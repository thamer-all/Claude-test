import { describe, it, expect } from 'vitest';
import { sha256, shortHash } from '../../utils/hashing.js';

describe('sha256', () => {
  it('returns a 64-character hex string', () => {
    const result = sha256('hello');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic (same input produces same output)', () => {
    const a = sha256('test input');
    const b = sha256('test input');
    expect(a).toBe(b);
  });

  it('produces different outputs for different inputs', () => {
    const a = sha256('input one');
    const b = sha256('input two');
    expect(a).not.toBe(b);
  });
});

describe('shortHash', () => {
  it('returns the first 12 characters of sha256', () => {
    const full = sha256('hello');
    const short = shortHash('hello');
    expect(short).toHaveLength(12);
    expect(short).toBe(full.slice(0, 12));
  });
});
