/**
 * `codeprobe flaky [path]` — Detect flaky tests by running each test N times.
 *
 * Runs each test multiple times and reports consistency. In mock mode,
 * tests are deterministic and should always be STABLE. In live mode,
 * flakiness reflects real model non-determinism.
 */

import { Command } from 'commander';
import { resolve } from 'node:path';
import { resolvePath } from '../utils/paths.js';
import { fileExists, isDirectory } from '../utils/fs.js';
import { formatTable } from '../utils/output.js';
import {
  parsePromptSpec,
  runSingleTest,
  type RunOptions,
} from '../core/promptRunner.js';
import type { ExecutionMode } from '../types/prompt.js';
import { setLogLevel } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FlakyTestResult {
  testName: string;
  promptName: string;
  runs: number;
  passed: number;
  failed: number;
  passRate: number;      // 0-100
  status: 'STABLE' | 'FLAKY';
}

interface FlakyReport {
  tests: FlakyTestResult[];
  stableCount: number;
  flakyCount: number;
  totalCount: number;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerFlakyCommand(program: Command): void {
  program
    .command('flaky [path]')
    .description('Detect flaky tests by running each test multiple times')
    .option('--runs <n>', 'Number of runs per test', '5')
    .option('--json', 'Output results as JSON')
    .option('--mode <mode>', 'Execution mode: mock or live', 'mock')
    .option('--model <model>', 'Override the model in the prompt spec (live mode)')
    .action(async (
      pathArg: string | undefined,
      options: {
        runs?: string;
        json?: boolean;
        mode?: string;
        model?: string;
      },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? 'prompts');
      const numRuns = Math.max(1, parseInt(options.runs ?? '5', 10));
      const mode: ExecutionMode = options.mode === 'live' ? 'live' : 'mock';

      const runOpts: RunOptions = {
        mode,
        verbose: false,
        cache: false,   // Never cache for flakiness detection
        modelOverride: options.model,
      };

      // Collect prompt spec files
      let specFiles: string[];

      if (await fileExists(targetPath)) {
        specFiles = [targetPath];
      } else if (await isDirectory(targetPath)) {
        const { glob } = await import('glob');
        specFiles = await glob(
          resolve(targetPath, '**/*.prompt.{yaml,yml}'),
          { absolute: true },
        );
        if (specFiles.length === 0) {
          specFiles = await glob(
            resolve(targetPath, '**/*.{yaml,yml}'),
            { absolute: true },
          );
        }
        specFiles.sort();
      } else {
        console.error(chalk.red(`Error: path not found: ${targetPath}`));
        process.exitCode = 1;
        return;
      }

      if (specFiles.length === 0) {
        if (options.json) {
          console.log(JSON.stringify({ tests: [], stableCount: 0, flakyCount: 0, totalCount: 0 }, null, 2));
        } else {
          console.log(chalk.yellow('\nNo prompt spec files found.'));
        }
        return;
      }

      // Run each test N times
      const allResults: FlakyTestResult[] = [];

      for (const specFile of specFiles) {
        const spec = await parsePromptSpec(specFile);
        const tests = spec.tests ?? [];

        for (const test of tests) {
          let passCount = 0;
          let failCount = 0;

          for (let i = 0; i < numRuns; i++) {
            const result = await runSingleTest(spec, test, runOpts);
            if (result.passed) {
              passCount++;
            } else {
              failCount++;
            }
          }

          const passRate = Math.round((passCount / numRuns) * 100);
          const isStable = passRate === 100 || passRate === 0;

          allResults.push({
            testName: test.name,
            promptName: spec.name,
            runs: numRuns,
            passed: passCount,
            failed: failCount,
            passRate,
            status: isStable ? 'STABLE' : 'FLAKY',
          });
        }
      }

      const stableCount = allResults.filter((r) => r.status === 'STABLE').length;
      const flakyCount = allResults.filter((r) => r.status === 'FLAKY').length;

      const report: FlakyReport = {
        tests: allResults,
        stableCount,
        flakyCount,
        totalCount: allResults.length,
      };

      // JSON output
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      // Table output
      console.log('');
      console.log(chalk.bold('Flakiness Report'));
      console.log('');

      const headers = ['Test', 'Runs', 'Pass', 'Fail', 'Rate', 'Status'];
      const rows: string[][] = [];

      for (const r of allResults) {
        const statusStr = r.status === 'STABLE'
          ? chalk.green('STABLE')
          : chalk.yellow('FLAKY');

        rows.push([
          `${r.promptName}/${r.testName}`,
          String(r.runs),
          String(r.passed),
          String(r.failed),
          `${r.passRate}%`,
          statusStr,
        ]);
      }

      const table = formatTable(headers, rows);
      for (const line of table.split('\n')) {
        console.log(`  ${line}`);
      }

      console.log('');
      console.log(
        `  Overall: ${chalk.green(`${stableCount}/${allResults.length} stable`)}, ` +
        `${flakyCount > 0 ? chalk.yellow(`${flakyCount}/${allResults.length} flaky`) : `${flakyCount}/${allResults.length} flaky`}`,
      );
      console.log('');

      if (flakyCount > 0) {
        process.exitCode = 1;
      }
    });
}
