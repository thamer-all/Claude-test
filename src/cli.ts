#!/usr/bin/env node
/**
 * codeprobe — DevTools for AI Coding
 * Context engineering toolkit for Claude, Cursor, Copilot, and more.
 *
 * Commands are organized into groups for discoverability:
 *   Top-level:  guard, verify, scan, impact, init, doctor, serve
 *   Groups:     test, context, prompt, detect, generate, ui
 */

import { Command } from 'commander';

// --- Top-level command imports ---
import { registerGuardCommand } from './commands/guard.js';
import { registerVerifyCommand } from './commands/verify.js';
import { registerScanCommand } from './commands/scan.js';
import { registerImpactCommand } from './commands/impact.js';
import { registerInitCommand } from './commands/init.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerServeCommand } from './commands/serve.js';

// --- test group ---
import { registerTestCommand } from './commands/test.js';
import { registerAbCommand } from './commands/ab.js';
import { registerScoreCommand } from './commands/score.js';
import { registerFlakyCommand } from './commands/flaky.js';
import { registerRegressionCommand } from './commands/regression.js';
import { registerHistoryCommand } from './commands/history.js';
import { registerAutotestCommand } from './commands/autotest.js';
import { registerBenchmarkCommand } from './commands/benchmark.js';
import { registerCheckCommand } from './commands/check.js';

// --- context group ---
import { registerContextCommand } from './commands/context.js';
import { registerPackCommand } from './commands/pack.js';
import { registerMapCommand } from './commands/map.js';
import { registerHeatmapCommand } from './commands/heatmap.js';
import { registerSimulateCommand } from './commands/simulate.js';
import { registerCostCommand } from './commands/cost.js';
import { registerQualityCommand } from './commands/quality.js';
import { registerExportCommand } from './commands/export.js';
import { registerSummaryCommand } from './commands/summary.js';

// --- prompt group ---
import { registerLintCommand } from './commands/lint.js';
import { registerImproveCommand } from './commands/improve.js';
import { registerExplainCommand } from './commands/explain.js';
import { registerDiffCommand } from './commands/diff.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerReplCommand } from './commands/repl.js';

// --- detect group ---
import { registerAgentsCommand } from './commands/agents.js';
import { registerHooksCommand } from './commands/hooks.js';
import { registerMcpCommand } from './commands/mcp.js';
import { registerModelsCommand } from './commands/models.js';
import { registerSecurityCommand } from './commands/security.js';
import { registerWorkflowCommand } from './commands/workflow.js';
import { registerContractsCommand } from './commands/contracts.js';

// --- generate group ---
import { registerGenerateClaudeMdCommand } from './commands/generateClaudeMd.js';
import { registerGenerateRulesCommand } from './commands/generateRules.js';
import { registerInstallHookCommand } from './commands/installHook.js';

// --- ui group ---
import { registerUiCommand } from './commands/ui.js';
import { registerDashboardCommand } from './commands/dashboard.js';
import { registerRecommendCommand } from './commands/recommend.js';

import { handleError } from './utils/errors.js';

// ---------------------------------------------------------------------------
// Helper: register a command on a temp program, then re-parent it under a
// group command with an optional new name. This avoids modifying any
// existing command files.
// ---------------------------------------------------------------------------

type RegisterFn = (program: Command) => void;

function addToGroup(
  group: Command,
  registerFn: RegisterFn,
  newName?: string,
): void {
  const temp = new Command();
  registerFn(temp);
  const cmd = temp.commands[0];
  if (cmd) {
    if (newName) {
      // Commander stores the name; we override it
      cmd.name(newName);
    }
    group.addCommand(cmd);
  }
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name('codeprobe')
  .version('0.3.0')
  .description('DevTools for AI Coding — context engineering toolkit for Claude, Cursor, Copilot, and more')
  .addHelpText('after', `
Daily workflow:
  $ codeprobe guard                    Snapshot health before AI coding
  $ codeprobe verify                   Check nothing broke after AI changes
  $ codeprobe scan                     Full project analysis
  $ codeprobe impact src/index.ts      Show blast radius of a file

Quick start:
  $ codeprobe init
  $ codeprobe guard && ai-code && codeprobe verify

Command groups:
  test       Run, benchmark, and validate prompt tests
  context    Analyze, pack, and optimize context windows
  prompt     Lint, improve, explain, and diff prompts
  detect     Scan for AI tools, security issues, contracts
  generate   Generate AI config files (CLAUDE.md, .cursorrules)
  ui         Launch dashboards and interactive tools
`);

// ── Top-level commands (daily use) ──────────────────────────────────

registerGuardCommand(program);
registerVerifyCommand(program);
registerScanCommand(program);
registerImpactCommand(program);
registerInitCommand(program);
registerDoctorCommand(program);
registerServeCommand(program);

// ── test group ──────────────────────────────────────────────────────

const testGroup = program
  .command('test')
  .description('Run, benchmark, and validate prompt tests');

addToGroup(testGroup, registerTestCommand, 'run');
addToGroup(testGroup, registerAbCommand);
addToGroup(testGroup, registerScoreCommand);
addToGroup(testGroup, registerFlakyCommand);
addToGroup(testGroup, registerRegressionCommand);
addToGroup(testGroup, registerHistoryCommand);
addToGroup(testGroup, registerAutotestCommand);
addToGroup(testGroup, registerBenchmarkCommand);
addToGroup(testGroup, registerCheckCommand);

// ── context group ───────────────────────────────────────────────────

const contextGroup = program
  .command('context')
  .description('Analyze, pack, and optimize context windows');

addToGroup(contextGroup, registerContextCommand, 'analyze');
addToGroup(contextGroup, registerPackCommand);
addToGroup(contextGroup, registerMapCommand);
addToGroup(contextGroup, registerHeatmapCommand);
addToGroup(contextGroup, registerSimulateCommand);
addToGroup(contextGroup, registerCostCommand);
addToGroup(contextGroup, registerQualityCommand);
addToGroup(contextGroup, registerExportCommand);
addToGroup(contextGroup, registerSummaryCommand);

// ── prompt group ────────────────────────────────────────────────────

const promptGroup = program
  .command('prompt')
  .description('Lint, improve, explain, and diff prompts');

addToGroup(promptGroup, registerLintCommand);
addToGroup(promptGroup, registerImproveCommand);
addToGroup(promptGroup, registerExplainCommand);
addToGroup(promptGroup, registerDiffCommand);
addToGroup(promptGroup, registerValidateCommand);
addToGroup(promptGroup, registerReplCommand);

// ── detect group ────────────────────────────────────────────────────

const detectGroup = program
  .command('detect')
  .description('Scan for AI tools, security issues, and contracts');

addToGroup(detectGroup, registerAgentsCommand);
addToGroup(detectGroup, registerHooksCommand);
addToGroup(detectGroup, registerMcpCommand);
addToGroup(detectGroup, registerModelsCommand);
addToGroup(detectGroup, registerSecurityCommand);
addToGroup(detectGroup, registerWorkflowCommand);
addToGroup(detectGroup, registerContractsCommand);

// ── generate group ──────────────────────────────────────────────────

const generateGroup = program
  .command('generate')
  .description('Generate AI config files — CLAUDE.md, .cursorrules, hooks');

addToGroup(generateGroup, registerGenerateClaudeMdCommand, 'claudemd');
addToGroup(generateGroup, registerGenerateRulesCommand, 'rules');
addToGroup(generateGroup, registerInstallHookCommand, 'hook');

// ── ui group ────────────────────────────────────────────────────────

const uiGroup = program
  .command('ui')
  .description('Launch dashboards and interactive tools');

addToGroup(uiGroup, registerDashboardCommand);
addToGroup(uiGroup, registerUiCommand, 'web');
addToGroup(uiGroup, registerRecommendCommand);

// ── Smart default ───────────────────────────────────────────────────

if (process.argv.length === 2) {
  process.argv.push('scan', '.');
}

program.parseAsync(process.argv).catch(handleError);
