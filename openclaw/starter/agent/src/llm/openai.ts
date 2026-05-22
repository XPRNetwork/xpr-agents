import OpenAI from 'openai';
import {
  LlmClient,
  LlmClientOptions,
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmContentBlock,
  LlmMessage,
  LlmProvider,
  LlmStopReason,
  DEFAULT_MODELS,
} from './types';

interface OpenAiCompatibleOptions extends LlmClientOptions {
  /** Used to point the OpenAI SDK at a different API root (e.g. xAI's https://api.x.ai/v1). */
  baseURL?: string;
  /** Distinguish openai vs xai for `provider` reporting + default model selection. */
  flavor?: 'openai' | 'xai';
}

/**
 * OpenAI Chat Completions client. Also serves xAI — same SDK, different
 * baseURL (https://api.x.ai/v1). xAI is OpenAI-API-compatible including
 * tool calling.
 */
export class OpenAiLlmClient implements LlmClient {
  readonly provider: LlmProvider;
  readonly model: string;
  private client: OpenAI;

  constructor(opts: OpenAiCompatibleOptions) {
    const flavor = opts.flavor || 'openai';
    this.provider = flavor;
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL, // undefined → defaults to api.openai.com
    });
    this.model = opts.model || DEFAULT_MODELS[flavor];
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    // Translate our internal message shape → OpenAI chat-completions shape.
    // The big shape differences:
    //   - system message is a separate field in Anthropic; in OpenAI it's
    //     the first message with role='system'.
    //   - tool_use in assistant content → tool_calls array on assistant
    //     message, with content set to a string (often empty).
    //   - tool_result blocks in user content → separate messages with
    //     role='tool', tool_call_id, content as string.
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [];
    openaiMessages.push({ role: 'system', content: req.system });

    for (const msg of req.messages) {
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          openaiMessages.push({ role: 'user', content: msg.content });
        } else {
          // Mix of text + tool_result blocks. Tool results become standalone
          // role=tool messages; remaining text becomes a single user message.
          const textParts: string[] = [];
          for (const block of msg.content) {
            if (block.type === 'text') {
              textParts.push(block.text);
            } else if (block.type === 'tool_result') {
              openaiMessages.push({
                role: 'tool',
                tool_call_id: block.tool_use_id,
                content: block.content,
              });
            }
          }
          if (textParts.length > 0) {
            openaiMessages.push({ role: 'user', content: textParts.join('\n') });
          }
        }
      } else {
        // Assistant message — split into content text + tool_calls.
        const textParts: string[] = [];
        const tool_calls: OpenAI.ChatCompletionMessageToolCall[] = [];
        for (const block of msg.content) {
          if (block.type === 'text') {
            textParts.push(block.text);
          } else if (block.type === 'tool_use') {
            tool_calls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input || {}),
              },
            });
          }
        }
        openaiMessages.push({
          role: 'assistant',
          content: textParts.length > 0 ? textParts.join('\n') : null,
          ...(tool_calls.length > 0 ? { tool_calls } : {}),
        } as OpenAI.ChatCompletionAssistantMessageParam);
      }
    }

    // GPT-5 / o-series require `max_completion_tokens`; the legacy
    // `max_tokens` field is rejected with a 400. xAI still uses the
    // older OpenAI shape and only accepts `max_tokens`. Branch on
    // the provider flavor so the right field gets sent.
    const isOpenAi = this.provider === 'openai';
    const tokenLimitField = isOpenAi
      ? { max_completion_tokens: req.max_tokens }
      : { max_tokens: req.max_tokens };

    const response = await this.client.chat.completions.create({
      model: req.model || this.model,
      ...tokenLimitField,
      messages: openaiMessages,
      tools: req.tools.length > 0
        ? req.tools.map((t) => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.input_schema as Record<string, unknown>,
            },
          }))
        : undefined,
    });

    const choice = response.choices[0];
    const msg = choice.message;

    const content: LlmContentBlock[] = [];
    if (msg.content) {
      content.push({ type: 'text', text: msg.content });
    }
    if (msg.tool_calls) {
      for (const call of msg.tool_calls) {
        if (call.type !== 'function') continue;
        let input: Record<string, unknown> = {};
        try {
          input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          // If the model returned malformed JSON, pass it through as a raw string
          // and let the tool handler reject — better than silently dropping the call.
          input = { __raw: call.function.arguments };
        }
        content.push({
          type: 'tool_use',
          id: call.id,
          name: call.function.name,
          input,
        });
      }
    }

    let stop_reason: LlmStopReason = 'end_turn';
    if (choice.finish_reason === 'tool_calls') stop_reason = 'tool_use';
    else if (choice.finish_reason === 'length') stop_reason = 'max_tokens';
    else if (choice.finish_reason === 'stop') stop_reason = 'end_turn';

    return {
      content,
      stop_reason,
      usage: response.usage
        ? {
            input_tokens: response.usage.prompt_tokens,
            output_tokens: response.usage.completion_tokens,
          }
        : undefined,
    };
  }
}

/**
 * xAI client — same as OpenAI client with baseURL pointing at api.x.ai/v1.
 * xAI is OpenAI-compatible at the API level including tool calling.
 */
export class XaiLlmClient extends OpenAiLlmClient {
  constructor(opts: LlmClientOptions) {
    super({
      apiKey: opts.apiKey,
      model: opts.model,
      baseURL: 'https://api.x.ai/v1',
      flavor: 'xai',
    });
  }
}
