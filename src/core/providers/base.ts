export interface ProviderClient {
  call(request: ProviderRequest): Promise<ProviderResponse>;
  isAvailable(): Promise<boolean>;
}

export interface ProviderRequest {
  model: string;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
}

export interface ProviderResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  stopReason: string;
}

export type ProviderName = 'anthropic' | 'openai' | 'google' | 'deepseek' | 'qwen' | 'local';
