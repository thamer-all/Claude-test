/**
 * Configuration loader for codeprobe.
 * Looks for .codeprobe.json or .codeprobe.yaml in the project root.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { CodeprobeConfig } from '../types/config.js';
import { fileExists } from './fs.js';

const CONFIG_FILE_NAMES = [
  '.codeprobe.json',
  '.codeprobe.yaml',
  '.codeprobe.yml',
  'codeprobe.config.json',
  'codeprobe.config.yaml',
  // Backward compat: also check legacy config file names
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
export async function loadConfig(rootPath: string): Promise<CodeprobeConfig> {
  for (const name of CONFIG_FILE_NAMES) {
    const configPath = join(rootPath, name);
    if (await fileExists(configPath)) {
      try {
        const content = await readFile(configPath, 'utf-8');
        if (name.endsWith('.json')) {
          return JSON.parse(content) as CodeprobeConfig;
        }
        return yaml.load(content) as CodeprobeConfig;
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
export function getDefaultConfig(): CodeprobeConfig {
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
