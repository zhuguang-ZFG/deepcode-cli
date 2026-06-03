import { useCallback } from "react";
import { useApp } from "ink";
import chalk from "chalk";
import type { SessionManager } from "../../session";
import {
  type SessionEntry,
  type SessionMessage,
  type UndoTarget,
  type UserPromptContent,
  type SkillInfo,
} from "../../session";
import type { PromptSubmission } from "../PromptInput";
import { buildExitSummaryText } from "../exitSummary";
import { executeLiMaCommand } from "../../lima/command-runner";
import type { RawMode } from "../contexts";

export type PromptHandlerDeps = {
  projectRoot: string;
  onRestart?: () => void;
  sessionManager: SessionManager;
  rawModeRef: React.MutableRefObject<RawMode>;
  writeRef: React.MutableRefObject<(text: string) => void>;
  limaCommandAbortRef: React.MutableRefObject<AbortController | null>;
  refreshSkills: (sessionId?: string) => Promise<void>;
  refreshSessionsList: () => void;
  setMessages: React.Dispatch<React.SetStateAction<SessionMessage[]>>;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setErrorLine: React.Dispatch<React.SetStateAction<string | null>>;
  setStreamProgress: React.Dispatch<React.SetStateAction<import("../../session").LlmStreamProgress | null>>;
  setRunningProcesses: React.Dispatch<React.SetStateAction<SessionEntry["processes"]>>;
  setActiveEntry: React.Dispatch<React.SetStateAction<SessionEntry | null>>;
  setActiveStatus: React.Dispatch<React.SetStateAction<import("../../session").SessionStatus | null>>;
  setIsExiting: React.Dispatch<React.SetStateAction<boolean>>;
  setShowWelcome: React.Dispatch<React.SetStateAction<boolean>>;
  setWelcomeNonce: React.Dispatch<React.SetStateAction<number>>;
  setDismissedQuestionIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setView: React.Dispatch<React.SetStateAction<"chat" | "session-list" | "undo" | "mcp-status">>;
  setUndoTargets: React.Dispatch<React.SetStateAction<UndoTarget[]>>;
  setMcpStatuses: React.Dispatch<React.SetStateAction<import("../../mcp/mcp-manager").McpServerStatus[]>>;
  setStatusLine: React.Dispatch<React.SetStateAction<string>>;
  setShowProcessStdout: React.Dispatch<React.SetStateAction<boolean>>;
  processStdoutRef: React.MutableRefObject<Map<number, string>>;
};

export function usePromptHandler(deps: PromptHandlerDeps) {
  const { exit } = useApp();
  const {
    projectRoot,
    onRestart,
    sessionManager,
    rawModeRef,
    writeRef,
    limaCommandAbortRef,
    refreshSkills,
    refreshSessionsList,
    setMessages,
    setBusy,
    setErrorLine,
    setStreamProgress,
    setRunningProcesses,
    setActiveEntry,
    setActiveStatus,
    setIsExiting,
    setShowWelcome,
    setWelcomeNonce,
    setDismissedQuestionIds,
    setView,
    setUndoTargets,
    setMcpStatuses,
    setStatusLine,
    setShowProcessStdout,
    processStdoutRef,
  } = deps;

  const handlePrompt = useCallback(
    async (submission: PromptSubmission) => {
      if (submission.command === "exit") {
        setIsExiting(true);
        setTimeout(() => {
          const activeSessionId = sessionManager.getActiveSessionId();
          const session = activeSessionId ? sessionManager.getSession(activeSessionId) : null;
          const summary = buildExitSummaryText({ session });
          process.stdout.write("\n");
          process.stdout.write(chalk.rgb(34, 154, 195)("> /exit "));
          process.stdout.write("\n\n");
          process.stdout.write(summary);
          process.stdout.write("\n\n");
          sessionManager.dispose();
          exit();
        }, 0);
        return;
      }
      if (submission.command === "new") {
        if (onRestart) {
          onRestart();
        } else {
          writeRef.current("\u001B[2J\u001B[3J\u001B[H");
          sessionManager.setActiveSessionId(null);
          setMessages([]);
          setStatusLine("");
          setErrorLine(null);
          setActiveEntry(null);
          setRunningProcesses(null);
          setActiveStatus(null);
          setDismissedQuestionIds(new Set());
          setShowWelcome(true);
          setWelcomeNonce((n: number) => n + 1);
          await refreshSkills();
          refreshSessionsList();
        }
        return;
      }
      if (submission.command === "resume") {
        setShowWelcome(false);
        refreshSessionsList();
        setView("session-list");
        return;
      }
      if (submission.command === "continue" && isCurrentSessionEmpty(sessionManager)) {
        setShowWelcome(false);
        refreshSessionsList();
        setView("session-list");
        return;
      }
      if (submission.command === "undo") {
        const activeSessionId = sessionManager.getActiveSessionId();
        if (!activeSessionId) {
          setErrorLine("No active session to undo.");
          return;
        }
        setShowWelcome(false);
        setUndoTargets(sessionManager.listUndoTargets(activeSessionId));
        setView("undo");
        return;
      }
      if (submission.command === "mcp") {
        setShowWelcome(false);
        setMcpStatuses(sessionManager.getMcpStatus());
        setView("mcp-status");
        return;
      }
      if (submission.command === "lima") {
        setShowWelcome(false);
        setBusy(true);
        setErrorLine(null);
        setMessages((prev) => [...prev, buildSyntheticUserMessage(submission.text, 0)]);
        const abortController = new AbortController();
        limaCommandAbortRef.current = abortController;
        try {
          const result = await executeLiMaCommand(submission.text, { projectRoot, signal: abortController.signal });
          setMessages((prev) => [...prev, buildSyntheticAssistantMessage(result.message)]);
          if (!result.ok) {
            setErrorLine(result.message);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setErrorLine(message);
          setMessages((prev) => [...prev, buildSyntheticAssistantMessage(message)]);
        } finally {
          setBusy(false);
          setStreamProgress(null);
          setRunningProcesses(null);
          setActiveEntry(null);
          limaCommandAbortRef.current = null;
        }
        return;
      }

      const prompt: UserPromptContent = {
        text: submission.text,
        imageUrls: submission.imageUrls,
        skills:
          submission.selectedSkills && submission.selectedSkills.length > 0 ? submission.selectedSkills : undefined,
      };

      const trimmedText = (submission.text ?? "").trim();
      const selectedSkillNames = submission.selectedSkills?.map((skill: SkillInfo) => skill.name).filter(Boolean) ?? [];
      const userDisplayContent =
        trimmedText ||
        (selectedSkillNames.length > 0 ? `Use skills: ${selectedSkillNames.join(", ")}` : "") ||
        (submission.imageUrls.length > 0 ? "[Image]" : "");

      if (userDisplayContent && submission.command !== "continue") {
        setMessages((prev) => [...prev, buildSyntheticUserMessage(userDisplayContent, submission.imageUrls.length)]);
      }

      setBusy(true);
      setErrorLine(null);
      setRunningProcesses(null);
      setShowProcessStdout(false);
      processStdoutRef.current.clear();
      try {
        await sessionManager.handleUserPrompt(prompt);
        await refreshSkills();
        refreshSessionsList();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setErrorLine(message);
      } finally {
        setBusy(false);
        setStreamProgress(null);
        setRunningProcesses(null);
      }
    },
    [exit, onRestart, projectRoot, sessionManager, refreshSkills, refreshSessionsList]
  );

  const handleSubmit = useCallback(
    (submission: PromptSubmission) => {
      void handlePrompt(submission);
    },
    [handlePrompt]
  );

  const handleInterrupt = useCallback(() => {
    if (limaCommandAbortRef.current) {
      limaCommandAbortRef.current.abort();
      return;
    }
    sessionManager.interruptActiveSession();
  }, [sessionManager]);

  return { handlePrompt, handleSubmit, handleInterrupt };
}

export function buildSyntheticUserMessage(content: string, imageCount: number): SessionMessage {
  const now = new Date().toISOString();
  return {
    id: `local-${Math.random().toString(36).slice(2)}`,
    sessionId: "local",
    role: "user",
    content,
    contentParams:
      imageCount > 0
        ? Array.from({ length: imageCount }, () => ({
            type: "image_url",
            image_url: { url: "" },
          }))
        : null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: now,
    updateTime: now,
  };
}

export function buildSyntheticAssistantMessage(content: string): SessionMessage {
  const now = new Date().toISOString();
  return {
    id: `local-${Math.random().toString(36).slice(2)}`,
    sessionId: "local",
    role: "assistant",
    content,
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: now,
    updateTime: now,
  };
}

function isCurrentSessionEmpty(sessionManager: SessionManager): boolean {
  const activeSessionId = sessionManager.getActiveSessionId();
  return !activeSessionId || !sessionManager.getSession(activeSessionId);
}
