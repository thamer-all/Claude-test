/**
 * Test run summary and benchmark result types.
 */

export interface RunSummary {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  cached: number;
}

export interface BenchmarkResult {
  model: string;
  promptName: string;
  runs: BenchmarkRun[];
  averageScore: number;
  averageTokens: number;
  averageLatency: number;
  estimatedCost: number;
}

export interface BenchmarkRun {
  runIndex: number;
  score: number;
  tokens: number;
  latency: number;
  output: string;
}

export interface ScoredTestResult {
  testName: string;
  promptName: string;
  passed: boolean;
  score: number;           // 0-100
  grade: string;           // A-F
  criteria: Array<{ name: string; score: number; weight: number }>;
  output: string;
  duration: number;
}
