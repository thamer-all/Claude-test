/**
 * Test history tracking with JSON file storage.
 *
 * Stores test run records in `.codeprobe/history/` as individual JSON files.
 * Each run gets its own `<id>.json` file for simple, dependency-free persistence.
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const HISTORY_DIR = join(process.cwd(), '.codeprobe', 'history');

export interface TestRunRecord {
  id: string;
  timestamp: string;
  specFile: string;
  totalTests: number;
  passed: number;
  failed: number;
  duration: number;
  results: Array<{
    testName: string;
    passed: boolean;
    score?: number;
    duration: number;
  }>;
}

/**
 * Ensure the history directory exists.
 */
async function ensureHistoryDir(): Promise<void> {
  await mkdir(HISTORY_DIR, { recursive: true });
}

/**
 * Save a test run record to `.codeprobe/history/<id>.json`.
 */
export async function saveTestRun(record: TestRunRecord): Promise<void> {
  await ensureHistoryDir();
  const filePath = join(HISTORY_DIR, `${record.id}.json`);
  await writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8');
}

/**
 * Load all history files, sorted by timestamp descending.
 * Optionally limit to the most recent N records.
 */
export async function loadHistory(limit?: number): Promise<TestRunRecord[]> {
  await ensureHistoryDir();

  let entries: string[];
  try {
    entries = await readdir(HISTORY_DIR);
  } catch {
    return [];
  }

  const jsonFiles = entries.filter((f) => f.endsWith('.json'));
  const records: TestRunRecord[] = [];

  for (const file of jsonFiles) {
    try {
      const content = await readFile(join(HISTORY_DIR, file), 'utf-8');
      const record = JSON.parse(content) as TestRunRecord;
      records.push(record);
    } catch {
      // Skip malformed files
    }
  }

  records.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  if (limit !== undefined && limit > 0) {
    return records.slice(0, limit);
  }

  return records;
}

/**
 * Return the history for a specific test, sorted by timestamp descending.
 */
export async function getTestTrend(
  testName: string,
  limit?: number,
): Promise<Array<{ timestamp: string; passed: boolean; score?: number; duration: number }>> {
  const records = await loadHistory();

  const trend: Array<{ timestamp: string; passed: boolean; score?: number; duration: number }> = [];

  for (const record of records) {
    for (const result of record.results) {
      if (result.testName === testName) {
        trend.push({
          timestamp: record.timestamp,
          passed: result.passed,
          score: result.score,
          duration: result.duration,
        });
      }
    }
  }

  // Already sorted by timestamp desc (from loadHistory)
  if (limit !== undefined && limit > 0) {
    return trend.slice(0, limit);
  }

  return trend;
}

/**
 * Delete all history files.
 */
export async function clearHistory(): Promise<void> {
  try {
    await rm(HISTORY_DIR, { recursive: true, force: true });
  } catch {
    // Directory may not exist
  }
  await ensureHistoryDir();
}
