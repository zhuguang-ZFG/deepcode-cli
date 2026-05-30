/**
 * Headless agent engine — runs coding tasks without Ink TUI.
 *
 * Supports: tool_use loop, conversation memory, project context injection,
 * streaming output, /lima command routing.
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type HeadlessResult = {
  ok: boolean;
  content: string;
  sessionId: string;
  toolCalls: number;
  telemetry: HeadlessTelemetry;
  error?: string;
};

export type HeadlessToolProtocol = "none" | "openai" | "anthropic" | "mixed";

export type HeadlessModelCallTelemetry = {
  attempt: number;
  phase: "chat";
  stream: boolean;
  timeoutMs: number;
  latencyMs: number;
  ok: boolean;
  status?: number;
  error?: string;
  contentChars: number;
  toolCalls: number;
  toolProtocol: HeadlessToolProtocol;
};

export type HeadlessOutcomeTelemetry = {
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
};

export type HeadlessTelemetry = {
  timeoutMs: number;
  maxRetries: number;
  retryCount: number;
  modelCalls: HeadlessModelCallTelemetry[];
  toolCapability: {
    requested: boolean;
    observed: boolean;
    protocol: HeadlessToolProtocol;
    toolCalls: number;
    unsupportedReason?: string;
  };
  outcomeReport?: HeadlessOutcomeTelemetry;
};

const MAX_AGENT_ROUNDS = 20;
const DEFAULT_MAX_TOKENS = 16384;
const DEFAULT_MODEL_TIMEOUT_MS = 90_000;
const DEFAULT_MODEL_RETRIES = 1;

// Safety: commands that must never be executed
const BLOCKED_COMMANDS =
  /^\s*(rm\s+-rf|mkfs|dd\s+if=|shutdown|reboot|halt|poweroff|sudo|su\s+|killall|pkill|nc\s|ncat|socat)\b/;

type HeadlessToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

type StreamingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

type LiMaCallResult = {
  content: string;
  toolCalls: HeadlessToolCall[];
  toolProtocol: HeadlessToolProtocol;
};

function createHeadlessTelemetry(): HeadlessTelemetry {
  return {
    timeoutMs: readPositiveIntEnv("LIMA_CODE_HEADLESS_TIMEOUT_MS", DEFAULT_MODEL_TIMEOUT_MS),
    maxRetries: readPositiveIntEnv("LIMA_CODE_HEADLESS_RETRIES", DEFAULT_MODEL_RETRIES),
    retryCount: 0,
    modelCalls: [],
    toolCapability: {
      requested: false,
      observed: false,
      protocol: "none",
      toolCalls: 0,
    },
  };
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name && error.name !== "Error" ? `${error.name}: ${error.message}` : error.message;
  }
  return String(error);
}

function classifyTelemetryError(error: unknown): string | undefined {
  const text = normalizeError(error).toLowerCase();
  if (!text) return undefined;
  if (text.includes("timeout") || text.includes("abort")) return "timeout";
  if (text.includes("401") || text.includes("403") || text.includes("forbidden") || text.includes("unauthorized")) {
    return "auth";
  }
  if (text.includes("429") || text.includes("rate") || text.includes("quota")) return "rate_limit";
  if (text.includes("reset") || text.includes("network") || text.includes("connect")) return "network_or_provider";
  return "provider_error";
}

function mergeToolProtocol(left: HeadlessToolProtocol, right: HeadlessToolProtocol): HeadlessToolProtocol {
  if (left === "none") return right;
  if (right === "none" || left === right) return left;
  return "mixed";
}

function updateToolCapability(telemetry: HeadlessTelemetry, result: LiMaCallResult): void {
  if (result.toolCalls.length > 0) {
    telemetry.toolCapability.observed = true;
    telemetry.toolCapability.protocol = mergeToolProtocol(telemetry.toolCapability.protocol, result.toolProtocol);
    telemetry.toolCapability.toolCalls += result.toolCalls.length;
    delete telemetry.toolCapability.unsupportedReason;
    return;
  }
  if (!telemetry.toolCapability.observed) {
    telemetry.toolCapability.unsupportedReason = "model_completed_without_tool_call";
  }
}

/**
 * Validate a bash command against safety rules.
 * Returns null if safe, or an error message if blocked.
 */
function validateCommand(command: string): string | null {
  if (BLOCKED_COMMANDS.test(command)) {
    return `BLOCKED: dangerous command detected: "${command.split(/\s/)[0]}"`;
  }
  if (command.includes("sudo ") || command.includes("su ")) {
    return "BLOCKED: sudo/su not allowed";
  }
  return null;
}

/**
 * Validate a file path is within the project sandbox.
 */
function validateFilePath(filePath: string, projectRoot: string): string | null {
  const resolved = require("path").resolve(filePath);
  const root = require("path").resolve(projectRoot);
  if (!resolved.startsWith(root + require("path").sep) && resolved !== root) {
    return `BLOCKED: path "${filePath}" escapes project root`;
  }
  return null;
}

/**
 * Build system prompt with project context (AGENTS.md / CLAUDE.md).
 */
async function buildSystemPrompt(projectRoot: string): Promise<string> {
  const fs = await import("fs/promises");

  const parts: string[] = [];
  const contextFiles = ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md"];

  for (const file of contextFiles) {
    try {
      const content = await fs.readFile(projectRoot + "/" + file, "utf-8");
      if (content.trim()) {
        parts.push(`# ${file}\n${content.trim().slice(0, 4000)}`);
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  if (parts.length > 0) {
    return parts.join("\n\n---\n\n");
  }
  return "";
}

/**
 * Build tool definitions for the LLM (bash, read, write, edit).
 */
function buildToolDefinitions() {
  return [
    {
      type: "function" as const,
      function: {
        name: "bash",
        description: "Execute a shell command and return its output.",
        parameters: {
          type: "object" as const,
          properties: {
            command: { type: "string", description: "Shell command to execute" },
            timeout: { type: "number", description: "Timeout in seconds (default 30)" },
          },
          required: ["command"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "read",
        description: "Read a file's contents.",
        parameters: {
          type: "object" as const,
          properties: {
            file_path: { type: "string", description: "Absolute file path" },
            offset: { type: "number", description: "Line offset" },
            limit: { type: "number", description: "Max lines to read" },
          },
          required: ["file_path"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "write",
        description: "Write content to a file.",
        parameters: {
          type: "object" as const,
          properties: {
            file_path: { type: "string", description: "Absolute file path" },
            content: { type: "string", description: "File content to write" },
          },
          required: ["file_path", "content"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "edit",
        description: "Edit a file by replacing a specific string.",
        parameters: {
          type: "object" as const,
          properties: {
            file_path: { type: "string", description: "Absolute file path" },
            old_string: { type: "string", description: "Text to find and replace" },
            new_string: { type: "string", description: "Replacement text" },
          },
          required: ["file_path", "old_string", "new_string"],
        },
      },
    },
  ];
}

/**
 * Execute a tool call locally.
 */
async function executeTool(name: string, args: Record<string, unknown>, projectRoot: string): Promise<string> {
  const fs = await import("fs/promises");
  const { execSync } = await import("child_process");

  switch (name) {
    case "bash": {
      const command = String(args.command || "");
      const blockReason = validateCommand(command);
      if (blockReason) return blockReason;
      const timeout = Number(args.timeout || 30) * 1000;
      try {
        const output = execSync(command, {
          cwd: projectRoot,
          timeout,
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return output.slice(0, 30000) || "(no output)";
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Exit 1: ${msg.slice(0, 5000)}`;
      }
    }
    case "read": {
      const filePath = String(args.file_path || "");
      const pathErr = validateFilePath(filePath, projectRoot);
      if (pathErr) return pathErr;
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const offset = Number(args.offset || 0);
        const limit = Number(args.limit || 2000);
        const lines = content.split("\n");
        return lines.slice(offset, offset + limit).join("\n");
      } catch (err: unknown) {
        return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    case "write": {
      const filePath = String(args.file_path || "");
      const pathErr = validateFilePath(filePath, projectRoot);
      if (pathErr) return pathErr;
      const content = String(args.content || "");
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      if (dir) await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
      return `Written ${content.length} bytes to ${filePath}`;
    }
    case "edit": {
      const filePath = String(args.file_path || "");
      const pathErr = validateFilePath(filePath, projectRoot);
      if (pathErr) return pathErr;
      const oldStr = String(args.old_string || "");
      const newStr = String(args.new_string || "");
      let content = await fs.readFile(filePath, "utf-8");
      if (!content.includes(oldStr)) {
        return `ERROR: old_string not found in ${filePath}`;
      }
      content = content.replace(oldStr, newStr);
      await fs.writeFile(filePath, content, "utf-8");
      return `OK: edited ${filePath}`;
    }
    default:
      return `ERROR: unknown tool "${name}"`;
  }
}

/**
 * Call LiMa Server with tool_use support.
 * Returns assistant message with optional tool_calls.
 */
async function callLiMaWithTools(
  messages: ChatCompletionMessageParam[],
  projectRoot: string,
  opts: { model?: string; maxTokens?: number; sessionId?: string; telemetry: HeadlessTelemetry }
): Promise<LiMaCallResult> {
  const { resolveCurrentSettings } = await import("./ui/App");
  const settings = resolveCurrentSettings(projectRoot) as {
    env?: { BASE_URL?: string; API_KEY?: string };
    model?: string;
  };
  const baseURL = settings.env?.BASE_URL || "https://chat.donglicao.com/v1";
  const apiKey = settings.env?.API_KEY || "";
  const model = opts.model || settings.model || "lima";
  const maxTokens = opts.maxTokens || DEFAULT_MAX_TOKENS;
  const stream = false;

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0,
    tools: buildToolDefinitions(),
    tool_choice: "auto",
    stream,
  };
  opts.telemetry.toolCapability.requested = true;

  for (let attempt = 1; attempt <= opts.telemetry.maxRetries + 1; attempt++) {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-Session-ID": opts.sessionId || "",
          "X-Project-Root": projectRoot,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.telemetry.timeoutMs),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LiMa Server ${response.status}: ${text.substring(0, 200)}`);
      }

      const parsed = await parseLiMaResponse(response);
      opts.telemetry.modelCalls.push({
        attempt,
        phase: "chat",
        stream,
        timeoutMs: opts.telemetry.timeoutMs,
        latencyMs: Date.now() - startedAt,
        ok: true,
        status: response.status,
        contentChars: parsed.content.length,
        toolCalls: parsed.toolCalls.length,
        toolProtocol: parsed.toolProtocol,
      });
      updateToolCapability(opts.telemetry, parsed);
      return parsed;
    } catch (error) {
      opts.telemetry.modelCalls.push({
        attempt,
        phase: "chat",
        stream,
        timeoutMs: opts.telemetry.timeoutMs,
        latencyMs: Date.now() - startedAt,
        ok: false,
        error: normalizeError(error),
        contentChars: 0,
        toolCalls: 0,
        toolProtocol: "none",
      });
      if (attempt > opts.telemetry.maxRetries) {
        throw error;
      }
      opts.telemetry.retryCount++;
    }
  }

  throw new Error("LiMa Server model call failed without an error");
}

async function parseLiMaResponse(response: Response): Promise<LiMaCallResult> {
  // Parse streaming SSE with tool_calls support
  let fullContent = "";
  let rawStreamText = "";
  const toolCallsMap: Record<string, StreamingToolCall> = {};
  let toolProtocol: HeadlessToolProtocol = "none";

  const reader = response.body?.getReader();
  if (!reader) {
    const data = (await response.json()) as Record<string, unknown>;
    const choice = (data.choices as Array<{ message?: Record<string, unknown> }>)?.[0];
    const msg = choice?.message as Record<string, unknown> | undefined;
    const toolCalls = parseToolCalls(msg?.tool_calls);
    return {
      content: (msg?.content as string) || "",
      toolCalls,
      toolProtocol: toolCalls.length > 0 ? "openai" : "none",
    };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunkText = decoder.decode(value, { stream: true });
    rawStreamText += chunkText;
    buffer += chunkText;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const dataText = line.replace(/^data:\s?/, "");
      if (dataText === "[DONE]") continue;
      try {
        const chunk = JSON.parse(dataText) as Record<string, unknown>;
        const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : null;
        const delta = isRecord(choice) && isRecord(choice.delta) ? choice.delta : null;
        if (typeof delta?.content === "string") {
          fullContent += delta.content;
          process.stderr.write(delta.content);
        }
        // Accumulate tool_calls from streaming deltas
        if (Array.isArray(delta?.tool_calls)) {
          for (const tc of delta.tool_calls) {
            if (!isRecord(tc)) continue;
            const idx = typeof tc.index === "number" ? tc.index : 0;
            const key = `tc_${idx}`;
            if (!toolCallsMap[key]) {
              toolCallsMap[key] = {
                id: typeof tc.id === "string" ? tc.id : "",
                name: "",
                arguments: "",
              };
            }
            const fn = isRecord(tc.function) ? tc.function : null;
            if (typeof tc.id === "string") toolCallsMap[key].id = tc.id;
            if (typeof fn?.name === "string") toolCallsMap[key].name = fn.name;
            if (typeof fn?.arguments === "string") toolCallsMap[key].arguments += fn.arguments;
            toolProtocol = mergeToolProtocol(toolProtocol, "openai");
          }
        }

        const anthropicTextDelta = parseAnthropicTextDelta(chunk);
        if (anthropicTextDelta) {
          fullContent += anthropicTextDelta;
          process.stderr.write(anthropicTextDelta);
        }

        const anthropicToolStart = parseAnthropicToolStart(chunk);
        if (anthropicToolStart) {
          const key = `ant_${anthropicToolStart.index}`;
          toolCallsMap[key] = {
            id: anthropicToolStart.id,
            name: anthropicToolStart.name,
            arguments: anthropicToolStart.input ? JSON.stringify(anthropicToolStart.input) : "",
          };
          toolProtocol = mergeToolProtocol(toolProtocol, "anthropic");
        }

        const anthropicToolDelta = parseAnthropicToolDelta(chunk);
        if (anthropicToolDelta) {
          const key = `ant_${anthropicToolDelta.index}`;
          if (!toolCallsMap[key]) {
            toolCallsMap[key] = { id: "", name: "", arguments: "" };
          }
          toolCallsMap[key].arguments += anthropicToolDelta.partialJson;
          toolProtocol = mergeToolProtocol(toolProtocol, "anthropic");
        }
      } catch {
        continue;
      }
    }
  }

  process.stderr.write("\n");

  // Parse accumulated tool_calls
  const toolCalls = Object.values(toolCallsMap).map((tc) => ({
    id: tc.id,
    name: tc.name,
    arguments: parseArgumentsJson(tc.arguments),
  }));

  if (!fullContent && toolCalls.length === 0) {
    const jsonResponse = parseChatCompletionJson(rawStreamText);
    if (jsonResponse) {
      return jsonResponse;
    }
  }

  return { content: fullContent, toolCalls, toolProtocol };
}

function parseChatCompletionJson(text: string): LiMaCallResult | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("data:")) {
    return null;
  }
  try {
    const data = JSON.parse(trimmed) as Record<string, unknown>;
    const choice = (data.choices as Array<{ message?: Record<string, unknown> }>)?.[0];
    const msg = choice?.message as Record<string, unknown> | undefined;
    const toolCalls = parseToolCalls(msg?.tool_calls);
    return {
      content: (msg?.content as string) || "",
      toolCalls,
      toolProtocol: toolCalls.length > 0 ? "openai" : "none",
    };
  } catch {
    return null;
  }
}

function parseToolCalls(raw: unknown): HeadlessToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((tc: Record<string, unknown>) => ({
    id: String(tc.id || ""),
    name: String((tc.function as Record<string, unknown>)?.name || ""),
    arguments:
      typeof (tc.function as Record<string, unknown>)?.arguments === "string"
        ? parseArgumentsJson((tc.function as Record<string, unknown>).arguments as string)
        : ((tc.function as Record<string, unknown>)?.arguments as Record<string, unknown>) || {},
  }));
}

function parseArgumentsJson(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseAnthropicTextDelta(chunk: Record<string, unknown>): string {
  if (chunk.type !== "content_block_delta") return "";
  const delta = isRecord(chunk.delta) ? chunk.delta : null;
  if (!delta || delta.type !== "text_delta") return "";
  return typeof delta.text === "string" ? delta.text : "";
}

function parseAnthropicToolStart(
  chunk: Record<string, unknown>
): { index: number; id: string; name: string; input: Record<string, unknown> | null } | null {
  if (chunk.type !== "content_block_start") return null;
  const contentBlock = isRecord(chunk.content_block) ? chunk.content_block : null;
  if (!contentBlock || contentBlock.type !== "tool_use") return null;
  const index = typeof chunk.index === "number" ? chunk.index : 0;
  return {
    index,
    id: typeof contentBlock.id === "string" ? contentBlock.id : "",
    name: typeof contentBlock.name === "string" ? contentBlock.name : "",
    input: isRecord(contentBlock.input) ? contentBlock.input : null,
  };
}

function parseAnthropicToolDelta(chunk: Record<string, unknown>): { index: number; partialJson: string } | null {
  if (chunk.type !== "content_block_delta") return null;
  const delta = isRecord(chunk.delta) ? chunk.delta : null;
  if (!delta || delta.type !== "input_json_delta") return null;
  const partialJson = typeof delta.partial_json === "string" ? delta.partial_json : "";
  if (!partialJson) return null;
  return {
    index: typeof chunk.index === "number" ? chunk.index : 0,
    partialJson,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Report task outcome to LiMa Server for learning.
 */
async function reportOutcome(
  sessionId: string,
  backend: string,
  success: boolean,
  latencyMs: number,
  projectRoot: string,
  telemetry: HeadlessTelemetry
): Promise<HeadlessOutcomeTelemetry> {
  const startedAt = Date.now();
  try {
    const { resolveCurrentSettings } = await import("./ui/App");
    const settings = resolveCurrentSettings(projectRoot) as {
      env?: { BASE_URL?: string; API_KEY?: string };
    };
    const baseURL = settings.env?.BASE_URL || "https://chat.donglicao.com/v1";
    const apiKey = settings.env?.API_KEY || "";

    const response = await fetch(`${baseURL.replace("/v1", "")}/agent/learn/outcome`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        task_id: sessionId,
        backend,
        scenario: "coding",
        success,
        latency_ms: latencyMs,
        quality_score: success ? 0.8 : 0.2,
        telemetry: {
          timeoutMs: telemetry.timeoutMs,
          maxRetries: telemetry.maxRetries,
          retryCount: telemetry.retryCount,
          modelCalls: telemetry.modelCalls.map((call) => ({
            attempt: call.attempt,
            phase: call.phase,
            stream: call.stream,
            timeoutMs: call.timeoutMs,
            latencyMs: call.latencyMs,
            ok: call.ok,
            status: call.status,
            error: classifyTelemetryError(call.error),
            contentChars: call.contentChars,
            toolCalls: call.toolCalls,
            toolProtocol: call.toolProtocol,
          })),
          toolCapability: telemetry.toolCapability,
        },
      }),
      signal: AbortSignal.timeout(5000),
    });

    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      error: response.ok ? undefined : (await response.text()).slice(0, 200),
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: normalizeError(error),
    };
  }
}

/**
 * Verify response quality — detect obvious errors.
 */
function verifyResponseQuality(content: string): { ok: boolean; warning?: string } {
  if (!content || content.length < 5) {
    return { ok: false, warning: "Response is too short" };
  }
  if (content.includes("Traceback (most recent call last)")) {
    return { ok: false, warning: "Response contains Python traceback" };
  }
  if (content.includes("Error:") && content.includes("undefined")) {
    return { ok: false, warning: "Response contains undefined error" };
  }
  return { ok: true };
}

/**
 * Run agent loop: send prompt → LLM responds → execute tools → repeat.
 */
async function agentLoop(
  userPrompt: string,
  projectRoot: string,
  opts: { model?: string; maxTokens?: number; verbose?: boolean; telemetry: HeadlessTelemetry }
): Promise<{ content: string; toolCalls: number; sessionId: string }> {
  const systemPrompt = await buildSystemPrompt(projectRoot);
  const sessionId = `hls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const messages: ChatCompletionMessageParam[] = [];
  const loopStartedAt = Date.now();

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: userPrompt });

  let totalToolCalls = 0;

  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    const { content, toolCalls } = await callLiMaWithTools(messages, projectRoot, { ...opts, sessionId });

    if (toolCalls.length === 0) {
      // LLM finished — verify quality before returning
      const quality = verifyResponseQuality(content);
      if (!quality.ok && opts.verbose) {
        process.stderr.write(`\n[quality] WARNING: ${quality.warning}\n`);
      }
      // Report outcome to server for learning
      opts.telemetry.outcomeReport = await reportOutcome(
        sessionId,
        "cli-agent",
        quality.ok,
        Date.now() - loopStartedAt,
        projectRoot,
        opts.telemetry
      );
      return { content, toolCalls: totalToolCalls, sessionId };
    }

    // Add assistant message with tool_calls to history
    messages.push({
      role: "assistant",
      content: content || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      })),
    });

    // Execute each tool and add results
    for (const tc of toolCalls) {
      totalToolCalls++;
      if (opts.verbose) {
        process.stderr.write(`\n[tool] ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 100)})\n`);
      }

      let result: string;
      try {
        result = await executeTool(tc.name, tc.arguments, projectRoot);
      } catch (err) {
        result = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      }

      // Show diff for write/edit operations
      if (((tc.name === "write" || tc.name === "edit") && result.startsWith("OK:")) || result.startsWith("Written")) {
        try {
          const filePath = String(tc.arguments.file_path || "");
          if (filePath) {
            const { execSync } = await import("child_process");
            const diff = execSync(`git diff --no-color -- "${filePath}" 2>/dev/null || true`, {
              cwd: projectRoot,
              encoding: "utf-8",
              timeout: 5000,
            }).trim();
            if (diff) {
              process.stderr.write(`\n[diff] ${filePath}:\n${diff.slice(0, 2000)}\n`);
            }
          }
        } catch {
          // Diff not available (file not in git)
        }
      }

      if (opts.verbose) {
        process.stderr.write(`[result] ${result.slice(0, 200)}\n`);
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result.slice(0, 50000), // Truncate very long outputs
      });
    }
  }

  return { content: "[Max agent rounds reached]", toolCalls: totalToolCalls, sessionId };
}

/**
 * Route /lima commands through the command runner.
 */
async function executeLiMaCommand(input: string, projectRoot: string): Promise<string> {
  const { executeLiMaCommand: runCmd } = await import("./lima/command-runner");
  const { LiMaAgentTaskClient } = await import("./lima/agent-task-client");

  const client = new LiMaAgentTaskClient();
  const result = await runCmd(input, {
    projectRoot,
    client: client.isConfigured() ? client : undefined,
  });

  return result.message || (result.ok ? "OK" : "Failed");
}

/**
 * Run a prompt in headless mode with full agent capabilities.
 * Supports tool_use loop, conversation memory, and project context.
 */
export async function runHeadless(
  prompt: string,
  options: { json: boolean; projectRoot?: string; verbose?: boolean }
): Promise<HeadlessResult> {
  const projectRoot = options.projectRoot || process.cwd();
  const telemetry = createHeadlessTelemetry();

  try {
    let content: string;
    let toolCalls = 0;
    let sessionId = "";

    // Route /lima commands to command runner
    if (prompt.trim().startsWith("/lima")) {
      content = await executeLiMaCommand(prompt.trim(), projectRoot);
    } else {
      // Agent loop with tool_use
      const result = await agentLoop(prompt, projectRoot, {
        verbose: options.verbose,
        telemetry,
      });
      content = result.content;
      toolCalls = result.toolCalls;
      sessionId = result.sessionId;
    }

    content = content.trim();

    const result: HeadlessResult = {
      ok: true,
      content,
      sessionId,
      toolCalls,
      telemetry,
    };

    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stdout.write(result.content + "\n");
    }

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const result: HeadlessResult = {
      ok: false,
      content: "",
      sessionId: "",
      toolCalls: 0,
      telemetry,
      error: msg,
    };

    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stderr.write(`Error: ${msg}\n`);
    }

    return result;
  }
}
