/**
 * Unified LLM client interface. Each provider (Anthropic / OpenAI / xAI /
 * Gemini) implements this. The agent runner only knows about these types —
 * never imports any provider SDK directly outside of `llm/<provider>.ts`.
 *
 * The internal message/tool shapes mirror Anthropic's Messages API because
 * that's what the runner originally targeted; OpenAI / xAI / Gemini impls
 * translate to their own formats inside complete() and back.
 */

export type LlmProvider = 'anthropic' | 'openai' | 'xai' | 'gemini';

export interface LlmTool {
  /** Tool name as the LLM will see it (e.g. `xpr_get_agent`). */
  name: string;
  description: string;
  /** JSON schema for the parameters object. */
  input_schema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    [k: string]: unknown;
  };
}

export interface LlmTextBlock {
  type: 'text';
  text: string;
}

export interface LlmToolUseBlock {
  type: 'tool_use';
  /** Stable identifier the assistant uses to refer to this tool call when its result comes back. */
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type LlmContentBlock = LlmTextBlock | LlmToolUseBlock;

export interface LlmToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  /** String form of the tool's return value (JSON serialised). */
  content: string;
  is_error?: boolean;
}

export interface LlmUserMessage {
  role: 'user';
  /** Plain text OR a mix of text + tool_result blocks (when responding to tool calls). */
  content: string | Array<LlmTextBlock | LlmToolResultBlock>;
}

export interface LlmAssistantMessage {
  role: 'assistant';
  content: LlmContentBlock[];
}

export type LlmMessage = LlmUserMessage | LlmAssistantMessage;

export type LlmStopReason =
  | 'end_turn'        // assistant finished talking
  | 'tool_use'        // assistant wants tools called
  | 'max_tokens'      // truncated by max_tokens
  | 'stop_sequence';

export interface LlmCompletionRequest {
  system: string;
  messages: LlmMessage[];
  tools: LlmTool[];
  max_tokens: number;
  /** Optional override; impl falls back to its `defaultModel`. */
  model?: string;
}

export interface LlmCompletionResponse {
  content: LlmContentBlock[];
  stop_reason: LlmStopReason;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface LlmClient {
  provider: LlmProvider;
  /** Resolved model name actually used for requests (after defaults applied). */
  model: string;
  complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse>;
}

export interface LlmClientOptions {
  apiKey: string;
  /** Override the default model for this provider. */
  model?: string;
}

/** Default model per provider. Override via AGENT_MODEL or AGENT_MODEL_<PROVIDER>. */
export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5',
  xai: 'grok-4.3',
  gemini: 'gemini-2.5-flash',
};

/**
 * Auto-detect provider from an API key prefix. Used when --provider is omitted.
 * Returns null if the prefix is ambiguous — caller should require --provider explicitly.
 */
export function detectProviderFromKey(key: string): LlmProvider | null {
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('xai-')) return 'xai';
  if (key.startsWith('sk-proj-') || key.startsWith('sk-svcacct-') || key.startsWith('sk-')) return 'openai';
  if (key.startsWith('AI') && key.length > 30) return 'gemini'; // Gemini keys start with "AI" + ~37 chars
  return null;
}
