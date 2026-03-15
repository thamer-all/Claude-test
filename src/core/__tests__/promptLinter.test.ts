import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lintPrompt } from '../../core/promptLinter.js';

let tempDir: string;

beforeAll(() => {
  tempDir = join(tmpdir(), `codeprobe-lint-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeTempYaml(filename: string, content: string): string {
  const filePath = join(tempDir, filename);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('lintPrompt', () => {
  it('triggers weak-system-prompt warning when no system prompt', async () => {
    const filePath = writeTempYaml(
      'no-system.yaml',
      `name: test\nprompt: "Do something with a list format"\n`,
    );
    const warnings = await lintPrompt(filePath);
    const match = warnings.find((w) => w.rule === 'weak-system-prompt');
    expect(match).toBeDefined();
  });

  it('triggers missing-tests warning when no tests defined', async () => {
    const filePath = writeTempYaml(
      'no-tests.yaml',
      `name: test\nsystem: "You are a helpful assistant that responds in list format."\nprompt: "Do something"\n`,
    );
    const warnings = await lintPrompt(filePath);
    const match = warnings.find((w) => w.rule === 'missing-tests');
    expect(match).toBeDefined();
  });

  it('triggers missing-description info when no description', async () => {
    const filePath = writeTempYaml(
      'no-desc.yaml',
      `name: test\nsystem: "You are a helpful assistant that responds in list format."\nprompt: "Do something"\n`,
    );
    const warnings = await lintPrompt(filePath);
    const match = warnings.find((w) => w.rule === 'missing-description');
    expect(match).toBeDefined();
  });

  it('triggers missing-model info when no model specified', async () => {
    const filePath = writeTempYaml(
      'no-model.yaml',
      `name: test\nsystem: "You are a helpful assistant that responds in list format."\nprompt: "Do something"\n`,
    );
    const warnings = await lintPrompt(filePath);
    const match = warnings.find((w) => w.rule === 'missing-model');
    expect(match).toBeDefined();
  });

  it('produces no or minimal warnings for a well-formed spec', async () => {
    const filePath = writeTempYaml(
      'well-formed.yaml',
      [
        'name: well-formed-spec',
        'description: A well-formed prompt spec for testing',
        'model: claude-sonnet-4-6',
        'system: |',
        '  You are a precise summarizer. Always respond in bullet list format.',
        '  Keep each bullet under 20 words.',
        'prompt: |',
        '  Summarize the following text in exactly 3 bullet points:',
        '  {{input}}',
        'tests:',
        '  - name: basic-test',
        '    input: "Some test input"',
        '    expect:',
        '      contains:',
        '        - "bullet"',
      ].join('\n'),
    );
    const warnings = await lintPrompt(filePath);
    // A well-formed spec should not have critical rules triggered
    const criticalRules = [
      'weak-system-prompt',
      'missing-tests',
      'missing-description',
      'missing-model',
    ];
    const criticalWarnings = warnings.filter((w) =>
      criticalRules.includes(w.rule),
    );
    expect(criticalWarnings).toHaveLength(0);
  });
});
