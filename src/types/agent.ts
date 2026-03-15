/**
 * Agent, hook, and MCP asset discovery types.
 */

export interface ClaudeAsset {
  path: string;
  type: ClaudeAssetType;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  metadata?: Record<string, unknown>;
}

export type AIToolType =
  | 'claude-config'
  | 'cursor-config'
  | 'windsurf-config'
  | 'copilot-config'
  | 'aider-config'
  | 'continue-config'
  | 'cline-config'
  | 'codex-config'
  | 'agent'
  | 'skill'
  | 'hook'
  | 'mcp-config'
  | 'prompt-spec'
  | 'context-file'
  | 'agentic-workflow'
  | 'other';

// Keep ClaudeAssetType as alias for backward compatibility
export type ClaudeAssetType = AIToolType;

export interface HookInfo {
  path: string;
  type: string;
  description: string;
  events?: string[];
}

export interface MCPAsset {
  path: string;
  type: 'mcp-config' | 'mcp-server' | 'mcp-related';
  serverName?: string;
  transport?: string;
  description: string;
}
