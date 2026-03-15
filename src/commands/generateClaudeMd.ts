/**
 * `codeprobe generate-claudemd [path]` — Auto-generate a CLAUDE.md file
 * based on repository analysis.
 *
 * Scans the directory for tech stack indicators, context budget, Claude
 * assets, and key files, then produces a CLAUDE.md that helps Claude Code
 * understand the project.
 */

import { Command } from 'commander';
import { stat, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { analyzeContext } from '../core/contextAnalyzer.js';
import { scanForClaudeAssets } from '../core/agentTracer.js';
import { readTextFile, fileExists } from '../utils/fs.js';
import { resolvePath } from '../utils/paths.js';
import { formatTokens } from '../utils/output.js';

// -----------------------------------------------------------------------
// Tech stack detection: map indicator files to technology names
// -----------------------------------------------------------------------

interface TechIndicator {
  file: string;
  tech: string;
}

const TECH_INDICATORS: ReadonlyArray<TechIndicator> = [
  { file: 'package.json', tech: 'Node.js / TypeScript / JavaScript' },
  { file: 'go.mod', tech: 'Go' },
  { file: 'requirements.txt', tech: 'Python' },
  { file: 'pyproject.toml', tech: 'Python' },
  { file: 'Cargo.toml', tech: 'Rust' },
  { file: 'pom.xml', tech: 'Java' },
  { file: 'build.gradle', tech: 'Java' },
  { file: 'Gemfile', tech: 'Ruby' },
  { file: 'mix.exs', tech: 'Elixir' },
];

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/**
 * Detect technologies present in the target directory by checking for
 * well-known build/config files.
 */
async function detectTechStack(targetPath: string): Promise<string[]> {
  const detected: string[] = [];
  const seen = new Set<string>();

  for (const indicator of TECH_INDICATORS) {
    const indicatorPath = resolve(targetPath, indicator.file);
    if (await fileExists(indicatorPath)) {
      if (!seen.has(indicator.tech)) {
        seen.add(indicator.tech);
        detected.push(indicator.tech);
      }
    }
  }

  // Check for .csproj files (glob-style — just look for any in root)
  const { walkDirectory } = await import('../utils/fs.js');
  const entries = await walkDirectory(targetPath, {
    ignoreDirs: new Set([
      'node_modules', '.git', 'dist', 'build', 'coverage',
      '__pycache__', '.next', '.nuxt', 'vendor', '.venv',
    ]),
  });

  const hasCsproj = entries.some(
    (e) => e.isFile && e.extension === '.csproj',
  );
  if (hasCsproj && !seen.has('.NET / C#')) {
    detected.push('.NET / C#');
  }

  return detected;
}

interface PackageInfo {
  name: string;
  description: string;
}

/**
 * Read project name and description from package.json if it exists.
 */
async function readPackageJson(
  targetPath: string,
): Promise<PackageInfo | null> {
  const pkgPath = resolve(targetPath, 'package.json');
  const content = await readTextFile(pkgPath);
  if (content === null) return null;

  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null) {
      const pkg = parsed as Record<string, unknown>;
      return {
        name: typeof pkg['name'] === 'string' ? pkg['name'] : '',
        description:
          typeof pkg['description'] === 'string' ? pkg['description'] : '',
      };
    }
  } catch {
    // Invalid JSON — ignore
  }

  return null;
}

/**
 * Build the directory structure section by summarizing top-level dirs
 * with file counts.
 */
function buildDirectorySection(
  entries: Array<{
    relativePath: string;
    isFile: boolean;
    isDirectory: boolean;
  }>,
): string {
  const dirCounts = new Map<string, number>();

  for (const entry of entries) {
    if (!entry.isFile) continue;
    const parts = entry.relativePath.split(/[/\\]/);
    const topDir = parts.length > 1 ? parts[0]! : '(root)';
    dirCounts.set(topDir, (dirCounts.get(topDir) ?? 0) + 1);
  }

  // Sort by file count descending
  const sorted = Array.from(dirCounts.entries()).sort(
    (a, b) => b[1] - a[1],
  );

  if (sorted.length === 0) return '_No files found._';

  const lines: string[] = [];
  for (const [dir, count] of sorted.slice(0, 15)) {
    lines.push(`- \`${dir}/\` — ${count} file${count === 1 ? '' : 's'}`);
  }
  if (sorted.length > 15) {
    lines.push(`- _...and ${sorted.length - 15} more directories_`);
  }

  return lines.join('\n');
}

/**
 * Generate the full CLAUDE.md content string.
 */
async function generateClaudeMdContent(
  targetPath: string,
): Promise<string> {
  const absolutePath = resolve(targetPath);
  const dirName = basename(absolutePath);

  // Run analysis in parallel
  const [analysis, assets, techStack, pkgInfo] = await Promise.all([
    analyzeContext(absolutePath),
    scanForClaudeAssets(absolutePath),
    detectTechStack(absolutePath),
    readPackageJson(absolutePath),
  ]);

  // Project title
  const projectName = pkgInfo?.name || dirName;
  const description =
    pkgInfo?.description || `Project at \`${dirName}\``;

  // Directory structure from walk entries (re-use analysis data for file entries)
  // We need to walk again to get directory entries for the structure section.
  const { walkDirectory } = await import('../utils/fs.js');
  const allEntries = await walkDirectory(absolutePath, {
    ignoreDirs: new Set([
      'node_modules', '.git', 'dist', 'build', 'coverage',
      '__pycache__', '.next', '.nuxt', 'vendor', '.venv',
    ]),
  });

  const directorySection = buildDirectorySection(allEntries);

  // Tech stack section
  const techStackSection =
    techStack.length > 0
      ? techStack.map((t) => `- ${t}`).join('\n')
      : '- _No recognized tech stack detected_';

  // Context budget section
  const fit200k = analysis.fitEstimates.find(
    (f) => f.windowLabel === '200k',
  );
  const fit1M = analysis.fitEstimates.find(
    (f) => f.windowLabel === '1M',
  );

  const fitsLabel = (
    fits: boolean,
    utilization: number,
  ): string => {
    const pct = (utilization * 100).toFixed(1);
    return fits ? `fits (${pct}% utilization)` : `doesn't fit (${pct}% utilization)`;
  };

  const contextBudgetLines = [
    `- Total files: ${analysis.totalFiles}`,
    `- Estimated tokens: ${formatTokens(analysis.estimatedTokens)}`,
  ];

  if (fit200k) {
    contextBudgetLines.push(
      `- 200k window: ${fitsLabel(fit200k.fits, fit200k.utilization)}`,
    );
  }
  if (fit1M) {
    contextBudgetLines.push(
      `- 1M window: ${fitsLabel(fit1M.fits, fit1M.utilization)}`,
    );
  }

  // Build & Run section
  let buildRunSection: string;
  if (pkgInfo) {
    buildRunSection = [
      '```bash',
      'npm install',
      'npm run build',
      'npm test',
      'npm start',
      '```',
    ].join('\n');
  } else {
    buildRunSection = '_Add build and run instructions here._';
  }

  // Claude Assets Found section
  let claudeAssetsSection: string;
  if (assets.length > 0) {
    claudeAssetsSection = assets
      .map(
        (a) =>
          `- \`${a.path.replace(absolutePath + '/', '')}\` — ${a.type} (${a.confidence} confidence)`,
      )
      .join('\n');
  } else {
    claudeAssetsSection = '_No Claude Code assets found (no CLAUDE.md, .claude/, skills, hooks, or MCP configs)._';
  }

  // Key Files section (top 10 by token count)
  const topFiles = analysis.largestFiles.slice(0, 10);
  let keyFilesSection: string;
  if (topFiles.length > 0) {
    keyFilesSection = topFiles
      .map(
        (f) =>
          `- \`${f.path}\` — ${formatTokens(f.estimatedTokens)} tokens`,
      )
      .join('\n');
  } else {
    keyFilesSection = '_No text files found._';
  }

  // Context Strategy section
  let strategySection: string;
  if (fit200k?.fits) {
    strategySection =
      'Repository fits comfortably in the 200k context window. Full codebase can be included.';
  } else if (fit1M?.fits) {
    strategySection =
      'Repository fits in the 1M window but exceeds 200k. Use `codeprobe pack --target 200k` to identify priority files.';
  } else {
    strategySection =
      'Repository exceeds context windows. Focus on specific modules. Use `codeprobe pack` to build a targeted context plan.';
  }

  // Assemble the final document
  const sections = [
    `# ${projectName}`,
    '',
    '## Overview',
    description,
    '',
    '## Tech Stack',
    techStackSection,
    '',
    '## Project Structure',
    directorySection,
    '',
    '## Context Budget',
    contextBudgetLines.join('\n'),
    '',
    '## Build & Run',
    buildRunSection,
    '',
    '## Claude Assets Found',
    claudeAssetsSection,
    '',
    '## Key Files',
    keyFilesSection,
    '',
    '## Context Strategy',
    strategySection,
    '',
  ];

  return sections.join('\n');
}

// -----------------------------------------------------------------------
// Command registration
// -----------------------------------------------------------------------

export function registerGenerateClaudeMdCommand(program: Command): void {
  program
    .command('generate-claudemd [path]')
    .description(
      'Auto-generate a CLAUDE.md file based on repository analysis',
    )
    .option('--dry-run', 'Print to stdout instead of writing a file')
    .option('--output <file>', 'Custom output path (default: CLAUDE.md)')
    .action(
      async (
        pathArg: string | undefined,
        options: { dryRun?: boolean; output?: string },
      ) => {
        const targetPath = resolvePath(pathArg ?? '.');

        // Validate the target path exists and is a directory
        try {
          const s = await stat(targetPath);
          if (!s.isDirectory()) {
            console.error(`Error: not a directory: ${targetPath}`);
            process.exitCode = 1;
            return;
          }
        } catch {
          console.error(`Error: path not found: ${targetPath}`);
          process.exitCode = 1;
          return;
        }

        const chalk = (await import('chalk')).default;

        if (!options.dryRun) {
          console.log(
            chalk.dim('Analyzing repository...'),
          );
        }

        const content = await generateClaudeMdContent(targetPath);

        if (options.dryRun) {
          console.log(content);
          return;
        }

        const outputPath = options.output
          ? resolvePath(options.output)
          : resolve(targetPath, 'CLAUDE.md');

        await writeFile(outputPath, content, 'utf-8');
        console.log(
          chalk.green(`CLAUDE.md written to ${outputPath}`),
        );
      },
    );
}
