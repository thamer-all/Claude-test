/**
 * Prompt diff — compare two prompt spec YAML files field by field
 * and report what changed.
 */

import { resolve } from 'node:path';

import { parsePromptSpec } from './promptRunner.js';
import type { PromptSpec } from '../types/prompt.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffDetail {
  field: string;
  before: string;
  after: string;
}

export interface DiffResult {
  systemPromptChanged: boolean;
  promptChanged: boolean;
  modelChanged: boolean;
  testsChanged: boolean;
  otherChanges: string[];
  details: DiffDetail[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Serialize a value to a stable string for comparison.
 */
function serialize(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

/**
 * Compare two values and return a DiffDetail if they differ.
 */
function compareField(
  field: string,
  before: unknown,
  after: unknown,
): DiffDetail | null {
  const beforeStr = serialize(before);
  const afterStr = serialize(after);

  if (beforeStr === afterStr) {
    return null;
  }

  return {
    field,
    before: beforeStr,
    after: afterStr,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse two prompt spec YAML files and compare them field by field.
 *
 * Returns a structured DiffResult indicating which fields changed
 * and the before/after values.
 */
export async function diffPrompts(
  pathA: string,
  pathB: string,
): Promise<DiffResult> {
  const absoluteA = resolve(pathA);
  const absoluteB = resolve(pathB);

  const specA: PromptSpec = await parsePromptSpec(absoluteA);
  const specB: PromptSpec = await parsePromptSpec(absoluteB);

  const details: DiffDetail[] = [];
  const otherChanges: string[] = [];

  // Compare name
  const nameDiff = compareField('name', specA.name, specB.name);
  if (nameDiff) {
    details.push(nameDiff);
    otherChanges.push('name');
  }

  // Compare description
  const descDiff = compareField('description', specA.description, specB.description);
  if (descDiff) {
    details.push(descDiff);
    otherChanges.push('description');
  }

  // Compare model
  const modelDiff = compareField('model', specA.model, specB.model);
  const modelChanged = modelDiff !== null;
  if (modelDiff) {
    details.push(modelDiff);
  }

  // Compare system prompt
  const systemDiff = compareField('system', specA.system, specB.system);
  const systemPromptChanged = systemDiff !== null;
  if (systemDiff) {
    details.push(systemDiff);
  }

  // Compare prompt
  const promptDiff = compareField('prompt', specA.prompt, specB.prompt);
  const promptChanged = promptDiff !== null;
  if (promptDiff) {
    details.push(promptDiff);
  }

  // Compare tests
  const testsA = serialize(specA.tests);
  const testsB = serialize(specB.tests);
  const testsChanged = testsA !== testsB;

  if (testsChanged) {
    // Add a summary diff for the tests array
    details.push({
      field: 'tests',
      before: testsA || '(none)',
      after: testsB || '(none)',
    });

    // Add per-test diffs for more granularity
    const maxLen = Math.max(
      specA.tests?.length ?? 0,
      specB.tests?.length ?? 0,
    );

    for (let i = 0; i < maxLen; i++) {
      const testA = specA.tests?.[i];
      const testB = specB.tests?.[i];

      if (!testA && testB) {
        details.push({
          field: `tests[${i}]`,
          before: '(not present)',
          after: serialize(testB),
        });
      } else if (testA && !testB) {
        details.push({
          field: `tests[${i}]`,
          before: serialize(testA),
          after: '(removed)',
        });
      } else if (testA && testB) {
        const testDiff = compareField(
          `tests[${i}]`,
          testA,
          testB,
        );
        if (testDiff) {
          details.push(testDiff);
        }
      }
    }
  }

  return {
    systemPromptChanged,
    promptChanged,
    modelChanged,
    testsChanged,
    otherChanges,
    details,
  };
}
