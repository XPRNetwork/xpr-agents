import { GoogleGenerativeAI, FunctionDeclarationsTool, Content, Part } from '@google/generative-ai';
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
 * Google Gemini client. Uses @google/generative-ai with function calling.
 *
 * Gemini's quirks vs Anthropic/OpenAI:
 *   - system prompt goes in `systemInstruction` on the model, not in messages
 *   - assistant role is called 'model'
 *   - tool calls come back as `functionCall` parts; tool results go in as
 *     `functionResponse` parts on a 'user' (function) message
 *   - tool_use_id doesn't exist natively — Gemini matches by tool name,
 *     so we generate stable IDs from `${name}-${index}` for our internal use
 */
export class GeminiLlmClient implements LlmClient {
  readonly provider = 'gemini' as const;
  readonly model: string;
  private genai: GoogleGenerativeAI;

  constructor(opts: LlmClientOptions) {
    this.genai = new GoogleGenerativeAI(opts.apiKey);
    this.model = opts.model || DEFAULT_MODELS.gemini;
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const model = this.genai.getGenerativeModel({
      model: req.model || this.model,
      systemInstruction: req.system,
      tools: req.tools.length > 0
        ? ([{
            functionDeclarations: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.input_schema as any,
            })),
          }] as FunctionDeclarationsTool[])
        : undefined,
      generationConfig: {
        maxOutputTokens: req.max_tokens,
      },
    });

    // Translate our messages → Gemini Content[]
    // We track tool_use_id → tool name so we can re-pair function responses.
    const toolUseIdToName: Record<string, string> = {};
    const history: Content[] = [];

    for (const msg of req.messages) {
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          history.push({ role: 'user', parts: [{ text: msg.content }] });
        } else {
          // Mix of text + tool_result blocks
          const textParts: Part[] = [];
          const functionResponseParts: Part[] = [];
          for (const block of msg.content) {
            if (block.type === 'text') {
              textParts.push({ text: block.text });
            } else if (block.type === 'tool_result') {
              const fnName = toolUseIdToName[block.tool_use_id] || 'unknown';
              let responseObj: unknown;
              try {
                responseObj = JSON.parse(block.content);
              } catch {
                responseObj = { result: block.content };
              }
              functionResponseParts.push({
                functionResponse: {
                  name: fnName,
                  response: responseObj as object,
                },
              } as Part);
            }
          }
          // Gemini wants function responses in their own 'function' or 'user' message
          if (functionResponseParts.length > 0) {
            history.push({ role: 'function', parts: functionResponseParts });
          }
          if (textParts.length > 0) {
            history.push({ role: 'user', parts: textParts });
          }
        }
      } else {
        // Assistant — track tool_use ids so tool_result blocks can map back
        const parts: Part[] = [];
        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ text: block.text });
          } else if (block.type === 'tool_use') {
            toolUseIdToName[block.id] = block.name;
            parts.push({
              functionCall: {
                name: block.name,
                args: block.input as object,
              },
            } as Part);
          }
        }
        history.push({ role: 'model', parts });
      }
    }

    // Send the conversation
    const lastUserContent = history.pop();
    if (!lastUserContent) {
      throw new Error('Gemini: messages array cannot be empty');
    }
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(lastUserContent.parts);
    const response = result.response;

    const content: LlmContentBlock[] = [];
    let toolUseIndex = 0;
    const responseText = response.text();
    if (responseText) {
      content.push({ type: 'text', text: responseText });
    }

    // Extract function calls from the response
    const functionCalls = response.functionCalls?.() || [];
    for (const call of functionCalls) {
      content.push({
        type: 'tool_use',
        id: `${call.name}-${toolUseIndex++}-${Date.now()}`,
        name: call.name,
        input: (call.args || {}) as Record<string, unknown>,
      });
    }

    const stop_reason: LlmStopReason =
      functionCalls.length > 0
        ? 'tool_use'
        : response.candidates?.[0]?.finishReason === 'MAX_TOKENS'
          ? 'max_tokens'
          : 'end_turn';

    const usage = response.usageMetadata
      ? {
          input_tokens: response.usageMetadata.promptTokenCount,
          output_tokens: response.usageMetadata.candidatesTokenCount,
        }
      : undefined;

    return { content, stop_reason, usage };
  }
}
