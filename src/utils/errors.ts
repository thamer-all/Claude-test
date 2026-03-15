/**
 * Custom error classes and a top-level error handler.
 */

/**
 * Base error for all claude-test errors. Carries a machine-readable
 * `code` and optional structured `details`.
 */
export class ClaudeTestError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ClaudeTestError';
    this.code = code;
    this.details = details;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Raised when a configuration file is missing, malformed, or contains
 * invalid values.
 */
export class ConfigError extends ClaudeTestError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', details);
    this.name = 'ConfigError';
  }
}

/**
 * Raised when a prompt spec file cannot be parsed or is invalid.
 */
export class PromptParseError extends ClaudeTestError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PROMPT_PARSE_ERROR', details);
    this.name = 'PromptParseError';
  }
}

/**
 * Raised when input data fails schema or constraint validation.
 */
export class ValidationError extends ClaudeTestError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

/**
 * Top-level error handler that prints a user-friendly message and
 * exits the process.
 *
 * - Known ClaudeTestError instances are printed cleanly.
 * - Unknown errors include a hint to report the bug.
 * - Stack traces are only printed when DEBUG is set.
 */
export function handleError(error: unknown): never {
  if (error instanceof ClaudeTestError) {
    process.stderr.write(`\nError [${error.code}]: ${error.message}\n`);

    if (error.details && Object.keys(error.details).length > 0) {
      process.stderr.write(
        `Details: ${JSON.stringify(error.details, null, 2)}\n`,
      );
    }

    if (process.env['DEBUG'] && error.stack) {
      process.stderr.write(`\n${error.stack}\n`);
    }

    process.exit(1);
  }

  if (error instanceof Error) {
    process.stderr.write(`\nUnexpected error: ${error.message}\n`);

    if (process.env['DEBUG'] && error.stack) {
      process.stderr.write(`\n${error.stack}\n`);
    } else {
      process.stderr.write(
        'Set DEBUG=1 for a full stack trace.\n',
      );
    }

    process.exit(1);
  }

  // Truly unknown throw value
  process.stderr.write(`\nUnexpected error: ${String(error)}\n`);
  process.exit(1);
}
