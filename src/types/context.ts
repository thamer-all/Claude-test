/**
 * Context analysis, simulation, and packing types.
 */

export interface ContextAnalysis {
  rootPath: string;
  totalFiles: number;
  textFiles: number;
  skippedFiles: number;
  totalBytes: number;
  estimatedTokens: number;
  extensionBreakdown: ExtensionStats[];
  largestFiles: FileTokenInfo[];
  fitEstimates: FitEstimate[];
}

export interface ExtensionStats {
  extension: string;
  fileCount: number;
  totalBytes: number;
  estimatedTokens: number;
}

export interface FileTokenInfo {
  path: string;
  bytes: number;
  estimatedTokens: number;
}

export interface FitEstimate {
  windowSize: number;
  windowLabel: string;
  fits: boolean;
  utilization: number;
  headroom: number;
}

export interface SimulationResult {
  rootPath: string;
  totalTokens: number;
  targets: SimulationTarget[];
  recommendations: string[];
}

export interface SimulationTarget {
  windowSize: number;
  windowLabel: string;
  fits: boolean;
  utilization: number;
  headroom: number;
  reservedBudget: number;
}

export interface PackPlan {
  target: number;
  targetLabel: string;
  systemPromptBudget: number;
  coreFilesBudget: number;
  docsBudget: number;
  toolMetaBudget: number;
  remainingFree: number;
  includeFirst: FileTokenInfo[];
  summarize: FileTokenInfo[];
  exclude: FileTokenInfo[];
  totalEstimatedTokens: number;
}

export interface ContextMap {
  rootPath: string;
  totalTokens: number;
  directories: DirectoryTokenInfo[];
}

export interface DirectoryTokenInfo {
  path: string;
  fileCount: number;
  estimatedTokens: number;
  percentage: number;
}

export interface HeatmapEntry {
  path: string;
  estimatedTokens: number;
  percentage: number;
  bar: string;
}
