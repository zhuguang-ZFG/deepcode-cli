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
  error?: string;
};

const MAX_AGENT_ROUNDS = 20;
const DEFAULT_MAX_TOKENS = 16384;

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
      const content = await fs.readFile(filePath, "utf-8");
      const offset = Number(args.offset || 0);
      const limit = Number(args.limit || 2000);
      const lines = content.split("\n");
      return lines.slice(offset, offset + limit).join("\n");
    }
    case "write": {
      const filePath = String(args.file_path || "");
      const content = String(args.content || "");
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      if (dir) await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
      return `Written ${content.length} bytes to ${filePath}`;
    }
    case "edit": {
      const filePath = String(args.file_path || "");
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
  opts: { model?: string; maxTokens?: number } = {}
): Promise<{
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}> {
  const { resolveCurrentSettings } = await import("./ui/App");
  const settings = resolveCurrentSettings(projectRoot) as {
    env?: { BASE_URL?: string; API_KEY?: string };
    model?: string;
  };
  const baseURL = settings.env?.BASE_URL || "https://chat.donglicao.com/v1";
  const apiKey = settings.env?.API_KEY || "";
  const model = opts.model || settings.model || "lima";
  const maxTokens = opts.maxTokens || DEFAULT_MAX_TOKENS;

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0,
    tools: buildToolDefinitions(),
    tool_choice: "auto",
    stream: true,
  };

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LiMa Server ${response.status}: ${text.substring(0, 200)}`);
  }

  // Parse streaming SSE with tool_calls support
  let fullContent = "";
  const toolCallsMap: Record<string, { id: string; name: string; arguments: string }> = {};

  const reader = response.body?.getReader();
  if (!reader) {
    const data = (await response.json()) as Record<string, unknown>;
    const choice = (data.choices as Array<{ message?: Record<string, unknown> }>)?.[0];
    const msg = choice?.message as Record<string, unknown> | undefined;
    return {
      content: (msg?.content as string) || "",
      toolCalls: parseToolCalls(msg?.tool_calls),
    };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        const chunk = JSON.parse(line.slice(6));
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          fullContent += delta.content;
          process.stderr.write(delta.content);
        }
        // Accumulate tool_calls from streaming deltas
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const key = `tc_${idx}`;
            if (!toolCallsMap[key]) {
              toolCallsMap[key] = {
                id: tc.id || "",
                name: tc.function?.name || "",
                arguments: "",
              };
            }
            if (tc.id) toolCallsMap[key].id = tc.id;
            if (tc.function?.name) toolCallsMap[key].name = tc.function.name;
            if (tc.function?.arguments) toolCallsMap[key].arguments += tc.function.arguments;
          }
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
    arguments: tc.arguments ? JSON.parse(tc.arguments) : {},
  }));

  return { content: fullContent, toolCalls };
}

function parseToolCalls(raw: unknown): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((tc: Record<string, unknown>) => ({
    id: String(tc.id || ""),
    name: String((tc.function as Record<string, unknown>)?.name || ""),
    arguments:
      typeof (tc.function as Record<string, unknown>)?.arguments === "string"
        ? JSON.parse((tc.function as Record<string, unknown>).arguments as string)
        : ((tc.function as Record<string, unknown>)?.arguments as Record<string, unknown>) || {},
  }));
}

/**
 * Run agent loop: send prompt → LLM responds → execute tools → repeat.
 */
async function agentLoop(
  userPrompt: string,
  projectRoot: string,
  opts: { model?: string; maxTokens?: number; verbose?: boolean } = {}
): Promise<{ content: string; toolCalls: number }> {
  const systemPrompt = await buildSystemPrompt(projectRoot);
  const messages: ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: userPrompt });

  let totalToolCalls = 0;

  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    const { content, toolCalls } = await callLiMaWithTools(messages, projectRoot, opts);

    if (toolCalls.length === 0) {
      // LLM finished — no more tools to call
      return { content, toolCalls: totalToolCalls };
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

  return { content: "[Max agent rounds reached]", toolCalls: totalToolCalls };
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

  try {
    let content: string;
    let toolCalls = 0;

    // Route /lima commands to command runner
    if (prompt.trim().startsWith("/lima")) {
      content = await executeLiMaCommand(prompt.trim(), projectRoot);
    } else {
      // Agent loop with tool_use
      const result = await agentLoop(prompt, projectRoot, {
        verbose: options.verbose,
      });
      content = result.content;
      toolCalls = result.toolCalls;
    }

    content = content.trim();

    const result: HeadlessResult = {
      ok: true,
      content,
      sessionId: "",
      toolCalls,
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
