/**
 * Provider factory — creates the right ProviderClient from a model name.
 */

import type { ProviderClient } from './base.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { GoogleProvider } from './google.js';

export function createProvider(modelId: string): ProviderClient {
  if (modelId.startsWith('claude-')) return new AnthropicProvider();
  if (modelId.startsWith('gpt-') || modelId.startsWith('o3') || modelId.startsWith('o4')) return new OpenAIProvider();
  if (modelId.startsWith('gemini-')) return new GoogleProvider();
  if (modelId.startsWith('deepseek-')) return new OpenAIProvider({ baseURL: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY' });
  if (modelId.startsWith('qwen-')) return new OpenAIProvider({ baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKeyEnv: 'DASHSCOPE_API_KEY' });
  if (modelId.startsWith('llama-')) return new OpenAIProvider(); // Via OpenAI-compatible endpoints
  if (modelId.startsWith('codestral') || modelId.startsWith('mistral')) return new OpenAIProvider({ baseURL: 'https://api.mistral.ai/v1', apiKeyEnv: 'MISTRAL_API_KEY' });
  if (modelId === 'local') return new OpenAIProvider({ baseURL: 'http://localhost:11434/v1', apiKeyEnv: 'OLLAMA_API_KEY' });

  // Default: try OpenAI-compatible
  return new OpenAIProvider();
}

export function getRequiredEnvVar(modelId: string): string {
  if (modelId.startsWith('claude-')) return 'ANTHROPIC_API_KEY';
  if (modelId.startsWith('gpt-') || modelId.startsWith('o3') || modelId.startsWith('o4')) return 'OPENAI_API_KEY';
  if (modelId.startsWith('gemini-')) return 'GOOGLE_API_KEY';
  if (modelId.startsWith('deepseek-')) return 'DEEPSEEK_API_KEY';
  if (modelId.startsWith('qwen-')) return 'DASHSCOPE_API_KEY';
  if (modelId.startsWith('codestral') || modelId.startsWith('mistral')) return 'MISTRAL_API_KEY';
  return 'OPENAI_API_KEY';
}
