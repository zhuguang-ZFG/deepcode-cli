/**
 * Headless execution engine — runs a single prompt without Ink TUI.
 * Used by `lima-code --headless -p "prompt"` and pipe mode.
 */
import type { SessionMessage } from "./session";
import { createHeadlessSession } from "./headless-session";

export type HeadlessResult = {
  ok: boolean;
  content: string;
  sessionId: string;
  error?: string;
};

/**
 * Run a single prompt in headless mode and return the result.
 */
export async function runHeadless(
  prompt: string,
  options: { json: boolean; projectRoot?: string }
): Promise<HeadlessResult> {
  const projectRoot = options.projectRoot || process.cwd();

  const collected: SessionMessage[] = [];
  const session = await createHeadlessSession(projectRoot, {
    onAssistantMessage: (msg) => collected.push(msg),
  });

  try {
    await session.handleUserPrompt({ text: prompt });

    // Find the last assistant message with content
    const lastAssistant = [...collected].reverse().find((m) => m.role === "assistant" && m.content);

    const content = lastAssistant?.content || "";

    const result: HeadlessResult = {
      ok: true,
      content: content.trim(),
      sessionId: "", // sessionId is private; not exposed in headless mode
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
