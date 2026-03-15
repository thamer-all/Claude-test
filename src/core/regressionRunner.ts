/**
 * Regression test runner — discovers and runs all prompt spec files in a directory.
 */

import { resolve, extname } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { RunSummary } from '../types/results.js';
import type { TestResult } from '../types/prompt.js';
import { runPromptTests } from './promptRunner.js';
import type { RunOptions } from './promptRunner.js';
import { logger } from '../utils/logger.js';

/**
 * Recursively discover all .yaml and .yml files in a directory.
 */
async function discoverSpecFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = resolve(currentPath, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden directories and common non-spec directories
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (ext === '.yaml' || ext === '.yml') {
          files.push(fullPath);
        }
      }
    }
  }

  await walk(dirPath);
  return files.sort();
}

/**
 * Run regression tests across all prompt spec files found in the given directory.
 * Returns an aggregate summary of all test results.
 */
export async function runRegressionTests(
  promptDir: string,
  options: RunOptions,
): Promise<RunSummary> {
  const absoluteDir = resolve(promptDir);

  // Verify the directory exists
  try {
    const dirStat = await stat(absoluteDir);
    if (!dirStat.isDirectory()) {
      throw new Error(`"${absoluteDir}" is not a directory`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('is not a directory')) {
      throw err;
    }
    throw new Error(`Directory not found: "${absoluteDir}"`);
  }

  const specFiles = await discoverSpecFiles(absoluteDir);

  if (specFiles.length === 0) {
    logger.warn(`No .yaml/.yml spec files found in "${absoluteDir}"`);
    return {
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
      cached: 0,
    };
  }

  logger.info(`Found ${specFiles.length} spec file(s) in "${absoluteDir}"`);

  const startTime = Date.now();
  let totalTests = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let cached = 0;

  for (const specFile of specFiles) {
    try {
      const results: TestResult[] = await runPromptTests(specFile, options);
      for (const result of results) {
        totalTests++;
        if (result.cached) {
          cached++;
        }
        if (result.error) {
          skipped++;
        } else if (result.passed) {
          passed++;
        } else {
          failed++;
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to process spec file "${specFile}": ${errorMsg}`);
      skipped++;
      totalTests++;
    }
  }

  const duration = Date.now() - startTime;

  const summary: RunSummary = {
    totalTests,
    passed,
    failed,
    skipped,
    duration,
    cached,
  };

  logger.info(
    `Regression run complete: ${passed}/${totalTests} passed, ${failed} failed, ${skipped} skipped (${duration}ms)`,
  );

  return summary;
}
