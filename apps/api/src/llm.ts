import OpenAI from "openai";

// Minimal, transport-level LLM contracts. The agent loop depends on these,
// never on a specific vendor SDK, so tests can mock the LLM entirely.

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      toolCalls?: { id: string; name: string; arguments: string }[];
      // Gemini 3 attaches thought signatures to tool calls that MUST be echoed
      // back verbatim; when present we send these raw objects instead of a
      // rebuilt copy, so vendor-specific fields survive the round trip.
      rawToolCalls?: unknown[];
    }
  | { role: "tool"; toolCallId: string; content: string };

export interface LlmTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmReply {
  content: string | null;
  toolCalls: { id: string; name: string; arguments: string }[];
  rawToolCalls?: unknown[];
}

export interface ChatRequest {
  messages: LlmMessage[];
  tools: LlmTool[];
}

export type ChatCompleter = (request: ChatRequest) => Promise<LlmReply>;

export interface LlmCompleterOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
}

const DEFAULT_TEMPERATURE = 0.1;

export function createLlmCompleter(options: LlmCompleterOptions = {}): ChatCompleter {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? "";
  if (apiKey === "") throw new Error("GEMINI_API_KEY is not set");
  const baseURL = options.baseUrl ?? process.env.LLM_BASE_URL;
  if (baseURL === undefined || baseURL === "") {
    throw new Error("LLM_BASE_URL is not set");
  }
  const model = options.model ?? process.env.LLM_MODEL ?? "gemini-3.5-flash-lite";
  const temperature = options.temperature ?? DEFAULT_TEMPERATURE;
  const client = new OpenAI({ apiKey, baseURL });

  return async ({ messages, tools }: ChatRequest): Promise<LlmReply> => {
    const payload = messages.map((message): unknown => {
      if (message.role === "assistant") {
        const rebuiltToolCalls =
          message.toolCalls !== undefined
            ? {
                tool_calls: message.toolCalls.map((toolCall) => ({
                  id: toolCall.id,
                  type: "function",
                  function: { name: toolCall.name, arguments: toolCall.arguments },
                })),
              }
            : {};
        return {
          role: "assistant",
          // Gemini's OpenAI-compat layer rejects content: null alongside
          // tool_calls, so send an empty string when there is no text.
          content: message.content ?? "",
          ...(message.rawToolCalls !== undefined && message.rawToolCalls.length > 0
            ? { tool_calls: message.rawToolCalls }
            : rebuiltToolCalls),
        };
      }
      if (message.role === "tool") {
        return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
      }
      return { role: message.role, content: message.content };
    });

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await client.chat.completions.create({
        model,
        temperature,
        messages: payload as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        tools: tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
      });
    } catch (error) {
      if (process.env.CARTGUARD_DEBUG_LLM === "1") {
        console.error("--- LLM REQUEST PAYLOAD ---");
        console.error(JSON.stringify(payload, null, 1));
        console.error("--- LLM ERROR ---");
        console.error(
          JSON.stringify(error, Object.getOwnPropertyNames(error)).slice(0, 1500),
        );
      }
      throw error;
    }

    const choice = response.choices[0]?.message;
    const toolCalls =
      choice?.tool_calls?.flatMap((toolCall) =>
        toolCall.type === "function" && toolCall.function !== null && toolCall.function !== undefined
          ? [
              {
                id: toolCall.id,
                name: toolCall.function.name,
                arguments: toolCall.function.arguments ?? "{}",
              },
            ]
          : [],
      ) ?? [];
    return {
      content: choice?.content ?? null,
      toolCalls,
      rawToolCalls: choice?.tool_calls ?? [],
    };
  };
}
