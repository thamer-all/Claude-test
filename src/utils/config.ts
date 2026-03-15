/**
 * Configuration loader for claude-test.
 * Looks for .claude-test.json or .claude-test.yaml in the project root.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { ClaudeTestConfig } from '../types/config.js';
import { fileExists } from './fs.js';

const CONFIG_FILE_NAMES = [
  '.claude-test.json',
  '.claude-test.yaml',
  '.claude-test.yml',
  'claude-test.config.json',
  'claude-test.config.yaml',
];

/**
 * Load configuration from the project root.
 * Returns a default config if no config file is found.
 */
export async function loadConfig(rootPath: string): Promise<ClaudeTestConfig> {
  for (const name of CONFIG_FILE_NAMES) {
    const configPath = join(rootPath, name);
    if (await fileExists(configPath)) {
      try {
        const content = await readFile(configPath, 'utf-8');
        if (name.endsWith('.json')) {
          return JSON.parse(content) as ClaudeTestConfig;
        }
        return yaml.load(content) as ClaudeTestConfig;
      } catch {
        // Fall through to default
      }
    }
  }

  return getDefaultConfig();
}

/**
 * Return the default configuration.
 */
export function getDefaultConfig(): ClaudeTestConfig {
  return {
    defaultModel: 'claude-sonnet-4-20250514',
    defaultContextTarget: '200k',
    ignorePaths: [],
    caching: true,
    contextBudgets: {
      systemPrompt: 0.1,
      coreFiles: 0.5,
      docs: 0.2,
      toolMeta: 0.1,
    },
  };
}
