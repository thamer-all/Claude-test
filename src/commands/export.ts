/**
 * `codeprobe export [path]` — Pack a repository into a single AI-friendly file.
 *
 * Replaces the need for tools like Repomix/Code2Prompt by producing a single
 * file containing the full repo tree and file contents, formatted for
 * consumption by LLMs.
 *
 * Supports markdown, XML, and plain text output formats.
 */

import { Command } from 'commander';
import { writeFile, readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { resolvePath } from '../utils/paths.js';
import { walkDirectory, getRelativePath } from '../utils/fs.js';
import { estimateTokens } from '../tokenizers/claudeTokenizer.js';
import { formatTokens, formatPercentage } from '../utils/output.js';
import { getModel } from '../core/modelRegistry.js';
import { setLogLevel } from '../utils/logger.js';

/** Directories to always skip. */
const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '__pycache__', '.venv', 'vendor',
  '.cache', '.turbo',
]);

/** Lock / dependency-resolution files — always excluded. */
const EXCLUDED_FILENAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  'composer.lock', 'gemfile.lock', 'poetry.lock', 'cargo.lock',
  'go.sum', 'flake.lock', 'packages.lock.json', 'shrinkwrap.json',
]);

/** Binary file extensions — always excluded. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.avif',
  '.svg', '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.webm',
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  '.sqlite', '.db',
  '.wasm',
]);

/** Core source code extensions — highest priority. */
const CORE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
  '.rb', '.c', '.cpp', '.h', '.cs', '.swift', '.kt', '.scala',
]);

/** Documentation extensions — second priority. */
const DOC_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt', '.rst', '.adoc',
]);

/** Config file extensions — third priority. */
const CONFIG_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.toml', '.xml', '.env',
  '.gitignore', '.dockerignore',
]);

/** Test path patterns — lowest priority. */
const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /__tests__\//, /\/test\//,
];

const TARGET_SIZES: Record<string, number> = {
  '200k': 200_000,
  '1m': 1_000_000,
};

type OutputFormat = 'markdown' | 'xml' | 'text';

interface FileEntry {
  relativePath: string;
  absolutePath: string;
  tokens: number;
  priority: number;
  language: string;
}

/**
 * Infer language identifier from file extension for fenced code blocks.
 */
function inferLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const languageMap: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
    '.mjs': 'javascript', '.cjs': 'javascript',
    '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust',
    '.java': 'java', '.kt': 'kotlin', '.scala': 'scala',
    '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp', '.cs': 'csharp',
    '.swift': 'swift', '.sh': 'bash', '.bash': 'bash', '.zsh': 'zsh',
    '.md': 'markdown', '.mdx': 'mdx',
    '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
    '.xml': 'xml', '.html': 'html', '.css': 'css', '.scss': 'scss',
    '.sql': 'sql', '.graphql': 'graphql',
    '.dockerfile': 'dockerfile',
  };
  return languageMap[ext] ?? '';
}

/**
 * Assign a priority score to a file. Lower number = higher priority.
 *   0 = core source, 1 = docs, 2 = configs, 3 = tests, 4 = other
 */
function prioritize(relativePath: string): number {
  const ext = extname(relativePath).toLowerCase();

  // Tests are lowest priority
  if (TEST_PATTERNS.some((p) => p.test(relativePath))) return 3;

  if (CORE_EXTENSIONS.has(ext)) return 0;
  if (DOC_EXTENSIONS.has(ext)) return 1;
  if (CONFIG_EXTENSIONS.has(ext)) return 2;
  return 4;
}

/**
 * Check whether a glob-like pattern matches a file path.
 * Supports simple patterns: *.ts, src/**, *.test.ts, etc.
 */
function matchesGlob(filePath: string, pattern: string): boolean {
  // Exact filename match
  if (basename(filePath) === pattern) return true;

  // Extension match: *.ts
  if (pattern.startsWith('*.') && filePath.endsWith(pattern.slice(1))) return true;

  // Directory prefix match: src/**
  if (pattern.endsWith('/**') && filePath.startsWith(pattern.slice(0, -3))) return true;

  // Simple contains match
  if (filePath.includes(pattern)) return true;

  return false;
}

/**
 * Build a compact tree representation: show directories as nodes
 * and files as leaves, with proper indentation.
 */
function buildCompactTree(sortedPaths: string[]): string {
  interface TreeNode {
    children: Map<string, TreeNode>;
    isFile: boolean;
  }

  const root: TreeNode = { children: new Map(), isFile: false };

  // Build tree structure
  for (const filePath of sortedPaths) {
    const parts = filePath.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (!current.children.has(part)) {
        current.children.set(part, { children: new Map(), isFile: i === parts.length - 1 });
      }
      current = current.children.get(part)!;
    }
  }

  // Render tree
  const lines: string[] = [];

  function render(node: TreeNode, prefix: string): void {
    const entries = Array.from(node.children.entries()).sort(([a, nodeA], [b, nodeB]) => {
      // Directories first, then files
      if (!nodeA.isFile && nodeB.isFile) return -1;
      if (nodeA.isFile && !nodeB.isFile) return 1;
      return a.localeCompare(b);
    });

    for (const [name, child] of entries) {
      if (child.isFile) {
        lines.push(`${prefix}${name}`);
      } else {
        lines.push(`${prefix}${name}/`);
        render(child, prefix + '  ');
      }
    }
  }

  render(root, '');
  return lines.join('\n');
}

/**
 * Format the export in markdown.
 */
function formatMarkdown(
  projectName: string,
  fileCount: number,
  totalTokens: number,
  targetLabel: string,
  fileTree: string,
  files: Array<{ relativePath: string; content: string; language: string }>,
  includeTree: boolean,
): string {
  const parts: string[] = [];

  parts.push(`# Repository Export: ${projectName}`);
  parts.push(`> Generated by codeprobe | ${fileCount} files | ${formatTokens(totalTokens)} tokens | Target: ${targetLabel}`);
  parts.push('');

  if (includeTree) {
    parts.push('## File Tree');
    parts.push('```');
    parts.push(fileTree);
    parts.push('```');
    parts.push('');
  }

  parts.push('## Files');
  parts.push('');

  for (const file of files) {
    parts.push(`### ${file.relativePath}`);
    parts.push(`\`\`\`${file.language}`);
    parts.push(file.content);
    parts.push('```');
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Format the export in XML.
 */
function formatXml(
  projectName: string,
  fileCount: number,
  totalTokens: number,
  files: Array<{ relativePath: string; content: string; language: string; tokens: number }>,
): string {
  const parts: string[] = [];

  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(`<repository name="${escapeXml(projectName)}" files="${fileCount}" tokens="${totalTokens}">`);

  for (const file of files) {
    parts.push(`<file path="${escapeXml(file.relativePath)}" language="${escapeXml(file.language)}" tokens="${file.tokens}">`);
    parts.push(escapeXml(file.content));
    parts.push('</file>');
  }

  parts.push('</repository>');

  return parts.join('\n');
}

/**
 * Escape special XML characters.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format the export in plain text.
 */
function formatText(
  projectName: string,
  fileCount: number,
  totalTokens: number,
  targetLabel: string,
  fileTree: string,
  files: Array<{ relativePath: string; content: string }>,
  includeTree: boolean,
): string {
  const parts: string[] = [];

  parts.push(`=== Repository: ${projectName} ===`);
  parts.push(`Files: ${fileCount} | Tokens: ${formatTokens(totalTokens)} | Target: ${targetLabel}`);
  parts.push('');

  if (includeTree) {
    parts.push('--- File Tree ---');
    parts.push(fileTree);
    parts.push('');
  }

  for (const file of files) {
    parts.push(`--- ${file.relativePath} ---`);
    parts.push(file.content);
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Determine the default output file extension based on format.
 */
function defaultOutputPath(format: OutputFormat): string {
  switch (format) {
    case 'xml': return 'codeprobe-export.xml';
    case 'text': return 'codeprobe-export.txt';
    case 'markdown': return 'codeprobe-export.md';
  }
}

export function registerExportCommand(program: Command): void {
  program
    .command('export [path]')
    .description('Pack a repository into a single AI-friendly file')
    .option('--output <file>', 'Output file path')
    .option('--format <format>', 'Output format: text, xml, markdown', 'markdown')
    .option('--target <target>', 'Target context window: 200k, 1m', '1m')
    .option('--model <model>', 'Use a model\'s context window as the target')
    .option('--include <glob>', 'Include only matching files')
    .option('--exclude <glob>', 'Exclude matching files')
    .option('--no-tree', 'Skip the file tree header')
    .option('--json', 'Output metadata as JSON (does not write the export file)')
    .action(async (
      pathArg: string | undefined,
      options: {
        output?: string;
        format: string;
        target: string;
        model?: string;
        include?: string;
        exclude?: string;
        tree: boolean;
        json?: boolean;
      },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? '.');

      try {
        await stat(targetPath);
      } catch {
        console.error(`Error: path not found: ${targetPath}`);
        process.exitCode = 1;
        return;
      }

      // Validate format
      const format = options.format.toLowerCase() as OutputFormat;
      if (!['markdown', 'xml', 'text'].includes(format)) {
        console.error(`Error: unknown format "${options.format}". Use "markdown", "xml", or "text".`);
        process.exitCode = 1;
        return;
      }

      // Resolve target context window size
      let targetSize: number;
      let targetLabel: string;

      if (options.model) {
        const modelInfo = getModel(options.model);
        if (!modelInfo) {
          console.error(`Error: unknown model "${options.model}". Use a model id from the registry (e.g., gpt-4o, claude-sonnet-4-6, gemini-2.5-pro).`);
          process.exitCode = 1;
          return;
        }
        targetSize = modelInfo.contextWindow;
        targetLabel = `${modelInfo.name} (${formatTokens(targetSize)})`;
      } else {
        const label = options.target.toLowerCase();
        const size = TARGET_SIZES[label];
        if (!size) {
          console.error(`Error: unknown target "${options.target}". Use "200k" or "1m".`);
          process.exitCode = 1;
          return;
        }
        targetSize = size;
        targetLabel = options.target.toUpperCase();
      }

      // Walk directory and collect text files
      const entries = await walkDirectory(targetPath, { ignoreDirs: DEFAULT_IGNORE_DIRS });
      const fileEntries = entries.filter((e) => e.isFile && e.size < 1_000_000);

      const candidates: FileEntry[] = [];

      for (const entry of fileEntries) {
        const fileName = basename(entry.path).toLowerCase();
        const ext = extname(entry.path).toLowerCase();
        const rel = getRelativePath(targetPath, entry.path);

        // Skip lock files
        if (EXCLUDED_FILENAMES.has(fileName)) continue;

        // Skip binary files
        if (BINARY_EXTENSIONS.has(ext)) continue;

        // Apply --include filter
        if (options.include && !matchesGlob(rel, options.include)) continue;

        // Apply --exclude filter
        if (options.exclude && matchesGlob(rel, options.exclude)) continue;

        // Try to read as text
        let content: string;
        try {
          content = await readFile(entry.path, 'utf-8');
        } catch {
          continue;
        }

        // Skip files that appear to be binary (contain null bytes in first 8k)
        if (content.slice(0, 8192).includes('\0')) continue;

        const tokens = estimateTokens(content);

        candidates.push({
          relativePath: rel,
          absolutePath: entry.path,
          tokens,
          priority: prioritize(rel),
          language: inferLanguage(entry.path),
        });
      }

      // Sort by priority (ascending), then by token count (ascending within same priority)
      candidates.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.tokens - b.tokens;
      });

      // Pack files into the budget
      const packedFiles: FileEntry[] = [];
      let usedTokens = 0;

      for (const file of candidates) {
        if (usedTokens + file.tokens <= targetSize) {
          packedFiles.push(file);
          usedTokens += file.tokens;
        }
      }

      // If --json, output metadata and exit
      if (options.json) {
        const metadata = {
          projectName: basename(targetPath),
          targetSize,
          targetLabel,
          format,
          totalFiles: packedFiles.length,
          totalTokens: usedTokens,
          utilization: usedTokens / targetSize,
          skippedFiles: candidates.length - packedFiles.length,
          files: packedFiles.map((f) => ({
            path: f.relativePath,
            tokens: f.tokens,
            priority: f.priority,
            language: f.language,
          })),
        };
        console.log(JSON.stringify(metadata, null, 2));
        return;
      }

      const projectName = basename(targetPath);

      // Sort packed files alphabetically for output
      packedFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

      // Build file tree
      const fileTree = buildCompactTree(packedFiles.map((f) => f.relativePath));

      // Read file contents
      const fileContents: Array<{
        relativePath: string;
        content: string;
        language: string;
        tokens: number;
      }> = [];

      for (const file of packedFiles) {
        try {
          const content = await readFile(file.absolutePath, 'utf-8');
          fileContents.push({
            relativePath: file.relativePath,
            content,
            language: file.language,
            tokens: file.tokens,
          });
        } catch {
          // Skip unreadable files
        }
      }

      // Generate output
      let output: string;

      switch (format) {
        case 'markdown':
          output = formatMarkdown(
            projectName,
            fileContents.length,
            usedTokens,
            targetLabel,
            fileTree,
            fileContents,
            options.tree,
          );
          break;
        case 'xml':
          output = formatXml(projectName, fileContents.length, usedTokens, fileContents);
          break;
        case 'text':
          output = formatText(
            projectName,
            fileContents.length,
            usedTokens,
            targetLabel,
            fileTree,
            fileContents,
            options.tree,
          );
          break;
      }

      // Determine output path
      const outputPath = resolvePath(options.output ?? defaultOutputPath(format));

      console.log(chalk.dim(`Exporting ${fileContents.length} files (${formatTokens(usedTokens)} tokens) to ${basename(outputPath)}...`));

      await writeFile(outputPath, output, 'utf-8');

      const utilization = targetSize > 0 ? usedTokens / targetSize : 0;

      console.log('');
      console.log(chalk.green(`Exported ${fileContents.length} files (${formatTokens(usedTokens)} tokens) to ${outputPath}`));
      console.log(chalk.dim(`Target: ${targetLabel} | Utilization: ${formatPercentage(utilization)}`));
    });
}
