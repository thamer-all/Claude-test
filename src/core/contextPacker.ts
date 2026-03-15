/**
 * Context packer — the killer feature.
 *
 * Analyzes a repository, categorizes files, ranks them by likely usefulness,
 * and builds an optimal pack plan that maximizes value within a context
 * window budget.
 */

import { resolve, basename, dirname } from 'node:path';

import type {
  PackPlan,
  FileTokenInfo,
} from '../types/context.js';
import type { ClaudeTestConfig } from '../types/config.js';
import { analyzeContext } from './contextAnalyzer.js';
import { walkDirectory, readTextFile } from '../utils/fs.js';
import { estimateTokens } from '../tokenizers/claudeTokenizer.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PackOptions {
  target: '200k' | '1m';
  optimize?: boolean;
  config?: ClaudeTestConfig;
}

type FileCategory = 'core' | 'docs' | 'configs' | 'tests' | 'assets' | 'generated';

interface CategorizedFile extends FileTokenInfo {
  category: FileCategory;
  priority: number; // Higher = more valuable
}

// ---------------------------------------------------------------------------
// File categorization heuristics
// ---------------------------------------------------------------------------

/** Extensions that indicate core source code. */
const CORE_SOURCE_EXTENSIONS = new Set([
  '.ts', '.js', '.py', '.go', '.rs', '.java', '.rb',
  '.tsx', '.jsx', '.vue', '.svelte', '.swift', '.kt',
  '.cs', '.cpp', '.c', '.h', '.hpp', '.scala', '.clj',
  '.ex', '.exs', '.hs', '.ml', '.mli', '.php',
]);

/** Extensions that indicate documentation. */
const DOC_EXTENSIONS = new Set([
  '.md', '.txt', '.rst', '.adoc', '.org',
]);

/** Extensions that indicate config files. */
const CONFIG_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.env.example', '.editorconfig', '.prettierrc',
]);

/** Directories that indicate core source code. */
const CORE_DIRS = new Set([
  'src', 'lib', 'app', 'apps', 'packages', 'modules',
  'components', 'pages', 'views', 'controllers', 'services',
  'models', 'utils', 'helpers', 'core',
]);

/** Directories that indicate test code. */
const TEST_DIRS = new Set([
  'test', 'tests', '__tests__', 'spec', 'specs',
  'e2e', 'integration', 'unit', 'fixtures',
]);

/** Directories that indicate generated/build output. */
const GENERATED_DIRS = new Set([
  'dist', 'build', '.next', '.nuxt', 'coverage', 'out',
  '.output', '.cache', '.turbo', 'target',
]);

/** Directories that indicate documentation. */
const DOC_DIRS = new Set([
  'docs', 'doc', 'documentation', 'wiki',
]);

/** File name patterns for test files. */
const TEST_FILE_PATTERNS = [
  /\.test\.\w+$/,
  /\.spec\.\w+$/,
  /_test\.\w+$/,
  /_spec\.\w+$/,
  /test_.*\.\w+$/,
];

/** File names that are documentation regardless of extension. */
const DOC_FILE_NAMES = new Set([
  'readme', 'changelog', 'changes', 'history',
  'contributing', 'license', 'authors', 'todo',
  'claude.md', 'claude',
]);

/** Config file names (exact match, case-insensitive). */
const CONFIG_FILE_NAMES = new Set([
  'package.json', 'tsconfig.json', 'jest.config.js',
  'vite.config.ts', 'webpack.config.js', 'rollup.config.js',
  'babel.config.js', '.babelrc', '.eslintrc', '.eslintrc.js',
  '.eslintrc.json', '.prettierrc', '.prettierrc.js',
  'tailwind.config.js', 'tailwind.config.ts',
  'postcss.config.js', 'next.config.js', 'next.config.mjs',
  'nuxt.config.ts', 'svelte.config.js',
  'docker-compose.yml', 'docker-compose.yaml',
  'dockerfile', 'makefile', 'cargo.toml', 'go.mod',
  'go.sum', 'requirements.txt', 'pyproject.toml',
  'gemfile', 'mix.exs', 'build.gradle', 'pom.xml',
]);

// ---------------------------------------------------------------------------
// Categorization logic
// ---------------------------------------------------------------------------

function categorizeFile(relativePath: string, extension: string): FileCategory {
  const lowerPath = relativePath.toLowerCase();
  const fileName = basename(lowerPath);
  const dirParts = dirname(lowerPath).split('/').filter(Boolean);

  // Check if it's in a generated directory
  for (const part of dirParts) {
    if (GENERATED_DIRS.has(part)) {
      return 'generated';
    }
  }

  // Check if it's a test file by name pattern
  for (const pattern of TEST_FILE_PATTERNS) {
    if (pattern.test(fileName)) {
      return 'tests';
    }
  }

  // Check if it's in a test directory
  for (const part of dirParts) {
    if (TEST_DIRS.has(part)) {
      return 'tests';
    }
  }

  // Check if it's a known config file
  if (CONFIG_FILE_NAMES.has(fileName)) {
    return 'configs';
  }

  // Check if it's a documentation file
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, '');
  if (DOC_FILE_NAMES.has(nameWithoutExt)) {
    return 'docs';
  }

  // Check by directory
  for (const part of dirParts) {
    if (DOC_DIRS.has(part)) {
      return 'docs';
    }
  }

  // Check by extension
  if (DOC_EXTENSIONS.has(extension)) {
    return 'docs';
  }

  if (CONFIG_EXTENSIONS.has(extension)) {
    return 'configs';
  }

  if (CORE_SOURCE_EXTENSIONS.has(extension)) {
    // Bonus: check if in a core directory
    return 'core';
  }

  return 'assets';
}

/**
 * Assign a priority score to a categorized file.
 * Higher scores = higher priority for inclusion.
 */
function assignPriority(file: CategorizedFile): number {
  const dirParts = dirname(file.path).split('/').filter(Boolean);
  let priority = 0;

  switch (file.category) {
    case 'core':
      priority = 100;
      // Boost files in core directories
      for (const part of dirParts) {
        if (CORE_DIRS.has(part)) {
          priority += 20;
          break;
        }
      }
      // Boost smaller files (more likely to be focused modules)
      if (file.estimatedTokens < 500) priority += 10;
      if (file.estimatedTokens < 200) priority += 5;
      break;
    case 'docs':
      priority = 60;
      // Boost README and CLAUDE.md
      const fileName = basename(file.path).toLowerCase();
      if (fileName === 'readme.md' || fileName === 'readme') priority += 30;
      if (fileName === 'claude.md') priority += 25;
      if (fileName === 'changelog.md') priority += 10;
      break;
    case 'configs':
      priority = 50;
      // Boost root-level configs
      if (dirParts.length <= 1) priority += 15;
      break;
    case 'tests':
      priority = 30;
      break;
    case 'generated':
      priority = 5;
      break;
    case 'assets':
      priority = 10;
      break;
  }

  return priority;
}

// ---------------------------------------------------------------------------
// Budget allocation
// ---------------------------------------------------------------------------

interface BudgetAllocation {
  systemPrompt: number;
  coreFiles: number;
  docs: number;
  toolMeta: number;
  free: number;
}

function allocateBudgets(
  targetTokens: number,
  config?: ClaudeTestConfig,
): BudgetAllocation {
  const budgets = config?.contextBudgets;

  // Normalize: if values are > 1, they're percentages (e.g. 10 = 10%); convert to fractions
  const norm = (v: number | undefined, fallback: number): number => {
    const val = v ?? fallback;
    return val > 1 ? val / 100 : val;
  };

  const systemPromptFrac = norm(budgets?.systemPrompt, 0.10);
  const coreFilesFrac = norm(budgets?.coreFiles, 0.50);
  const docsFrac = norm(budgets?.docs, 0.20);
  const toolMetaFrac = norm(budgets?.toolMeta, 0.10);
  const freeFrac = 1.0 - systemPromptFrac - coreFilesFrac - docsFrac - toolMetaFrac;

  return {
    systemPrompt: Math.round(targetTokens * systemPromptFrac),
    coreFiles: Math.round(targetTokens * coreFilesFrac),
    docs: Math.round(targetTokens * docsFrac),
    toolMeta: Math.round(targetTokens * toolMetaFrac),
    free: Math.round(targetTokens * Math.max(freeFrac, 0)),
  };
}

// ---------------------------------------------------------------------------
// Packing algorithm
// ---------------------------------------------------------------------------

/**
 * Pack files into budget buckets using a greedy approach.
 * Files are sorted by priority (descending), then by token count (ascending)
 * to maximize the number of high-value files that fit.
 */
function packFiles(
  files: CategorizedFile[],
  budgets: BudgetAllocation,
): { included: CategorizedFile[]; summarize: CategorizedFile[]; excluded: CategorizedFile[] } {
  const included: CategorizedFile[] = [];
  const summarize: CategorizedFile[] = [];
  const excluded: CategorizedFile[] = [];

  // Sort by priority desc, then by token count asc (fit more smaller files)
  const sorted = [...files].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.estimatedTokens - b.estimatedTokens;
  });

  // Track remaining budget per category
  const remaining: Record<FileCategory, number> = {
    core: budgets.coreFiles,
    docs: budgets.docs,
    configs: budgets.toolMeta,
    tests: budgets.free,
    assets: 0,
    generated: 0,
  };

  // Also track a spillover budget from free allocation
  let spillover = budgets.free;

  for (const file of sorted) {
    const categoryBudget = remaining[file.category];

    if (file.category === 'generated' || file.category === 'assets') {
      excluded.push(file);
      continue;
    }

    if (file.estimatedTokens <= categoryBudget) {
      // Fits in its category budget
      remaining[file.category] -= file.estimatedTokens;
      included.push(file);
    } else if (file.estimatedTokens <= spillover) {
      // Fits in the spillover/free budget
      spillover -= file.estimatedTokens;
      included.push(file);
    } else if (file.estimatedTokens > 2000 && file.category === 'core') {
      // Large core file: recommend summarizing
      summarize.push(file);
    } else {
      excluded.push(file);
    }
  }

  return { included, summarize, excluded };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an optimized context pack plan for a repository.
 *
 * 1. Analyzes the repo using contextAnalyzer
 * 2. Categorizes files (core, docs, configs, tests, assets, generated)
 * 3. Ranks files by likely usefulness
 * 4. Allocates budgets per category
 * 5. Packs files greedily into the target context window
 * 6. Returns a plan with include/summarize/exclude recommendations
 */
export async function packContext(
  rootPath: string,
  options: PackOptions,
): Promise<PackPlan> {
  const absoluteRoot = resolve(rootPath);
  const targetTokens = options.target === '200k' ? 200_000 : 1_000_000;
  const targetLabel = options.target === '200k' ? '200k' : '1M';

  logger.debug(`Packing context for ${absoluteRoot} (target: ${targetLabel})`);

  // Step 1: Run the full analysis (used for validation / logging)
  await analyzeContext(absoluteRoot, options.config);

  // Step 2 & 3: Categorize and rank all text files
  const ignoreDirs = new Set([
    'node_modules', '.git', 'dist', 'build', 'coverage',
    '.DS_Store', '__pycache__', '.next', '.nuxt', '.svelte-kit',
    '.turbo', '.vercel', 'vendor', '.venv', 'env', '.env',
  ]);
  if (options.config?.ignorePaths) {
    for (const p of options.config.ignorePaths) {
      ignoreDirs.add(p);
    }
  }

  const entries = await walkDirectory(absoluteRoot, { ignoreDirs });
  const fileEntries = entries.filter((e) => e.isFile);

  const categorizedFiles: CategorizedFile[] = [];

  for (const entry of fileEntries) {
    // Skip binary extensions
    const binaryExts = new Set([
      '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2',
      '.ttf', '.eot', '.mp3', '.mp4', '.zip', '.tar', '.gz',
      '.pdf', '.exe', '.dll', '.so', '.dylib', '.class', '.pyc',
      '.o', '.obj', '.bin', '.dat', '.sqlite', '.db',
    ]);

    if (binaryExts.has(entry.extension)) {
      continue;
    }

    const content = await readTextFile(entry.path);
    if (content === null) {
      continue;
    }

    const tokens = estimateTokens(content);
    const category = categorizeFile(entry.relativePath, entry.extension);

    const file: CategorizedFile = {
      path: entry.relativePath,
      bytes: entry.size,
      estimatedTokens: tokens,
      category,
      priority: 0,
    };

    file.priority = assignPriority(file);
    categorizedFiles.push(file);
  }

  // Step 4: Allocate budgets
  const budgets = allocateBudgets(targetTokens, options.config);

  // Step 5: Pack files into budgets
  const { included, summarize, excluded } = packFiles(categorizedFiles, budgets);

  // Calculate total tokens for included files
  const totalIncluded = included.reduce(
    (sum, f) => sum + f.estimatedTokens,
    0,
  );

  // Strip category/priority from the public FileTokenInfo results
  const toFileTokenInfo = (f: CategorizedFile): FileTokenInfo => ({
    path: f.path,
    bytes: f.bytes,
    estimatedTokens: f.estimatedTokens,
  });

  const plan: PackPlan = {
    target: targetTokens,
    targetLabel,
    systemPromptBudget: budgets.systemPrompt,
    coreFilesBudget: budgets.coreFiles,
    docsBudget: budgets.docs,
    toolMetaBudget: budgets.toolMeta,
    remainingFree: budgets.free,
    includeFirst: included.map(toFileTokenInfo),
    summarize: summarize.map(toFileTokenInfo),
    exclude: excluded.map(toFileTokenInfo),
    totalEstimatedTokens: totalIncluded,
  };

  logger.debug(
    `Pack plan: ${included.length} include, ${summarize.length} summarize, ${excluded.length} exclude (${totalIncluded} tokens)`,
  );

  return plan;
}
