/**
 * File system utilities for claude-test.
 */

import { readFile, stat, readdir } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';

/**
 * Safely read a text file, returning null on failure.
 */
export async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Check if a file exists and is a file (not a directory).
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Check if a path is a directory.
 */
export async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Get file size in bytes, or 0 on error.
 */
export async function getFileSize(filePath: string): Promise<number> {
  try {
    const s = await stat(filePath);
    return s.size;
  } catch {
    return 0;
  }
}

/**
 * Get the extension of a file, lowercase, including the dot.
 */
export function getExtension(filePath: string): string {
  return extname(filePath).toLowerCase();
}

/**
 * Get relative path from a root.
 */
export function getRelativePath(rootPath: string, filePath: string): string {
  return relative(rootPath, filePath);
}

export interface WalkOptions {
  ignoreDirs?: Set<string>;
  ignoreExtensions?: Set<string>;
}

export interface WalkEntry {
  path: string;
  relativePath: string;
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  extension: string;
}

/**
 * Recursively walk a directory, yielding file entries.
 */
export async function walkDirectory(
  rootPath: string,
  options?: WalkOptions,
): Promise<WalkEntry[]> {
  const entries: WalkEntry[] = [];
  const ignoreDirs = options?.ignoreDirs ?? new Set<string>();

  async function walk(currentPath: string): Promise<void> {
    let dirEntries;
    try {
      dirEntries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of dirEntries) {
      const fullPath = join(currentPath, entry.name);
      const relPath = relative(rootPath, fullPath);

      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name)) {
          continue;
        }
        entries.push({
          path: fullPath,
          relativePath: relPath,
          isFile: false,
          isDirectory: true,
          size: 0,
          extension: '',
        });
        await walk(fullPath);
      } else if (entry.isFile()) {
        let size = 0;
        try {
          const s = await stat(fullPath);
          size = s.size;
        } catch {
          // skip files we can't stat
        }
        entries.push({
          path: fullPath,
          relativePath: relPath,
          isFile: true,
          isDirectory: false,
          size,
          extension: extname(entry.name).toLowerCase(),
        });
      }
    }
  }

  await walk(rootPath);
  return entries;
}
