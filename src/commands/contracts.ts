/**
 * `codeprobe contracts [path]` — Extract and display type/API contracts.
 *
 * Parses TypeScript/JavaScript files to find exported symbols, import
 * relationships, and API routes. Saves snapshot for use by `verify`.
 */

import { Command } from 'commander';
import { resolve, join } from 'node:path';
import { stat, writeFile, mkdir } from 'node:fs/promises';
import { extractContracts } from '../core/contractExtractor.js';

export function registerContractsCommand(program: Command): void {
  program
    .command('contracts')
    .argument('[path]', 'Path to analyze', '.')
    .description('Extract type/API contracts — exports, imports, routes')
    .option('--json', 'Output as JSON')
    .option('--save', 'Save to .codeprobe/contracts.json')
    .action(async (pathArg: string, options: { json?: boolean; save?: boolean }) => {
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
        console.log(chalk.bold('  codeprobe contracts'));
        console.log('');
        console.log(chalk.dim('  Extracting contracts...'));
        console.log('');
      }

      const contracts = await extractContracts(targetPath);

      // Save if requested
      if (options.save) {
        const guardDir = join(targetPath, '.codeprobe');
        await mkdir(guardDir, { recursive: true });
        await writeFile(
          join(guardDir, 'contracts.json'),
          JSON.stringify(contracts, null, 2),
          'utf-8',
        );
        if (!options.json) {
          console.log(chalk.green('  Saved to .codeprobe/contracts.json'));
          console.log('');
        }
      }

      if (options.json) {
        console.log(JSON.stringify(contracts, null, 2));
        return;
      }

      // Summary
      console.log(chalk.bold('  Summary'));
      console.log(`    Files scanned:   ${contracts.fileCount}`);
      console.log(`    Exports:         ${contracts.exports.length}`);
      console.log(`    Import links:    ${contracts.imports.length}`);
      console.log(`    API routes:      ${contracts.routes.length}`);

      // Exports by kind
      if (contracts.exports.length > 0) {
        console.log('');
        console.log(chalk.bold('  Exports by Kind'));
        const kindCounts = new Map<string, number>();
        for (const exp of contracts.exports) {
          kindCounts.set(exp.kind, (kindCounts.get(exp.kind) ?? 0) + 1);
        }
        for (const [kind, count] of [...kindCounts.entries()].sort((a, b) => b[1] - a[1])) {
          console.log(`    ${kind.padEnd(12)} ${count}`);
        }
      }

      // Top imported files
      if (contracts.imports.length > 0) {
        console.log('');
        console.log(chalk.bold('  Most Imported Files'));
        const importCounts = new Map<string, number>();
        for (const imp of contracts.imports) {
          importCounts.set(imp.target, (importCounts.get(imp.target) ?? 0) + 1);
        }
        const sorted = [...importCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
        for (const [file, count] of sorted) {
          console.log(`    ${String(count).padStart(3)} imports  ${file}`);
        }
      }

      // API routes
      if (contracts.routes.length > 0) {
        console.log('');
        console.log(chalk.bold('  API Routes'));
        for (const route of contracts.routes) {
          const methodColor = route.method === 'GET' ? chalk.green
            : route.method === 'POST' ? chalk.blue
            : route.method === 'PUT' ? chalk.yellow
            : route.method === 'DELETE' ? chalk.red
            : chalk.white;
          console.log(`    ${methodColor(route.method.padEnd(7))} ${route.path}  ${chalk.dim(route.file + ':' + route.line)}`);
        }
      }

      console.log('');
    });
}
