/**
 * Cryptographic hashing utilities.
 */

import { createHash } from 'node:crypto';

/**
 * Compute a full SHA-256 hex digest of the input string.
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Compute a short (12-character) SHA-256 prefix for use as a
 * compact, collision-resistant identifier.
 */
export function shortHash(input: string): string {
  return sha256(input).slice(0, 12);
}
