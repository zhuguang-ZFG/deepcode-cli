import { useCallback } from "react";
import chalk from "chalk";
import type { SessionManager } from "../../session";
import { type SessionEntry, type SessionMessage, type UndoTarget } from "../../session";
import type { UndoRestoreMode } from "../UndoSelector";
import type { PromptDraft } from "../PromptInput";
import { renderMessageToStdout } from "../components/MessageView/utils";
import { RawMode } from "../contexts";
import { buildStatusLine } from "../session-status";

type View = "chat" | "session-list" | "undo" | "mcp-status";

export type ViewActionDeps = {
  sessionManager: SessionManager;
  rawModeRef: React.MutableRefObject<RawMode>;
  setMode: (mode: RawMode) => void;
  refreshSkills: (sessionId?: string) => Promise<void>;
  refreshSessionsList: () => void;
  loadVisibleMessages: (manager: SessionManager, sessionId: string) => SessionMessage[];
  setMessages: React.Dispatch<React.SetStateAction<SessionMessage[]>>;
  setShowWelcome: React.Dispatch<React.SetStateAction<boolean>>;
  setWelcomeNonce: React.Dispatch<React.SetStateAction<number>>;
  setView: React.Dispatch<React.SetStateAction<View>>;
  setErrorLine: React.Dispatch<React.SetStateAction<string | null>>;
  setStatusLine: React.Dispatch<React.SetStateAction<string>>;
  setActiveEntry: React.Dispatch<React.SetStateAction<SessionEntry | null>>;
  setRunningProcesses: React.Dispatch<React.SetStateAction<SessionEntry["processes"]>>;
  setActiveStatus: React.Dispatch<React.SetStateAction<SessionEntry["status"] | null>>;
  setPromptDraft: React.Dispatch<React.SetStateAction<PromptDraft | null>>;
};

export function useViewActions(deps: ViewActionDeps) {
  const {
    sessionManager,
    rawModeRef,
    setMode,
    refreshSkills,
    refreshSessionsList,
    loadVisibleMessages,
    setMessages,
    setShowWelcome,
    setWelcomeNonce,
    setView,
    setErrorLine,
    setStatusLine,
    setActiveEntry,
    setRunningProcesses,
    setActiveStatus,
    setPromptDraft,
  } = deps;

  const reloadActiveSessionView = useCallback(
    (sessionId: string): void => {
      process.stdout.write("\u001B[2J\u001B[3J\u001B[H");
      setMessages([]);
      setShowWelcome(false);
      setWelcomeNonce((n: number) => n + 1);
      setTimeout(() => {
        setMessages(loadVisibleMessages(sessionManager, sessionId));
        setShowWelcome(true);
      }, 0);
    },
    [sessionManager, loadVisibleMessages]
  );

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      const currentSessionId = sessionManager.getActiveSessionId();
      if (currentSessionId !== sessionId) {
        process.stdout.write("\u001B[2J\u001B[3J\u001B[H");
      }
      sessionManager.setActiveSessionId(sessionId);
      setMessages([]);
      setShowWelcome(false);
      setWelcomeNonce((n: number) => n + 1);
      setView("chat");
      setTimeout(() => {
        setMessages(loadVisibleMessages(sessionManager, sessionId));
        setShowWelcome(true);
      }, 0);
      const session = sessionManager.getSession(sessionId);
      setStatusLine(session ? buildStatusLine(session) : "");
      setActiveEntry(session ?? null);
      setRunningProcesses(session?.processes ?? null);
      setActiveStatus(session?.status ?? null);
      await refreshSkills(sessionId);
    },
    [sessionManager, loadVisibleMessages, refreshSkills]
  );

  const handleUndoRestore = useCallback(
    async (target: UndoTarget, restoreMode: UndoRestoreMode): Promise<void> => {
      const sessionId = sessionManager.getActiveSessionId();
      if (!sessionId) {
        setErrorLine("No active session to undo.");
        setView("chat");
        setShowWelcome(true);
        return;
      }

      const errors: string[] = [];
      if (restoreMode === "code-and-conversation") {
        try {
          sessionManager.restoreSessionCode(sessionId, target.message.id);
        } catch (error) {
          errors.push(`代码恢复失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      let conversationRestored = false;
      try {
        sessionManager.restoreSessionConversation(sessionId, target.message.id);
        conversationRestored = true;
      } catch (error) {
        errors.push(`会话恢复失败: ${error instanceof Error ? error.message : String(error)}`);
      }

      refreshSessionsList();
      await refreshSkills(sessionId);
      setView("chat");
      setErrorLine(errors.length > 0 ? errors.join(" ") : null);
      if (conversationRestored) {
        setPromptDraft(buildPromptDraftFromSessionMessage(target.message, Date.now()));
      }
      reloadActiveSessionView(sessionId);
    },
    [reloadActiveSessionView, refreshSessionsList, refreshSkills, sessionManager]
  );

  const handleRawModeChange = useCallback(
    (nextMode: string) => {
      const activeSessionId = sessionManager.getActiveSessionId();
      setMode(nextMode as RawMode);
      setShowWelcome(false);
      setMessages([]);
      process.stdout.write("\u001B[2J\u001B[3J\u001B[H");

      setTimeout(() => {
        if (nextMode === RawMode.Raw) {
          const allMessages = activeSessionId ? loadVisibleMessages(sessionManager, activeSessionId) : [];
          for (const msg of allMessages) {
            process.stdout.write("\n");
            process.stdout.write(renderMessageToStdout(msg, nextMode) + "\n\n");
          }
          if (allMessages.length > 0) {
            process.stdout.write("\n\n");
            process.stdout.write(chalk.dim("按 ESC 退出原始模式"));
          } else {
            process.stdout.write("\n");
            process.stdout.write(chalk.dim("(当前会话还没有消息。发送一条消息后会显示在这里。)"));
            process.stdout.write("\n\n");
            process.stdout.write(chalk.dim("按 ESC 退出原始模式"));
          }
        } else if (activeSessionId) {
          handleSelectSession(activeSessionId);
        } else {
          setWelcomeNonce((n: number) => n + 1);
          setShowWelcome(true);
        }
      }, 200);
    },
    [handleSelectSession, sessionManager, setMode, loadVisibleMessages]
  );

  return { reloadActiveSessionView, handleSelectSession, handleUndoRestore, handleRawModeChange };
}

export function buildPromptDraftFromSessionMessage(message: SessionMessage, nonce: number): PromptDraft {
  return {
    nonce,
    text: typeof message.content === "string" ? message.content : "",
    imageUrls: extractImageUrlsFromContentParams(message.contentParams),
  };
}

function extractImageUrlsFromContentParams(contentParams: unknown): string[] {
  const params = Array.isArray(contentParams) ? contentParams : contentParams ? [contentParams] : [];
  const imageUrls: string[] = [];
  for (const param of params) {
    if (!param || typeof param !== "object") {
      continue;
    }
    const record = param as { type?: unknown; image_url?: { url?: unknown } };
    const url = record.image_url?.url;
    if (record.type === "image_url" && typeof url === "string" && url) {
      imageUrls.push(url);
    }
  }
  return imageUrls;
}
