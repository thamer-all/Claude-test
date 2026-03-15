/**
 * Output formatting utilities for tables, sizes, durations, and
 * ASCII bar charts.
 */

/**
 * Format an array of rows into an aligned plain-text table.
 */
export function formatTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) => {
    const maxData = rows.reduce(
      (max, row) => Math.max(max, (row[i] ?? '').length),
      0,
    );
    return Math.max(h.length, maxData);
  });

  const lines: string[] = [];

  const headerLine = headers
    .map((h, i) => h.padEnd(colWidths[i]!))
    .join('  ');
  lines.push(headerLine);

  const separator = colWidths.map((w) => '-'.repeat(w)).join('  ');
  lines.push(separator);

  for (const row of rows) {
    const line = row
      .map((cell, i) => (cell ?? '').padEnd(colWidths[i]!))
      .join('  ');
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Format a byte count into a human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  if (unitIndex === 0) return `${value} B`;
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Format a token count into a human-readable string (e.g. "12.3k").
 */
export function formatTokens(tokens: number): string {
  if (tokens < 0) return '0';

  if (tokens < 1000) return tokens.toString();
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}

/**
 * Format a duration in milliseconds into a human-readable string.
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return '0ms';

  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.round((ms % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.round((ms % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

/**
 * Format a value between 0 and 1 as a percentage string.
 */
export function formatPercentage(value: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  return `${(clamped * 100).toFixed(1)}%`;
}

/**
 * Render an ASCII progress/proportion bar.
 *
 * @param value  Current value
 * @param max    Maximum value (determines bar fill)
 * @param width  Character width of the bar (default 30)
 * @returns      A string like `[########............]`
 */
export function formatBar(
  value: number,
  max: number,
  width: number = 30,
): string {
  if (max <= 0) return '[' + '.'.repeat(width) + ']';

  const ratio = Math.max(0, Math.min(1, value / max));
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  return '[' + '#'.repeat(filled) + '.'.repeat(empty) + ']';
}
