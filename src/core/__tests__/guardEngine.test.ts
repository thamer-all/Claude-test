/**
 * Tests for the guard engine.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createSnapshot,
  saveBaseline,
  loadBaseline,
} from '../guardEngine.js';

const TEST_DIR = join(process.cwd(), '.test-guard-fixture');

beforeAll(async () => {
  await mkdir(join(TEST_DIR, 'src'), { recursive: true });

  // Create a minimal project
  await writeFile(join(TEST_DIR, 'src', 'index.ts'), `
export function hello(): string {
  return 'hello';
}
`);

  await writeFile(join(TEST_DIR, 'src', 'utils.ts'), `
export const VERSION = '1.0.0';
`);
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('createSnapshot', () => {
  it('creates a snapshot with checks and file hashes', async () => {
    const snapshot = await createSnapshot(TEST_DIR);

    expect(snapshot.version).toBe(1);
    expect(snapshot.timestamp).toBeGreaterThan(0);
    expect(snapshot.checks.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.fileHashes.length).toBe(2); // index.ts and utils.ts
    expect(snapshot.totalFiles).toBe(2);
  });

  it('includes file paths in hashes', async () => {
    const snapshot = await createSnapshot(TEST_DIR);

    const paths = snapshot.fileHashes.map(f => f.path);
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('src/utils.ts');
  });

  it('hashes are deterministic', async () => {
    const snap1 = await createSnapshot(TEST_DIR);
    const snap2 = await createSnapshot(TEST_DIR);

    // Same file content should produce same hashes
    for (const fh1 of snap1.fileHashes) {
      const fh2 = snap2.fileHashes.find(f => f.path === fh1.path);
      expect(fh2).toBeDefined();
      expect(fh2!.hash).toBe(fh1.hash);
    }
  });
});

describe('saveBaseline / loadBaseline', () => {
  it('round-trips a snapshot', async () => {
    const snapshot = await createSnapshot(TEST_DIR);
    await saveBaseline(TEST_DIR, snapshot);

    const loaded = await loadBaseline(TEST_DIR);
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.fileHashes.length).toBe(snapshot.fileHashes.length);
    expect(loaded!.checks.length).toBe(snapshot.checks.length);
  });

  it('returns null when no baseline exists', async () => {
    const noBaselineDir = join(TEST_DIR, 'no-baseline');
    await mkdir(noBaselineDir, { recursive: true });

    const loaded = await loadBaseline(noBaselineDir);
    expect(loaded).toBeNull();

    await rm(noBaselineDir, { recursive: true, force: true });
  });
});
