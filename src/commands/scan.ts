/**
 * `codeprobe scan [path]` — Unified one-command project analysis.
 *
 * Runs context analysis, AI tool detection, lint check, security scan,
 * and workflow analysis in parallel, then presents a consolidated report
 * with an overall health score and actionable recommendations.
 */

import { Command } from 'commander';
import { resolve, basename, relative } from 'node:path';
import { stat } from 'node:fs/promises';
import { setLogLevel } from '../utils/logger.js';
import { analyzeContext } from '../core/contextAnalyzer.js';
import { scanForClaudeAssets } from '../core/agentTracer.js';
import { lintDirectory } from '../core/promptLinter.js';
import { scanSecurity } from '../core/securityScanner.js';
import { analyzeWorkflow } from './workflow.js';
import { formatTokens, formatBytes } from '../utils/output.js';
import type { ContextAnalysis } from '../types/context.js';
import type { ClaudeAsset } from '../types/agent.js';
import type { LintWarning, SecurityFinding } from '../types/diagnostics.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkflowReport {
  tasks: Array<{ file: string; total: number; completed: number; pending: number; completionPct: number }>;
  lessons: Array<{ file: string; count: number }>;
  plans: Array<{ directory: string; files: string[] }>;
  aiTools: Array<{ tool: string; files: string[] }>;
  score: number;
  maxScore: number;
  detected: string[];
  missing: string[];
}

interface Recommendation {
  priority: 'HIGH' | 'MED' | 'LOW';
  message: string;
  fix?: string;
}

interface ScanResult {
  path: string;
  context: ContextAnalysis;
  assets: ClaudeAsset[];
  lintWarnings: LintWarning[];
  securityFindings: SecurityFinding[];
  workflow: WorkflowReport;
  recommendations: Recommendation[];
  healthScore: number;
}

// ---------------------------------------------------------------------------
// Health score computation
// ---------------------------------------------------------------------------

function computeHealthScore(
  context: ContextAnalysis,
  assets: ClaudeAsset[],
  lintWarnings: LintWarning[],
  securityFindings: SecurityFinding[],
  workflow: WorkflowReport,
): number {
  let score = 0;

  // Context fits in 200k? +2
  const fitsIn200k = context.estimatedTokens <= 200_000;
  if (fitsIn200k) score += 2;

  // No lint issues? +1
  const lintErrors = lintWarnings.filter(w => w.severity === 'error');
  if (lintErrors.length === 0) score += 1;

  // No security issues? +2
  if (securityFindings.length === 0) score += 2;

  // Has AI config (CLAUDE.md, .cursorrules, etc)? +1
  const aiConfigTypes = new Set(['claude-config', 'cursor-config', 'windsurf-config', 'copilot-config', 'aider-config', 'continue-config', 'cline-config', 'codex-config']);
  const hasAIConfig = assets.some(a => aiConfigTypes.has(a.type));
  if (hasAIConfig) score += 1;

  // Has prompt specs? +1
  const hasPromptSpecs = assets.some(a => a.type === 'prompt-spec');
  if (hasPromptSpecs) score += 1;

  // Prompt specs have tests? +1
  const promptSpecsWithoutTests = lintWarnings.filter(w => w.rule === 'missing-tests');
  if (hasPromptSpecs && promptSpecsWithoutTests.length === 0) score += 1;

  // Workflow score >= 3? +1
  if (workflow.score >= 3) score += 1;

  // Has CI? +1
  if (workflow.detected.includes('CI integration')) score += 1;

  return Math.min(score, 10);
}

// ---------------------------------------------------------------------------
// Recommendation generation
// ---------------------------------------------------------------------------

function generateRecommendations(
  context: ContextAnalysis,
  assets: ClaudeAsset[],
  lintWarnings: LintWarning[],
  securityFindings: SecurityFinding[],
  workflow: WorkflowReport,
): Recommendation[] {
  const recs: Recommendation[] = [];

  // Security issues
  const criticalSecurity = securityFindings.filter(f => f.severity === 'critical');
  if (criticalSecurity.length > 0) {
    recs.push({
      priority: 'HIGH',
      message: `${criticalSecurity.length} critical security issue${criticalSecurity.length > 1 ? 's' : ''} found`,
      fix: 'codeprobe security .',
    });
  }

  const highSecurity = securityFindings.filter(f => f.severity === 'high');
  if (highSecurity.length > 0) {
    recs.push({
      priority: 'HIGH',
      message: `${highSecurity.length} high-severity security issue${highSecurity.length > 1 ? 's' : ''} found`,
      fix: 'codeprobe security .',
    });
  }

  // Lint errors
  const lintErrors = lintWarnings.filter(w => w.severity === 'error');
  if (lintErrors.length > 0) {
    recs.push({
      priority: 'HIGH',
      message: `${lintErrors.length} lint error${lintErrors.length > 1 ? 's' : ''} in prompt specs`,
      fix: 'codeprobe lint .',
    });
  }

  // Prompt specs without tests
  const missingTests = lintWarnings.filter(w => w.rule === 'missing-tests');
  if (missingTests.length > 0) {
    const specFile = missingTests[0]?.file;
    const shortPath = specFile ? relative(process.cwd(), specFile) : 'prompts/';
    recs.push({
      priority: 'HIGH',
      message: `${missingTests.length} prompt spec${missingTests.length > 1 ? 's have' : ' has'} no tests`,
      fix: `codeprobe autotest ${shortPath}`,
    });
  }

  // Exceeds GPT-4o context window
  if (context.estimatedTokens > 128_000) {
    recs.push({
      priority: 'HIGH',
      message: 'Exceeds GPT-4o context window (128k)',
      fix: 'codeprobe pack . --target 128k',
    });
  }

  // Exceeds 200k context window
  if (context.estimatedTokens > 200_000) {
    recs.push({
      priority: 'HIGH',
      message: 'Exceeds Claude/o3 context window (200k)',
      fix: 'codeprobe pack . --target 200k',
    });
  }

  // No AI config
  const aiConfigTypes = new Set(['claude-config', 'cursor-config', 'windsurf-config', 'copilot-config', 'aider-config', 'continue-config', 'cline-config', 'codex-config']);
  const hasAIConfig = assets.some(a => aiConfigTypes.has(a.type));
  if (!hasAIConfig) {
    recs.push({
      priority: 'MED',
      message: 'No AI tool configuration found (CLAUDE.md, .cursorrules, etc.)',
      fix: 'codeprobe generate-claudemd',
    });
  }

  // No prompt specs
  const hasPromptSpecs = assets.some(a => a.type === 'prompt-spec');
  if (!hasPromptSpecs) {
    recs.push({
      priority: 'MED',
      message: 'No prompt specs found',
      fix: 'codeprobe init',
    });
  }

  // Workflow gaps
  for (const missing of workflow.missing) {
    if (missing === 'task tracking') {
      recs.push({
        priority: 'LOW',
        message: 'No task tracking file (tasks/todo.md)',
      });
    } else if (missing === 'lessons') {
      recs.push({
        priority: 'LOW',
        message: 'No lessons file for capturing learnings',
      });
    } else if (missing === 'plans') {
      recs.push({
        priority: 'LOW',
        message: 'No plan files found',
      });
    } else if (missing === 'CI integration') {
      recs.push({
        priority: 'LOW',
        message: 'No CI/CD configuration detected',
      });
    }
  }

  // Lint warnings (non-error)
  const lintWarningCount = lintWarnings.filter(w => w.severity === 'warning').length;
  if (lintWarningCount > 0) {
    recs.push({
      priority: 'LOW',
      message: `${lintWarningCount} lint warning${lintWarningCount > 1 ? 's' : ''} in prompt specs`,
      fix: 'codeprobe lint . --fix',
    });
  }

  return recs;
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .argument('[path]', 'Path to analyze', '.')
    .description('Full project analysis — context, AI tools, lint, security, workflow, and recommendations')
    .option('--json', 'Output scan results as JSON')
    .option('--fix', 'Show fix commands for each recommendation')
    .action(async (pathArg: string, options: { json?: boolean; fix?: boolean }) => {
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
      const [context, assets, lintWarnings, securityFindings, workflow] = await Promise.all([
        analyzeContext(targetPath),
        scanForClaudeAssets(targetPath),
        lintDirectory(targetPath),
        scanSecurity(targetPath),
        analyzeWorkflow(targetPath),
      ]);

      const recommendations = generateRecommendations(
        context, assets, lintWarnings, securityFindings, workflow,
      );

      const healthScore = computeHealthScore(
        context, assets, lintWarnings, securityFindings, workflow,
      );

      // JSON output
      if (options.json) {
        const data: ScanResult = {
          path: targetPath,
          context,
          assets,
          lintWarnings,
          securityFindings,
          workflow,
          recommendations,
          healthScore,
        };
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      // Rich terminal output
      const chalk = (await import('chalk')).default;

      const W = 64;
      const line = '\u2550'.repeat(W);

      console.log('');
      console.log(chalk.bold('  codeprobe scan \u2014 Project Analysis'));
      console.log('');
      console.log(chalk.dim(`  ${line}`));
      console.log(chalk.bold(`  ${targetPath}`));
      console.log(chalk.dim(`  ${line}`));

      // --- Context ---
      console.log('');
      console.log(chalk.bold('  Context'));

      const tokensStr = formatTokens(context.estimatedTokens);
      const bytesStr = formatBytes(context.totalBytes);
      console.log(chalk.white(`    ${context.textFiles} files | ${tokensStr} tokens | ${bytesStr}`));

      // Context fit summary
      const fitModels: Array<{ label: string; window: number }> = [
        { label: 'GPT-4o 128k', window: 128_000 },
        { label: '200k', window: 200_000 },
        { label: '1M', window: 1_000_000 },
      ];

      const fitParts: string[] = [];
      for (const model of fitModels) {
        const pct = Math.round((context.estimatedTokens / model.window) * 100);
        const fits = context.estimatedTokens <= model.window;
        if (fits) {
          fitParts.push(chalk.green(`${model.label}: fits (${pct}%)`));
        } else {
          fitParts.push(chalk.red(`${model.label}: OVER (${pct}%)`));
        }
      }
      console.log(`    ${fitParts.join(' | ')}`);

      // --- AI Tools ---
      console.log('');
      console.log(chalk.bold('  AI Tools'));

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

      if (assets.length === 0) {
        console.log(chalk.dim('    No AI tool configurations detected'));
      } else {
        // Group by type
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
          console.log(`    ${chalk.cyan(tool)}: ${files.join(', ')}`);
        }
      }

      // --- Quality ---
      console.log('');
      console.log(chalk.bold('  Quality'));

      const lintErrorCount = lintWarnings.filter(w => w.severity === 'error').length;
      const lintWarnCount = lintWarnings.filter(w => w.severity === 'warning').length;
      const totalLint = lintErrorCount + lintWarnCount;
      const lintColor = lintErrorCount > 0 ? chalk.red : lintWarnCount > 0 ? chalk.yellow : chalk.green;
      console.log(`    Lint: ${lintColor(`${totalLint} issue${totalLint !== 1 ? 's' : ''}`)}`
        + (lintErrorCount > 0 ? chalk.red(` (${lintErrorCount} error${lintErrorCount !== 1 ? 's' : ''})`) : ''));

      const secCritical = securityFindings.filter(f => f.severity === 'critical').length;
      const secHigh = securityFindings.filter(f => f.severity === 'high').length;
      const totalSec = securityFindings.length;
      const secColor = secCritical > 0 ? chalk.red : secHigh > 0 ? chalk.yellow : chalk.green;
      console.log(`    Security: ${secColor(`${totalSec} issue${totalSec !== 1 ? 's' : ''}`)}`
        + (secCritical > 0 ? chalk.red(` (${secCritical} critical)`) : ''));

      // --- Workflow ---
      console.log('');
      console.log(chalk.bold('  Workflow'));

      const wfScoreColor = workflow.score >= 4 ? chalk.green : workflow.score >= 2 ? chalk.yellow : chalk.red;
      const detectedStr = workflow.detected.length > 0
        ? workflow.detected.join(', ')
        : 'none detected';
      const missingStr = workflow.missing.length > 0
        ? `Missing: ${workflow.missing.join(', ')}`
        : '';

      console.log(`    Score: ${wfScoreColor(`${workflow.score}/${workflow.maxScore}`)} \u2014 ${detectedStr}`);
      if (missingStr) {
        console.log(`    ${chalk.dim(missingStr)}`);
      }

      // --- Recommendations ---
      if (recommendations.length > 0) {
        console.log('');
        console.log(chalk.bold('  Recommendations'));

        for (const rec of recommendations) {
          const priorityColor = rec.priority === 'HIGH' ? chalk.red
            : rec.priority === 'MED' ? chalk.yellow
            : chalk.dim;
          const tag = priorityColor(rec.priority.padEnd(4));
          console.log(`    ${tag}  ${rec.message}`);
          if (options.fix && rec.fix) {
            console.log(chalk.dim(`          \u2192 ${rec.fix}`));
          }
        }
      }

      // --- Overall Health ---
      console.log('');
      const healthColor = healthScore >= 8 ? chalk.green
        : healthScore >= 5 ? chalk.yellow
        : chalk.red;
      console.log(`  ${chalk.bold('Overall Health:')} ${healthColor(`${healthScore}/10`)}`);

      console.log(chalk.dim(`  ${line}`));
      console.log('');
    });
}
