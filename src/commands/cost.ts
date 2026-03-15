/**
 * `codeprobe cost [path]` — Estimate context cost across AI models.
 *
 * Analyzes the repository token count and shows how much it would cost
 * to send the full context to various popular models.
 */

import { Command } from 'commander';
import { resolvePath } from '../utils/paths.js';
import { stat } from 'node:fs/promises';
import { setLogLevel } from '../utils/logger.js';
import { analyzeContext } from '../core/contextAnalyzer.js';
import { getModel } from '../core/modelRegistry.js';
import { formatTokens, formatTable } from '../utils/output.js';
import type { ModelInfo } from '../core/modelRegistry.js';

/** Popular models to display by default (a curated subset). */
const POPULAR_MODEL_IDS = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'gpt-4.1',
  'gpt-4o',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'deepseek-v3',
];

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(0)}M`;
  return `${Math.round(tokens / 1000)}k`;
}

function formatDollars(amount: number): string {
  if (amount < 0.005) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

interface CostEstimate {
  model: ModelInfo;
  inputCost: number;
  outputCostPer1k: number;
}

function buildEstimates(models: ModelInfo[], estimatedTokens: number): CostEstimate[] {
  return models.map((model) => {
    const inputCost = (estimatedTokens / 1_000_000) * model.inputPricePer1M;
    const outputCostPer1k = (1000 / 1_000_000) * model.outputPricePer1M;
    return { model, inputCost, outputCostPer1k };
  });
}

export function registerCostCommand(program: Command): void {
  program
    .command('cost [path]')
    .description('Estimate context cost — how much it costs to send this repo to various AI models')
    .option('--model <model>', 'Show cost for a specific model only')
    .option('--json', 'Output cost estimates as JSON')
    .action(async (
      pathArg: string | undefined,
      options: { model?: string; json?: boolean },
    ) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const chalk = (await import('chalk')).default;
      const targetPath = resolvePath(pathArg ?? '.');

      try {
        await stat(targetPath);
      } catch {
        console.error(`Error: path not found: ${targetPath}`);
        process.exitCode = 1;
        return;
      }

      // Analyze the repository to get token count
      const analysis = await analyzeContext(targetPath);
      const estimatedTokens = analysis.estimatedTokens;

      // Determine which models to show
      let models: ModelInfo[];
      if (options.model) {
        const modelInfo = getModel(options.model);
        if (!modelInfo) {
          console.error(`Error: unknown model "${options.model}". Use a model id from the registry (e.g., claude-sonnet-4-6, gpt-4o, gemini-2.5-pro).`);
          process.exitCode = 1;
          return;
        }
        models = [modelInfo];
      } else {
        models = POPULAR_MODEL_IDS
          .map((id) => getModel(id))
          .filter((m): m is ModelInfo => m !== undefined);
      }

      const estimates = buildEstimates(models, estimatedTokens);

      // Find cheapest
      const cheapest = [...estimates].sort((a, b) => a.inputCost - b.inputCost)[0];
      // Find best value (cheapest among models with >= 500k context)
      const largeContextModels = estimates.filter((e) => e.model.contextWindow >= 500_000);
      const bestValue = largeContextModels.length > 0
        ? [...largeContextModels].sort((a, b) => a.inputCost - b.inputCost)[0]
        : undefined;

      if (options.json) {
        const jsonResult = {
          rootPath: targetPath,
          estimatedTokens,
          estimates: estimates.map((e) => ({
            modelId: e.model.id,
            modelName: e.model.name,
            provider: e.model.provider,
            contextWindow: e.model.contextWindow,
            inputCost: e.inputCost,
            outputCostPer1k: e.outputCostPer1k,
            fits: estimatedTokens <= e.model.contextWindow,
          })),
          cheapest: cheapest ? { modelId: cheapest.model.id, inputCost: cheapest.inputCost } : null,
          bestValue: bestValue ? { modelId: bestValue.model.id, inputCost: bestValue.inputCost, contextWindow: bestValue.model.contextWindow } : null,
        };
        console.log(JSON.stringify(jsonResult, null, 2));
        return;
      }

      // Pretty-print output
      console.log(chalk.bold('\nContext Cost Estimate'));
      console.log(chalk.dim(`  Repository: ${targetPath}`));
      console.log(`  Estimated tokens: ${formatTokens(estimatedTokens)}`);
      console.log('');

      const headers = ['Model', 'Context', 'Input Cost', 'Output Cost (1k tokens)'];
      const rows = estimates.map((e) => {
        const fits = estimatedTokens <= e.model.contextWindow;
        const contextStr = formatContextWindow(e.model.contextWindow);
        const contextDisplay = fits ? contextStr : chalk.red(contextStr + ' *');
        return [
          e.model.name,
          contextDisplay,
          formatDollars(e.inputCost),
          formatDollars(e.outputCostPer1k),
        ];
      });

      const table = formatTable(headers, rows);
      for (const line of table.split('\n')) {
        console.log(`  ${line}`);
      }

      // Show if any model can't fit the context
      const overflowModels = estimates.filter((e) => estimatedTokens > e.model.contextWindow);
      if (overflowModels.length > 0) {
        console.log(chalk.dim(`\n  * Context exceeds model's window`));
      }

      console.log('');
      if (cheapest) {
        console.log(`  Cheapest: ${chalk.green(cheapest.model.name)} (${formatDollars(cheapest.inputCost)} input)`);
      }
      if (bestValue && bestValue !== cheapest) {
        console.log(`  Best value: ${chalk.green(bestValue.model.name)} (${formatDollars(bestValue.inputCost)} input, ${formatContextWindow(bestValue.model.contextWindow)} context)`);
      }
      console.log('');
    });
}
