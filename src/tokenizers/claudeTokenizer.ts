/**
 * Claude tokenizer wrapper using tiktoken with cl100k_base encoding.
 * Provides lazy initialization and graceful fallback to character-count estimation.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface TiktokenEncoder {
  encode(text: string): Uint32Array;
  decode(tokens: Uint32Array): string;
  free(): void;
}

let tokenizerInstance: TiktokenEncoder | null = null;
let initFailed = false;

/**
 * Lazily initialize and return the tiktoken encoder.
 * Uses createRequire for synchronous loading in ESM context.
 * Returns null if tiktoken cannot be loaded.
 */
function lazyInit(): TiktokenEncoder | null {
  if (tokenizerInstance) {
    return tokenizerInstance;
  }
  if (initFailed) {
    return null;
  }

  try {
    const tiktoken = require('tiktoken') as {
      get_encoding(encoding: string): TiktokenEncoder;
    };
    tokenizerInstance = tiktoken.get_encoding('cl100k_base');
    return tokenizerInstance;
  } catch {
    initFailed = true;
    return null;
  }
}

/**
 * Fallback estimation: approximately 1 token per 4 characters.
 */
function fallbackEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate the number of tokens in a text string.
 * Uses tiktoken cl100k_base when available, falls back to chars/4.
 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }

  const encoder = lazyInit();
  if (encoder) {
    try {
      const tokens = encoder.encode(text);
      return tokens.length;
    } catch {
      return fallbackEstimate(text);
    }
  }

  return fallbackEstimate(text);
}

/**
 * Estimate token count for a file's contents.
 * Reads the file as UTF-8 text and estimates tokens.
 */
export async function estimateTokensForFile(filePath: string): Promise<number> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return estimateTokens(content);
  } catch {
    return 0;
  }
}

/**
 * Get the underlying tiktoken encoder instance.
 * Returns the encoder or throws if initialization fails.
 */
export function getTokenizer(): TiktokenEncoder {
  const encoder = lazyInit();
  if (!encoder) {
    throw new Error(
      'Failed to initialize tiktoken encoder. ' +
        'Ensure the tiktoken package is installed correctly.',
    );
  }
  return encoder;
}
