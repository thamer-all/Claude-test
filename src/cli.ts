#!/usr/bin/env node
/**
 * codeprobe — DevTools for AI Coding
 * Context engineering toolkit for Claude, Cursor, Copilot, and more.
 */

import { Command } from 'commander';
import { registerInitCommand } from './commands/init.js';
import { registerTestCommand } from './commands/test.js';
import { registerDiffCommand } from './commands/diff.js';
import { registerContextCommand } from './commands/context.js';
import { registerSimulateCommand } from './commands/simulate.js';
import { registerPackCommand } from './commands/pack.js';
import { registerBenchmarkCommand } from './commands/benchmark.js';
import { registerAgentsCommand } from './commands/agents.js';
import { registerHooksCommand } from './commands/hooks.js';
import { registerMcpCommand } from './commands/mcp.js';
import { registerLintCommand } from './commands/lint.js';
import { registerImproveCommand } from './commands/improve.js';
import { registerMapCommand } from './commands/map.js';
import { registerHeatmapCommand } from './commands/heatmap.js';
import { registerExplainCommand } from './commands/explain.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerSecurityCommand } from './commands/security.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerReplCommand } from './commands/repl.js';
import { registerGenerateClaudeMdCommand } from './commands/generateClaudeMd.js';
import { registerInstallHookCommand } from './commands/installHook.js';
import { registerWorkflowCommand } from './commands/workflow.js';
import { registerModelsCommand } from './commands/models.js';
import { registerUiCommand } from './commands/ui.js';
import { registerDashboardCommand } from './commands/dashboard.js';
import { registerCostCommand } from './commands/cost.js';
import { registerGenerateRulesCommand } from './commands/generateRules.js';
import { registerRegressionCommand } from './commands/regression.js';
import { registerHistoryCommand } from './commands/history.js';
import { handleError } from './utils/errors.js';

const program = new Command();

program
  .name('codeprobe')
  .version('0.1.0')
  .description('DevTools for AI Coding — context engineering toolkit for Claude, Cursor, Copilot, and more')
  .addHelpText('after', `
Examples:
  $ codeprobe init                    Create starter project
  $ codeprobe test                    Run all prompt tests
  $ codeprobe context .               Analyze repo context usage
  $ codeprobe pack . --target 200k    Build context pack plan
  $ codeprobe simulate . --model gpt-4o   Simulate against model context window
  $ codeprobe workflow run ci         Run a named workflow
  $ codeprobe doctor                  Check environment setup
`);

registerInitCommand(program);
registerTestCommand(program);
registerDiffCommand(program);
registerContextCommand(program);
registerSimulateCommand(program);
registerPackCommand(program);
registerBenchmarkCommand(program);
registerAgentsCommand(program);
registerHooksCommand(program);
registerMcpCommand(program);
registerLintCommand(program);
registerImproveCommand(program);
registerMapCommand(program);
registerHeatmapCommand(program);
registerExplainCommand(program);
registerValidateCommand(program);
registerSecurityCommand(program);
registerDoctorCommand(program);
registerReplCommand(program);
registerGenerateClaudeMdCommand(program);
registerInstallHookCommand(program);
registerWorkflowCommand(program);
registerModelsCommand(program);
registerUiCommand(program);
registerDashboardCommand(program);
registerCostCommand(program);
registerGenerateRulesCommand(program);
registerRegressionCommand(program);
registerHistoryCommand(program);

program.parseAsync(process.argv).catch(handleError);
