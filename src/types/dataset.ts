/**
 * Dataset types for batch prompt evaluation.
 */

import type { AssertionResult } from './prompt.js';

export interface DatasetRow {
  input: string;
  expected?: string;
  metadata?: Record<string, unknown>;
}

export interface DatasetResult {
  datasetPath: string;
  promptName: string;
  totalRows: number;
  passed: number;
  failed: number;
  results: DatasetRowResult[];
}

export interface DatasetRowResult {
  rowIndex: number;
  input: string;
  expected?: string;
  output: string;
  passed: boolean;
  assertions: AssertionResult[];
}
