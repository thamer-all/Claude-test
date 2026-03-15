/**
 * Doctor runner: environment and project diagnostics.
 *
 * Runs a series of checks to verify that the development environment
 * and project structure are properly configured for claude-test.
 */

import { stat, access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DiagnosticCheck } from '../types/diagnostics.js';
import { fileExists, isDirectory } from '../utils/fs.js';
import { resolveProjectRoot } from '../utils/paths.js';

const execFileAsync = promisify(execFile);

/**
 * Parse a Node.js version string (e.g. "v18.17.0") into its major
 * version number.
 */
function parseMajorVersion(versionStr: string): number | null {
  const match = /^v?(\d+)/.exec(versionStr.trim());
  if (!match?.[1]) return null;
  return parseInt(match[1], 10);
}

/**
 * Check Node.js version >= 18.
 */
async function checkNodeVersion(): Promise<DiagnosticCheck> {
  const version = process.version;
  const major = parseMajorVersion(version);

  if (major === null) {
    return {
      name: 'Node.js version',
      status: 'warn',
      message: `Unable to parse Node.js version: ${version}`,
    };
  }

  if (major < 18) {
    return {
      name: 'Node.js version',
      status: 'fail',
      message: `Node.js ${version} is below the minimum required version (>=18).`,
      details: 'Upgrade Node.js to version 18 or later: https://nodejs.org/',
    };
  }

  return {
    name: 'Node.js version',
    status: 'pass',
    message: `Node.js ${version} meets the minimum requirement (>=18).`,
  };
}

/**
 * Check that the prompts/ directory exists.
 */
async function checkPromptsDir(): Promise<DiagnosticCheck> {
  const root = resolveProjectRoot();
  const promptsDir = join(root, 'prompts');

  if (await isDirectory(promptsDir)) {
    return {
      name: 'prompts/ directory',
      status: 'pass',
      message: 'prompts/ directory exists.',
    };
  }

  return {
    name: 'prompts/ directory',
    status: 'warn',
    message: 'prompts/ directory not found.',
    details: 'Create a prompts/ directory to store your prompt specification files.',
  };
}

/**
 * Check that the datasets/ directory exists.
 */
async function checkDatasetsDir(): Promise<DiagnosticCheck> {
  const root = resolveProjectRoot();
  const datasetsDir = join(root, 'datasets');

  if (await isDirectory(datasetsDir)) {
    return {
      name: 'datasets/ directory',
      status: 'pass',
      message: 'datasets/ directory exists.',
    };
  }

  return {
    name: 'datasets/ directory',
    status: 'warn',
    message: 'datasets/ directory not found.',
    details: 'Create a datasets/ directory to store evaluation datasets (JSONL files).',
  };
}

/**
 * Check that claude-test.config.yaml exists.
 */
async function checkConfigFile(): Promise<DiagnosticCheck> {
  const root = resolveProjectRoot();
  const configNames = [
    'claude-test.config.yaml',
    'claude-test.config.yml',
    '.claude-test.yaml',
    '.claude-test.yml',
  ];

  for (const name of configNames) {
    const configPath = join(root, name);
    if (await fileExists(configPath)) {
      return {
        name: 'Configuration file',
        status: 'pass',
        message: `Configuration file found: ${name}`,
      };
    }
  }

  return {
    name: 'Configuration file',
    status: 'warn',
    message: 'No claude-test configuration file found.',
    details:
      'Create a claude-test.config.yaml file to customize default settings. ' +
      'Run with defaults if no configuration is needed.',
  };
}

/**
 * Check that ANTHROPIC_API_KEY environment variable is set.
 */
async function checkApiKey(): Promise<DiagnosticCheck> {
  const key = process.env['ANTHROPIC_API_KEY'];

  if (!key) {
    return {
      name: 'ANTHROPIC_API_KEY',
      status: 'warn',
      message: 'ANTHROPIC_API_KEY environment variable is not set.',
      details:
        'Set ANTHROPIC_API_KEY to enable live model calls. ' +
        'Mock mode works without an API key.',
    };
  }

  if (key.length < 10) {
    return {
      name: 'ANTHROPIC_API_KEY',
      status: 'warn',
      message: 'ANTHROPIC_API_KEY appears to be too short to be valid.',
    };
  }

  return {
    name: 'ANTHROPIC_API_KEY',
    status: 'pass',
    message: 'ANTHROPIC_API_KEY is set.',
  };
}

/**
 * Check that .cache/ directory exists and is writable.
 */
async function checkCacheDir(): Promise<DiagnosticCheck> {
  const root = resolveProjectRoot();
  const cacheDir = join(root, '.cache');

  if (!(await isDirectory(cacheDir))) {
    // Check if it exists but is a file
    if (await fileExists(cacheDir)) {
      return {
        name: '.cache/ directory',
        status: 'fail',
        message: '.cache exists but is not a directory.',
      };
    }

    return {
      name: '.cache/ directory',
      status: 'warn',
      message: '.cache/ directory does not exist.',
      details:
        'The cache directory will be created automatically when caching is used. ' +
        'You can also create it manually: mkdir .cache',
    };
  }

  try {
    await access(cacheDir, constants.W_OK);
    return {
      name: '.cache/ directory',
      status: 'pass',
      message: '.cache/ directory exists and is writable.',
    };
  } catch {
    return {
      name: '.cache/ directory',
      status: 'fail',
      message: '.cache/ directory exists but is not writable.',
      details: 'Check file permissions on the .cache/ directory.',
    };
  }
}

/**
 * Check that package.json exists in the project root.
 */
async function checkPackageJson(): Promise<DiagnosticCheck> {
  const root = resolveProjectRoot();
  const pkgPath = join(root, 'package.json');

  if (await fileExists(pkgPath)) {
    return {
      name: 'package.json',
      status: 'pass',
      message: 'package.json exists in the project root.',
    };
  }

  return {
    name: 'package.json',
    status: 'warn',
    message: 'package.json not found in the project root.',
    details: 'A package.json is recommended for managing dependencies.',
  };
}

/**
 * Check that TypeScript is installed and accessible.
 */
async function checkTypeScript(): Promise<DiagnosticCheck> {
  try {
    const { stdout } = await execFileAsync('npx', ['tsc', '--version'], {
      timeout: 10000,
    });
    const version = stdout.trim();
    return {
      name: 'TypeScript',
      status: 'pass',
      message: `TypeScript is installed: ${version}`,
    };
  } catch {
    // Try checking node_modules directly
    const root = resolveProjectRoot();
    const tscPath = join(root, 'node_modules', '.bin', 'tsc');

    try {
      await stat(tscPath);
      return {
        name: 'TypeScript',
        status: 'pass',
        message: 'TypeScript is installed (found in node_modules).',
      };
    } catch {
      // Fall through to warn
    }

    return {
      name: 'TypeScript',
      status: 'warn',
      message: 'TypeScript does not appear to be installed.',
      details:
        'Install TypeScript: npm install --save-dev typescript',
    };
  }
}

/**
 * Run all diagnostic checks and return the results.
 *
 * Checks:
 * 1. Node.js version (>= 18)
 * 2. prompts/ directory exists
 * 3. datasets/ directory exists
 * 4. claude-test.config.yaml exists
 * 5. ANTHROPIC_API_KEY env var is set
 * 6. .cache/ directory exists/writable
 * 7. package.json exists
 * 8. TypeScript installed
 *
 * @returns  Array of diagnostic check results.
 */
export async function runDiagnostics(): Promise<DiagnosticCheck[]> {
  const checks = await Promise.all([
    checkNodeVersion(),
    checkPromptsDir(),
    checkDatasetsDir(),
    checkConfigFile(),
    checkApiKey(),
    checkCacheDir(),
    checkPackageJson(),
    checkTypeScript(),
  ]);

  return checks;
}
