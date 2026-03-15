/**
 * `codeprobe history` — View test run history and trends.
 *
 * Subcommands/options:
 *   codeprobe history              Show recent test runs (default: last 10)
 *   --limit <n>                    Number of runs to show
 *   --test <name>                  Show trend for a specific test
 *   --clear                        Clear all history
 *   --json                         JSON output
 */

import { Command } from 'commander';
import { loadHistory, getTestTrend, clearHistory } from '../core/testHistory.js';
import { formatTable, formatDuration } from '../utils/output.js';

/**
 * Format an ISO timestamp to a short date string like "2026-03-15 23:15".
 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Extract the short spec name from a full file path.
 */
function shortSpecName(specFile: string): string {
  const parts = specFile.replace(/\\/g, '/').split('/');
  const fileName = parts[parts.length - 1] ?? specFile;
  return fileName
    .replace(/\.prompt\.ya?ml$/, '')
    .replace(/\.ya?ml$/, '');
}

export function registerHistoryCommand(program: Command): void {
  program
    .command('history')
    .description('View test run history and trends')
    .option('--limit <n>', 'Number of runs to show', '10')
    .option('--test <name>', 'Show trend for a specific test')
    .option('--clear', 'Clear all history')
    .option('--json', 'Output as JSON')
    .action(async (options: {
      limit?: string;
      test?: string;
      clear?: boolean;
      json?: boolean;
    }) => {
      const chalk = (await import('chalk')).default;
      const limit = parseInt(options.limit ?? '10', 10);

      // Clear history
      if (options.clear) {
        await clearHistory();
        if (options.json) {
          console.log(JSON.stringify({ cleared: true }));
        } else {
          console.log(chalk.green('History cleared.'));
        }
        return;
      }

      // Show trend for a specific test
      if (options.test) {
        const trend = await getTestTrend(options.test, limit);

        if (options.json) {
          console.log(JSON.stringify(trend, null, 2));
          return;
        }

        if (trend.length === 0) {
          console.log(chalk.yellow(`\nNo history found for test: ${options.test}`));
          return;
        }

        console.log(chalk.bold(`\nTrend: ${options.test}\n`));

        const headers = ['Date', 'Passed', 'Duration'];
        const rows = trend.map((entry) => [
          formatDate(entry.timestamp),
          entry.passed ? chalk.green('YES') : chalk.red('NO'),
          formatDuration(entry.duration),
        ]);

        console.log(
          formatTable(headers, rows)
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n'),
        );

        const passCount = trend.filter((e) => e.passed).length;
        const passRate = ((passCount / trend.length) * 100).toFixed(1);
        console.log(
          `\n  Pass rate: ${passRate}% (${passCount}/${trend.length})`,
        );
        console.log('');
        return;
      }

      // Default: show recent runs
      const records = await loadHistory(limit);

      if (options.json) {
        console.log(JSON.stringify(records, null, 2));
        return;
      }

      if (records.length === 0) {
        console.log(chalk.yellow('\nNo test history found. Run `codeprobe test` to create some.'));
        return;
      }

      console.log(chalk.bold(`\nTest Run History (last ${limit})\n`));

      const headers = ['Run', 'Date', 'Spec', 'Pass', 'Fail', 'Total', 'Duration'];
      const rows = records.map((r) => [
        r.id.slice(0, 8),
        formatDate(r.timestamp),
        shortSpecName(r.specFile),
        String(r.passed),
        r.failed > 0 ? chalk.red(String(r.failed)) : String(r.failed),
        String(r.totalTests),
        formatDuration(r.duration),
      ]);

      console.log(
        formatTable(headers, rows)
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n'),
      );
      console.log('');
    });
}
