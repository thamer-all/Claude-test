# claude-test

DevTools for Claude — Context Engineering Toolkit for Claude Code.

A CLI that helps developers test prompts, analyze context usage, lint prompt specs, scan for security issues, benchmark models, and generate optimized context packs. All commands work offline with deterministic mock responses by default; set `ANTHROPIC_API_KEY` for live Anthropic API calls.

## Build & Run

```bash
npm install
npm run build        # tsc → dist/
npm test             # vitest run
node dist/cli.js <command>
```

Other useful scripts:

```bash
npm run dev          # tsc --watch (incremental rebuild)
npm run lint         # tsc --noEmit (type-check only)
npm run clean        # rm -rf dist
```

## Architecture

Monolithic CLI built with Commander.js. All source lives in `src/`:

```
src/
  cli.ts              Entrypoint — registers all 21 commands
  commands/           21 command handlers (one file per command)
  core/               18 engine modules (analyzers, runners, scanners)
  types/              7 TypeScript type definition files
  utils/              9 shared utilities (logger, fs, cache, output formatting)
  tokenizers/         Claude tokenizer wrapper (tiktoken cl100k_base)
```

### Commands (21)

`init` `test` `diff` `context` `simulate` `pack` `benchmark` `agents` `hooks` `mcp` `lint` `improve` `map` `heatmap` `explain` `validate` `security` `doctor` `repl` `generate-claudemd` `install-hook`

### Core engines (18)

`agentTracer` `anthropicClient` `benchmarkRunner` `contextAnalyzer` `contextPacker` `datasetRunner` `doctorRunner` `hookScanner` `mcpScanner` `promptDiff` `promptExplainer` `promptImprover` `promptLinter` `promptRunner` `regressionRunner` `repositorySimulator` `securityScanner` `skillValidator`

## Coding Conventions

- **ESM modules** — `"type": "module"` in package.json. Target ES2022, module Node16.
- **`.js` extension on all relative imports** — required by Node16 module resolution (e.g., `import { foo } from './utils/logger.js'`).
- **Strict TypeScript** — `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`. No `any` types.
- **ESM-only packages** — `chalk`, `ora`, and other ESM-only deps use dynamic `import()` inside command handlers, not top-level imports.
- **Command registration pattern** — every command file exports `registerXxxCommand(program: Command): void`. This function is imported and called in `cli.ts`.
- **`--json` flag** — every command that outputs data supports `--json` for machine-readable output.
- **Non-zero exit codes** — commands set `process.exitCode = 1` on failure (never `process.exit(1)`).
- **No runtime dependency on Anthropic SDK** — `@anthropic-ai/sdk` is dynamically imported in `anthropicClient.ts` only when live mode is requested.

## Key Design Decisions

- **Mock-first**: All commands work without an API key. Mock mode is the default. Deterministic mock output is hashed from prompt + system + input for stable, reproducible test results.
- **Anthropic-only**: No multi-provider abstractions. Claude models only (`claude-sonnet-4-6`, `claude-opus-4-6`).
- **Optional live API**: The Anthropic SDK is dynamically imported at runtime, not listed as a dependency. Users install it themselves if they want live calls.
- **Context engineering focus**: `context`, `simulate`, `pack`, `map`, and `heatmap` are the primary differentiators.
- **Configuration via YAML**: `claude-test.config.yaml` at project root. Prompt specs are also YAML files in `prompts/`.

## Testing

Tests use **vitest**. Test files live alongside source in `src/**/__tests__/*.test.ts`.

```bash
npm test              # run all tests once
npm run test:watch    # vitest in watch mode
```

Current test coverage:
- `promptRunner` — mock prompt execution and result formatting
- `contextAnalyzer` — repository scanning and token counting
- `promptLinter` — lint rule detection on prompt specs
- `securityScanner` — injection and PII pattern detection
- `output` (utils) — output formatting helpers
- `hashing` (utils) — deterministic hash generation

## Adding a New Command

1. Create `src/commands/myCommand.ts`
2. Export `registerMyCommandCommand(program: Command): void`
3. Import and call it in `src/cli.ts`
4. Rebuild: `npm run build`
5. Test: `node dist/cli.js my-command --help`

## Project Files

- `claude-test.config.yaml` — default CLI configuration (model, context target, ignore paths, budgets)
- `prompts/` — prompt spec YAML files (used by `test`, `lint`, `validate`, `explain`)
- `datasets/` — evaluation datasets in JSONL format (used by `benchmark`)
- `examples/` — example prompt specs for onboarding
- `fixtures/` — test fixtures
- `.cache/` — cached prompt results (gitignored)
