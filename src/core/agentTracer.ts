/**
 * Agent tracer: heuristic scanner for Claude-related workflow assets.
 *
 * Walks a repository tree and identifies files that are part of a
 * Claude Code workflow -- configuration, agents, skills, hooks,
 * MCP configs, and prompt specs.
 */

import { basename, extname } from 'node:path';
import { stat } from 'node:fs/promises';
import type { ClaudeAsset, ClaudeAssetType } from '../types/agent.js';
import { walkDirectory } from '../utils/fs.js';

/** Directories to skip during traversal. */
const SKIP_DIRS: Set<string> = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '__pycache__', '.next', '.nuxt', '.cache', '.turbo',
  '.parcel-cache', '.vscode', '.idea', 'vendor', 'tmp',
  '.tmp', '.terraform',
]);

/**
 * Pattern rules for identifying Claude assets.
 * Each rule defines a match condition, the resulting asset type,
 * confidence level, and a human-readable reason.
 */
interface AssetRule {
  match: (relativePath: string, fileName: string, ext: string) => boolean;
  type: ClaudeAssetType;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

const ASSET_RULES: ReadonlyArray<AssetRule> = [
  // CLAUDE.md at any level
  {
    match: (_rel, name) => name === 'CLAUDE.md',
    type: 'claude-config',
    confidence: 'high',
    reason: 'CLAUDE.md is a Claude Code project instructions file.',
  },
  // .claude/ directory contents
  {
    match: (rel) => rel.startsWith('.claude/') || rel.startsWith('.claude\\'),
    type: 'claude-config',
    confidence: 'high',
    reason: 'File inside .claude/ directory (Claude Code configuration).',
  },
  // .claude/settings.json specifically
  {
    match: (rel) =>
      rel === '.claude/settings.json' ||
      rel === '.claude\\settings.json',
    type: 'claude-config',
    confidence: 'high',
    reason: 'Claude Code settings file.',
  },
  // agents/*.yaml or agents/*.yml
  {
    match: (rel, _name, ext) => {
      const parts = rel.split(/[/\\]/);
      return parts.length >= 2 &&
        parts[0] === 'agents' &&
        (ext === '.yaml' || ext === '.yml');
    },
    type: 'agent',
    confidence: 'medium',
    reason: 'YAML file in agents/ directory -- likely an agent definition.',
  },
  // SKILL.md
  {
    match: (_rel, name) => name === 'SKILL.md',
    type: 'skill',
    confidence: 'medium',
    reason: 'SKILL.md is a Claude Code skill definition file.',
  },
  // skills/*.md
  {
    match: (rel, _name, ext) => {
      const parts = rel.split(/[/\\]/);
      return parts.length >= 2 &&
        parts[0] === 'skills' &&
        ext === '.md';
    },
    type: 'skill',
    confidence: 'medium',
    reason: 'Markdown file in skills/ directory -- likely a skill definition.',
  },
  // hooks/ directory at root
  {
    match: (rel) => {
      const parts = rel.split(/[/\\]/);
      return parts.length >= 2 && parts[0] === 'hooks';
    },
    type: 'hook',
    confidence: 'medium',
    reason: 'File in hooks/ directory.',
  },
  // .claude/hooks directory
  {
    match: (rel) =>
      rel.startsWith('.claude/hooks/') ||
      rel.startsWith('.claude\\hooks\\'),
    type: 'hook',
    confidence: 'medium',
    reason: 'File in .claude/hooks/ directory.',
  },
  // MCP config files
  {
    match: (_rel, name) =>
      name === '.mcp.json' ||
      name === 'mcp.json',
    type: 'mcp-config',
    confidence: 'high',
    reason: 'MCP configuration file.',
  },
  // .claude/mcp*.json
  {
    match: (rel, name) => {
      const parts = rel.split(/[/\\]/);
      return parts.length >= 2 &&
        parts[0] === '.claude' &&
        name.startsWith('mcp') &&
        name.endsWith('.json');
    },
    type: 'mcp-config',
    confidence: 'high',
    reason: 'MCP configuration file in .claude/ directory.',
  },
  // *.prompt.yaml / *.prompt.yml
  {
    match: (_rel, name) =>
      name.endsWith('.prompt.yaml') ||
      name.endsWith('.prompt.yml'),
    type: 'prompt-spec',
    confidence: 'high',
    reason: 'Prompt specification file (*.prompt.yaml).',
  },
  // prompts/*.yaml
  {
    match: (rel, _name, ext) => {
      const parts = rel.split(/[/\\]/);
      return parts.length >= 2 &&
        parts[0] === 'prompts' &&
        (ext === '.yaml' || ext === '.yml');
    },
    type: 'prompt-spec',
    confidence: 'medium',
    reason: 'YAML file in prompts/ directory -- likely a prompt specification.',
  },
];

/**
 * Heuristically scan a repository for Claude-related workflow assets.
 *
 * Walks the directory tree (skipping node_modules, .git, dist, etc.)
 * and matches files against a set of pattern rules to identify
 * configuration files, agents, skills, hooks, MCP configs, and
 * prompt specs.
 *
 * @param rootPath  Absolute path to the repository root.
 * @returns         Array of discovered Claude assets with confidence and reason.
 */
export async function scanForClaudeAssets(
  rootPath: string,
): Promise<ClaudeAsset[]> {
  // Verify root exists and is a directory
  try {
    const rootStat = await stat(rootPath);
    if (!rootStat.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const assets: ClaudeAsset[] = [];
  const seenPaths = new Set<string>();

  const entries = await walkDirectory(rootPath, { ignoreDirs: SKIP_DIRS });

  for (const entry of entries) {
    if (!entry.isFile) continue;

    const relativePath = entry.relativePath;
    const fileName = basename(entry.path);
    const ext = extname(entry.path).toLowerCase();

    for (const rule of ASSET_RULES) {
      if (rule.match(relativePath, fileName, ext)) {
        // Avoid duplicates when multiple rules match the same file.
        // Use the first (highest priority) match.
        if (!seenPaths.has(entry.path)) {
          seenPaths.add(entry.path);
          assets.push({
            path: entry.path,
            type: rule.type,
            confidence: rule.confidence,
            reason: rule.reason,
          });
        }
        break;
      }
    }
  }

  // Sort by confidence (high first), then by path
  const confidenceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  assets.sort((a, b) => {
    const confDiff = confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
    if (confDiff !== 0) return confDiff;
    return a.path.localeCompare(b.path);
  });

  return assets;
}
