/**
 * Headless execution engine — runs prompts without Ink TUI.
 * Supports chat, coding, and /lima commands with streaming output.
 */

export type HeadlessResult = {
  ok: boolean;
  content: string;
  sessionId: string;
  error?: string;
};

/**
 * Call LiMa Server with streaming support for lower first-token latency.
 * Server-side routing handles scenario detection and backend selection.
 */
async function callLiMaServer(
  prompt: string,
  projectRoot: string,
  opts: { model?: string; maxTokens?: number } = {}
): Promise<string> {
  const { resolveCurrentSettings } = await import("./ui/App");
  const settings = resolveCurrentSettings(projectRoot) as {
    env?: { BASE_URL?: string; API_KEY?: string };
    model?: string;
  };
  const baseURL = settings.env?.BASE_URL || "https://chat.donglicao.com/v1";
  const apiKey = settings.env?.API_KEY || "";

  // Use lima model — server-side routing detects scenario and picks backend
  const model = opts.model || settings.model || "lima";

  // Adaptive max_tokens by prompt length (longer prompts → more output)
  const maxTokens = opts.maxTokens || (prompt.length > 500 ? 16384 : prompt.length > 200 ? 8192 : 4096);

  const url = `${baseURL}/chat/completions`;
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens,
    temperature: 0,
    stream: true,
  };

  const response = await fetch(url, {
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

  // Stream SSE response, output chunks progressively
  let fullContent = "";
  const reader = response.body?.getReader();
  if (!reader) {
    const data = (await response.json()) as Record<string, unknown>;
    const choices = data.choices as Array<{ message?: Record<string, unknown> }> | undefined;
    return (choices?.[0]?.message?.content as string) || "";
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
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) {
          fullContent += content;
          process.stderr.write(content);
        }
      } catch {
        // Skip unparseable chunks
      }
    }
  }
  process.stderr.write("\n");
  return fullContent || "No response";
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
 * Run a single prompt in headless mode.
 * Routes /lima commands to command runner, everything else to LiMa Server.
 */
export async function runHeadless(
  prompt: string,
  options: { json: boolean; projectRoot?: string }
): Promise<HeadlessResult> {
  const projectRoot = options.projectRoot || process.cwd();

  try {
    let content: string;

    // Route /lima commands to command runner
    if (prompt.trim().startsWith("/lima")) {
      content = await executeLiMaCommand(prompt.trim(), projectRoot);
    } else {
      content = await callLiMaServer(prompt, projectRoot);
    }

    content = content.trim();

    const result: HeadlessResult = {
      ok: true,
      content,
      sessionId: "",
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
