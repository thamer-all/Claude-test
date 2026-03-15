/**
 * Logging utilities for codeprobe CLI.
 */

import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

let currentLevel: LogLevel = 'info';
let jsonMode = false;

/**
 * Enable or disable JSON output mode.
 * When enabled, spinners and decorative output are suppressed.
 */
export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

/**
 * Check whether JSON output mode is active.
 */
export function isJsonMode(): boolean {
  return jsonMode;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

export function debug(message: string, ...args: unknown[]): void {
  if (shouldLog('debug')) {
    console.log(chalk.gray(`[debug] ${message}`), ...args);
  }
}

export function info(message: string, ...args: unknown[]): void {
  if (shouldLog('info')) {
    console.log(message, ...args);
  }
}

export function warn(message: string, ...args: unknown[]): void {
  if (shouldLog('warn')) {
    console.warn(chalk.yellow(`[warn] ${message}`), ...args);
  }
}

export function error(message: string, ...args: unknown[]): void {
  if (shouldLog('error')) {
    console.error(chalk.red(`[error] ${message}`), ...args);
  }
}

export function success(message: string, ...args: unknown[]): void {
  if (shouldLog('info')) {
    console.log(chalk.green(message), ...args);
  }
}

export function dim(message: string, ...args: unknown[]): void {
  if (shouldLog('info')) {
    console.log(chalk.dim(message), ...args);
  }
}

export const logger = {
  debug,
  info,
  warn,
  error,
  success,
  dim,
  setLogLevel,
  getLogLevel,
};
