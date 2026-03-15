/**
 * Anthropic provider — wraps the existing anthropicClient.ts
 * into the ProviderClient interface.
 */

import type { ProviderClient, ProviderRequest, ProviderResponse } from './base.js';
import { callAnthropic, isAnthropicAvailable } from '../anthropicClient.js';

export class AnthropicProvider implements ProviderClient {
  async isAvailable(): Promise<boolean> {
    return isAnthropicAvailable();
  }

  async call(request: ProviderRequest): Promise<ProviderResponse> {
    const result = await callAnthropic({
      model: request.model,
      system: request.system,
      messages: request.messages,
      maxTokens: request.maxTokens,
    });

    return {
      content: result.content,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      model: result.model,
      stopReason: result.stopReason,
    };
  }
}
