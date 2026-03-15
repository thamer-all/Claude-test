/**
 * `codeprobe init` — Create starter folders, example prompt files,
 * dataset examples, and configuration.
 *
 * Auto-detects AI tools in use and provides context-aware next steps.
 */

import { Command } from 'commander';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { resolvePath } from '../utils/paths.js';
import { fileExists, isDirectory } from '../utils/fs.js';

const EXAMPLE_PROMPT_SPEC = `# Example prompt spec for codeprobe
name: summarize
description: Summarize an article into bullet points
model: claude-sonnet-4-6

system: |
  You are a concise summarizer. Given an article, produce 3-5 bullet points
  capturing the key ideas.

prompt: |
  Summarize the following article into 3-5 bullet points:

  {{input}}

tests:
  - name: produces bullet points
    input: >
      Artificial intelligence is transforming industries worldwide.
      Healthcare, finance, and transportation are seeing significant
      improvements through machine learning applications.
    expect:
      contains:
        - "artificial intelligence"
      regex:
        - "^[\\\\s]*[-*]"
  - name: handles short input
    input: "The sky is blue."
    expect:
      contains:
        - "sky"
`;

const EXAMPLE_DATASET = `{"input":"Machine learning models require large amounts of data for training.","expected":"Summary mentioning data requirements"}
{"input":"Climate change is affecting weather patterns globally, leading to more extreme events.","expected":"Summary mentioning climate and weather"}
{"input":"Remote work has become the new norm since the pandemic reshaped how companies operate.","expected":"Summary mentioning remote work trends"}
`;

const EXAMPLE_FIXTURE = `The Rise of Context Engineering

Context engineering is the emerging discipline of designing and optimizing
the information provided to large language models (LLMs) to achieve better
outputs. Unlike prompt engineering, which focuses narrowly on the instruction
text, context engineering considers the entire input window: system prompts,
few-shot examples, retrieved documents, tool definitions, and conversation
history.

Key principles of context engineering include:

1. Token budget management — understanding how to allocate the finite
   context window across different information types.

2. Information density — ensuring every token carries maximum signal
   and minimal noise.

3. Structured formatting — using consistent formats (YAML, XML, markdown)
   that models parse reliably.

4. Progressive disclosure — loading information on demand rather than
   stuffing everything upfront.

5. Validation loops — testing that context changes actually improve
   model behavior on representative tasks.

As context windows grow from 8K to 200K to 1M+ tokens, context engineering
becomes increasingly important. The challenge shifts from "what fits" to
"what matters" — curating the right information at the right level of
detail for each specific task.
`;

const EXAMPLE_CONFIG = `# codeprobe configuration
# See: https://github.com/anthropics/codeprobe

defaultModel: claude-sonnet-4-6
defaultContextTarget: 200k

# Paths to ignore during context analysis
ignorePaths:
  - node_modules
  - .git
  - dist
  - coverage
  - "*.min.js"
  - "*.map"

# Enable result caching
caching: true

# Context window budget allocation (percentages)
contextBudgets:
  systemPrompt: 10
  coreFiles: 50
  docs: 20
  toolMeta: 10

# Watch mode settings
watchDefaults:
  debounceMs: 300
  clearScreen: true

# Benchmark defaults
benchmarkDefaults:
  models:
    - claude-sonnet-4-6
    - claude-opus-4-6
  runs: 3
  warmup: true
`;

interface InitItem {
  type: 'dir' | 'file';
  path: string;
  content?: string;
  description: string;
}

interface DetectedTool {
  name: string;
  indicator: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Auto-detect AI tools in use by checking for known config files/directories.
 */
async function detectAITools(root: string): Promise<DetectedTool[]> {
  const detected: DetectedTool[] = [];

  const checks: Array<{ name: string; paths: string[] }> = [
    { name: 'Claude Code', paths: ['CLAUDE.md', '.claude/settings.json'] },
    { name: 'Cursor', paths: ['.cursorrules', '.cursor/rules'] },
    { name: 'Windsurf', paths: ['.windsurfrules', '.windsurf/rules'] },
    { name: 'GitHub Copilot', paths: ['.github/copilot-instructions.md', '.copilot'] },
    { name: 'Aider', paths: ['.aider.conf.yml', '.aiderignore'] },
    { name: 'Continue', paths: ['.continue/config.json', '.continuerules'] },
    { name: 'Cline', paths: ['.clinerules', '.cline'] },
    { name: 'Codex', paths: ['codex.md', 'CODEX.md', '.codex'] },
  ];

  for (const check of checks) {
    for (const p of check.paths) {
      if (await pathExists(join(root, p))) {
        detected.push({ name: check.name, indicator: p });
        break;
      }
    }
  }

  return detected;
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Create starter folders, example prompt files, dataset examples, and config')
    .option('--force', 'Overwrite existing files')
    .action(async (options: { force?: boolean }) => {
      const chalk = (await import('chalk')).default;
      const root = process.cwd();

      // Auto-detect AI tools
      const detectedTools = await detectAITools(root);

      const items: InitItem[] = [
        {
          type: 'dir',
          path: 'prompts',
          description: 'Prompt specs directory',
        },
        {
          type: 'file',
          path: join('prompts', 'summarize.prompt.yaml'),
          content: EXAMPLE_PROMPT_SPEC,
          description: 'Example prompt spec',
        },
        {
          type: 'dir',
          path: 'datasets',
          description: 'Datasets directory',
        },
        {
          type: 'file',
          path: join('datasets', 'sample.jsonl'),
          content: EXAMPLE_DATASET,
          description: 'Example dataset',
        },
        {
          type: 'dir',
          path: 'fixtures',
          description: 'Test fixtures directory',
        },
        {
          type: 'file',
          path: join('fixtures', 'article.txt'),
          content: EXAMPLE_FIXTURE,
          description: 'Sample fixture',
        },
        {
          type: 'dir',
          path: 'examples',
          description: 'Examples directory',
        },
        {
          type: 'file',
          path: 'codeprobe.config.yaml',
          content: EXAMPLE_CONFIG,
          description: 'Configuration file',
        },
      ];

      let created = 0;
      let skipped = 0;
      const createdFiles: string[] = [];

      for (const item of items) {
        const fullPath = resolvePath(join(root, item.path));

        if (item.type === 'dir') {
          if (await isDirectory(fullPath)) {
            if (!options.force) {
              console.log(chalk.dim(`  skip  ${item.path}/ (already exists)`));
              skipped++;
              continue;
            }
          }
          await mkdir(fullPath, { recursive: true });
          console.log(chalk.green(`  create  ${item.path}/`));
          created++;
        } else {
          if ((await fileExists(fullPath)) && !options.force) {
            console.log(chalk.dim(`  skip  ${item.path} (already exists)`));
            skipped++;
            continue;
          }
          // Ensure parent directory exists
          const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
          await mkdir(parentDir, { recursive: true });
          await writeFile(fullPath, item.content ?? '', 'utf-8');
          console.log(chalk.green(`  create  ${item.path}`));
          createdFiles.push(item.path);
          created++;
        }
      }

      console.log('');
      console.log(
        chalk.bold(`Initialized codeprobe project: ${created} created, ${skipped} skipped`),
      );

      // Show detected AI tools
      if (detectedTools.length > 0) {
        console.log('');
        console.log(chalk.bold('  Detected AI tools:'));
        for (const tool of detectedTools) {
          console.log(chalk.cyan(`    ${tool.name}`) + chalk.dim(` (${tool.indicator})`));
        }

        // Hint about Cursor rules generation if Cursor is detected but no .cursorrules
        const hasCursor = detectedTools.some(t => t.name === 'Cursor');
        const hasCursorRules = await pathExists(join(root, '.cursorrules'));
        if (hasCursor && !hasCursorRules) {
          console.log(chalk.dim('    Tip: generate Cursor rules with: codeprobe generate-rules --tool cursor'));
        }
      } else {
        console.log('');
        console.log(chalk.dim('  No AI tools detected. Generate configs with:'));
        console.log(chalk.dim('    codeprobe generate-claudemd      (Claude Code)'));
        console.log(chalk.dim('    codeprobe generate-rules         (Cursor, Windsurf, etc.)'));
      }

      // Context-aware "What's next?" section
      console.log('');
      console.log(chalk.bold('  What\'s next:'));
      console.log(chalk.white('    1. Run a full scan:           ') + chalk.cyan('codeprobe scan'));
      console.log(chalk.white('    2. See the dashboard:         ') + chalk.cyan('codeprobe'));
      console.log(chalk.white('    3. Generate AI tool config:   ') + chalk.cyan('codeprobe generate-claudemd'));
      console.log(chalk.white('    4. Test your prompts:         ') + chalk.cyan('codeprobe test'));
      console.log(chalk.white('    5. Auto-generate tests:       ') + chalk.cyan('codeprobe autotest prompts/summarize.prompt.yaml'));
      console.log('');
    });
}
