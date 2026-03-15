import { describe, it, expect } from 'vitest';
import { analyzeContext } from '../../core/contextAnalyzer.js';

const PROJECT_ROOT = '/Users/thamer/Desktop/Claude test';

describe('analyzeContext', () => {
  it('returns totalFiles > 0 for the project root', async () => {
    const result = await analyzeContext(PROJECT_ROOT);
    expect(result.totalFiles).toBeGreaterThan(0);
  });

  it('returns estimatedTokens > 0', async () => {
    const result = await analyzeContext(PROJECT_ROOT);
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it('extensionBreakdown includes .ts', async () => {
    const result = await analyzeContext(PROJECT_ROOT);
    const tsEntry = result.extensionBreakdown.find(
      (e) => e.extension === '.ts',
    );
    expect(tsEntry).toBeDefined();
    expect(tsEntry!.fileCount).toBeGreaterThan(0);
  });

  it('fitEstimates has entries for 200k and 1M', async () => {
    const result = await analyzeContext(PROJECT_ROOT);
    const labels = result.fitEstimates.map((f) => f.windowLabel);
    expect(labels).toContain('200k');
    expect(labels).toContain('1M');
  });

  it('largestFiles is sorted descending by tokens', async () => {
    const result = await analyzeContext(PROJECT_ROOT);
    expect(result.largestFiles.length).toBeGreaterThan(0);
    for (let i = 1; i < result.largestFiles.length; i++) {
      expect(result.largestFiles[i - 1]!.estimatedTokens).toBeGreaterThanOrEqual(
        result.largestFiles[i]!.estimatedTokens,
      );
    }
  });
});
