/**
 * `codeprobe verify` — Verify project health after AI changes.
 *
 * Compares current state against the baseline created by `codeprobe guard`.
 * Reports regressions, file changes, and contract violations.
 */

import { Command } from 'commander';
import { resolve, join } from 'node:path';
import { stat, readFile } from 'node:fs/promises';
import { verify } from '../core/guardEngine.js';
import { extractContracts, diffContracts } from '../core/contractExtractor.js';
import { fileExists } from '../utils/fs.js';
import type { ContractSnapshot } from '../core/contractExtractor.js';

export function registerVerifyCommand(program: Command): void {
  program
    .command('verify')
    .argument('[path]', 'Path to project root', '.')
    .description('Verify project health — run after AI coding sessions to detect regressions')
    .option('--json', 'Output results as JSON')
    .action(async (pathArg: string, options: { json?: boolean }) => {
      const targetPath = resolve(pathArg);

      // Verify path exists
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

      if (!options.json) {
        console.log('');
        console.log(chalk.bold('  codeprobe verify'));
        console.log('');
        console.log(chalk.dim('  Verifying against baseline...'));
        console.log('');
      }

      // Verify health
      let result;
      try {
        result = await verify(targetPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (options.json) {
          console.log(JSON.stringify({ error: msg }));
        } else {
          console.error(chalk.red(`  ${msg}`));
          console.log('');
        }
        process.exitCode = 1;
        return;
      }

      // Also check contracts
      const contractsPath = join(targetPath, '.codeprobe', 'contracts.json');
      let contractDiff = null;
      if (await fileExists(contractsPath)) {
        try {
          const baselineContracts = JSON.parse(await readFile(contractsPath, 'utf-8')) as ContractSnapshot;
          const currentContracts = await extractContracts(targetPath);
          contractDiff = diffContracts(baselineContracts, currentContracts);
        } catch {
          // Skip contract diff on error
        }
      }

      if (options.json) {
        console.log(JSON.stringify({ ...result, contractDiff }, null, 2));
        if (result.regressions.length > 0) {
          process.exitCode = 1;
        }
        return;
      }

      // Display check results
      console.log(chalk.bold('  Checks'));
      for (const check of result.current.checks) {
        const baselineCheck = result.baseline.checks.find(c => c.name === check.name);
        const icon = check.status === 'pass' ? chalk.green('\u2713')
          : check.status === 'fail' ? chalk.red('\u2717')
          : check.status === 'skip' ? chalk.dim('-')
          : chalk.yellow('!');

        let statusLine = check.message;
        // Show regression indicator
        if (baselineCheck && baselineCheck.status === 'pass' && check.status === 'fail') {
          statusLine += chalk.red(' (REGRESSION)');
        } else if (baselineCheck && baselineCheck.status === 'fail' && check.status === 'pass') {
          statusLine += chalk.green(' (FIXED)');
        }

        const statusColor = check.status === 'pass' ? chalk.green
          : check.status === 'fail' ? chalk.red
          : chalk.dim;
        console.log(`  ${icon} ${check.name.padEnd(20)} ${statusColor(statusLine)}`);
      }

      // File changes
      if (result.fileChanges.length > 0) {
        console.log('');
        console.log(chalk.bold('  File Changes'));
        const modified = result.fileChanges.filter(f => f.type === 'modified');
        const added = result.fileChanges.filter(f => f.type === 'added');
        const removed = result.fileChanges.filter(f => f.type === 'removed');

        if (modified.length > 0) {
          console.log(chalk.yellow(`    ${modified.length} modified`));
          for (const f of modified.slice(0, 10)) {
            console.log(chalk.dim(`      ${f.path}`));
          }
          if (modified.length > 10) {
            console.log(chalk.dim(`      ... and ${modified.length - 10} more`));
          }
        }
        if (added.length > 0) {
          console.log(chalk.green(`    ${added.length} added`));
          for (const f of added.slice(0, 5)) {
            console.log(chalk.dim(`      ${f.path}`));
          }
        }
        if (removed.length > 0) {
          console.log(chalk.red(`    ${removed.length} removed`));
          for (const f of removed.slice(0, 5)) {
            console.log(chalk.dim(`      ${f.path}`));
          }
        }
      }

      // Contract changes
      if (contractDiff) {
        const hasChanges = contractDiff.removedExports.length > 0 ||
          contractDiff.changedExports.length > 0 ||
          contractDiff.removedRoutes.length > 0;

        if (hasChanges) {
          console.log('');
          console.log(chalk.bold('  Contract Changes'));

          if (contractDiff.removedExports.length > 0) {
            console.log(chalk.red(`    ${contractDiff.removedExports.length} export${contractDiff.removedExports.length > 1 ? 's' : ''} removed`));
            for (const exp of contractDiff.removedExports.slice(0, 5)) {
              console.log(chalk.dim(`      ${exp.kind} ${exp.name} (${exp.file})`));
            }
          }

          if (contractDiff.changedExports.length > 0) {
            console.log(chalk.yellow(`    ${contractDiff.changedExports.length} export signature${contractDiff.changedExports.length > 1 ? 's' : ''} changed`));
            for (const change of contractDiff.changedExports.slice(0, 5)) {
              console.log(chalk.dim(`      ${change.after.name} (${change.after.file})`));
            }
          }

          if (contractDiff.removedRoutes.length > 0) {
            console.log(chalk.red(`    ${contractDiff.removedRoutes.length} API route${contractDiff.removedRoutes.length > 1 ? 's' : ''} removed`));
            for (const route of contractDiff.removedRoutes) {
              console.log(chalk.dim(`      ${route.method} ${route.path}`));
            }
          }
        }
      }

      // Regressions summary
      if (result.regressions.length > 0) {
        console.log('');
        console.log(chalk.bold.red('  Regressions'));
        for (const reg of result.regressions) {
          console.log(chalk.red(`    \u2717 ${reg.check}: ${reg.message}`));
        }
      }

      // Overall score
      console.log('');
      const scoreColor = result.healthScore >= 8 ? chalk.green
        : result.healthScore >= 5 ? chalk.yellow
        : chalk.red;
      console.log(`  ${chalk.bold('Health Score:')} ${scoreColor(`${result.healthScore}/10`)} \u2014 ${result.summary}`);
      console.log('');

      if (result.regressions.length > 0) {
        process.exitCode = 1;
      }
    });
}
