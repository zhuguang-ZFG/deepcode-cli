import * as crypto from "crypto";
import type { ChatCompletionDebugOptions } from "./constants";
import type { ModelUsage, LlmStreamProgress } from "./types";
import {
  isUsageRecord,
  summarizeCompletionOptions,
  getLiMaRouterRequestTimeoutMs,
  getLiMaRouterMaxRetries,
} from "./helpers";
import { isLiMaRouterBaseURL } from "../common/openai-thinking";
import { logApiError } from "../common/error-logger";
import { logOpenAIChatCompletionDebug, normalizeDebugError } from "../common/debug-logger";

type CreateOpenAIClientFn = () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  client: { chat: { completions: { create: Function } } } | null;
  model: string;
  baseURL?: string;
  debugLogEnabled?: boolean;
};

export interface ChatCompletionStreamCallbacks {
  onLlmStreamProgress?: (progress: LlmStreamProgress) => void;
}

export function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "AbortError" || error.constructor.name === "APIUserAbortError";
}

export function throwIfAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) {
    return;
  }
  const error = new Error("Request was aborted.");
  error.name = "AbortError";
  throw error;
}

const CJK_RE = /[㐀-鿿豈-﫿]/gu;

export function estimateStreamTokens(text: string): number {
  if (!text) return 0;
  const cjkMatches = text.match(CJK_RE);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const nonCjkCount = text.length - cjkCount;
  return cjkCount * 0.6 + nonCjkCount * 0.3;
}

export function formatEstimatedTokens(tokens: number): string {
  if (tokens <= 0) {
    return "0";
  }
  const roundedTokens = Math.round(tokens);
  if (roundedTokens <= 0) {
    return "0";
  }
  if (roundedTokens < 100) {
    return String(roundedTokens);
  }
  if (roundedTokens < 10000) {
    return `${Number((roundedTokens / 1000).toFixed(1))}k`;
  }
  return `${Math.round(roundedTokens / 1000)}k`;
}

export function emitLlmStreamProgress(
  callbacks: ChatCompletionStreamCallbacks,
  requestId: string,
  startedAt: string,
  estimatedTokens: number,
  phase: LlmStreamProgress["phase"],
  sessionId?: string,
  transport?: LlmStreamProgress["transport"],
  telemetry?: Pick<LlmStreamProgress, "attempt" | "maxAttempts" | "timeoutMs" | "lastError" | "model">
): void {
  callbacks.onLlmStreamProgress?.({
    requestId,
    sessionId,
    startedAt,
    estimatedTokens: Math.round(estimatedTokens),
    formattedTokens: formatEstimatedTokens(estimatedTokens),
    phase,
    transport,
    ...telemetry,
  });
}

export function isLiMaRouterBlockedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { status?: unknown; message?: unknown };
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  return record.status === 403 || message.includes("403") || message.includes("blocked");
}

export function buildLiMaRouterBlockedFallbackRequest(request: Record<string, unknown>): Record<string, unknown> {
  const lastUserContent = getLastTextMessageContent(request.messages, "user");
  const fallbackNote =
    "上一次带本地工具的 LiMa Router 请求在执行前被拦截。请不要调用本地工具，明确说明实时项目检查被拦截。";
  return {
    model: request.model,
    messages: [
      {
        role: "system",
        content:
          "你是 LiMa Code。上一次带工具请求被上游路由拦截。请给出不使用工具的简洁兜底回答，说明被拦截的层级，不要假装本地检查已经成功。",
      },
      {
        role: "user",
        content: lastUserContent ? `${lastUserContent}\n\n${fallbackNote}` : fallbackNote,
      },
    ],
    stream: false,
  };
}

export function buildLiMaRouterBlockedLocalResponse(
  initialError: unknown,
  fallbackError: unknown
): { choices: Array<{ message: Record<string, unknown> }>; usage: null } {
  const initialMessage = initialError instanceof Error ? initialError.message : String(initialError);
  const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
  return {
    choices: [
      {
        message: {
          content: [
            "LiMa Router 在可用响应产出前拦截了模型请求。",
            "",
            "层级: 上游模型或供应商准入层",
            `初始请求: ${initialMessage}`,
            `兜底请求: ${fallbackMessage}`,
            "",
            "不要假设本轮已有任何本地工具执行结果。如果持续出现，请运行 /lima doctor，或切换供应商/模型路由后重试。",
          ].join("\n"),
        },
      },
    ],
    usage: null,
  };
}

export function getLastTextMessageContent(messages: unknown, role: string): string {
  if (!Array.isArray(messages)) {
    return "";
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: unknown; content?: unknown };
    if (message?.role !== role) {
      continue;
    }
    if (typeof message.content === "string") {
      return message.content;
    }
    if (!Array.isArray(message.content)) {
      continue;
    }
    const textParts = message.content
      .map((part) =>
        (part as { type?: unknown; text?: unknown }).type === "text" ? (part as { text?: unknown }).text : ""
      )
      .filter((text): text is string => typeof text === "string" && text.length > 0);
    return textParts.join("\n");
  }

  return "";
}

export function logChatCompletionDebug(
  debug: ChatCompletionDebugOptions | undefined,
  entry: Parameters<typeof logOpenAIChatCompletionDebug>[0]
): void {
  if (!debug?.enabled) {
    return;
  }
  logOpenAIChatCompletionDebug(entry);
}

export function normalizeLlmToolCalls(rawToolCalls: unknown[] | null | undefined): unknown[] | null {
  if (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0) {
    return null;
  }

  return rawToolCalls.map((toolCall) => {
    if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
      return toolCall;
    }

    const record = toolCall as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (id) {
      return toolCall;
    }

    return {
      ...record,
      id: generateToolCallId(),
    };
  });
}

function generateToolCallId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export async function createChatCompletionStream(
  callbacks: ChatCompletionStreamCallbacks,
  client: NonNullable<ReturnType<CreateOpenAIClientFn>["client"]>,
  request: Record<string, unknown>,
  options?: Record<string, unknown>,
  sessionId?: string,
  debug?: ChatCompletionDebugOptions
): Promise<{
  choices?: Array<{ message?: Record<string, unknown> }>;
  usage?: ModelUsage | null;
}> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const estimatedTokens = 0;
  const transport = isLiMaRouterBaseURL(debug?.baseURL) ? "non_stream" : "stream";
  const progressModel = typeof request.model === "string" ? request.model : undefined;
  emitLlmStreamProgress(callbacks, requestId, startedAt, estimatedTokens, "start", sessionId, transport, {
    model: progressModel,
  });

  const streamRequest = {
    ...request,
    stream: true,
    stream_options: {
      ...(isUsageRecord(request.stream_options) ? request.stream_options : {}),
      include_usage: true,
    },
  };

  if (transport === "non_stream") {
    return handleNonStreamRequest(
      callbacks,
      client,
      request,
      streamRequest,
      options,
      requestId,
      startedAt,
      startedAtMs,
      sessionId,
      transport,
      progressModel,
      debug
    );
  }

  return handleStreamRequest(
    callbacks,
    client,
    streamRequest,
    options,
    requestId,
    startedAt,
    startedAtMs,
    sessionId,
    transport,
    progressModel,
    debug
  );
}

async function handleNonStreamRequest(
  callbacks: ChatCompletionStreamCallbacks,
  client: NonNullable<ReturnType<CreateOpenAIClientFn>["client"]>,
  request: Record<string, unknown>,
  streamRequest: Record<string, unknown>,
  options: Record<string, unknown> | undefined,
  requestId: string,
  startedAt: string,
  startedAtMs: number,
  sessionId: string | undefined,
  transport: "non_stream",
  progressModel: string | undefined,
  debug?: ChatCompletionDebugOptions
): Promise<{ choices?: Array<{ message?: Record<string, unknown> }>; usage?: ModelUsage | null }> {
  const nonStreamRequest: Record<string, unknown> = { ...request, stream: false };
  delete nonStreamRequest.stream_options;
  const timeoutMs = getLiMaRouterRequestTimeoutMs();
  const maxRetries = getLiMaRouterMaxRetries();
  const requestOptions: Record<string, unknown> = { ...options, timeout: timeoutMs, maxRetries };
  emitLlmStreamProgress(callbacks, requestId, startedAt, 0, "update", sessionId, transport, {
    attempt: 1,
    maxAttempts: maxRetries + 1,
    timeoutMs,
    model: progressModel,
  });
  try {
    const response = await (
      client.chat.completions.create as unknown as (
        body: Record<string, unknown>,
        options?: Record<string, unknown>
      ) => Promise<unknown>
    )(nonStreamRequest, requestOptions);
    logChatCompletionDebug(debug, {
      timestamp: new Date().toISOString(),
      location: debug?.location ?? "createChatCompletionStream:lima-non-stream",
      requestId,
      sessionId,
      model: typeof request.model === "string" ? request.model : undefined,
      baseURL: debug?.baseURL,
      durationMs: Date.now() - startedAtMs,
      params: { ...debug?.params, options: summarizeCompletionOptions(requestOptions), transport: "non_stream" },
      request: nonStreamRequest,
      response,
    });
    return response as { choices?: Array<{ message?: Record<string, unknown> }>; usage?: ModelUsage | null };
  } catch (error) {
    if (isLiMaRouterBlockedError(error)) {
      return handleBlockedFallback(
        callbacks,
        client,
        nonStreamRequest,
        requestOptions,
        error,
        requestId,
        startedAt,
        startedAtMs,
        sessionId,
        debug
      );
    }
    logChatCompletionDebug(debug, {
      timestamp: new Date().toISOString(),
      location: debug?.location ?? "createChatCompletionStream:lima-non-stream",
      requestId,
      sessionId,
      model: typeof request.model === "string" ? request.model : undefined,
      baseURL: debug?.baseURL,
      durationMs: Date.now() - startedAtMs,
      params: { ...debug?.params, options: summarizeCompletionOptions(requestOptions), transport: "non_stream" },
      request: nonStreamRequest,
      error: normalizeDebugError(error),
    });
    logApiError({
      timestamp: new Date().toISOString(),
      location: "createChatCompletionStream:lima-non-stream",
      requestId,
      sessionId,
      model: typeof request.model === "string" ? request.model : undefined,
      error: {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      request: nonStreamRequest,
    });
    throw error;
  } finally {
    emitLlmStreamProgress(callbacks, requestId, startedAt, 0, "end", sessionId, transport);
  }
}

async function handleBlockedFallback(
  callbacks: ChatCompletionStreamCallbacks,
  client: NonNullable<ReturnType<CreateOpenAIClientFn>["client"]>,
  nonStreamRequest: Record<string, unknown>,
  requestOptions: Record<string, unknown>,
  error: unknown,
  requestId: string,
  startedAt: string,
  startedAtMs: number,
  sessionId: string | undefined,
  debug?: ChatCompletionDebugOptions
): Promise<{ choices?: Array<{ message?: Record<string, unknown> }>; usage?: ModelUsage | null }> {
  const fallbackRequest = buildLiMaRouterBlockedFallbackRequest(nonStreamRequest);
  try {
    const response = await (
      client.chat.completions.create as unknown as (
        body: Record<string, unknown>,
        options?: Record<string, unknown>
      ) => Promise<unknown>
    )(fallbackRequest, requestOptions);
    logChatCompletionDebug(debug, {
      timestamp: new Date().toISOString(),
      location: "createChatCompletionStream:lima-non-stream-blocked-fallback",
      requestId,
      sessionId,
      model: typeof nonStreamRequest.model === "string" ? nonStreamRequest.model : undefined,
      baseURL: debug?.baseURL,
      durationMs: Date.now() - startedAtMs,
      params: {
        ...debug?.params,
        options: summarizeCompletionOptions(requestOptions),
        transport: "non_stream",
        fallback: "blocked_request",
      },
      request: fallbackRequest,
      response,
    });
    return response as { choices?: Array<{ message?: Record<string, unknown> }>; usage?: ModelUsage | null };
  } catch (fallbackError) {
    const localResponse = buildLiMaRouterBlockedLocalResponse(error, fallbackError);
    logChatCompletionDebug(debug, {
      timestamp: new Date().toISOString(),
      location: "createChatCompletionStream:lima-non-stream-blocked-local",
      requestId,
      sessionId,
      model: typeof nonStreamRequest.model === "string" ? nonStreamRequest.model : undefined,
      baseURL: debug?.baseURL,
      durationMs: Date.now() - startedAtMs,
      params: {
        ...debug?.params,
        options: summarizeCompletionOptions(requestOptions),
        transport: "non_stream",
        fallback: "local_blocked_report",
      },
      request: fallbackRequest,
      error: {
        name: "LiMaRouterBlockedFallbackError",
        message: `initial: ${error instanceof Error ? error.message : String(error)}; fallback: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
        stack: JSON.stringify({ initial: normalizeDebugError(error), fallback: normalizeDebugError(fallbackError) }),
      },
      response: localResponse,
    });
    return localResponse;
  }
}

async function handleStreamRequest(
  callbacks: ChatCompletionStreamCallbacks,
  client: NonNullable<ReturnType<CreateOpenAIClientFn>["client"]>,
  streamRequest: Record<string, unknown>,
  options: Record<string, unknown> | undefined,
  requestId: string,
  startedAt: string,
  startedAtMs: number,
  sessionId: string | undefined,
  transport: "stream",
  progressModel: string | undefined,
  debug?: ChatCompletionDebugOptions
): Promise<{ choices?: Array<{ message?: Record<string, unknown> }>; usage?: ModelUsage | null }> {
  let response: unknown;
  try {
    response = await (
      client.chat.completions.create as unknown as (
        body: Record<string, unknown>,
        options?: Record<string, unknown>
      ) => Promise<unknown>
    )(streamRequest, options);
  } catch (error) {
    logChatCompletionDebug(debug, {
      timestamp: new Date().toISOString(),
      location: debug?.location ?? "createChatCompletionStream:create",
      requestId,
      sessionId,
      model: typeof streamRequest.model === "string" ? streamRequest.model : undefined,
      baseURL: debug?.baseURL,
      durationMs: Date.now() - startedAtMs,
      params: { ...debug?.params, options: summarizeCompletionOptions(options) },
      request: streamRequest,
      error: normalizeDebugError(error),
    });
    logApiError({
      timestamp: new Date().toISOString(),
      location: "createChatCompletionStream:create",
      requestId,
      sessionId,
      model: typeof streamRequest.model === "string" ? streamRequest.model : undefined,
      error: {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      request: streamRequest,
    });
    emitLlmStreamProgress(callbacks, requestId, startedAt, 0, "end", sessionId, transport);
    throw error;
  }

  if (!response || typeof (response as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== "function") {
    emitLlmStreamProgress(callbacks, requestId, startedAt, 0, "end", sessionId, transport);
    logChatCompletionDebug(debug, {
      timestamp: new Date().toISOString(),
      location: debug?.location ?? "createChatCompletionStream",
      requestId,
      sessionId,
      model: typeof streamRequest.model === "string" ? streamRequest.model : undefined,
      baseURL: debug?.baseURL,
      durationMs: Date.now() - startedAtMs,
      params: { ...debug?.params, options: summarizeCompletionOptions(options) },
      request: streamRequest,
      response,
    });
    return response as { choices?: Array<{ message?: Record<string, unknown> }>; usage?: ModelUsage | null };
  }

  return processStreamResponse(
    callbacks,
    response,
    streamRequest,
    options,
    requestId,
    startedAt,
    startedAtMs,
    sessionId,
    transport,
    progressModel,
    debug
  );
}

async function processStreamResponse(
  callbacks: ChatCompletionStreamCallbacks,
  response: unknown,
  streamRequest: Record<string, unknown>,
  options: Record<string, unknown> | undefined,
  requestId: string,
  startedAt: string,
  startedAtMs: number,
  sessionId: string | undefined,
  transport: "stream",
  progressModel: string | undefined,
  debug?: ChatCompletionDebugOptions
): Promise<{ choices?: Array<{ message?: Record<string, unknown> }>; usage?: ModelUsage | null }> {
  let content = "";
  let reasoningContent = "";
  let refusal: string | null = null;
  let usage: ModelUsage | null = null;
  const responseChunks: unknown[] = [];
  let estimatedTokens = 0;
  const toolCallsByIndex = new Map<
    number,
    { id?: string; type?: string; function?: { name?: string; arguments?: string } }
  >();

  const trackText = (value: unknown) => {
    if (typeof value !== "string" || value.length === 0) return;
    estimatedTokens += estimateStreamTokens(value);
    emitLlmStreamProgress(callbacks, requestId, startedAt, estimatedTokens, "update", sessionId, transport);
  };

  try {
    for await (const chunk of response as AsyncIterable<Record<string, unknown>>) {
      if (debug?.enabled) responseChunks.push(chunk);
      if ("usage" in chunk && chunk.usage != null) usage = chunk.usage as ModelUsage;

      const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
      for (const choice of choices) {
        const delta = isUsageRecord(choice) && isUsageRecord(choice.delta) ? choice.delta : null;
        if (!delta) continue;

        const contentDelta = delta.content;
        if (typeof contentDelta === "string") {
          content += contentDelta;
          trackText(contentDelta);
        }

        const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
        if (typeof reasoningDelta === "string") {
          reasoningContent += reasoningDelta;
          trackText(reasoningDelta);
        }

        if (typeof delta.refusal === "string") {
          refusal = `${refusal ?? ""}${delta.refusal}`;
          trackText(delta.refusal);
        }

        const rawToolCalls = delta.tool_calls;
        if (Array.isArray(rawToolCalls)) {
          for (const rawToolCall of rawToolCalls) {
            if (!isUsageRecord(rawToolCall)) continue;
            const index = typeof rawToolCall.index === "number" ? rawToolCall.index : toolCallsByIndex.size;
            const current = toolCallsByIndex.get(index) ?? {};
            if (typeof rawToolCall.id === "string") current.id = rawToolCall.id;
            if (typeof rawToolCall.type === "string") current.type = rawToolCall.type;
            const rawFunction = isUsageRecord(rawToolCall.function) ? rawToolCall.function : null;
            if (rawFunction) {
              current.function = current.function ?? {};
              if (typeof rawFunction.name === "string") {
                current.function.name = `${current.function.name ?? ""}${rawFunction.name}`;
                trackText(rawFunction.name);
              }
              if (typeof rawFunction.arguments === "string") {
                current.function.arguments = `${current.function.arguments ?? ""}${rawFunction.arguments}`;
                trackText(rawFunction.arguments);
              }
            }
            toolCallsByIndex.set(index, current);
          }
        }
      }
    }
  } catch (error) {
    logChatCompletionDebug(debug, {
      timestamp: new Date().toISOString(),
      location: debug?.location ?? "createChatCompletionStream:stream",
      requestId,
      sessionId,
      model: typeof streamRequest.model === "string" ? streamRequest.model : undefined,
      baseURL: debug?.baseURL,
      durationMs: Date.now() - startedAtMs,
      params: { ...debug?.params, options: summarizeCompletionOptions(options) },
      request: streamRequest,
      responseChunks,
      error: normalizeDebugError(error),
    });
    logApiError({
      timestamp: new Date().toISOString(),
      location: "createChatCompletionStream:stream",
      requestId,
      sessionId,
      model: typeof streamRequest.model === "string" ? streamRequest.model : undefined,
      error: {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      request: streamRequest,
    });
    throw error;
  } finally {
    emitLlmStreamProgress(callbacks, requestId, startedAt, estimatedTokens, "end", sessionId, transport);
  }

  const toolCalls = Array.from(toolCallsByIndex.entries())
    .sort(([left], [right]) => left - right)
    .map(([, toolCall]) => toolCall);
  const normalizedToolCalls = normalizeLlmToolCalls(toolCalls);
  const message: Record<string, unknown> = { content };
  if (normalizedToolCalls) message.tool_calls = normalizedToolCalls;
  if (reasoningContent.length > 0) message.reasoning_content = reasoningContent;
  if (refusal != null) message.refusal = refusal;

  const finalResponse = { choices: [{ message }], usage };
  logChatCompletionDebug(debug, {
    timestamp: new Date().toISOString(),
    location: debug?.location ?? "createChatCompletionStream",
    requestId,
    sessionId,
    model: typeof streamRequest.model === "string" ? streamRequest.model : undefined,
    baseURL: debug?.baseURL,
    durationMs: Date.now() - startedAtMs,
    params: { ...debug?.params, options: summarizeCompletionOptions(options) },
    request: streamRequest,
    responseChunks,
    response: finalResponse,
  });
  return finalResponse;
}
