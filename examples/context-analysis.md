# Context Analysis -- Example Output

The examples below show what you would see when running context analysis
commands against a typical TypeScript project.

---

## claude-test context

Analyzes the current project and reports token usage against the target window.

```
$ claude-test context

  claude-test context analysis
  Target window: 1,000,000 tokens

  Files scanned:     142
  Total tokens:      87,342
  Window usage:      8.7%

  By category:
    Source code        62,410 tokens   71.5%
    Documentation       9,880 tokens   11.3%
    Configuration       4,215 tokens    4.8%
    Tests              10,837 tokens   12.4%

  Top 5 files by token count:
    src/core/engine.ts              8,412 tokens
    src/commands/test.ts            5,230 tokens
    src/utils/tokenizer.ts          4,891 tokens
    README.md                       3,720 tokens
    src/core/contextBuilder.ts      3,415 tokens

  Budget allocation (configured):
    System prompt       10%    100,000 tokens available
    Core files          50%    500,000 tokens available
    Documentation       20%    200,000 tokens available
    Tool metadata       10%    100,000 tokens available

  Status: Well within budget. 91.3% of context window available.
```

---

## claude-test heatmap

Visualizes token density across project directories.

```
$ claude-test heatmap

  Token density heatmap

  src/
  +-- core/           [================        ]  18,240 tokens
  +-- commands/        [===========             ]  12,880 tokens
  +-- utils/           [=========               ]  10,320 tokens
  +-- types/           [=====                   ]   5,640 tokens
  +-- tokenizers/      [====                    ]   4,120 tokens

  prompts/             [==                      ]   2,410 tokens
  examples/            [==                      ]   1,890 tokens
  fixtures/            [=                       ]     720 tokens

  Total: 56,220 tokens across 48 files
```

---

## claude-test simulate

Simulates context window assembly for a given task description.

```
$ claude-test simulate "fix the token counting bug in the heatmap command"

  Simulated context assembly
  Task: "fix the token counting bug in the heatmap command"

  Files selected (by relevance):
    1. src/commands/heatmap.ts           3,120 tokens   [direct match]
    2. src/tokenizers/claudeTokenizer.ts 4,891 tokens   [dependency]
    3. src/utils/paths.ts                1,240 tokens   [imported by #1]
    4. src/types/context.ts                890 tokens   [type definitions]
    5. src/core/contextBuilder.ts        3,415 tokens   [shared logic]

  System prompt:                         2,100 tokens
  Selected files:                       13,556 tokens
  Remaining capacity:                  984,344 tokens

  Estimated relevance: high
  All key files fit within budget.
```

---

## claude-test map

Generates a structural map of the project for inclusion in context.

```
$ claude-test map

  Project map (token-annotated)

  claude-test/
    src/
      cli.ts                          420 tokens
      commands/
        test.ts                     5,230 tokens
        context.ts                  2,810 tokens
        heatmap.ts                  3,120 tokens
        simulate.ts                 2,440 tokens
        lint.ts                     1,980 tokens
      core/
        engine.ts                   8,412 tokens
        contextBuilder.ts           3,415 tokens
        benchmarkRunner.ts          2,890 tokens
      types/
        prompt.ts                   1,120 tokens
        context.ts                    890 tokens
        config.ts                     760 tokens
      utils/
        tokenizer.ts                4,891 tokens
        cache.ts                    1,640 tokens
        logger.ts                     920 tokens

  Total: 48 files, 56,220 tokens
  Map itself: 312 tokens
```
