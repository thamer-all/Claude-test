# codeprobe Production Readiness Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all broken/rough edges, wire up real Claude API integration, add Claude Code hook/MCP integration, add unit tests, and ship a production-ready CLI that Claude Code users can actually install and use.

**Architecture:** Fix-first approach. We fix all bugs and inconsistencies in the existing 19 commands, then add the integration layer (hooks, MCP server, CLAUDE.md generation), then add tests, then publish.

**Tech Stack:** TypeScript, Node.js, Commander.js, tiktoken, @anthropic-ai/sdk (optional peer dep), vitest (testing)

---

## Audit Findings (Current State)

### Bugs to Fix
1. **`init` command uses old model names** — `claude-sonnet-4-20250514` and `claude-haiku-4-20250414` in generated config/specs. Should be `claude-sonnet-4-6` and `claude-opus-4-6`.
2. **`init` config uses fractional budgets** (0.10) but main config uses percentage integers (10). Inconsistent — pack command normalizes, but confusing for users.
3. **REPL uses old model name** — `claude-sonnet-4-20250514` as default.
4. **Benchmark live mode throws** — not wired to anthropicClient.ts.
5. **`test --mode live` works for test runner** but benchmark's live mode is still a placeholder.
6. **No error exit codes for some commands** — `security`, `lint` should exit 1 on critical/error findings.
7. **`context` on nonexistent path** — may not give friendly error.
8. **No `--json` flag on `diff` command** — inconsistent with other commands.
9. **REPL mock output is simplistic** — doesn't use the smart mock from promptRunner.

### Missing for Production
10. **No unit tests** — zero test files.
11. **No `npx` smoke test** — `npx codeprobe` untested.
12. **No shebang permission** — `dist/cli.js` may not be executable.
13. **No CLAUDE.md for the project itself** — ironic for a context engineering tool.
14. **Live benchmark mode** — not connected to anthropicClient.
15. **No retry/backoff** in anthropicClient.
16. **No usage guide for Claude Code users** — how to add hooks, MCP, etc.

### Missing for Claude Code Integration
17. **No Claude Code hook integration** — users can't run `codeprobe` as a pre-commit or post-edit hook.
18. **No MCP server mode** — can't expose codeprobe as MCP tools to Claude Code.
19. **No `codeprobe generate-claude-md`** command — should generate a CLAUDE.md context file from repo analysis.
20. **No guidance on `.claude/settings.json` hook config**.
21. **README doesn't explain Claude Code integration**.

---

## Task 1: Fix Model Names and Config Consistency

**Files:**
- Modify: `src/commands/init.ts`
- Modify: `src/commands/repl.ts`

**Step 1: Fix init.ts model names**

In `src/commands/init.ts`, replace all occurrences of:
- `claude-sonnet-4-20250514` → `claude-sonnet-4-6`
- `claude-haiku-4-20250414` → `claude-opus-4-6`

Also change the config budgets from fractional (0.10) to percentage integers (10) to match the main `codeprobe.config.yaml`:
```yaml
contextBudgets:
  systemPrompt: 10
  coreFiles: 50
  docs: 20
  toolMeta: 10
```

**Step 2: Fix repl.ts default model**

In `src/commands/repl.ts`, change `claude-sonnet-4-20250514` to `claude-sonnet-4-6`.

**Step 3: Build and verify**

Run: `npm run build`
Run: `rm -rf /tmp/ct-test && mkdir /tmp/ct-test && cd /tmp/ct-test && node "/Users/thamer/Desktop/Claude test/dist/cli.js" init && cat codeprobe.config.yaml && cat prompts/summarize.prompt.yaml`
Expected: All model names are `claude-sonnet-4-6` or `claude-opus-4-6`. Budget values are integers (10, 50, 20, 10).

**Step 4: Commit**

```bash
git add src/commands/init.ts src/commands/repl.ts
git commit -m "fix: use correct model names and consistent budget format in init/repl"
```

---

## Task 2: Fix Exit Codes and Error Handling

**Files:**
- Modify: `src/commands/lint.ts`
- Modify: `src/commands/validate.ts`
- Modify: `src/commands/context.ts`
- Modify: `src/commands/diff.ts`

**Step 1: Add exit code 1 for lint errors**

In `src/commands/lint.ts`, after displaying warnings, add:
```typescript
const errorCount = warnings.filter(w => w.severity === 'error').length;
if (errorCount > 0) {
  process.exitCode = 1;
}
```

**Step 2: Add exit code 1 for validation failures**

In `src/commands/validate.ts`, set `process.exitCode = 1` when any file fails validation.

**Step 3: Add `--json` flag to diff command**

In `src/commands/diff.ts`, add `--json` option and output `DiffResult` as JSON when set.

**Step 4: Add error handling for nonexistent paths in context**

In `src/commands/context.ts`, wrap the analyzeContext call in try/catch and print a friendly error for ENOENT.

**Step 5: Build and test**

Run: `npm run build`
Run: `node dist/cli.js context /nonexistent/path` — should show friendly error, not stack trace
Run: `node dist/cli.js diff prompts/summarize.prompt.yaml examples/basic-test.prompt.yaml --json` — should output JSON

**Step 6: Commit**

```bash
git add src/commands/lint.ts src/commands/validate.ts src/commands/context.ts src/commands/diff.ts
git commit -m "fix: exit codes for lint/validate, --json for diff, friendly errors"
```

---

## Task 3: Wire Live Benchmark Mode

**Files:**
- Modify: `src/core/benchmarkRunner.ts`

**Step 1: Replace live mode placeholder with API call**

In `src/core/benchmarkRunner.ts`, replace the `throw new Error('Live benchmarking...')` block with:
```typescript
const { callAnthropic } = await import('./anthropicClient.js');
const fullPrompt = spec.prompt.replace('{{input}}', spec.tests?.[0]?.input ?? 'Hello');
const start = Date.now();

const response = await callAnthropic({
  model,
  system: spec.system,
  messages: [{ role: 'user', content: fullPrompt }],
});

const latency = Date.now() - start;
benchmarkRuns.push({
  runIndex: i,
  score: 1.0, // Live mode doesn't score — user evaluates
  tokens: response.inputTokens + response.outputTokens,
  latency,
  output: response.content,
});
```

**Step 2: Build and verify mock still works**

Run: `npm run build`
Run: `node dist/cli.js benchmark prompts/summarize.prompt.yaml` — should still work in mock mode

**Step 3: Commit**

```bash
git add src/core/benchmarkRunner.ts
git commit -m "feat: wire live benchmark mode to Anthropic API"
```

---

## Task 4: Add `generate-claudemd` Command

**Files:**
- Create: `src/commands/generateClaudeMd.ts`
- Modify: `src/cli.ts`

This is a key integration feature — generate a CLAUDE.md file from repo analysis.

**Step 1: Create the command**

`src/commands/generateClaudeMd.ts` should:
1. Run `contextAnalyzer` on the repo
2. Scan for existing Claude assets (agents, hooks, MCP)
3. Detect the tech stack (package.json, go.mod, requirements.txt, Cargo.toml, etc.)
4. Generate a CLAUDE.md with sections:
   - Project overview (from package.json name/description or directory name)
   - Tech stack detected
   - Key directories and their purposes
   - Context budget summary (total tokens, fit estimates)
   - Existing Claude assets found
   - Recommended context strategy
5. Write to `CLAUDE.md` or print to stdout with `--dry-run`

**Step 2: Register in cli.ts**

Add `import { registerGenerateClaudeMdCommand } from './commands/generateClaudeMd.js'` and register it.

**Step 3: Build and test**

Run: `npm run build`
Run: `node dist/cli.js generate-claudemd --dry-run` — should print a reasonable CLAUDE.md

**Step 4: Commit**

```bash
git add src/commands/generateClaudeMd.ts src/cli.ts
git commit -m "feat: add generate-claudemd command for Claude Code integration"
```

---

## Task 5: Add Claude Code Hooks Integration

**Files:**
- Create: `src/commands/installHook.ts`
- Modify: `src/cli.ts`
- Create: `docs/claude-code-integration.md`

**Step 1: Create install-hook command**

`codeprobe install-hook` should:
1. Read or create `.claude/settings.json`
2. Add a hook entry that runs `codeprobe test --json` as a pre-commit or custom event hook
3. Support `--event <event>` flag (default: `PreCommit`)
4. Support `--command <cmd>` flag (default: `codeprobe test --json`)
5. Print what was added and how to use it

Example `.claude/settings.json` hook format:
```json
{
  "hooks": {
    "PreCommit": [
      {
        "command": "codeprobe test --json",
        "description": "Run prompt regression tests before commit"
      }
    ]
  }
}
```

**Step 2: Create integration docs**

Create `docs/claude-code-integration.md` explaining:
- How to install codeprobe
- How to use it with Claude Code
- How to set up hooks
- How to use context analysis to improve your CLAUDE.md
- How to use pack to optimize what Claude sees
- Example workflows

**Step 3: Register in cli.ts**

**Step 4: Build and test**

Run: `npm run build`
Run: `node dist/cli.js install-hook --dry-run`

**Step 5: Commit**

```bash
git add src/commands/installHook.ts src/cli.ts docs/claude-code-integration.md
git commit -m "feat: add install-hook command and Claude Code integration docs"
```

---

## Task 6: Add Unit Tests with Vitest

**Files:**
- Create: `vitest.config.ts`
- Create: `src/core/__tests__/promptRunner.test.ts`
- Create: `src/core/__tests__/contextAnalyzer.test.ts`
- Create: `src/core/__tests__/contextPacker.test.ts`
- Create: `src/core/__tests__/promptLinter.test.ts`
- Create: `src/core/__tests__/securityScanner.test.ts`
- Create: `src/utils/__tests__/output.test.ts`
- Create: `src/utils/__tests__/hashing.test.ts`
- Modify: `package.json` (add vitest dep and test script)

**Step 1: Install vitest**

```bash
npm install --save-dev vitest
```

Add to package.json scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 2: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    globals: true,
  },
});
```

**Step 3: Write tests for core modules**

Priority test files:
1. `promptRunner.test.ts` — parsePromptSpec, evaluateAssertions, generateMockOutput, runSingleTest
2. `contextAnalyzer.test.ts` — analyzeContext on the project itself
3. `contextPacker.test.ts` — file categorization, budget allocation
4. `promptLinter.test.ts` — each lint rule
5. `securityScanner.test.ts` — each security rule
6. `output.test.ts` — formatBytes, formatTokens, formatBar, formatTable
7. `hashing.test.ts` — sha256, shortHash

**Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 5: Add test to CI**

In `.github/workflows/codeprobe.yml`, add:
```yaml
- name: Test
  run: npm test
```

**Step 6: Commit**

```bash
git add vitest.config.ts src/**/__tests__/ package.json package-lock.json .github/workflows/codeprobe.yml
git commit -m "test: add vitest unit tests for core modules"
```

---

## Task 7: Create CLAUDE.md for the Project

**Files:**
- Create: `CLAUDE.md`

**Step 1: Generate and write CLAUDE.md**

Use `codeprobe generate-claudemd` on the project itself (or write manually). Should include:
- What codeprobe is
- How to build: `npm install && npm run build`
- How to test: `npm test`
- How to run: `node dist/cli.js <command>`
- Architecture overview (commands/, core/, types/, utils/)
- Coding conventions (ESM, .js imports, no `any`, strict mode)
- Key design decisions (mock-first, optional live API, Anthropic-only)

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md for context engineering"
```

---

## Task 8: Update README with Claude Code Integration

**Files:**
- Modify: `README.md`

**Step 1: Add Claude Code integration section**

Add a new section after "CI Integration" explaining:

```markdown
## Claude Code Integration

### Context Engineering for Claude Code

codeprobe helps you optimize your project for Claude Code:

```bash
# Analyze how much of your repo fits in Claude's context
codeprobe context .

# Get a packing plan — what to include in CLAUDE.md
codeprobe pack . --target 200k

# Generate a CLAUDE.md from repo analysis
codeprobe generate-claudemd

# See which files consume the most tokens
codeprobe heatmap . --top 20
```

### Hooks

Run prompt tests automatically when working with Claude Code:

```bash
# Install a pre-commit hook for Claude Code
codeprobe install-hook

# Or configure manually in .claude/settings.json:
{
  "hooks": {
    "PreCommit": [{
      "command": "codeprobe test --json"
    }]
  }
}
```

### Live Mode

Test prompts against the real Claude API:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm install @anthropic-ai/sdk
codeprobe test --mode live
codeprobe benchmark prompts/my-prompt.yaml --mode live
```
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add Claude Code integration guide to README"
```

---

## Task 9: Publish Preparation

**Files:**
- Modify: `package.json`
- Verify: `dist/cli.js` has shebang and is executable

**Step 1: Verify shebang**

Check that `dist/cli.js` starts with `#!/usr/bin/env node`. If not, fix `src/cli.ts`.

**Step 2: Test npx**

```bash
npm pack  # Creates codeprobe-0.1.0.tgz
npx ./codeprobe-0.1.0.tgz --version  # Should print 0.1.0
npx ./codeprobe-0.1.0.tgz doctor     # Should run diagnostics
```

**Step 3: Verify package.json fields**

Ensure:
- `"files": ["dist", "README.md", "LICENSE"]` is set
- `"bin": { "codeprobe": "dist/cli.js" }` is set
- `"type": "module"` is set
- `"engines": { "node": ">=18.0.0" }` is set
- Repository URL is filled in

**Step 4: Add `prepublishOnly` script**

```json
"prepublishOnly": "npm run build && npm test"
```

**Step 5: Commit and tag**

```bash
git add package.json
git commit -m "chore: prepare for npm publish"
git tag v0.1.0
```

---

## Summary: How People Use codeprobe with Claude Code

### Install
```bash
npm install -g codeprobe
```

### Understand Your Repo's Context
```bash
codeprobe context .        # How many tokens is your repo?
codeprobe simulate .       # Does it fit in Claude's window?
codeprobe map .            # Where are the tokens?
codeprobe heatmap .        # Which files are heaviest?
codeprobe pack . --target 200k  # What should Claude see?
```

### Generate Better CLAUDE.md
```bash
codeprobe generate-claudemd  # Auto-generate from analysis
```

### Test Your Prompts
```bash
codeprobe init             # Create example prompt specs
codeprobe test             # Run tests (mock mode)
codeprobe test --mode live # Run against real Claude API
codeprobe lint             # Check prompt quality
codeprobe security         # Check for injection risks
```

### Integrate with Claude Code
```bash
codeprobe install-hook     # Add pre-commit hook
codeprobe agents .         # Find all Claude assets
codeprobe hooks .          # See hook configurations
codeprobe mcp .            # Find MCP configs
```

### CI/CD
```yaml
# .github/workflows/prompts.yml
- run: npm install -g codeprobe
- run: codeprobe validate --json
- run: codeprobe test --json
- run: codeprobe lint --json
- run: codeprobe security --json
```
