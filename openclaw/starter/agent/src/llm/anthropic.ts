import Anthropic from '@anthropic-ai/sdk';
import {
  LlmClient,
  LlmClientOptions,
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmContentBlock,
  LlmStopReason,
  DEFAULT_MODELS,
} from './types';

/**
 * Anthropic Messages API client. Pass-through — our internal types already
 * match Anthropic's shape, so translation is mostly a cast.
 */
export class AnthropicLlmClient implements LlmClient {
  readonly provider = 'anthropic' as const;
  readonly model: string;
  private client: Anthropic;

  constructor(opts: LlmClientOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model || DEFAULT_MODELS.anthropic;
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const response = await this.client.messages.create({
      model: req.model || this.model,
      max_tokens: req.max_tokens,
      system: req.system,
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as any,
      })),
      messages: req.messages as any, // shapes match
    });

    const content: LlmContentBlock[] = [];
    for (const block of response.content) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        content.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: (block.input || {}) as Record<string, unknown>,
        });
      }
      // Skip server_tool_use blocks — Anthropic-managed tools (web_search) handled internally
    }

    // Map stop_reason → our union
    let stop_reason: LlmStopReason = 'end_turn';
    if (response.stop_reason === 'tool_use') stop_reason = 'tool_use';
    else if (response.stop_reason === 'max_tokens') stop_reason = 'max_tokens';
    else if (response.stop_reason === 'stop_sequence') stop_reason = 'stop_sequence';

    return {
      content,
      stop_reason,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  }
}
