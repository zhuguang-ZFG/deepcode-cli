/**
 * Headless execution engine — runs a single prompt without Ink TUI.
 * Calls LiMa Server API directly (non-streaming) for clean responses.
 */

export type HeadlessResult = {
  ok: boolean;
  content: string;
  sessionId: string;
  error?: string;
};

/**
 * Call LiMa Server API directly (non-streaming).
 * This avoids streaming path thinking contamination.
 */
async function callLiMaServer(prompt: string, projectRoot: string): Promise<string> {
  const { resolveCurrentSettings } = await import("./ui/App");
  const settings = resolveCurrentSettings(projectRoot) as {
    env?: { BASE_URL?: string; API_KEY?: string };
    model?: string;
  };
  const baseURL = settings.env?.BASE_URL || "https://chat.donglicao.com/v1";
  const apiKey = settings.env?.API_KEY || "";

  const url = `${baseURL}/chat/completions`;
  const body = {
    model: settings.model || "lima-1.3",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 2000,
    temperature: 0,
    stream: false,
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

  const data = (await response.json()) as Record<string, unknown>;
  const choices = data.choices as Array<{ message?: Record<string, unknown> }> | undefined;
  return (choices?.[0]?.message?.content as string) || "";
}

/**
 * Run a single prompt in headless mode and return the result.
 * Uses non-streaming path to avoid thinking contamination.
 */
export async function runHeadless(
  prompt: string,
  options: { json: boolean; projectRoot?: string }
): Promise<HeadlessResult> {
  const projectRoot = options.projectRoot || process.cwd();

  try {
    const raw = await callLiMaServer(prompt, projectRoot);
    const content = raw.trim();

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
    const result: HeadlessResult = { ok: false, content: "", sessionId: "", error: msg };

    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stderr.write(`Error: ${msg}\n`);
    }

    return result;
  }
}
