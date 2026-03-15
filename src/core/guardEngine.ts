/**
 * Guard engine — snapshot project health before AI sessions,
 * verify nothing broke after AI changes.
 *
 * Auto-detects tooling: tsc, vitest/jest/mocha/pytest, eslint/biome.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileExists } from '../utils/fs.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCheck {
  name: string;
  status: 'pass' | 'fail' | 'skip' | 'error';
  message: string;
  duration: number;
  details?: string;
}

export interface FileHash {
  path: string;
  hash: string;
}

export interface HealthSnapshot {
  version: 1;
  timestamp: number;
  rootPath: string;
  checks: ToolCheck[];
  fileHashes: FileHash[];
  totalFiles: number;
}

export interface VerifyResult {
  baseline: HealthSnapshot;
  current: HealthSnapshot;
  regressions: ToolRegression[];
  fileChanges: FileChange[];
  healthScore: number;
  summary: string;
}

export interface ToolRegression {
  check: string;
  before: 'pass' | 'fail' | 'skip' | 'error';
  after: 'pass' | 'fail' | 'skip' | 'error';
  message: string;
}

export interface FileChange {
  path: string;
  type: 'added' | 'removed' | 'modified';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GUARD_DIR = '.codeprobe';
const BASELINE_FILE = 'baseline.json';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '.cache', '.turbo', '.codeprobe',
  '.parcel-cache', 'vendor', 'tmp', '__pycache__',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.vue', '.svelte', '.astro',
]);

// ---------------------------------------------------------------------------
// Tool detection & execution
// ---------------------------------------------------------------------------

async function detectAndRunTsc(rootPath: string): Promise<ToolCheck> {
  const start = Date.now();

  // Check if tsconfig.json exists
  const hasTsConfig = await fileExists(join(rootPath, 'tsconfig.json'));
  if (!hasTsConfig) {
    return { name: 'TypeScript', status: 'skip', message: 'No tsconfig.json found', duration: Date.now() - start };
  }

  try {
    // Try npx tsc --noEmit
    await execFileAsync('npx', ['tsc', '--noEmit'], {
      cwd: rootPath,
      timeout: 60_000,
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    return { name: 'TypeScript', status: 'pass', message: 'Compiles cleanly', duration: Date.now() - start };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    const output = (error.stdout ?? '') + (error.stderr ?? '');
    // Count errors
    const errorLines = output.split('\n').filter((l: string) => /error TS\d+/.test(l));
    const msg = errorLines.length > 0
      ? `${errorLines.length} type error${errorLines.length > 1 ? 's' : ''}`
      : 'Compilation failed';
    return {
      name: 'TypeScript',
      status: 'fail',
      message: msg,
      duration: Date.now() - start,
      details: errorLines.slice(0, 10).join('\n'),
    };
  }
}

async function detectAndRunTests(rootPath: string): Promise<ToolCheck> {
  const start = Date.now();

  // Detect test runner from package.json
  const pkgPath = join(rootPath, 'package.json');
  if (!(await fileExists(pkgPath))) {
    // Try pytest
    try {
      const result = await execFileAsync('python', ['-m', 'pytest', '--tb=no', '-q'], {
        cwd: rootPath,
        timeout: 120_000,
      });
      const passed = result.stdout.includes('passed');
      return {
        name: 'Tests (pytest)',
        status: passed ? 'pass' : 'fail',
        message: result.stdout.split('\n').pop()?.trim() ?? 'Tests completed',
        duration: Date.now() - start,
      };
    } catch {
      return { name: 'Tests', status: 'skip', message: 'No test runner detected', duration: Date.now() - start };
    }
  }

  let pkg: Record<string, unknown>;
  try {
    const content = await readFile(pkgPath, 'utf-8');
    pkg = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return { name: 'Tests', status: 'skip', message: 'Could not read package.json', duration: Date.now() - start };
  }

  const scripts = pkg.scripts as Record<string, string> | undefined;
  const deps = { ...(pkg.devDependencies as Record<string, string> ?? {}), ...(pkg.dependencies as Record<string, string> ?? {}) };

  // Detect runner
  let runner: string | null = null;
  let command: string[];

  if (deps.vitest || scripts?.test?.includes('vitest')) {
    runner = 'vitest';
    command = ['npx', 'vitest', 'run', '--reporter=verbose'];
  } else if (deps.jest || scripts?.test?.includes('jest')) {
    runner = 'jest';
    command = ['npx', 'jest', '--ci', '--silent'];
  } else if (deps.mocha || scripts?.test?.includes('mocha')) {
    runner = 'mocha';
    command = ['npx', 'mocha', '--exit'];
  } else if (scripts?.test) {
    runner = 'npm test';
    command = ['npm', 'test'];
  } else {
    return { name: 'Tests', status: 'skip', message: 'No test script or runner found', duration: Date.now() - start };
  }

  try {
    const result = await execFileAsync(command[0]!, command.slice(1), {
      cwd: rootPath,
      timeout: 120_000,
      env: { ...process.env, NODE_OPTIONS: '', CI: 'true' },
    });
    const output = result.stdout + result.stderr;

    // Try to extract pass/fail counts
    const passMatch = /(\d+)\s+pass/i.exec(output);
    const failMatch = /(\d+)\s+fail/i.exec(output);
    const passCount = passMatch ? parseInt(passMatch[1]!, 10) : 0;
    const failCount = failMatch ? parseInt(failMatch[1]!, 10) : 0;

    const msg = failCount > 0
      ? `${failCount} failing, ${passCount} passing`
      : passCount > 0
        ? `${passCount} passing`
        : 'Tests completed';

    return {
      name: `Tests (${runner})`,
      status: failCount > 0 ? 'fail' : 'pass',
      message: msg,
      duration: Date.now() - start,
    };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string };
    const output = (error.stdout ?? '') + (error.stderr ?? '');
    const failMatch = /(\d+)\s+fail/i.exec(output);
    const failCount = failMatch ? parseInt(failMatch[1]!, 10) : 0;
    return {
      name: `Tests (${runner})`,
      status: 'fail',
      message: failCount > 0 ? `${failCount} test${failCount > 1 ? 's' : ''} failing` : 'Tests failed',
      duration: Date.now() - start,
      details: output.slice(-500),
    };
  }
}

async function detectAndRunLint(rootPath: string): Promise<ToolCheck> {
  const start = Date.now();

  // Check for biome
  const hasBiome = await fileExists(join(rootPath, 'biome.json')) ||
    await fileExists(join(rootPath, 'biome.jsonc'));

  if (hasBiome) {
    try {
      await execFileAsync('npx', ['biome', 'check', '.'], {
        cwd: rootPath,
        timeout: 60_000,
      });
      return { name: 'Lint (biome)', status: 'pass', message: 'No issues', duration: Date.now() - start };
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string };
      const output = (error.stdout ?? '') + (error.stderr ?? '');
      return { name: 'Lint (biome)', status: 'fail', message: 'Issues found', duration: Date.now() - start, details: output.slice(-300) };
    }
  }

  // Check for eslint
  const hasEslint = await fileExists(join(rootPath, '.eslintrc.json')) ||
    await fileExists(join(rootPath, '.eslintrc.js')) ||
    await fileExists(join(rootPath, '.eslintrc.yml')) ||
    await fileExists(join(rootPath, 'eslint.config.js')) ||
    await fileExists(join(rootPath, 'eslint.config.mjs'));

  if (hasEslint) {
    try {
      await execFileAsync('npx', ['eslint', '.', '--max-warnings=0'], {
        cwd: rootPath,
        timeout: 60_000,
      });
      return { name: 'Lint (eslint)', status: 'pass', message: 'No issues', duration: Date.now() - start };
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string };
      const output = (error.stdout ?? '') + (error.stderr ?? '');
      const errorMatch = /(\d+)\s+error/i.exec(output);
      const warnMatch = /(\d+)\s+warning/i.exec(output);
      const errors = errorMatch ? parseInt(errorMatch[1]!, 10) : 0;
      const warnings = warnMatch ? parseInt(warnMatch[1]!, 10) : 0;
      const msg = errors > 0 ? `${errors} error${errors > 1 ? 's' : ''}, ${warnings} warning${warnings > 1 ? 's' : ''}` : 'Issues found';
      return { name: 'Lint (eslint)', status: 'fail', message: msg, duration: Date.now() - start, details: output.slice(-300) };
    }
  }

  return { name: 'Lint', status: 'skip', message: 'No linter configured', duration: Date.now() - start };
}

// ---------------------------------------------------------------------------
// File hashing
// ---------------------------------------------------------------------------

async function hashSourceFiles(rootPath: string): Promise<FileHash[]> {
  const hashes: FileHash[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = '.' + entry.name.split('.').pop()?.toLowerCase();
        if (SOURCE_EXTENSIONS.has(ext)) {
          try {
            const content = await readFile(fullPath, 'utf-8');
            const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
            const relPath = fullPath.slice(rootPath.length + 1);
            hashes.push({ path: relPath, hash });
          } catch {
            // Skip unreadable files
          }
        }
      }
    }
  }

  await walk(rootPath);
  hashes.sort((a, b) => a.path.localeCompare(b.path));
  return hashes;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/**
 * Create a health snapshot of the project.
 * Runs all detected checks and hashes source files.
 */
export async function createSnapshot(rootPath: string): Promise<HealthSnapshot> {
  const absRoot = resolve(rootPath);

  // Run all checks in parallel
  const [tsc, tests, lint, fileHashes] = await Promise.all([
    detectAndRunTsc(absRoot),
    detectAndRunTests(absRoot),
    detectAndRunLint(absRoot),
    hashSourceFiles(absRoot),
  ]);

  const checks = [tsc, tests, lint];

  return {
    version: 1,
    timestamp: Date.now(),
    rootPath: absRoot,
    checks,
    fileHashes,
    totalFiles: fileHashes.length,
  };
}

// ---------------------------------------------------------------------------
// Save / load baseline
// ---------------------------------------------------------------------------

/**
 * Save a snapshot as the baseline.
 */
export async function saveBaseline(rootPath: string, snapshot: HealthSnapshot): Promise<string> {
  const guardDir = join(resolve(rootPath), GUARD_DIR);
  await mkdir(guardDir, { recursive: true });
  const baselinePath = join(guardDir, BASELINE_FILE);
  await writeFile(baselinePath, JSON.stringify(snapshot, null, 2), 'utf-8');
  return baselinePath;
}

/**
 * Load the saved baseline, or null if none exists.
 */
export async function loadBaseline(rootPath: string): Promise<HealthSnapshot | null> {
  const baselinePath = join(resolve(rootPath), GUARD_DIR, BASELINE_FILE);
  if (!(await fileExists(baselinePath))) {
    return null;
  }

  try {
    const content = await readFile(baselinePath, 'utf-8');
    return JSON.parse(content) as HealthSnapshot;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Verify (diff against baseline)
// ---------------------------------------------------------------------------

/**
 * Verify current project state against the saved baseline.
 */
export async function verify(rootPath: string): Promise<VerifyResult> {
  const baseline = await loadBaseline(rootPath);
  if (!baseline) {
    throw new Error('No baseline found. Run `codeprobe guard` first to create a snapshot.');
  }

  const current = await createSnapshot(rootPath);

  // Find regressions (checks that got worse)
  const regressions: ToolRegression[] = [];
  for (const currentCheck of current.checks) {
    const baselineCheck = baseline.checks.find(c => c.name === currentCheck.name);
    if (!baselineCheck) continue;

    if (baselineCheck.status === 'pass' && currentCheck.status === 'fail') {
      regressions.push({
        check: currentCheck.name,
        before: baselineCheck.status,
        after: currentCheck.status,
        message: `Was passing, now failing: ${currentCheck.message}`,
      });
    } else if (baselineCheck.status === 'pass' && currentCheck.status === 'error') {
      regressions.push({
        check: currentCheck.name,
        before: baselineCheck.status,
        after: currentCheck.status,
        message: `Was passing, now erroring: ${currentCheck.message}`,
      });
    }
  }

  // Find file changes
  const fileChanges: FileChange[] = [];
  const baselineFiles = new Map(baseline.fileHashes.map(f => [f.path, f.hash]));
  const currentFiles = new Map(current.fileHashes.map(f => [f.path, f.hash]));

  for (const [path, hash] of currentFiles) {
    const baselineHash = baselineFiles.get(path);
    if (!baselineHash) {
      fileChanges.push({ path, type: 'added' });
    } else if (baselineHash !== hash) {
      fileChanges.push({ path, type: 'modified' });
    }
  }

  for (const path of baselineFiles.keys()) {
    if (!currentFiles.has(path)) {
      fileChanges.push({ path, type: 'removed' });
    }
  }

  // Compute health score (0-10)
  let healthScore = 10;

  // Deduct for regressions
  healthScore -= regressions.length * 3;

  // Deduct for currently failing checks
  const failingChecks = current.checks.filter(c => c.status === 'fail');
  healthScore -= failingChecks.length * 1;

  // Bonus: no file changes = nothing to worry about
  if (fileChanges.length === 0 && regressions.length === 0) {
    healthScore = 10;
  }

  healthScore = Math.max(0, Math.min(10, healthScore));

  // Build summary
  const parts: string[] = [];
  if (regressions.length > 0) {
    parts.push(`${regressions.length} regression${regressions.length > 1 ? 's' : ''}`);
  }
  if (fileChanges.length > 0) {
    const modified = fileChanges.filter(f => f.type === 'modified').length;
    const added = fileChanges.filter(f => f.type === 'added').length;
    const removed = fileChanges.filter(f => f.type === 'removed').length;
    const changeParts: string[] = [];
    if (modified > 0) changeParts.push(`${modified} modified`);
    if (added > 0) changeParts.push(`${added} added`);
    if (removed > 0) changeParts.push(`${removed} removed`);
    parts.push(changeParts.join(', '));
  }

  const summary = parts.length > 0
    ? parts.join(' | ')
    : 'No changes detected';

  return {
    baseline,
    current,
    regressions,
    fileChanges,
    healthScore,
    summary,
  };
}
