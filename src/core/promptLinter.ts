/**
 * Prompt spec linter.
 *
 * Validates prompt specification files against a set of configurable
 * rules covering clarity, safety, completeness, and consistency.
 */

import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import yaml from 'js-yaml';
import type { LintWarning } from '../types/diagnostics.js';
import type { PromptSpec, PromptTest, TestExpectation } from '../types/prompt.js';
import { walkDirectory } from '../utils/fs.js';

/**
 * Vague words that lack specificity when used without further qualification.
 */
const VAGUE_WORDS: ReadonlyArray<string> = [
  'good', 'nice', 'appropriate', 'proper', 'suitable',
  'adequate', 'reasonable', 'decent', 'fine', 'okay',
  'correct', 'right', 'best', 'great', 'optimal',
];

/**
 * Patterns that suggest potential prompt injection vulnerabilities.
 */
const INJECTION_PATTERNS: ReadonlyArray<RegExp> = [
  /ignore\s+(all\s+)?previous/i,
  /disregard\s+(all\s+)?previous/i,
  /disregard\s+(all\s+)?(above|prior)/i,
  /forget\s+(all\s+)?previous/i,
  /new\s+instructions?\s*:/i,
  /override\s+(system|instructions)/i,
  /you\s+are\s+now\s+/i,
  /act\s+as\s+if\s+/i,
  /pretend\s+(that\s+)?you/i,
  /ignore\s+everything\s+(above|before)/i,
];

/**
 * Contradictory instruction pairs: [patternA, patternB, description].
 */
const CONTRADICTIONS: ReadonlyArray<[RegExp, RegExp, string]> = [
  [/be\s+concise/i, /explain\s+in\s+detail/i, '"be concise" vs "explain in detail"'],
  [/be\s+brief/i, /be\s+thorough/i, '"be brief" vs "be thorough"'],
  [/keep\s+it\s+short/i, /provide\s+(a\s+)?comprehensive/i, '"keep it short" vs "provide comprehensive"'],
  [/one\s+sentence/i, /multiple\s+paragraphs/i, '"one sentence" vs "multiple paragraphs"'],
  [/do\s+not\s+explain/i, /explain\s+(your|the)\s+reasoning/i, '"do not explain" vs "explain reasoning"'],
  [/no\s+examples/i, /provide\s+examples/i, '"no examples" vs "provide examples"'],
];

/**
 * Rough token estimation: ~4 characters per token for English text.
 */
function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Parse a YAML file into a PromptSpec. Returns null on parse failure.
 */
async function parseSpec(
  specPath: string,
): Promise<PromptSpec | null> {
  let content: string;
  try {
    content = await readFile(specPath, 'utf-8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch {
    return null;
  }

  if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  return {
    name: typeof obj['name'] === 'string' ? obj['name'] : specPath,
    description: typeof obj['description'] === 'string' ? obj['description'] : undefined,
    model: typeof obj['model'] === 'string' ? obj['model'] : undefined,
    system: typeof obj['system'] === 'string' ? obj['system'] : undefined,
    prompt: typeof obj['prompt'] === 'string' ? obj['prompt'] : '',
    tests: Array.isArray(obj['tests']) ? parseRawTests(obj['tests']) : undefined,
  };
}

/**
 * Parse raw test entries from YAML.
 */
function parseRawTests(rawTests: unknown[]): PromptTest[] {
  return rawTests
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    .map((t) => {
      const test: PromptTest = {
        name: typeof t['name'] === 'string' ? t['name'] : 'unnamed',
        input: typeof t['input'] === 'string' ? t['input'] : undefined,
        inputFile: typeof t['inputFile'] === 'string' ? t['inputFile'] : undefined,
      };

      if (typeof t['expect'] === 'object' && t['expect'] !== null) {
        const e = t['expect'] as Record<string, unknown>;
        const expect: TestExpectation = {};

        if (Array.isArray(e['contains'])) {
          expect.contains = e['contains'].filter((v): v is string => typeof v === 'string');
        }
        if (Array.isArray(e['notContains'])) {
          expect.notContains = e['notContains'].filter((v): v is string => typeof v === 'string');
        }
        if (Array.isArray(e['regex'])) {
          expect.regex = e['regex'].filter((v): v is string => typeof v === 'string');
        }
        if (typeof e['equals'] === 'string') {
          expect.equals = e['equals'];
        }
        if (typeof e['jsonSchema'] === 'object' && e['jsonSchema'] !== null) {
          expect.jsonSchema = e['jsonSchema'] as Record<string, unknown>;
        }

        test.expect = expect;
      }

      return test;
    });
}

/**
 * Check a single spec against all lint rules.
 */
function applyRules(spec: PromptSpec, filePath: string): LintWarning[] {
  const warnings: LintWarning[] = [];

  // Combine all text for full-spec checks
  const fullText = [spec.system ?? '', spec.prompt].join('\n');

  // Rule 1: no-vague-instructions
  for (const word of VAGUE_WORDS) {
    const pattern = new RegExp(`\\b${word}\\b`, 'gi');
    const match = pattern.exec(fullText);
    if (match) {
      // Check it's not followed by a more specific qualifier
      const afterMatch = fullText.slice(match.index + match[0].length, match.index + match[0].length + 30);
      const hasQualifier = /^\s+(for|when|if|because|that|which|at|in|with)\b/.test(afterMatch);
      if (!hasQualifier) {
        warnings.push({
          file: filePath,
          rule: 'no-vague-instructions',
          severity: 'warning',
          message: `Vague word "${word}" found without specific qualification. Consider being more precise.`,
        });
      }
    }
  }

  // Rule 2: require-format
  const formatIndicators = [
    /\bformat\b/i, /\bjson\b/i, /\bxml\b/i, /\byaml\b/i,
    /\bmarkdown\b/i, /\bcsv\b/i, /\btable\b/i,
    /\bbullet/i, /\bnumbered\s+list/i, /\blist\b/i,
    /\boutput\s+as\b/i, /\brespond\s+(with|in|as)\b/i,
  ];
  const hasFormat = formatIndicators.some((p) => p.test(fullText));
  if (!hasFormat) {
    warnings.push({
      file: filePath,
      rule: 'require-format',
      severity: 'warning',
      message: 'No output format specified in prompt or system message. Consider specifying the expected response format.',
    });
  }

  // Rule 3: weak-system-prompt
  if (!spec.system) {
    warnings.push({
      file: filePath,
      rule: 'weak-system-prompt',
      severity: 'warning',
      message: 'No system prompt defined. A system prompt helps set context and constraints.',
    });
  } else if (spec.system.length < 20) {
    warnings.push({
      file: filePath,
      rule: 'weak-system-prompt',
      severity: 'warning',
      message: `System prompt is very short (${spec.system.length} chars). Consider adding more context and constraints.`,
    });
  }

  // Rule 4: prompt-injection-risk
  for (const pattern of INJECTION_PATTERNS) {
    const match = pattern.exec(fullText);
    if (match) {
      warnings.push({
        file: filePath,
        rule: 'prompt-injection-risk',
        severity: 'error',
        message: `Potential prompt injection pattern detected: "${match[0]}". This could be exploited to override instructions.`,
      });
    }
  }

  // Rule 5: oversized-prompt
  const totalTokens = estimateTokenCount(fullText);
  if (totalTokens > 4000) {
    warnings.push({
      file: filePath,
      rule: 'oversized-prompt',
      severity: 'warning',
      message: `Prompt is estimated at ~${totalTokens} tokens, exceeding the 4000-token guideline. Consider trimming or splitting.`,
    });
  }

  // Rule 6: missing-description
  if (!spec.description) {
    warnings.push({
      file: filePath,
      rule: 'missing-description',
      severity: 'info',
      message: 'No description field. Adding a description improves discoverability and documentation.',
    });
  }

  // Rule 7: missing-tests
  if (!spec.tests || spec.tests.length === 0) {
    warnings.push({
      file: filePath,
      rule: 'missing-tests',
      severity: 'warning',
      message: 'No tests defined. Add tests to verify prompt behavior and prevent regressions.',
    });
  }

  // Rule 8: missing-model
  if (!spec.model) {
    warnings.push({
      file: filePath,
      rule: 'missing-model',
      severity: 'info',
      message: 'No model specified. The default model will be used, which may produce unexpected results if changed.',
    });
  }

  // Rule 9: missing-assertions
  if (spec.tests && spec.tests.length > 0) {
    for (const test of spec.tests) {
      if (!test.expect) {
        warnings.push({
          file: filePath,
          rule: 'missing-assertions',
          severity: 'warning',
          message: `Test "${test.name}" has no expect field. Tests without assertions cannot verify output correctness.`,
        });
      }
    }
  }

  // Rule 10: contradictory-instructions
  for (const [patternA, patternB, description] of CONTRADICTIONS) {
    if (patternA.test(fullText) && patternB.test(fullText)) {
      warnings.push({
        file: filePath,
        rule: 'contradictory-instructions',
        severity: 'warning',
        message: `Potentially contradictory instructions detected: ${description}. This may confuse the model.`,
      });
    }
  }

  return warnings;
}

/**
 * Lint a single prompt spec file and return all warnings.
 *
 * @param specPath  Absolute path to a YAML prompt spec file.
 * @returns         Array of lint warnings.
 */
export async function lintPrompt(specPath: string): Promise<LintWarning[]> {
  const spec = await parseSpec(specPath);

  if (!spec) {
    return [
      {
        file: specPath,
        rule: 'parse-error',
        severity: 'error',
        message: 'Failed to parse prompt spec file. Ensure it is valid YAML with a "prompt" field.',
      },
    ];
  }

  return applyRules(spec, specPath);
}

/**
 * Lint all prompt spec files in a directory recursively.
 *
 * Looks for files with `.yaml` or `.yml` extensions.
 *
 * @param dirPath  Absolute path to the directory to scan.
 * @returns        Array of lint warnings from all discovered spec files.
 */
export async function lintDirectory(dirPath: string): Promise<LintWarning[]> {
  const warnings: LintWarning[] = [];
  const promptExtensions = new Set(['.yaml', '.yml']);

  // Verify directory exists
  try {
    const dirStat = await stat(dirPath);
    if (!dirStat.isDirectory()) {
      return [
        {
          file: dirPath,
          rule: 'invalid-path',
          severity: 'error',
          message: `"${dirPath}" is not a directory.`,
        },
      ];
    }
  } catch {
    return [
      {
        file: dirPath,
        rule: 'invalid-path',
        severity: 'error',
        message: `Directory "${dirPath}" does not exist or is not accessible.`,
      },
    ];
  }

  const entries = await walkDirectory(dirPath);

  for (const entry of entries) {
    if (!entry.isFile) continue;
    const ext = extname(entry.path).toLowerCase();
    if (!promptExtensions.has(ext)) continue;

    const fileWarnings = await lintPrompt(entry.path);
    warnings.push(...fileWarnings);
  }

  return warnings;
}
