/**
 * `codeprobe dashboard [path]` — Rich terminal dashboard.
 *
 * Runs context analysis, asset scanning, doctor checks, and workflow
 * detection, then prints a beautiful overview using chalk and Unicode
 * box-drawing characters.
 */

import { Command } from 'commander';
import { resolve, basename } from 'node:path';
import { stat } from 'node:fs/promises';
import { setLogLevel } from '../utils/logger.js';
import { analyzeContext } from '../core/contextAnalyzer.js';
import { scanForClaudeAssets } from '../core/agentTracer.js';
import { doctorRunner } from './doctor.js';
import { analyzeWorkflow } from './workflow.js';
import { formatTokens, formatBytes } from '../utils/output.js';
import type { ContextAnalysis } from '../types/context.js';
import type { DiagnosticCheck } from '../types/diagnostics.js';
import type { ClaudeAsset } from '../types/agent.js';

// ---------------------------------------------------------------------------
// Box-drawing helpers
// ---------------------------------------------------------------------------

interface ChalkInstance {
  bold: (s: string) => string;
  dim: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  red: (s: string) => string;
  cyan: (s: string) => string;
  white: (s: string) => string;
  gray: (s: string) => string;
  bgBlue: (s: string) => string;
  blue: (s: string) => string;
}

const BOX_WIDTH = 66;

function topBox(chalk: ChalkInstance, title: string, subtitle: string): string {
  const lines: string[] = [];
  const inner = BOX_WIDTH - 2;
  lines.push(chalk.dim('\u2554' + '\u2550'.repeat(inner) + '\u2557'));

  // Title row: pad based on visible length
  const styledTitle = '  ' + chalk.bold(chalk.cyan(title));
  const titleVisible = '  ' + title;
  const titlePad = inner - titleVisible.length;
  lines.push(chalk.dim('\u2551') + styledTitle + ' '.repeat(Math.max(0, titlePad)) + chalk.dim('\u2551'));

  // Subtitle row: pad based on visible length
  const styledSub = '  ' + chalk.dim(subtitle);
  const subVisible = '  ' + subtitle;
  const subPad = inner - subVisible.length;
  lines.push(chalk.dim('\u2551') + styledSub + ' '.repeat(Math.max(0, subPad)) + chalk.dim('\u2551'));

  lines.push(chalk.dim('\u255A' + '\u2550'.repeat(inner) + '\u255D'));
  return lines.join('\n');
}

function sectionTop(chalk: ChalkInstance, title: string): string {
  const inner = BOX_WIDTH - 2;
  const label = `\u2500 ${title} `;
  const pad = inner - label.length;
  return chalk.dim('\u250C') + chalk.dim(label) + chalk.dim('\u2500'.repeat(Math.max(0, pad))) + chalk.dim('\u2510');
}

function sectionRow(chalk: ChalkInstance, content: string): string {
  const inner = BOX_WIDTH - 2;
  // Strip ANSI for length calculation
  const stripped = content.replace(/\u001B\[[0-9;]*m/g, '');
  if (stripped.length > inner) {
    // Truncate content to fit inside the box
    // We need to truncate the visible characters while preserving ANSI codes
    let visibleCount = 0;
    const ansiRegex = /\u001B\[[0-9;]*m/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const segments: Array<{ start: number; end: number; isAnsi: boolean }> = [];

    while ((match = ansiRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ start: lastIndex, end: match.index, isAnsi: false });
      }
      segments.push({ start: match.index, end: match.index + match[0].length, isAnsi: true });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
      segments.push({ start: lastIndex, end: content.length, isAnsi: false });
    }

    let truncated = '';
    const maxVisible = inner - 1; // Leave room for closing border
    for (const seg of segments) {
      if (seg.isAnsi) {
        truncated += content.slice(seg.start, seg.end);
      } else {
        const remaining = maxVisible - visibleCount;
        const text = content.slice(seg.start, seg.end);
        if (text.length <= remaining) {
          truncated += text;
          visibleCount += text.length;
        } else {
          truncated += text.slice(0, remaining);
          visibleCount += remaining;
          break;
        }
      }
    }
    const truncStripped = truncated.replace(/\u001B\[[0-9;]*m/g, '');
    const truncPad = inner - truncStripped.length;
    return chalk.dim('\u2502') + truncated + ' '.repeat(Math.max(0, truncPad)) + chalk.dim('\u2502');
  }
  const pad = inner - stripped.length;
  return chalk.dim('\u2502') + content + ' '.repeat(Math.max(0, pad)) + chalk.dim('\u2502');
}

function sectionBottom(chalk: ChalkInstance): string {
  const inner = BOX_WIDTH - 2;
  return chalk.dim('\u2514') + chalk.dim('\u2500'.repeat(inner)) + chalk.dim('\u2518');
}

// ---------------------------------------------------------------------------
// Bar rendering
// ---------------------------------------------------------------------------

function renderBar(
  chalk: ChalkInstance,
  ratio: number,
  barWidth: number,
): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * barWidth);
  const empty = barWidth - filled;
  return chalk.green('\u2588'.repeat(filled)) + chalk.dim('\u2591'.repeat(empty));
}

function renderFitBar(
  chalk: ChalkInstance,
  ratio: number,
  barWidth: number,
  fits: boolean,
): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * barWidth);
  const empty = barWidth - filled;
  const color = fits ? chalk.green : chalk.red;
  return color('\u2588'.repeat(filled)) + chalk.dim('\u2591'.repeat(empty));
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderOverview(
  chalk: ChalkInstance,
  analysis: ContextAnalysis,
  doctorChecks: DiagnosticCheck[],
  workflowScore: number,
  workflowMax: number,
  aiToolCount: number,
): string[] {
  const lines: string[] = [];
  lines.push(sectionTop(chalk, 'Overview'));

  const passCount = doctorChecks.filter((c) => c.status === 'pass').length;
  const totalChecks = doctorChecks.length;
  const hasFail = doctorChecks.some((c) => c.status === 'fail');
  const hasWarn = doctorChecks.some((c) => c.status === 'warn');
  const doctorIcon = hasFail ? chalk.red('\u2717') : hasWarn ? chalk.yellow('!') : chalk.green('\u2713');

  const filesStr = `Files: ${analysis.totalFiles}`;
  const tokensStr = `Tokens: ${formatTokens(analysis.estimatedTokens)}`;
  const sizeStr = `Size: ${formatBytes(analysis.totalBytes)}`;
  const row1 = `  ${filesStr.padEnd(16)}${tokensStr.padEnd(21)}${sizeStr}`;
  lines.push(sectionRow(chalk, row1));

  const workflowStr = `Workflow: ${workflowScore}/${workflowMax}`;
  const aiStr = `AI Tools: ${aiToolCount} detected`;
  // Handle ANSI in doctorIcon when calculating padding
  const row2Content = `  Doctor: ${passCount}/${totalChecks} ${doctorIcon}`;
  const row2Stripped = `  Doctor: ${passCount}/${totalChecks} X`;
  const row2Pad = 16 - row2Stripped.length;
  const row2Final = row2Content + ' '.repeat(Math.max(0, row2Pad)) + workflowStr.padEnd(20) + aiStr;
  lines.push(sectionRow(chalk, row2Final));

  lines.push(sectionBottom(chalk));
  return lines;
}

function renderContextFit(
  chalk: ChalkInstance,
  analysis: ContextAnalysis,
): string[] {
  const lines: string[] = [];
  lines.push(sectionTop(chalk, 'Context Window Fit'));
  lines.push(sectionRow(chalk, ''));

  // Models to show fit for
  const fitModels: Array<{ id: string; label: string; contextWindow: number }> = [
    { id: 'gpt-4o', label: 'GPT-4o (128k)', contextWindow: 128_000 },
    { id: 'claude-sonnet-4-6', label: 'Claude (200k)', contextWindow: 200_000 },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 (1M)', contextWindow: 1_048_576 },
    { id: 'gpt-4.1', label: 'GPT-4.1 (1M)', contextWindow: 1_047_576 },
  ];

  const barWidth = 32;
  const totalTokens = analysis.estimatedTokens;
  const labelWidth = 18;

  for (const model of fitModels) {
    const ratio = totalTokens / model.contextWindow;
    const pct = Math.min(Math.round(ratio * 100), 999);
    const fits = totalTokens <= model.contextWindow;
    const bar = renderFitBar(chalk, ratio, barWidth, fits);
    const icon = fits ? chalk.green('\u2713') : chalk.red('\u2717');
    const pctStr = `${pct}%`.padStart(4);
    const label = model.label.padEnd(labelWidth);
    lines.push(sectionRow(chalk, `  ${label} ${bar} ${pctStr} ${icon}`));
  }

  lines.push(sectionRow(chalk, ''));
  lines.push(sectionBottom(chalk));
  return lines;
}

function renderTopFiles(
  chalk: ChalkInstance,
  analysis: ContextAnalysis,
): string[] {
  const lines: string[] = [];
  lines.push(sectionTop(chalk, 'Top Files by Tokens'));
  lines.push(sectionRow(chalk, ''));

  const topFiles = analysis.largestFiles.slice(0, 10);
  if (topFiles.length === 0) {
    lines.push(sectionRow(chalk, chalk.dim('  No files found')));
    lines.push(sectionRow(chalk, ''));
    lines.push(sectionBottom(chalk));
    return lines;
  }

  const maxTokens = topFiles[0]?.estimatedTokens ?? 1;
  const barWidth = 16;
  const nameWidth = 30;

  for (const file of topFiles) {
    const ratio = file.estimatedTokens / maxTokens;
    const bar = renderBar(chalk, ratio, barWidth);
    const name = file.path.length > nameWidth
      ? '...' + file.path.slice(-(nameWidth - 3))
      : file.path.padEnd(nameWidth);
    const tokenStr = formatTokens(file.estimatedTokens).padStart(6);
    lines.push(sectionRow(chalk, `  ${name} ${bar} ${tokenStr}`));
  }

  if (analysis.largestFiles.length > 10) {
    lines.push(sectionRow(chalk, chalk.dim(`  ... ${analysis.largestFiles.length - 10} more files`)));
  }

  lines.push(sectionRow(chalk, ''));
  lines.push(sectionBottom(chalk));
  return lines;
}

function renderExtensions(
  chalk: ChalkInstance,
  analysis: ContextAnalysis,
): string[] {
  const lines: string[] = [];
  lines.push(sectionTop(chalk, 'Extensions'));

  const totalTokens = analysis.estimatedTokens || 1;
  const barWidth = 20;

  // Show top extensions, group the rest as "other"
  const topExtCount = 4;
  const topExts = analysis.extensionBreakdown.slice(0, topExtCount);
  const otherExts = analysis.extensionBreakdown.slice(topExtCount);

  const otherFiles = otherExts.reduce((sum, e) => sum + e.fileCount, 0);
  const otherTokens = otherExts.reduce((sum, e) => sum + e.estimatedTokens, 0);

  for (const ext of topExts) {
    const pct = ext.estimatedTokens / totalTokens;
    const bar = renderBar(chalk, pct, barWidth);
    const pctStr = `${Math.round(pct * 100)}%`.padStart(4);
    const extLabel = ext.extension.padEnd(6);
    const countStr = `${ext.fileCount} files`.padEnd(10);
    const tokenStr = `${formatTokens(ext.estimatedTokens)} tokens`.padEnd(14);
    lines.push(sectionRow(chalk, `  ${extLabel} ${countStr} ${tokenStr} ${bar} ${pctStr}`));
  }

  if (otherFiles > 0) {
    const pct = otherTokens / totalTokens;
    const bar = renderBar(chalk, pct, barWidth);
    const pctStr = `${Math.round(pct * 100)}%`.padStart(4);
    const extLabel = 'other'.padEnd(6);
    const countStr = `${otherFiles} files`.padEnd(10);
    const tokenStr = `${formatTokens(otherTokens)} tokens`.padEnd(14);
    lines.push(sectionRow(chalk, `  ${extLabel} ${countStr} ${tokenStr} ${bar} ${pctStr}`));
  }

  lines.push(sectionBottom(chalk));
  return lines;
}

function renderDoctor(
  chalk: ChalkInstance,
  checks: DiagnosticCheck[],
): string[] {
  const lines: string[] = [];
  lines.push(sectionTop(chalk, 'Doctor'));

  // Render checks in compact rows of 3
  const items: string[] = checks.map((c) => {
    const icon = c.status === 'pass'
      ? chalk.green('\u2713')
      : c.status === 'warn'
        ? chalk.yellow('!')
        : chalk.red('\u2717');

    // Extract short label from name and message
    let label = c.name;
    if (c.name === 'Node.js version') {
      const verMatch = c.message.match(/v[\d.]+/);
      label = `Node.js ${verMatch ? verMatch[0] : ''}`;
    } else if (c.name === 'npm') {
      label = `npm ${c.message}`;
    } else if (c.name === 'git') {
      const gitMatch = c.message.match(/[\d.]+/);
      label = `git v${gitMatch ? gitMatch[0] : ''}`;
    } else if (c.name === 'package.json') {
      label = 'package.json';
    } else if (c.name === 'codeprobe config' || c.name === 'Configuration file') {
      label = 'config';
    } else if (c.name === 'CLAUDE.md') {
      label = 'CLAUDE.md';
    } else if (c.name === 'prompts/ directory') {
      label = 'prompts/';
    } else if (c.name === 'tiktoken') {
      label = 'tiktoken';
    } else if (c.name === 'Cache directory' || c.name === '.cache/ directory') {
      label = 'cache';
    }

    return `${icon} ${label}`;
  });

  // Layout in rows of 3
  const perRow = 3;
  const colWidth = 20;
  for (let i = 0; i < items.length; i += perRow) {
    const row = items.slice(i, i + perRow);
    // Pad each item to colWidth (accounting for ANSI)
    const paddedItems = row.map((item) => {
      const stripped = item.replace(/\u001B\[[0-9;]*m/g, '');
      const pad = colWidth - stripped.length;
      return item + ' '.repeat(Math.max(0, pad));
    });
    lines.push(sectionRow(chalk, '  ' + paddedItems.join('')));
  }

  lines.push(sectionBottom(chalk));
  return lines;
}

function renderAITools(
  chalk: ChalkInstance,
  assets: ClaudeAsset[],
): string[] {
  const lines: string[] = [];
  lines.push(sectionTop(chalk, 'AI Tools'));

  if (assets.length === 0) {
    lines.push(sectionRow(chalk, chalk.dim('  No AI tool configurations detected')));
    lines.push(sectionBottom(chalk));
    return lines;
  }

  // Group by type and show a summary line per tool
  const typeLabels: Record<string, string> = {
    'claude-config': 'Claude Code',
    'cursor-config': 'Cursor',
    'windsurf-config': 'Windsurf',
    'copilot-config': 'GitHub Copilot',
    'aider-config': 'Aider',
    'continue-config': 'Continue',
    'cline-config': 'Cline',
    'codex-config': 'Codex',
    'agent': 'Agent',
    'skill': 'Skill',
    'hook': 'Hook',
    'mcp-config': 'MCP Config',
    'prompt-spec': 'Prompt Spec',
    'context-file': 'Context File',
    'agentic-workflow': 'Workflow',
  };

  const grouped = new Map<string, string[]>();
  for (const asset of assets) {
    const label = typeLabels[asset.type] ?? asset.type;
    const existing = grouped.get(label);
    const fileName = basename(asset.path);
    if (existing) {
      existing.push(fileName);
    } else {
      grouped.set(label, [fileName]);
    }
  }

  for (const [tool, files] of grouped) {
    lines.push(sectionRow(chalk, `  ${chalk.bold(tool)}: ${files.join(', ')}`));
  }

  lines.push(sectionBottom(chalk));
  return lines;
}


// ---------------------------------------------------------------------------
// Dashboard JSON output type
// ---------------------------------------------------------------------------

interface DashboardData {
  path: string;
  overview: {
    files: number;
    tokens: number;
    bytes: number;
    doctorPass: number;
    doctorTotal: number;
    workflowScore: number;
    workflowMax: number;
    aiToolCount: number;
  };
  contextFit: Array<{
    model: string;
    contextWindow: number;
    utilization: number;
    fits: boolean;
  }>;
  topFiles: Array<{
    path: string;
    tokens: number;
  }>;
  extensions: Array<{
    extension: string;
    files: number;
    tokens: number;
    percentage: number;
  }>;
  doctor: Array<{
    name: string;
    status: string;
    message: string;
  }>;
  aiTools: Array<{
    type: string;
    path: string;
  }>;
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export function registerDashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .argument('[path]', 'Path to analyze', '.')
    .description('Rich terminal dashboard — context, models, doctor, and AI tools at a glance')
    .option('--json', 'Output dashboard data as JSON')
    .action(async (pathArg: string, options: { json?: boolean }) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const targetPath = resolve(pathArg);

      // Verify path exists
      try {
        const s = await stat(targetPath);
        if (!s.isDirectory()) {
          console.error(`Error: not a directory: ${targetPath}`);
          process.exitCode = 1;
          return;
        }
      } catch {
        console.error(`Error: path not found: ${targetPath}`);
        process.exitCode = 1;
        return;
      }

      // Run all analyses in parallel
      const [analysis, assets, doctorChecks, workflow] = await Promise.all([
        analyzeContext(targetPath),
        scanForClaudeAssets(targetPath),
        doctorRunner(),
        analyzeWorkflow(targetPath),
      ]);

      // Count unique AI tool types
      const aiToolTypes = new Set(assets.map((a) => a.type));
      const aiToolCount = aiToolTypes.size > 0 ? assets.length : 0;

      // JSON output
      if (options.json) {
        const fitModels = [
          { id: 'gpt-4o', label: 'GPT-4o (128k)', contextWindow: 128_000 },
          { id: 'claude-sonnet-4-6', label: 'Claude (200k)', contextWindow: 200_000 },
          { id: 'gemini-2.5-pro', label: 'Gemini 2.5 (1M)', contextWindow: 1_048_576 },
          { id: 'gpt-4.1', label: 'GPT-4.1 (1M)', contextWindow: 1_047_576 },
        ];

        const data: DashboardData = {
          path: targetPath,
          overview: {
            files: analysis.totalFiles,
            tokens: analysis.estimatedTokens,
            bytes: analysis.totalBytes,
            doctorPass: doctorChecks.filter((c) => c.status === 'pass').length,
            doctorTotal: doctorChecks.length,
            workflowScore: workflow.score,
            workflowMax: workflow.maxScore,
            aiToolCount,
          },
          contextFit: fitModels.map((m) => ({
            model: m.label,
            contextWindow: m.contextWindow,
            utilization: analysis.estimatedTokens / m.contextWindow,
            fits: analysis.estimatedTokens <= m.contextWindow,
          })),
          topFiles: analysis.largestFiles.slice(0, 10).map((f) => ({
            path: f.path,
            tokens: f.estimatedTokens,
          })),
          extensions: analysis.extensionBreakdown.map((e) => ({
            extension: e.extension,
            files: e.fileCount,
            tokens: e.estimatedTokens,
            percentage: analysis.estimatedTokens > 0
              ? e.estimatedTokens / analysis.estimatedTokens
              : 0,
          })),
          doctor: doctorChecks.map((c) => ({
            name: c.name,
            status: c.status,
            message: c.message,
          })),
          aiTools: assets.map((a) => ({
            type: a.type,
            path: a.path,
          })),
        };

        console.log(JSON.stringify(data, null, 2));
        return;
      }

      // Rich terminal output
      const chalk = (await import('chalk')).default;

      console.log('');

      // Header box
      console.log(topBox(chalk, 'codeprobe dashboard', targetPath));
      console.log('');

      // Overview
      const overviewLines = renderOverview(
        chalk, analysis, doctorChecks,
        workflow.score, workflow.maxScore, aiToolCount,
      );
      for (const line of overviewLines) {
        console.log(line);
      }
      console.log('');

      // Context Window Fit
      const fitLines = renderContextFit(chalk, analysis);
      for (const line of fitLines) {
        console.log(line);
      }
      console.log('');

      // Top Files
      const topFilesLines = renderTopFiles(chalk, analysis);
      for (const line of topFilesLines) {
        console.log(line);
      }
      console.log('');

      // Extensions
      const extLines = renderExtensions(chalk, analysis);
      for (const line of extLines) {
        console.log(line);
      }
      console.log('');

      // Doctor
      const doctorLines = renderDoctor(chalk, doctorChecks);
      for (const line of doctorLines) {
        console.log(line);
      }
      console.log('');

      // AI Tools
      const aiToolLines = renderAITools(chalk, assets);
      for (const line of aiToolLines) {
        console.log(line);
      }
      console.log('');
    });
}
