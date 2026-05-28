/**
 * Headless SessionManager factory — creates a SessionManager without Ink TUI.
 * Used by agent/programmatic mode (--headless flag).
 */
import type { SessionManager, SessionMessage } from "./session";
import { createOpenAIClient } from "./common/openai-client";

type HeadlessCallbacks = {
  onAssistantMessage?: (message: SessionMessage) => void;
};

/**
 * Create a SessionManager that works without a terminal.
 * All TUI callbacks default to no-ops.
 */
export async function createHeadlessSession(
  projectRoot: string,
  callbacks: HeadlessCallbacks = {}
): Promise<SessionManager> {
  const sessionMod = await import("./session");
  const { resolveCurrentSettings } = await import("./ui/App");

  const client = createOpenAIClient(projectRoot);

  const collected: SessionMessage[] = [];

  return new sessionMod.SessionManager({
    projectRoot,
    createOpenAIClient: () => client,
    getResolvedSettings: () => resolveCurrentSettings(projectRoot),
    renderMarkdown: (text: string) => text,
    onAssistantMessage: (message: SessionMessage, _shouldConnect: boolean) => {
      collected.push(message);
      callbacks.onAssistantMessage?.(message);
    },
    onLlmStreamProgress: () => {},
    onSessionEntryUpdated: () => {},
    onMcpStatusChanged: () => {},
    onProcessStdout: () => {},
  });
}
