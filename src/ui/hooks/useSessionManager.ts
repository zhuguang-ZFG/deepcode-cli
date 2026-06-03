import { useLayoutEffect, useMemo } from "react";
import { createOpenAIClient } from "../../common/openai-client";
import { SessionManager, type SessionEntry, type SessionMessage, type LlmStreamProgress } from "../../session";
import { resolveCurrentSettings } from "../settings-io";
import { buildStatusLine } from "../session-status";
import { renderMessageToStdout } from "../components/MessageView/utils";
import { RawMode } from "../contexts";

export type SessionManagerCallbacks = {
  rawModeRef: React.MutableRefObject<RawMode>;
  setMessages: React.Dispatch<React.SetStateAction<SessionMessage[]>>;
  setActiveEntry: React.Dispatch<React.SetStateAction<SessionEntry | null>>;
  setStatusLine: React.Dispatch<React.SetStateAction<string>>;
  setRunningProcesses: React.Dispatch<React.SetStateAction<SessionEntry["processes"]>>;
  setActiveStatus: React.Dispatch<React.SetStateAction<SessionEntry["status"] | null>>;
  setStreamProgress: React.Dispatch<React.SetStateAction<LlmStreamProgress | null>>;
  setMcpStatuses: React.Dispatch<React.SetStateAction<ReturnType<SessionManager["getMcpStatus"]>>>;
  processStdoutRef: React.MutableRefObject<Map<number, string>>;
};

export function useSessionManager(projectRoot: string, callbacks: SessionManagerCallbacks): SessionManager {
  const sessionManager = useMemo(() => {
    return new SessionManager({
      projectRoot,
      createOpenAIClient: () => createOpenAIClient(projectRoot),
      getResolvedSettings: () => resolveCurrentSettings(projectRoot),
      renderMarkdown: (text) => text,
      onAssistantMessage: (message: SessionMessage) => {
        callbacks.setMessages((prev) => [...prev, message]);
        if (callbacks.rawModeRef.current === RawMode.Raw) {
          process.stdout.write("\n");
          process.stdout.write(renderMessageToStdout(message, callbacks.rawModeRef.current) + "\n\n");
        }
      },
      onSessionEntryUpdated: (entry) => {
        callbacks.setActiveEntry(entry);
        callbacks.setStatusLine(buildStatusLine(entry));
        callbacks.setRunningProcesses(entry.processes);
        callbacks.setActiveStatus(entry.status);
      },
      onLlmStreamProgress: (progress) => {
        if (progress.phase === "end") {
          callbacks.setStreamProgress(null);
          return;
        }
        callbacks.setStreamProgress(progress);
      },
      onMcpStatusChanged: () => {
        callbacks.setMcpStatuses(sessionManager.getMcpStatus());
      },
      onProcessStdout: (pid, chunk) => {
        const buf = callbacks.processStdoutRef.current;
        const current = buf.get(pid) ?? "";
        const MAX_STDOUT_BUFFER = 1_000_000;
        if (current.length >= MAX_STDOUT_BUFFER) {
          return;
        }
        const text = typeof chunk === "string" ? chunk : String(chunk);
        const available = MAX_STDOUT_BUFFER - current.length;
        buf.set(pid, current + text.slice(0, available));
      },
    });
  }, [projectRoot]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const settings = resolveCurrentSettings(projectRoot);
    void sessionManager.initMcpServers(settings.mcpServers);
  }, [projectRoot, sessionManager]);

  return sessionManager;
}
