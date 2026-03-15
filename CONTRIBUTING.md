# Contributing to codeprobe

Thank you for your interest in contributing to codeprobe. This document
covers the process for setting up a development environment, building the
project, and submitting changes.

## Development Setup

1. **Clone the repository**

```bash
git clone https://github.com/anthropics/codeprobe.git
cd codeprobe
```

2. **Install dependencies**

Requires Node.js 18 or later.

```bash
npm install
```

3. **Build the project**

```bash
npm run build
```

4. **Run locally**

```bash
node dist/cli.js --help
```

Or link it globally for development:

```bash
npm link
codeprobe --help
```

## Project Structure

```
src/
  cli.ts              CLI entry point (commander setup)
  commands/            One file per command
  core/                Core logic (engine, context builder, benchmark runner)
  types/               TypeScript type definitions
  utils/               Shared utilities (cache, logger, paths, tokenizer)
  tokenizers/          Token counting implementations
prompts/               Example prompt specs
datasets/              Example JSONL datasets
fixtures/              Test fixture files
examples/              Example configurations and usage
```

## Adding a New Command

1. Create a new file in `src/commands/` (e.g., `src/commands/mycommand.ts`).
2. Export a function that registers the command with Commander:

```typescript
import { Command } from "commander";

export function registerMyCommand(program: Command): void {
  program
    .command("mycommand")
    .description("One-line description of what it does")
    .argument("[path]", "optional path argument")
    .option("-o, --output <format>", "output format", "text")
    .action(async (path, options) => {
      // Implementation here
    });
}
```

3. Import and register the command in `src/cli.ts`.
4. Add the command to the commands table in `README.md`.

## Code Style

- **TypeScript strict mode** is enforced. No `any` types.
- Use named exports, not default exports.
- Keep functions small and focused. Prefer pure functions where possible.
- Use `async`/`await` over raw promises.
- Error messages should be clear and actionable. Include the path or value
  that caused the error when relevant.
- Run `npm run lint` before committing. The lint step runs `tsc --noEmit`
  to check for type errors.

## Commit Messages

Use clear, imperative-mood commit messages:

```
Add heatmap command for token density visualization
Fix token count calculation for multibyte characters
Update context budget defaults in config schema
```

## Pull Request Process

1. Fork the repository and create a feature branch from `main`.
2. Make your changes. Add or update tests if applicable.
3. Run `npm run build` and `npm run lint` to verify everything compiles.
4. Open a pull request against `main`.
5. Provide a clear description of what your change does and why.
6. A maintainer will review your PR. Address any feedback, then it will
   be merged.

## Reporting Issues

Open a GitHub issue with:

- A clear title describing the problem.
- Steps to reproduce the issue.
- Expected behavior vs. actual behavior.
- Your Node.js version and operating system.

## License

By contributing, you agree that your contributions will be licensed under
the MIT License.
