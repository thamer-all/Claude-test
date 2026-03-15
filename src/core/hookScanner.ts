/**
 * Hook scanner: detect hook-like assets in a repository.
 *
 * Looks for hook definitions in Claude Code configuration,
 * package.json scripts, Husky, git hooks directories, and
 * custom hooks directories.
 */

import { join } from 'node:path';
import { readFile, stat, readdir } from 'node:fs/promises';
import type { HookInfo } from '../types/agent.js';

/**
 * Safely read and parse a JSON file. Returns null on failure.
 */
async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * List files in a directory. Returns an empty array if the directory
 * does not exist or is not accessible.
 */
async function listDirectory(dirPath: string): Promise<string[]> {
  try {
    const dirStat = await stat(dirPath);
    if (!dirStat.isDirectory()) return [];
    const entries = await readdir(dirPath);
    return entries;
  } catch {
    return [];
  }
}

/**
 * Scan .claude/settings.json for hook configurations.
 */
async function scanClaudeSettings(rootPath: string): Promise<HookInfo[]> {
  const hooks: HookInfo[] = [];
  const settingsPath = join(rootPath, '.claude', 'settings.json');
  const data = await readJsonFile(settingsPath);

  if (!data) return hooks;

  // Look for a "hooks" key in the settings
  if (typeof data['hooks'] === 'object' && data['hooks'] !== null) {
    const hooksObj = data['hooks'] as Record<string, unknown>;

    for (const [event, config] of Object.entries(hooksObj)) {
      if (typeof config === 'string') {
        hooks.push({
          path: settingsPath,
          type: 'claude-hook',
          description: `Claude hook for event "${event}": ${config}`,
          events: [event],
        });
      } else if (typeof config === 'object' && config !== null) {
        const configObj = config as Record<string, unknown>;
        const command = typeof configObj['command'] === 'string'
          ? configObj['command']
          : 'unknown';
        hooks.push({
          path: settingsPath,
          type: 'claude-hook',
          description: `Claude hook for event "${event}": ${command}`,
          events: [event],
        });
      }
    }
  }

  return hooks;
}

/**
 * Scan .claude/hooks/ directory for hook scripts.
 */
async function scanClaudeHooksDir(rootPath: string): Promise<HookInfo[]> {
  const hooks: HookInfo[] = [];
  const hooksDir = join(rootPath, '.claude', 'hooks');
  const entries = await listDirectory(hooksDir);

  for (const entry of entries) {
    const fullPath = join(hooksDir, entry);
    hooks.push({
      path: fullPath,
      type: 'claude-hook',
      description: `Claude hook script: ${entry}`,
    });
  }

  return hooks;
}

/**
 * Scan hooks/ directory at repository root.
 */
async function scanRootHooksDir(rootPath: string): Promise<HookInfo[]> {
  const hooks: HookInfo[] = [];
  const hooksDir = join(rootPath, 'hooks');
  const entries = await listDirectory(hooksDir);

  for (const entry of entries) {
    const fullPath = join(hooksDir, entry);
    hooks.push({
      path: fullPath,
      type: 'project-hook',
      description: `Hook script in hooks/ directory: ${entry}`,
    });
  }

  return hooks;
}

/**
 * Scan package.json for scripts with "hook" in their name.
 */
async function scanPackageJsonHooks(rootPath: string): Promise<HookInfo[]> {
  const hooks: HookInfo[] = [];
  const pkgPath = join(rootPath, 'package.json');
  const data = await readJsonFile(pkgPath);

  if (!data) return hooks;

  if (typeof data['scripts'] === 'object' && data['scripts'] !== null) {
    const scripts = data['scripts'] as Record<string, unknown>;

    for (const [name, command] of Object.entries(scripts)) {
      if (name.toLowerCase().includes('hook') && typeof command === 'string') {
        hooks.push({
          path: pkgPath,
          type: 'npm-hook',
          description: `npm script "${name}": ${command}`,
          events: [name],
        });
      }
    }
  }

  return hooks;
}

/**
 * Scan .husky/ directory for Husky git hooks.
 */
async function scanHuskyDir(rootPath: string): Promise<HookInfo[]> {
  const hooks: HookInfo[] = [];
  const huskyDir = join(rootPath, '.husky');
  const entries = await listDirectory(huskyDir);

  for (const entry of entries) {
    // Skip husky internal files
    if (entry === '_' || entry.startsWith('.')) continue;

    const fullPath = join(huskyDir, entry);
    try {
      const entryStat = await stat(fullPath);
      if (!entryStat.isFile()) continue;
    } catch {
      continue;
    }

    hooks.push({
      path: fullPath,
      type: 'husky-hook',
      description: `Husky git hook: ${entry}`,
      events: [entry],
    });
  }

  return hooks;
}

/**
 * Scan .githooks/ directory for custom git hooks.
 */
async function scanGitHooksDir(rootPath: string): Promise<HookInfo[]> {
  const hooks: HookInfo[] = [];
  const gitHooksDir = join(rootPath, '.githooks');
  const entries = await listDirectory(gitHooksDir);

  for (const entry of entries) {
    const fullPath = join(gitHooksDir, entry);
    try {
      const entryStat = await stat(fullPath);
      if (!entryStat.isFile()) continue;
    } catch {
      continue;
    }

    hooks.push({
      path: fullPath,
      type: 'git-hook',
      description: `Custom git hook: ${entry}`,
      events: [entry],
    });
  }

  return hooks;
}

/**
 * Scan a repository for hook-like assets.
 *
 * Detects hooks from multiple sources:
 * - .claude/settings.json hooks configuration
 * - .claude/hooks/ directory
 * - hooks/ directory at repository root
 * - package.json scripts with "hook" in the name
 * - .husky/ directory (Husky git hooks)
 * - .githooks/ directory (custom git hooks)
 *
 * @param rootPath  Absolute path to the repository root.
 * @returns         Array of detected hook descriptions.
 */
export async function scanForHooks(rootPath: string): Promise<HookInfo[]> {
  // Verify root exists
  try {
    const rootStat = await stat(rootPath);
    if (!rootStat.isDirectory()) return [];
  } catch {
    return [];
  }

  const results = await Promise.all([
    scanClaudeSettings(rootPath),
    scanClaudeHooksDir(rootPath),
    scanRootHooksDir(rootPath),
    scanPackageJsonHooks(rootPath),
    scanHuskyDir(rootPath),
    scanGitHooksDir(rootPath),
  ]);

  return results.flat();
}
