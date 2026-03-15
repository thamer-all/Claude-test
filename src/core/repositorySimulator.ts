/**
 * Repository simulator — estimates how a repository's context fits
 * into Claude's context windows, accounting for reserved budgets
 * and providing actionable recommendations.
 */

import { resolve } from 'node:path';

import type { SimulationResult, SimulationTarget } from '../types/context.js';
import type { CodeprobeConfig } from '../types/config.js';
import { analyzeContext } from './contextAnalyzer.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fraction of the context window reserved for system prompt, tools, etc. */
const RESERVED_BUDGET_FRACTION = 0.15;

const SIMULATION_TARGETS: Array<{ size: number; label: string }> = [
  { size: 200_000, label: '200k' },
  { size: 1_000_000, label: '1M' },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Simulate how a repository fits within Claude's context windows.
 *
 * Runs contextAnalyzer internally, then compares the total estimated tokens
 * against 200k and 1M targets with a 15% reserved budget for system prompt,
 * tool definitions, and other meta content. Generates human-readable
 * recommendations.
 */
export async function simulateContext(
  rootPath: string,
  config?: CodeprobeConfig,
): Promise<SimulationResult> {
  const absoluteRoot = resolve(rootPath);
  logger.debug(`Simulating context for: ${absoluteRoot}`);

  const analysis = await analyzeContext(absoluteRoot, config);
  const totalTokens = analysis.estimatedTokens;

  // Build simulation targets
  const targets: SimulationTarget[] = SIMULATION_TARGETS.map((target) => {
    const reservedBudget = Math.round(target.size * RESERVED_BUDGET_FRACTION);
    const availableTokens = target.size - reservedBudget;
    const fits = totalTokens <= availableTokens;
    const utilization =
      availableTokens > 0 ? totalTokens / availableTokens : 0;
    const headroom = availableTokens > 0 ? 1 - utilization : 0;

    return {
      windowSize: target.size,
      windowLabel: target.label,
      fits,
      utilization: Math.min(utilization, 1),
      headroom: Math.max(headroom, 0),
      reservedBudget,
    };
  });

  // Generate recommendations
  const recommendations = generateRecommendations(
    totalTokens,
    targets,
    analysis,
  );

  logger.debug(
    `Simulation complete: ${totalTokens} tokens, ${recommendations.length} recommendation(s)`,
  );

  return {
    rootPath: absoluteRoot,
    totalTokens,
    targets,
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// Recommendation generator
// ---------------------------------------------------------------------------

interface AnalysisSummary {
  totalFiles: number;
  textFiles: number;
  largestFiles: Array<{ path: string; estimatedTokens: number }>;
  extensionBreakdown: Array<{ extension: string; estimatedTokens: number }>;
}

function generateRecommendations(
  totalTokens: number,
  targets: SimulationTarget[],
  analysis: AnalysisSummary,
): string[] {
  const recommendations: string[] = [];

  for (const target of targets) {
    const available = target.windowSize - target.reservedBudget;

    if (target.fits) {
      const headroomPct = Math.round(target.headroom * 100);
      recommendations.push(
        `Repository fits in ${target.windowLabel} window with ${headroomPct}% headroom (${totalTokens.toLocaleString()} / ${available.toLocaleString()} available tokens).`,
      );
    } else {
      const overflow = totalTokens - available;
      recommendations.push(
        `Repository exceeds ${target.windowLabel} window by ${overflow.toLocaleString()} tokens. Reduction needed.`,
      );
    }
  }

  // If the repo doesn't fit in 200k but fits in 1M, suggest strategies
  const fits200k = targets.find((t) => t.windowLabel === '200k')?.fits ?? false;
  const fits1M = targets.find((t) => t.windowLabel === '1M')?.fits ?? false;

  if (!fits200k && fits1M) {
    recommendations.push(
      'Consider using the 1M context model, or trim lower-priority files to fit in 200k.',
    );
  }

  if (!fits200k) {
    // Suggest trimming test files
    const testExtensions = analysis.extensionBreakdown.filter(
      (e) =>
        e.extension === '.test.ts' ||
        e.extension === '.spec.ts' ||
        e.extension === '.test.js' ||
        e.extension === '.spec.js',
    );
    if (testExtensions.length > 0) {
      const testTokens = testExtensions.reduce(
        (sum, e) => sum + e.estimatedTokens,
        0,
      );
      if (testTokens > 0) {
        recommendations.push(
          `Consider excluding test files to save ~${testTokens.toLocaleString()} tokens.`,
        );
      }
    }

    // Suggest trimming large files
    if (analysis.largestFiles.length > 0) {
      const top3 = analysis.largestFiles.slice(0, 3);
      const top3Tokens = top3.reduce(
        (sum, f) => sum + f.estimatedTokens,
        0,
      );
      const fileNames = top3.map((f) => f.path).join(', ');
      recommendations.push(
        `The 3 largest files (${fileNames}) account for ~${top3Tokens.toLocaleString()} tokens. Consider summarizing or excluding them.`,
      );
    }
  }

  if (!fits200k && !fits1M) {
    recommendations.push(
      'Repository is too large for any standard context window. Use context packing (codeprobe pack) to select the most relevant files.',
    );
  }

  return recommendations;
}
