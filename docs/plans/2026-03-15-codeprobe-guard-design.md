# Codeprobe Guard — Pre/Post AI Verification Layer

**Date:** 2026-03-15
**Status:** Approved

## Problem

AI coding tools (Claude Code, Cursor, Copilot) break things because they:
1. Don't understand project dependencies — change one file, break three others
2. Write code that looks right but fails at runtime — wrong imports, schema mismatches
3. Don't verify their own work — say "done" without running tests or type checks

## Solution

4 new commands that create a verification layer around AI coding sessions:

### Commands

1. **`codeprobe guard`** — Snapshot project health before AI session
   - Runs: tsc, test runner, linter (auto-detected)
   - Records: file hashes, exported contracts, import graph
   - Saves baseline to `.codeprobe/baseline.json`

2. **`codeprobe verify`** — Verify nothing broke after AI changes
   - Re-runs all checks, diffs against baseline
   - Reports: what broke, what's new, what's risky
   - Outputs health score (0-10)
   - Supports `--json` for CI integration

3. **`codeprobe impact <file>`** — Show blast radius before editing
   - Traces import graph to find all dependents
   - Lists exported symbols and their consumers
   - Assigns risk level (LOW/MEDIUM/HIGH/CRITICAL)

4. **`codeprobe contracts [path]`** — Extract & validate type/API contracts
   - Parses TypeScript exports (interfaces, types, function signatures)
   - Detects API routes (Express/NestJS/Fastify patterns)
   - Maps import relationships
   - Saves to `.codeprobe/contracts.json`

### Core Engines

1. **`guardEngine.ts`** — Snapshot creation, diffing, health scoring
2. **`contractExtractor.ts`** — Parse TS files for exports, imports, API routes

### Hook Integration

Works as Claude Code PreCommit hook via:
```
codeprobe install-hook --event PreCommit --command "codeprobe verify --json"
```

## Technical Details

- Auto-detects tooling: vitest/jest/mocha/pytest, eslint/biome, tsc
- All checks run in parallel for speed
- File hashing via SHA-256 for change detection
- Import graph built by parsing `import` statements (regex-based, no TS compiler dependency)
- Contracts extracted via regex parsing of `export` declarations
- No new dependencies required

## Success Criteria

- `guard` + `verify` round-trip works on codeprobe's own codebase
- `impact` correctly traces the full import graph
- `contracts` extracts all exported types and functions
- All commands support `--json` output
- All commands work offline (no API key needed)
- Existing tests continue to pass
