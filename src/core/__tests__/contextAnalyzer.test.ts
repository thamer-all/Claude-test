import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeContext } from '../../core/contextAnalyzer.js';

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'codeprobe-ctx-'));
  // Create a small project structure
  mkdirSync(join(tempDir, 'src'), { recursive: true });
  writeFileSync(join(tempDir, 'src', 'index.ts'), 'export const hello = "world";\nconsole.log(hello);\n');
  writeFileSync(join(tempDir, 'src', 'utils.ts'), 'export function add(a: number, b: number): number {\n  return a + b;\n}\n');
  writeFileSync(join(tempDir, 'README.md'), '# Test Project\n\nThis is a test.\n');
  writeFileSync(join(tempDir, 'package.json'), '{"name":"test","version":"1.0.0"}\n');
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('analyzeContext', () => {
  it('returns totalFiles > 0', async () => {
    const result = await analyzeContext(tempDir);
    expect(result.totalFiles).toBeGreaterThan(0);
  });

  it('returns estimatedTokens > 0', async () => {
    const result = await analyzeContext(tempDir);
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it('extensionBreakdown includes .ts', async () => {
    const result = await analyzeContext(tempDir);
    const tsEntry = result.extensionBreakdown.find(
      (e) => e.extension === '.ts',
    );
    expect(tsEntry).toBeDefined();
    expect(tsEntry!.fileCount).toBeGreaterThan(0);
  });

  it('fitEstimates has entries for 200k and 1M', async () => {
    const result = await analyzeContext(tempDir);
    const labels = result.fitEstimates.map((f) => f.windowLabel);
    expect(labels).toContain('200k');
    expect(labels).toContain('1M');
  });

  it('largestFiles is sorted descending by tokens', async () => {
    const result = await analyzeContext(tempDir);
    expect(result.largestFiles.length).toBeGreaterThan(0);
    for (let i = 1; i < result.largestFiles.length; i++) {
      expect(result.largestFiles[i - 1]!.estimatedTokens).toBeGreaterThanOrEqual(
        result.largestFiles[i]!.estimatedTokens,
      );
    }
  });
});
