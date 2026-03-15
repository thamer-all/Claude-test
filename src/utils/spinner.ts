/**
 * Spinner wrapper around ora (ESM dynamic import).
 *
 * Provides a simplified interface for showing progress indicators.
 * Falls back to plain text output when ora cannot be loaded or when
 * stdout is not a TTY.
 */

import { getLogLevel } from './logger.js';

export interface Spinner {
  start(): void;
  stop(): void;
  succeed(text?: string): void;
  fail(text?: string): void;
  update(text: string): void;
}

/**
 * Create a spinner with the given initial text.
 *
 * If the log level is set to 'silent' or the terminal does not support
 * TTY output, the returned spinner is a silent no-op that avoids
 * polluting stdout.
 */
export async function createSpinner(text: string): Promise<Spinner> {
  if (getLogLevel() === 'silent') {
    return createNoopSpinner();
  }

  try {
    const ora = await import('ora');
    const instance = ora.default(text);

    return {
      start() {
        instance.start();
      },
      stop() {
        instance.stop();
      },
      succeed(msg?: string) {
        instance.succeed(msg);
      },
      fail(msg?: string) {
        instance.fail(msg);
      },
      update(msg: string) {
        instance.text = msg;
      },
    };
  } catch {
    return createFallbackSpinner(text);
  }
}

/**
 * No-op spinner for JSON mode.
 */
function createNoopSpinner(): Spinner {
  return {
    start() { /* noop */ },
    stop() { /* noop */ },
    succeed() { /* noop */ },
    fail() { /* noop */ },
    update() { /* noop */ },
  };
}

/**
 * Plain text fallback when ora is unavailable.
 */
function createFallbackSpinner(text: string): Spinner {
  return {
    start() {
      process.stderr.write(`... ${text}\n`);
    },
    stop() {
      // nothing to clear
    },
    succeed(msg?: string) {
      process.stderr.write(`  OK: ${msg ?? text}\n`);
    },
    fail(msg?: string) {
      process.stderr.write(`  FAIL: ${msg ?? text}\n`);
    },
    update(msg: string) {
      process.stderr.write(`... ${msg}\n`);
    },
  };
}
