/**
 * Path utilities for resolving project root, cache directories,
 * and normalizing paths.
 */

import { resolve, relative, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

/**
 * Resolve the project root directory.
 *
 * Uses the current working directory as the project root. This aligns
 * with how CLI tools typically operate: they act on the directory from
 * which they are invoked.
 */
export function resolveProjectRoot(): string {
  return process.cwd();
}

/**
 * Resolve a path relative to the current working directory.
 * Absolute paths are returned as-is.
 */
export function resolvePath(p: string): string {
  return resolve(process.cwd(), p);
}

/**
 * Get a relative path from `from` to `to`.
 */
export function getRelativePath(from: string, to: string): string {
  return relative(from, to);
}

/**
 * Get the cache directory for claude-test.
 *
 * Follows XDG conventions on Linux/macOS:
 *   $XDG_CACHE_HOME/claude-test  (if set)
 *   ~/.cache/claude-test          (default)
 *
 * Falls back to the OS temp directory if the home directory is not
 * available.
 */
export function getCacheDir(): string {
  const xdgCache = process.env['XDG_CACHE_HOME'];
  if (xdgCache) {
    return join(xdgCache, 'claude-test');
  }

  const home = homedir();
  if (home) {
    return join(home, '.cache', 'claude-test');
  }

  return join(tmpdir(), 'claude-test');
}
