/**
 * Configuration types for claude-test.
 */

export interface ClaudeTestConfig {
  defaultModel?: string;
  defaultContextTarget?: '200k' | '1m';
  ignorePaths?: string[];
  caching?: boolean;
  watchDefaults?: WatchConfig;
  contextBudgets?: ContextBudgets;
  benchmarkDefaults?: BenchmarkConfig;
}

export interface WatchConfig {
  debounceMs?: number;
  clearScreen?: boolean;
}

export interface ContextBudgets {
  systemPrompt?: number;
  coreFiles?: number;
  docs?: number;
  toolMeta?: number;
}

export interface BenchmarkConfig {
  models?: string[];
  runs?: number;
  warmup?: boolean;
}
