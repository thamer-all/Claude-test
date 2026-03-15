/**
 * `codeprobe recommend [path]` — Analyze an entire project and give
 * actionable recommendations for improving prompt engineering practices.
 *
 * Checks for missing specs, untested prompts, missing configs, context
 * window overflows, security issues, and more.
 */

import { Command } from 'commander';
import { resolve, join } from 'node:path';
import { access } from 'node:fs/promises';
import { resolvePath } from '../utils/paths.js';
import { fileExists, isDirectory, walkDirectory, readTextFile } from '../utils/fs.js';
import { estimateTokens } from '../tokenizers/claudeTokenizer.js';
import { setLogLevel } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Recommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  title: string;
  description: string;
  command: string;
}

// ---------------------------------------------------------------------------
// Context window sizes for known models
// ---------------------------------------------------------------------------

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  'gpt-3.5-turbo': 16_385,
  'claude-sonnet-4-6': 200_000,
  'claude-opus-4-6': 200_000,
  'claude-3-5-sonnet': 200_000,
  'claude-3-opus': 200_000,
  'claude-3-haiku': 200_000,
};

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '__pycache__', '.venv', 'vendor',
  '.cache', '.turbo',
]);

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function findPromptSpecs(rootPath: string): Promise<string[]> {
  const { glob } = await import('glob');
  return glob(resolve(rootPath, '**/*.prompt.{yaml,yml}'), {
    absolute: true,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
  });
}

/**
 * Check 1: No prompt specs found.
 */
async function checkNoSpecs(rootPath: string): Promise<Recommendation | null> {
  const specs = await findPromptSpecs(rootPath);
  if (specs.length === 0) {
    return {
      priority: 'critical',
      category: 'Setup',
      title: 'No prompt specs found',
      description: 'Create prompt specs to test your AI prompts',
      command: 'codeprobe init',
    };
  }
  return null;
}

/**
 * Check 2: Prompt specs with no tests.
 */
async function checkSpecsWithoutTests(rootPath: string): Promise<Recommendation | null> {
  const yaml = (await import('js-yaml')).default;
  const specs = await findPromptSpecs(rootPath);
  const untested: string[] = [];

  for (const specFile of specs) {
    const content = await readTextFile(specFile);
    if (!content) continue;

    try {
      const parsed = yaml.load(content) as Record<string, unknown>;
      if (!parsed['tests'] || !Array.isArray(parsed['tests']) || parsed['tests'].length === 0) {
        const fileName = specFile.split('/').pop() ?? specFile;
        untested.push(fileName);
      }
    } catch {
      // Skip unparseable files
    }
  }

  if (untested.length > 0) {
    const first = untested[0]!;
    return {
      priority: 'high',
      category: 'Testing',
      title: `${untested.length} prompt spec${untested.length > 1 ? 's have' : ' has'} no tests`,
      description: 'Untested prompts may have regressions',
      command: `codeprobe autotest prompts/${first}`,
    };
  }
  return null;
}

/**
 * Check 3: No CLAUDE.md or .cursorrules.
 */
async function checkAiConfig(rootPath: string): Promise<Recommendation | null> {
  const claudeMdPath = join(rootPath, 'CLAUDE.md');
  const cursorRulesPath = join(rootPath, '.cursorrules');
  const windsurfPath = join(rootPath, '.windsurfrules');
  const copilotPath = join(rootPath, '.github', 'copilot-instructions.md');

  const hasClaudeMd = await fileExists(claudeMdPath);
  const hasCursorRules = await fileExists(cursorRulesPath);
  const hasWindsurf = await fileExists(windsurfPath);
  const hasCopilot = await fileExists(copilotPath);

  if (!hasClaudeMd && !hasCursorRules && !hasWindsurf && !hasCopilot) {
    return {
      priority: 'high',
      category: 'Configuration',
      title: 'No AI tool configuration found',
      description: 'No CLAUDE.md, .cursorrules, .windsurfrules, or copilot-instructions.md found',
      command: 'codeprobe generate-claudemd',
    };
  }

  if (!hasClaudeMd) {
    return {
      priority: 'medium',
      category: 'Configuration',
      title: 'No CLAUDE.md found',
      description: 'Add a CLAUDE.md for better Claude Code context',
      command: 'codeprobe generate-claudemd',
    };
  }

  return null;
}

/**
 * Check 4: Repo exceeds common context windows.
 */
async function checkContextWindow(rootPath: string): Promise<Recommendation | null> {
  const entries = await walkDirectory(rootPath, { ignoreDirs: DEFAULT_IGNORE_DIRS });
  const files = entries.filter((e) => e.isFile && e.size < 1_000_000);

  let totalTokens = 0;
  // Sample up to 200 files to avoid excessive I/O
  const sample = files.slice(0, 200);

  for (const file of sample) {
    const content = await readTextFile(file.path);
    if (!content) continue;
    totalTokens += estimateTokens(content);
  }

  // Extrapolate if we sampled
  if (files.length > sample.length) {
    totalTokens = Math.round(totalTokens * (files.length / sample.length));
  }

  // Check against GPT-4o (most common limit to exceed)
  const gpt4oLimit = MODEL_CONTEXT_WINDOWS['gpt-4o']!;
  if (totalTokens > gpt4oLimit) {
    const tokenStr = totalTokens > 1_000_000
      ? `${(totalTokens / 1_000_000).toFixed(1)}M`
      : `${Math.round(totalTokens / 1000)}k`;
    return {
      priority: 'high',
      category: 'Context',
      title: 'Repository exceeds GPT-4o context window',
      description: `~${tokenStr} tokens estimated, exceeds 128k window`,
      command: 'codeprobe pack . --model gpt-4o',
    };
  }

  return null;
}

/**
 * Check 5: Large files dominating tokens.
 */
async function checkLargeFiles(rootPath: string): Promise<Recommendation | null> {
  const entries = await walkDirectory(rootPath, { ignoreDirs: DEFAULT_IGNORE_DIRS });
  const files = entries.filter((e) => e.isFile && e.size > 50_000 && e.size < 1_000_000);

  if (files.length >= 3) {
    return {
      priority: 'medium',
      category: 'Context',
      title: `${files.length} large files may dominate token budget`,
      description: 'Review the top files by token count to optimize context',
      command: 'codeprobe heatmap --top 5',
    };
  }
  return null;
}

/**
 * Check 6: No .gitignore.
 */
async function checkGitignore(rootPath: string): Promise<Recommendation | null> {
  const gitignorePath = join(rootPath, '.gitignore');
  if (!(await fileExists(gitignorePath))) {
    return {
      priority: 'medium',
      category: 'Configuration',
      title: 'No .gitignore found',
      description: 'Add a .gitignore to exclude irrelevant files from context',
      command: 'echo "node_modules/\\ndist/\\ncoverage/" > .gitignore',
    };
  }
  return null;
}

/**
 * Check 7: Lock files present (informational).
 */
async function checkLockFiles(rootPath: string): Promise<Recommendation | null> {
  const lockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'];
  const found: string[] = [];

  for (const lock of lockFiles) {
    if (await fileExists(join(rootPath, lock))) {
      found.push(lock);
    }
  }

  if (found.length > 0) {
    return {
      priority: 'low',
      category: 'Context',
      title: 'Lock files present in repository',
      description: 'Lock files are excluded from pack by default, but verify they are not polluting context',
      command: 'codeprobe context .',
    };
  }
  return null;
}

/**
 * Check 8: No test history.
 */
async function checkTestHistory(rootPath: string): Promise<Recommendation | null> {
  const historyPath = join(rootPath, '.codeprobe', 'history');
  let hasHistory = false;
  try {
    await access(historyPath);
    hasHistory = true;
  } catch {
    // No history directory
  }

  if (!hasHistory) {
    return {
      priority: 'low',
      category: 'Testing',
      title: 'No test history',
      description: 'Start tracking test results over time',
      command: 'codeprobe test',
    };
  }
  return null;
}

/**
 * Check 9: Security issues in prompt specs.
 */
async function checkSecurityIssues(rootPath: string): Promise<Recommendation | null> {
  const specs = await findPromptSpecs(rootPath);
  if (specs.length === 0) return null;

  const injectionPattern = /ignore\s+(previous|above|all)\s+(instructions?|prompts?|rules?)/i;
  const secretPattern = /(?:api[_-]?key|apikey|secret|password|token)\s*[:=]\s*['"][^'"]{8,}/i;

  let issueCount = 0;
  for (const specFile of specs) {
    const content = await readTextFile(specFile);
    if (!content) continue;
    if (injectionPattern.test(content) || secretPattern.test(content)) {
      issueCount++;
    }
  }

  if (issueCount > 0) {
    return {
      priority: 'critical',
      category: 'Security',
      title: `Security issues found in ${issueCount} spec${issueCount > 1 ? 's' : ''}`,
      description: 'Potential injection patterns or leaked secrets detected',
      command: 'codeprobe security',
    };
  }
  return null;
}

/**
 * Check 10: Lint warnings in prompt specs.
 */
async function checkLintWarnings(rootPath: string): Promise<Recommendation | null> {
  const yaml = (await import('js-yaml')).default;
  const specs = await findPromptSpecs(rootPath);
  let warnings = 0;

  for (const specFile of specs) {
    const content = await readTextFile(specFile);
    if (!content) continue;

    try {
      const parsed = yaml.load(content) as Record<string, unknown>;
      if (!parsed['name']) warnings++;
      if (!parsed['prompt']) warnings++;
      if (!parsed['description']) warnings++;
    } catch {
      warnings++;
    }
  }

  if (warnings > 0) {
    return {
      priority: 'medium',
      category: 'Quality',
      title: `${warnings} lint warning${warnings > 1 ? 's' : ''} in prompt specs`,
      description: 'Fix lint issues to improve spec quality',
      command: 'codeprobe lint',
    };
  }
  return null;
}

/**
 * Check 11: No CI configured.
 */
async function checkCi(rootPath: string): Promise<Recommendation | null> {
  const ciPaths = [
    join(rootPath, '.github', 'workflows'),
    join(rootPath, '.gitlab-ci.yml'),
    join(rootPath, '.circleci'),
    join(rootPath, 'Jenkinsfile'),
  ];

  for (const ciPath of ciPaths) {
    try {
      await access(ciPath);
      return null; // CI found
    } catch {
      // Continue checking
    }
  }

  return {
    priority: 'medium',
    category: 'CI/CD',
    title: 'No CI configured',
    description: 'Add a CI workflow to run prompt tests automatically',
    command: 'codeprobe doctor',
  };
}

/**
 * Check 12: Multiple AI tool configs without coordination.
 */
async function checkMultipleAiConfigs(rootPath: string): Promise<Recommendation | null> {
  const configs: string[] = [];
  const paths: Array<[string, string]> = [
    [join(rootPath, 'CLAUDE.md'), 'CLAUDE.md'],
    [join(rootPath, '.cursorrules'), '.cursorrules'],
    [join(rootPath, '.windsurfrules'), '.windsurfrules'],
    [join(rootPath, '.github', 'copilot-instructions.md'), 'copilot-instructions.md'],
  ];

  for (const [path, name] of paths) {
    if (await fileExists(path)) {
      configs.push(name);
    }
  }

  if (configs.length >= 2) {
    return {
      priority: 'low',
      category: 'Configuration',
      title: 'Multiple AI tool configs detected',
      description: `Found: ${configs.join(', ')}. Consider keeping them in sync`,
      command: 'codeprobe generate-rules',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Score calculation
// ---------------------------------------------------------------------------

function calculateScore(recommendations: Recommendation[]): number {
  let score = 10;

  for (const rec of recommendations) {
    switch (rec.priority) {
      case 'critical': score -= 3; break;
      case 'high': score -= 2; break;
      case 'medium': score -= 1; break;
      case 'low': score -= 0.5; break;
    }
  }

  return Math.max(0, Math.min(10, Math.round(score)));
}

function getScoreMessage(score: number): string {
  if (score >= 9) return 'Excellent setup';
  if (score >= 7) return 'Good, minor improvements possible';
  if (score >= 5) return 'Room for improvement';
  if (score >= 3) return 'Needs attention';
  return 'Significant issues to address';
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function runRecommendations(rootPath: string): Promise<Recommendation[]> {
  const checks = [
    checkNoSpecs,
    checkSpecsWithoutTests,
    checkAiConfig,
    checkContextWindow,
    checkLargeFiles,
    checkGitignore,
    checkLockFiles,
    checkTestHistory,
    checkSecurityIssues,
    checkLintWarnings,
    checkCi,
    checkMultipleAiConfigs,
  ];

  const results = await Promise.all(checks.map((check) => check(rootPath)));
  const recommendations = results.filter((r): r is Recommendation => r !== null);

  // Sort by priority
  const priorityOrder: Record<Recommendation['priority'], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recommendations;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export function registerRecommendCommand(program: Command): void {
  program
    .command('recommend [path]')
    .description('Analyze project and give actionable recommendations for prompt engineering')
    .option('--json', 'Output recommendations as JSON')
    .action(async (
      pathArg: string | undefined,
      options: { json?: boolean },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? '.');

      if (!(await isDirectory(targetPath))) {
        console.error(chalk.red(`Error: path is not a directory: ${targetPath}`));
        process.exitCode = 1;
        return;
      }

      const recommendations = await runRecommendations(targetPath);
      const score = calculateScore(recommendations);

      if (options.json) {
        console.log(JSON.stringify({ recommendations, score }, null, 2));
        return;
      }

      console.log(chalk.bold('\nSmart Recommendations'));
      console.log('');

      if (recommendations.length === 0) {
        console.log(chalk.green('  No issues found — your project looks great!'));
        console.log('');
        console.log(chalk.bold(`  Score: ${score}/10 — ${getScoreMessage(score)}`));
        console.log('');
        return;
      }

      const priorityColor: Record<Recommendation['priority'], (s: string) => string> = {
        critical: chalk.bgRed.white,
        high: chalk.red,
        medium: chalk.yellow,
        low: chalk.blue,
      };

      for (const rec of recommendations) {
        const label = priorityColor[rec.priority](` ${rec.priority.toUpperCase()} `);
        console.log(`  ${label}  ${chalk.bold(rec.title)}`);
        console.log(`          ${rec.description}`);
        console.log(`          ${chalk.dim('\u2192 Run:')} ${chalk.cyan(rec.command)}`);
        console.log('');
      }

      console.log(chalk.bold(`  Score: ${score}/10 — ${getScoreMessage(score)}`));
      console.log('');
    });
}
