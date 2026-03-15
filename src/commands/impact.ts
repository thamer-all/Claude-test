/**
 * `codeprobe impact <file>` — Show the blast radius of editing a file.
 *
 * Traces the import graph to find all files that depend on the target,
 * lists exported symbols and their consumers, and assigns a risk level.
 */

import { Command } from 'commander';
import { resolve, relative } from 'node:path';
import { stat } from 'node:fs/promises';
import { extractContracts, analyzeDependents } from '../core/contractExtractor.js';

export function registerImpactCommand(program: Command): void {
  program
    .command('impact')
    .argument('<file>', 'File to analyze impact for')
    .option('--json', 'Output results as JSON')
    .option('--root <path>', 'Project root path', '.')
    .description('Show blast radius — which files depend on a given file')
    .action(async (fileArg: string, options: { json?: boolean; root: string }) => {
      const rootPath = resolve(options.root);
      const filePath = resolve(fileArg);

      // Verify file exists
      try {
        const s = await stat(filePath);
        if (!s.isFile()) {
          console.error(`Error: not a file: ${filePath}`);
          process.exitCode = 1;
          return;
        }
      } catch {
        console.error(`Error: file not found: ${filePath}`);
        process.exitCode = 1;
        return;
      }

      const chalk = (await import('chalk')).default;
      const relFile = relative(rootPath, filePath);

      if (!options.json) {
        console.log('');
        console.log(chalk.bold('  codeprobe impact'));
        console.log('');
        console.log(chalk.dim(`  Analyzing: ${relFile}`));
        console.log('');
      }

      // Extract contracts
      const contracts = await extractContracts(rootPath);

      // Analyze dependents
      const info = analyzeDependents(relFile, contracts);

      if (options.json) {
        console.log(JSON.stringify(info, null, 2));
        return;
      }

      // Exported symbols
      if (info.exportedSymbols.length > 0) {
        console.log(chalk.bold('  Exported Symbols'));
        for (const sym of info.exportedSymbols) {
          const sig = sym.signature ? chalk.dim(` ${sym.signature}`) : '';
          console.log(`    ${chalk.cyan(sym.kind.padEnd(10))} ${sym.name}${sig}`);
        }
      } else {
        console.log(chalk.dim('  No exports found in this file'));
      }

      // Dependents
      console.log('');
      if (info.dependents.length > 0) {
        console.log(chalk.bold(`  Dependents (${info.dependents.length})`));
        for (const dep of info.dependents) {
          const symbolList = dep.symbols.join(', ');
          console.log(`    ${dep.file}`);
          console.log(chalk.dim(`      imports: ${symbolList}`));
        }
      } else {
        console.log(chalk.dim('  No files depend on this file'));
      }

      // Risk level
      console.log('');
      const totalUsages = info.dependents.reduce((sum, d) => sum + d.symbols.length, 0);
      const riskColor = info.riskLevel === 'CRITICAL' ? chalk.red
        : info.riskLevel === 'HIGH' ? chalk.red
        : info.riskLevel === 'MEDIUM' ? chalk.yellow
        : chalk.green;
      console.log(`  ${chalk.bold('Risk:')} ${riskColor(info.riskLevel)} (${info.dependents.length} dependent${info.dependents.length !== 1 ? 's' : ''}, ${totalUsages} usage${totalUsages !== 1 ? 's' : ''})`);
      console.log('');
    });
}
