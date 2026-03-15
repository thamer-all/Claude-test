/**
 * `claude-test agents [path]` — Scan for AI coding tool assets.
 *
 * Detects configuration and workflow files for Claude Code, Cursor,
 * Windsurf, GitHub Copilot, Aider, Continue.dev, Cline, OpenAI Codex,
 * and other AI coding tools.
 */

import { Command } from 'commander';
import { resolvePath } from '../utils/paths.js';
import { walkDirectory, getRelativePath } from '../utils/fs.js';
import { readFile } from 'node:fs/promises';
import { setLogLevel } from '../utils/logger.js';
import type { ClaudeAsset, ClaudeAssetType } from '../types/agent.js';

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.cache', '.turbo',
]);

/** Patterns for identifying Claude assets. */
const ASSET_PATTERNS: Array<{
  namePattern: RegExp;
  type: ClaudeAssetType;
  confidence: ClaudeAsset['confidence'];
  reason: string;
}> = [
  {
    namePattern: /^CLAUDE\.md$/i,
    type: 'claude-config',
    confidence: 'high',
    reason: 'Claude Code configuration file',
  },
  {
    namePattern: /^\.claude\/?/,
    type: 'claude-config',
    confidence: 'high',
    reason: 'Claude configuration directory',
  },
  {
    namePattern: /\.prompt\.(ya?ml|json)$/i,
    type: 'prompt-spec',
    confidence: 'high',
    reason: 'Prompt specification file',
  },
  {
    namePattern: /\.skill\.(ya?ml|md)$/i,
    type: 'skill',
    confidence: 'high',
    reason: 'Skill definition file',
  },
  {
    namePattern: /mcp\.json$/i,
    type: 'mcp-config',
    confidence: 'high',
    reason: 'MCP configuration file',
  },
  {
    namePattern: /\.mcp\.(ya?ml|json)$/i,
    type: 'mcp-config',
    confidence: 'high',
    reason: 'MCP configuration file',
  },
  {
    namePattern: /hooks?\.(ya?ml|json|ts|js)$/i,
    type: 'hook',
    confidence: 'medium',
    reason: 'Possible hook configuration',
  },
  {
    namePattern: /claude[_-]?test\.config\.(ya?ml|json)$/i,
    type: 'context-file',
    confidence: 'high',
    reason: 'claude-test configuration file',
  },
  {
    namePattern: /AGENTS?\.md$/i,
    type: 'agent',
    confidence: 'medium',
    reason: 'Agent instructions file',
  },
  {
    namePattern: /CONTEXT\.md$/i,
    type: 'context-file',
    confidence: 'medium',
    reason: 'Context documentation file',
  },
  // ── Cursor ──
  {
    namePattern: /^\.cursorrules$/,
    type: 'cursor-config',
    confidence: 'high',
    reason: 'Cursor rules configuration file',
  },
  {
    namePattern: /^\.cursor[/\\]rules[/\\]/,
    type: 'cursor-config',
    confidence: 'high',
    reason: 'Cursor rule definition',
  },
  {
    namePattern: /^\.cursor[/\\]mcp\.json$/,
    type: 'mcp-config',
    confidence: 'high',
    reason: 'MCP configuration file for Cursor',
  },
  // ── Windsurf ──
  {
    namePattern: /^\.windsurfrules$/,
    type: 'windsurf-config',
    confidence: 'high',
    reason: 'Windsurf rules configuration file',
  },
  {
    namePattern: /^\.windsurf[/\\]rules[/\\]/,
    type: 'windsurf-config',
    confidence: 'high',
    reason: 'Windsurf rule definition',
  },
  // ── GitHub Copilot ──
  {
    namePattern: /^\.github[/\\]copilot-instructions\.md$/,
    type: 'copilot-config',
    confidence: 'high',
    reason: 'GitHub Copilot custom instructions',
  },
  {
    namePattern: /^\.copilot[/\\]/,
    type: 'copilot-config',
    confidence: 'medium',
    reason: 'GitHub Copilot configuration',
  },
  // ── Aider ──
  {
    namePattern: /^\.aider\.conf\.yml$/,
    type: 'aider-config',
    confidence: 'high',
    reason: 'Aider configuration file',
  },
  {
    namePattern: /^\.aiderignore$/,
    type: 'aider-config',
    confidence: 'high',
    reason: 'Aider ignore file',
  },
  {
    namePattern: /^\.aider\.model\.settings\.yml$/,
    type: 'aider-config',
    confidence: 'high',
    reason: 'Aider model settings file',
  },
  // ── Continue.dev ──
  {
    namePattern: /^\.continue[/\\]config\.json$/,
    type: 'continue-config',
    confidence: 'high',
    reason: 'Continue.dev configuration file',
  },
  {
    namePattern: /^\.continuerules$/,
    type: 'continue-config',
    confidence: 'high',
    reason: 'Continue.dev rules file',
  },
  {
    namePattern: /^\.continue[/\\]/,
    type: 'continue-config',
    confidence: 'medium',
    reason: 'Continue.dev configuration',
  },
  // ── Cline ──
  {
    namePattern: /^\.clinerules$/,
    type: 'cline-config',
    confidence: 'high',
    reason: 'Cline rules configuration file',
  },
  {
    namePattern: /^\.cline[/\\]/,
    type: 'cline-config',
    confidence: 'medium',
    reason: 'Cline configuration',
  },
  // ── OpenAI Codex CLI ──
  {
    namePattern: /^[Cc][Oo][Dd][Ee][Xx]\.md$/,
    type: 'codex-config',
    confidence: 'high',
    reason: 'OpenAI Codex CLI instruction file',
  },
  {
    namePattern: /^\.codex[/\\]/,
    type: 'codex-config',
    confidence: 'medium',
    reason: 'OpenAI Codex configuration',
  },
  // ── General AI ──
  {
    namePattern: /^AI\.md$/,
    type: 'context-file',
    confidence: 'medium',
    reason: 'AI instructions file',
  },
  {
    namePattern: /^\.ai[/\\]/,
    type: 'context-file',
    confidence: 'medium',
    reason: 'AI configuration directory',
  },
  // ── Agentic workflow ──
  {
    namePattern: /^tasks[/\\]todo\.md$/i,
    type: 'agentic-workflow',
    confidence: 'high',
    reason: 'Agentic workflow task list',
  },
  {
    namePattern: /^tasks[/\\]lessons\.md$/i,
    type: 'agentic-workflow',
    confidence: 'high',
    reason: 'Agentic workflow lessons learned',
  },
  {
    namePattern: /^PLAN\.md$/,
    type: 'agentic-workflow',
    confidence: 'medium',
    reason: 'Agentic workflow plan file',
  },
  {
    namePattern: /^plans[/\\].*\.md$/i,
    type: 'agentic-workflow',
    confidence: 'medium',
    reason: 'Agentic workflow plan',
  },
];

/**
 * Scan a directory for Claude-related assets.
 */
async function agentTracer(rootPath: string): Promise<ClaudeAsset[]> {
  const entries = await walkDirectory(rootPath, { ignoreDirs: DEFAULT_IGNORE_DIRS });
  const assets: ClaudeAsset[] = [];

  for (const entry of entries) {
    const relPath = getRelativePath(rootPath, entry.path);
    const fileName = entry.path.split('/').pop() ?? '';

    for (const pattern of ASSET_PATTERNS) {
      if (pattern.namePattern.test(fileName) || pattern.namePattern.test(relPath)) {
        let metadata: Record<string, unknown> | undefined;

        // Try to extract metadata from the file
        if (entry.isFile && entry.size < 50_000) {
          try {
            const content = await readFile(entry.path, 'utf-8');
            metadata = {
              sizeBytes: entry.size,
              lineCount: content.split('\n').length,
            };
          } catch {
            // Skip metadata extraction
          }
        }

        assets.push({
          path: relPath,
          type: pattern.type,
          confidence: pattern.confidence,
          reason: pattern.reason,
          metadata,
        });
        break; // Only match the first pattern per file
      }
    }
  }

  return assets;
}

export function registerAgentsCommand(program: Command): void {
  program
    .command('agents [path]')
    .description('Scan for AI coding tool assets — Claude, Cursor, Windsurf, Copilot, and more')
    .option('--json', 'Output findings as JSON')
    .action(async (
      pathArg: string | undefined,
      options: { json?: boolean },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? '.');

      const assets = await agentTracer(targetPath);

      if (options.json) {
        console.log(JSON.stringify(assets, null, 2));
        return;
      }

      if (assets.length === 0) {
        console.log(chalk.dim('\nNo AI coding tool assets found.'));
        console.log(chalk.dim('Run `claude-test init` to create starter files.\n'));
        return;
      }

      console.log(chalk.bold(`\nAI Tool Assets (${assets.length} found)`));
      console.log('');

      // Group by type
      const grouped = new Map<ClaudeAssetType, ClaudeAsset[]>();
      for (const asset of assets) {
        const list = grouped.get(asset.type) ?? [];
        list.push(asset);
        grouped.set(asset.type, list);
      }

      const typeLabels: Record<ClaudeAssetType, string> = {
        'claude-config': 'Claude Code',
        'cursor-config': 'Cursor',
        'windsurf-config': 'Windsurf',
        'copilot-config': 'GitHub Copilot',
        'aider-config': 'Aider',
        'continue-config': 'Continue.dev',
        'cline-config': 'Cline',
        'codex-config': 'OpenAI Codex',
        'agent': 'Agents',
        'skill': 'Skills',
        'hook': 'Hooks',
        'mcp-config': 'MCP Configs',
        'prompt-spec': 'Prompt Specs',
        'context-file': 'Context Files',
        'agentic-workflow': 'Agentic Workflow',
        'other': 'Other',
      };

      for (const [type, items] of grouped) {
        console.log(chalk.bold(`  ${typeLabels[type] ?? type}`));
        for (const item of items) {
          const confColor = item.confidence === 'high'
            ? chalk.green
            : item.confidence === 'medium'
              ? chalk.yellow
              : chalk.dim;
          console.log(`    ${item.path}  ${confColor(`[${item.confidence}]`)}  ${chalk.dim(item.reason)}`);
        }
        console.log('');
      }
    });
}
