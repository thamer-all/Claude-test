/**
 * `codeprobe guard` — Snapshot project health before an AI coding session.
 *
 * Creates a baseline of TypeScript compilation, test results, lint status,
 * and file hashes. Use `codeprobe verify` after AI changes to detect regressions.
 */

import { Command } from 'commander';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { createSnapshot, saveBaseline } from '../core/guardEngine.js';
import { extractContracts } from '../core/contractExtractor.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export function registerGuardCommand(program: Command): void {
  program
    .command('guard')
    .argument('[path]', 'Path to project root', '.')
    .description('Snapshot project health — run before AI coding sessions')
    .option('--json', 'Output snapshot as JSON')
    .option('--skip <checks>', 'Skip checks (comma-separated: tsc,tests,lint)')
    .action(async (pathArg: string, options: { json?: boolean; skip?: string }) => {
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
        console.log(chalk.bold('  codeprobe guard'));
        console.log('');
        console.log(chalk.dim('  Snapshotting project health...'));
        console.log('');
      }

      // Create health snapshot
      const snapshot = await createSnapshot(targetPath);

      // Also extract contracts
      const contracts = await extractContracts(targetPath);

      // Save both
      const baselinePath = await saveBaseline(targetPath, snapshot);

      // Save contracts alongside baseline
      const guardDir = join(targetPath, '.codeprobe');
      await mkdir(guardDir, { recursive: true });
      await writeFile(
        join(guardDir, 'contracts.json'),
        JSON.stringify(contracts, null, 2),
        'utf-8',
      );

      if (options.json) {
        console.log(JSON.stringify({ snapshot, contracts }, null, 2));
        return;
      }

      // Display results
      for (const check of snapshot.checks) {
        const icon = check.status === 'pass' ? chalk.green('\u2713')
          : check.status === 'fail' ? chalk.red('\u2717')
          : check.status === 'skip' ? chalk.dim('-')
          : chalk.yellow('!');
        const statusColor = check.status === 'pass' ? chalk.green
          : check.status === 'fail' ? chalk.red
          : chalk.dim;
        console.log(`  ${icon} ${check.name.padEnd(20)} ${statusColor(check.message)} ${chalk.dim(`(${check.duration}ms)`)}`);
      }

      console.log('');
      console.log(chalk.dim(`  Files tracked: ${snapshot.totalFiles}`));
      console.log(chalk.dim(`  Contracts: ${contracts.exports.length} exports, ${contracts.imports.length} imports`));
      if (contracts.routes.length > 0) {
        console.log(chalk.dim(`  API routes: ${contracts.routes.length}`));
      }
      console.log('');
      console.log(chalk.green(`  Baseline saved to ${baselinePath}`));
      console.log(chalk.dim('  Run `codeprobe verify` after making changes to check for regressions.'));
      console.log('');
    });
}
