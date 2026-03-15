import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  formatTokens,
  formatDuration,
  formatPercentage,
  formatBar,
} from '../../utils/output.js';

describe('formatBytes', () => {
  it('formats 0 as "0 B"', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats 1024 as "1.0 KB"', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
  });

  it('formats 1048576 as "1.0 MB"', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });
});

describe('formatTokens', () => {
  it('formats 0 as "0"', () => {
    expect(formatTokens(0)).toBe('0');
  });

  it('formats 1500 as "1.5k"', () => {
    expect(formatTokens(1500)).toBe('1.5k');
  });

  it('formats 1000000 as "1.00M"', () => {
    expect(formatTokens(1000000)).toBe('1.00M');
  });
});

describe('formatDuration', () => {
  it('formats 0 as "0ms"', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  it('formats 1500 as "1.5s"', () => {
    expect(formatDuration(1500)).toBe('1.5s');
  });

  it('formats 65000 as "1m 5s"', () => {
    expect(formatDuration(65000)).toBe('1m 5s');
  });
});

describe('formatPercentage', () => {
  it('formats 0.5 as "50.0%"', () => {
    expect(formatPercentage(0.5)).toBe('50.0%');
  });

  it('formats 1 as "100.0%"', () => {
    expect(formatPercentage(1)).toBe('100.0%');
  });

  it('formats 0.123 as "12.3%"', () => {
    expect(formatPercentage(0.123)).toBe('12.3%');
  });
});

describe('formatBar', () => {
  it('produces a string of the right width with "#" and "." chars', () => {
    const bar = formatBar(50, 100, 20);
    // bar should be "[" + 20 chars of # and . + "]" = 22 total
    expect(bar).toHaveLength(22);
    expect(bar.startsWith('[')).toBe(true);
    expect(bar.endsWith(']')).toBe(true);
    // Inner content should only be '#' and '.'
    const inner = bar.slice(1, -1);
    expect(inner).toMatch(/^[#.]+$/);
    // 50/100 = 50%, so 10 of 20 should be '#'
    const hashes = inner.split('').filter((c) => c === '#').length;
    expect(hashes).toBe(10);
  });
});
