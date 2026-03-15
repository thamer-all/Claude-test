/**
 * Prompt explainer: offline analysis of a prompt spec.
 *
 * Generates a plain-text explanation of what a prompt does,
 * identifies potential weaknesses, and suggests improvements --
 * all without making any LLM calls.
 */

import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
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
 * Describe the prompt's purpose based on its content.
 */
function describePrompt(spec: PromptSpec): string[] {
  const lines: string[] = [];

  lines.push(`Prompt: "${spec.name}"`);

  if (spec.description) {
    lines.push(`Description: ${spec.description}`);
  }

  if (spec.model) {
    lines.push(`Target model: ${spec.model}`);
  } else {
    lines.push('Target model: not specified (will use default)');
  }

  const promptTokens = estimateTokenCount(spec.prompt);
  const systemTokens = estimateTokenCount(spec.system ?? '');
  const totalTokens = promptTokens + systemTokens;

  lines.push(`Estimated size: ~${totalTokens} tokens (prompt: ~${promptTokens}, system: ~${systemTokens})`);

  if (spec.system) {
    lines.push('');
    lines.push('System prompt sets context for the assistant with the following instructions:');
    // Extract a brief summary from the first sentence or first 120 chars
    const firstSentence = spec.system.split(/[.!?\n]/).filter(Boolean)[0]?.trim();
    if (firstSentence) {
      const summary = firstSentence.length > 120
        ? firstSentence.slice(0, 117) + '...'
        : firstSentence;
      lines.push(`  "${summary}"`);
    }
  }

  lines.push('');
  lines.push('The user prompt instructs the model to:');
  // Extract key action phrases
  const actionPatterns = [
    { pattern: /\b(generate|create|write|produce|make)\b/i, verb: 'generate content' },
    { pattern: /\b(analyze|review|evaluate|assess|examine)\b/i, verb: 'analyze input' },
    { pattern: /\b(translate|convert|transform)\b/i, verb: 'translate or convert' },
    { pattern: /\b(summarize|condense|shorten)\b/i, verb: 'summarize content' },
    { pattern: /\b(classify|categorize|label|tag)\b/i, verb: 'classify or categorize' },
    { pattern: /\b(explain|describe|elaborate)\b/i, verb: 'explain or describe' },
    { pattern: /\b(extract|find|identify|detect)\b/i, verb: 'extract or identify information' },
    { pattern: /\b(fix|correct|repair|debug)\b/i, verb: 'fix or correct issues' },
    { pattern: /\b(compare|contrast|diff)\b/i, verb: 'compare items' },
    { pattern: /\b(list|enumerate|outline)\b/i, verb: 'list or enumerate items' },
  ];

  const detectedActions: string[] = [];
  for (const { pattern, verb } of actionPatterns) {
    if (pattern.test(spec.prompt)) {
      detectedActions.push(verb);
    }
  }

  if (detectedActions.length > 0) {
    for (const action of detectedActions) {
      lines.push(`  - ${action}`);
    }
  } else {
    lines.push('  - (no specific action verb detected -- the prompt may need clearer instructions)');
  }

  return lines;
}

/**
 * Identify potential weaknesses in the prompt spec.
 */
function identifyWeaknesses(spec: PromptSpec): string[] {
  const weaknesses: string[] = [];

  if (!spec.system) {
    weaknesses.push('No system prompt: the model has no role or constraint context.');
  } else if (spec.system.length < 20) {
    weaknesses.push('System prompt is very short and may not provide enough context.');
  }

  // Check for vague language
  const vagueWords = ['good', 'nice', 'appropriate', 'proper', 'suitable', 'adequate', 'reasonable'];
  const fullText = [spec.system ?? '', spec.prompt].join(' ').toLowerCase();
  const foundVague = vagueWords.filter((w) => fullText.includes(w));
  if (foundVague.length > 0) {
    weaknesses.push(
      `Uses vague language (${foundVague.join(', ')}) that may lead to inconsistent outputs.`,
    );
  }

  // Check for format specification
  const formatPatterns = [
    /\bformat\b/i, /\bjson\b/i, /\byaml\b/i, /\bmarkdown\b/i,
    /\boutput\s+as\b/i, /\brespond\s+(with|in)\b/i,
  ];
  const hasFormat = formatPatterns.some((p) => p.test(fullText));
  if (!hasFormat) {
    weaknesses.push('No output format specified. Responses may vary in structure.');
  }

  // Check for prompt injection vulnerability
  const injectionPatterns = [
    /ignore\s+(all\s+)?previous/i,
    /disregard/i,
    /new\s+instructions/i,
  ];
  const hasInjectionRisk = injectionPatterns.some((p) => p.test(fullText));
  if (hasInjectionRisk) {
    weaknesses.push('Contains patterns that could be exploited for prompt injection.');
  }

  // Check prompt size
  const totalTokens = estimateTokenCount(fullText);
  if (totalTokens > 4000) {
    weaknesses.push(
      `Large prompt (~${totalTokens} tokens) may increase latency and cost without proportional quality gains.`,
    );
  }

  // Check for contradictions
  const contradictions: Array<[RegExp, RegExp, string]> = [
    [/be\s+concise/i, /explain\s+in\s+detail/i, '"be concise" + "explain in detail"'],
    [/be\s+brief/i, /be\s+thorough/i, '"be brief" + "be thorough"'],
    [/do\s+not\s+explain/i, /explain\s+(your|the)\s+reasoning/i, '"do not explain" + "explain reasoning"'],
  ];
  for (const [a, b, desc] of contradictions) {
    if (a.test(fullText) && b.test(fullText)) {
      weaknesses.push(`Contradictory instructions: ${desc}.`);
    }
  }

  if (weaknesses.length === 0) {
    weaknesses.push('No major weaknesses detected.');
  }

  return weaknesses;
}

/**
 * Analyze tests and explain why they might fail.
 */
function analyzeTests(spec: PromptSpec): string[] {
  const lines: string[] = [];
  const tests = spec.tests ?? [];

  if (tests.length === 0) {
    lines.push('No tests defined. Cannot analyze potential test failures.');
    lines.push('Recommendation: add at least 2-3 tests covering primary and edge cases.');
    return lines;
  }

  lines.push(`${tests.length} test(s) defined:`);

  for (const test of tests) {
    lines.push('');
    lines.push(`  Test: "${test.name}"`);

    if (!test.expect) {
      lines.push('    Issue: No assertions. This test will always pass, providing no safety net.');
      continue;
    }

    const reasons: string[] = [];

    if (test.expect.contains && test.expect.contains.length > 0) {
      lines.push(`    Checks output contains: ${test.expect.contains.map((s) => `"${s}"`).join(', ')}`);
      reasons.push(
        'Could fail if the model paraphrases expected keywords or uses synonyms.',
      );
    }

    if (test.expect.notContains && test.expect.notContains.length > 0) {
      lines.push(`    Checks output does NOT contain: ${test.expect.notContains.map((s) => `"${s}"`).join(', ')}`);
      reasons.push(
        'Could fail if the model mentions excluded terms in context or explanations.',
      );
    }

    if (test.expect.regex && test.expect.regex.length > 0) {
      lines.push(`    Checks output matches regex patterns`);
      reasons.push(
        'Regex assertions can be brittle if the model varies whitespace or formatting.',
      );
    }

    if (test.expect.equals !== undefined) {
      const preview = test.expect.equals.length > 60
        ? test.expect.equals.slice(0, 57) + '...'
        : test.expect.equals;
      lines.push(`    Checks exact match: "${preview}"`);
      reasons.push(
        'Exact match is very strict. Any extra whitespace, punctuation, or phrasing difference causes failure.',
      );
    }

    if (test.expect.jsonSchema) {
      lines.push('    Validates output against a JSON schema');
      reasons.push(
        'Could fail if the model wraps JSON in markdown code blocks or adds extra text.',
      );
    }

    if (reasons.length > 0) {
      lines.push('    Potential failure reasons:');
      for (const reason of reasons) {
        lines.push(`      - ${reason}`);
      }
    }
  }

  return lines;
}

/**
 * Generate improvement suggestions.
 */
function generateSuggestions(spec: PromptSpec): string[] {
  const suggestions: string[] = [];

  if (!spec.system) {
    suggestions.push('Add a system prompt that defines the assistant\'s role and constraints.');
  }

  if (!spec.description) {
    suggestions.push('Add a description field for better documentation and discoverability.');
  }

  if (!spec.model) {
    suggestions.push('Specify a target model to ensure consistent behavior across environments.');
  }

  const tests = spec.tests ?? [];
  if (tests.length === 0) {
    suggestions.push('Add tests with assertions to catch regressions.');
  } else if (tests.length < 3) {
    suggestions.push('Add more test cases (aim for 3-5) covering happy path, edge cases, and error cases.');
  }

  const hasJsonSchema = tests.some((t) => t.expect?.jsonSchema);
  if (!hasJsonSchema && tests.length > 0) {
    suggestions.push('Consider adding jsonSchema assertions for structured output validation.');
  }

  const fullText = [spec.system ?? '', spec.prompt].join(' ');
  const tokenCount = estimateTokenCount(fullText);
  if (tokenCount > 3000) {
    suggestions.push('Consider splitting long instructions into a system prompt (static context) and user prompt (per-request).');
  }

  if (suggestions.length === 0) {
    suggestions.push('The prompt spec looks well-structured. Consider adding more edge case tests for robustness.');
  }

  return suggestions;
}

/**
 * Analyze a prompt spec file and generate a plain-text explanation.
 *
 * This is a purely offline analysis -- no LLM calls are made.
 *
 * @param specPath  Absolute path to a YAML prompt spec file.
 * @returns         Multi-line plain-text explanation.
 */
export async function explainPrompt(specPath: string): Promise<string> {
  const spec = await parseSpec(specPath);

  if (!spec) {
    return [
      `Failed to parse prompt spec at: ${specPath}`,
      '',
      'Ensure the file is valid YAML with at least a "prompt" field.',
      'Example:',
      '  name: my-prompt',
      '  prompt: "Summarize the following text: {{input}}"',
    ].join('\n');
  }

  const sections: string[][] = [];

  // Section 1: What does this prompt do?
  sections.push([
    '== What This Prompt Does ==',
    ...describePrompt(spec),
  ]);

  // Section 2: Potential weaknesses
  sections.push([
    '== Potential Weaknesses ==',
    ...identifyWeaknesses(spec),
  ]);

  // Section 3: Test analysis
  sections.push([
    '== Test Analysis ==',
    ...analyzeTests(spec),
  ]);

  // Section 4: Suggestions
  sections.push([
    '== Suggestions for Improvement ==',
    ...generateSuggestions(spec),
  ]);

  return sections.map((section) => section.join('\n')).join('\n\n');
}
