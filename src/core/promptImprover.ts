/**
 * Prompt improvement suggestion engine.
 *
 * Analyzes a prompt spec and generates actionable improvement
 * suggestions covering format, schema, testing, and prompt quality.
 */

import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import type { ImprovementSuggestion } from '../types/diagnostics.js';
import type { PromptSpec, PromptTest, TestExpectation } from '../types/prompt.js';

/**
 * Rough token estimation: ~4 characters per token.
 */
function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Parse a YAML file into a PromptSpec. Returns null on failure.
 */
async function parseSpec(specPath: string): Promise<PromptSpec | null> {
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
 * Check whether any test uses a jsonSchema assertion.
 */
function hasJsonSchemaAssertion(tests: PromptTest[]): boolean {
  return tests.some((t) => t.expect?.jsonSchema !== undefined);
}

/**
 * Check whether any test uses file-based input.
 */
function hasFileBasedInput(tests: PromptTest[]): boolean {
  return tests.some((t) => t.inputFile !== undefined);
}

/**
 * Count the distinct assertion types used across all tests.
 */
function countAssertionTypes(tests: PromptTest[]): number {
  const types = new Set<string>();
  for (const test of tests) {
    if (!test.expect) continue;
    if (test.expect.contains) types.add('contains');
    if (test.expect.notContains) types.add('notContains');
    if (test.expect.regex) types.add('regex');
    if (test.expect.equals !== undefined) types.add('equals');
    if (test.expect.jsonSchema) types.add('jsonSchema');
  }
  return types.size;
}

/**
 * Analyze a prompt spec and generate improvement suggestions.
 *
 * This is a purely offline analysis -- no LLM calls are made.
 * Suggestions are prioritized by their expected impact on prompt
 * quality and test reliability.
 *
 * @param specPath  Absolute path to a YAML prompt spec file.
 * @returns         Ordered array of improvement suggestions.
 */
export async function improvePrompt(
  specPath: string,
): Promise<ImprovementSuggestion[]> {
  const spec = await parseSpec(specPath);

  if (!spec) {
    return [
      {
        category: 'parse-error',
        priority: 'high',
        message: 'Cannot parse the prompt spec file.',
        details:
          'Ensure the file is valid YAML and contains at least a "prompt" field.',
      },
    ];
  }

  const suggestions: ImprovementSuggestion[] = [];

  // 1. Missing output format specification
  const fullText = [spec.system ?? '', spec.prompt].join('\n');
  const formatIndicators = [
    /\bformat\b/i, /\bjson\b/i, /\bxml\b/i, /\byaml\b/i,
    /\bmarkdown\b/i, /\bcsv\b/i, /\btable\b/i,
    /\bbullet/i, /\bnumbered\s+list/i,
    /\boutput\s+as\b/i, /\brespond\s+(with|in|as)\b/i,
  ];
  const hasFormat = formatIndicators.some((p) => p.test(fullText));
  if (!hasFormat) {
    suggestions.push({
      category: 'output-format',
      priority: 'high',
      message: 'Add an explicit output format specification.',
      details:
        'Specify the expected output format (JSON, markdown, plain text, etc.) to get more consistent responses. ' +
        'Example: add "Respond in JSON with keys: answer, confidence" to your prompt.',
    });
  }

  // 2. Overly long prompts
  const tokenCount = estimateTokenCount(fullText);
  if (tokenCount > 4000) {
    suggestions.push({
      category: 'prompt-length',
      priority: 'medium',
      message: `Prompt is ~${tokenCount} tokens. Consider trimming for efficiency.`,
      details:
        'Long prompts increase latency and cost. Try extracting examples into separate test inputs, ' +
        'removing redundant instructions, or using a system prompt for static context.',
    });
  }

  // 3. Missing schema constraints
  const tests = spec.tests ?? [];
  if (tests.length > 0 && !hasJsonSchemaAssertion(tests)) {
    suggestions.push({
      category: 'schema-validation',
      priority: 'medium',
      message: 'Add jsonSchema assertions to validate structured output.',
      details:
        'If your prompt produces structured data, adding a jsonSchema assertion ensures ' +
        'the output conforms to the expected shape. This catches schema drift and missing fields.',
    });
  }

  // 4. Missing regression tests
  if (tests.length === 0) {
    suggestions.push({
      category: 'testing',
      priority: 'high',
      message: 'Add tests to verify prompt behavior.',
      details:
        'Tests prevent regressions when you modify the prompt. Start with 2-3 tests covering ' +
        'the primary use case, an edge case, and an adversarial input.',
    });
  }

  // 5. Missing system prompt
  if (!spec.system) {
    suggestions.push({
      category: 'system-prompt',
      priority: 'high',
      message: 'Add a system prompt to set context and constraints.',
      details:
        'A system prompt defines the assistant\'s role, tone, and boundaries. ' +
        'Example: "You are a code review assistant. Respond concisely with actionable feedback."',
    });
  }

  // 6. Generic system prompts
  if (spec.system) {
    const genericPatterns = [
      /^you are (a|an) (helpful|friendly) assistant\.?$/i,
      /^you are a chatbot\.?$/i,
      /^you are an ai\.?$/i,
      /^respond helpfully\.?$/i,
      /^be helpful\.?$/i,
    ];
    const isGeneric = genericPatterns.some((p) => p.test(spec.system!.trim()));
    if (isGeneric) {
      suggestions.push({
        category: 'system-prompt',
        priority: 'medium',
        message: 'System prompt is too generic. Make it more specific to your use case.',
        details:
          'Generic system prompts like "You are a helpful assistant" do not meaningfully constrain ' +
          'the model. Specify the domain, output expectations, and constraints. ' +
          'Example: "You are a TypeScript expert. Review code for bugs, type safety issues, ' +
          'and performance problems. Respond with a numbered list."',
      });
    }
  }

  // 7. Missing file-based test inputs
  if (tests.length > 0 && !hasFileBasedInput(tests)) {
    suggestions.push({
      category: 'test-fixtures',
      priority: 'low',
      message: 'Consider adding file-based test inputs for complex scenarios.',
      details:
        'For long or structured inputs, use inputFile to reference fixture files. ' +
        'This keeps the spec clean and makes it easy to test with realistic data.',
    });
  }

  // 8. Test coverage breadth
  if (tests.length > 0 && tests.length < 3) {
    suggestions.push({
      category: 'test-coverage',
      priority: 'medium',
      message: `Only ${tests.length} test(s) defined. Consider adding more diverse test cases.`,
      details:
        'Good test coverage includes: (1) a happy-path test, (2) an edge case with unusual input, ' +
        '(3) a negative test with invalid input, and (4) a boundary test. ' +
        'Aim for at least 3-5 tests per prompt spec.',
    });
  }

  // Bonus: low assertion diversity
  if (tests.length > 0) {
    const assertionTypeCount = countAssertionTypes(tests);
    if (assertionTypeCount <= 1 && tests.length >= 2) {
      suggestions.push({
        category: 'assertion-diversity',
        priority: 'low',
        message: 'Tests use only one type of assertion. Consider diversifying.',
        details:
          'Using a mix of contains, regex, notContains, and jsonSchema assertions ' +
          'provides broader coverage and catches more issues.',
      });
    }
  }

  // Sort by priority: high first, then medium, then low
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return suggestions;
}
