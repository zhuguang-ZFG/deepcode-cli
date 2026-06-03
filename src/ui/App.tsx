import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, useApp, useStdout, useWindowSize } from "ink";
import chalk from "chalk";
import type { SessionManager } from "../session";
import {
  type LlmStreamProgress,
  type MessageMeta,
  type ModelUsage,
  type SessionEntry,
  type SessionMessage,
  type SessionStatus,
  type SkillInfo,
  type UndoTarget,
  type UserPromptContent,
} from "../session";
import { type ModelConfigSelection, type ResolvedDeepcodingSettings } from "../settings";
import { PromptInput, type PromptDraft, type PromptSubmission } from "./PromptInput";
import { MessageView, RawModeExitPrompt } from "./components";
import { SessionList } from "./SessionList";
import { UndoSelector, type UndoRestoreMode } from "./UndoSelector";
import { buildLoadingText } from "./loadingText";
import { findExpandedThinkingId } from "./thinkingState";
import { WelcomeScreen } from "./WelcomeScreen";
import { AskUserQuestionPrompt } from "./AskUserQuestionPrompt";
import { McpStatusList } from "./McpStatusList";
import { ProcessStdoutView } from "./ProcessStdoutView";
import { RuntimeStatusPanel, RUNTIME_STATUS_PANEL_WIDTH } from "./RuntimeStatusPanel";
import { buildRuntimeStatusViewModel } from "./runtimeStatus";
import {
  type AskUserQuestionAnswers,
  findPendingAskUserQuestion,
  formatAskUserQuestionAnswers,
} from "./askUserQuestion";
import { RawMode, useRawModeContext } from "./contexts";
import { renderMessageToStdout } from "./components/MessageView/utils";
import { createOpenAIClient } from "../common/openai-client";

import { resolveCurrentSettings } from "./settings-io";
import { useSessionManager } from "./hooks/useSessionManager";
import { usePromptHandler, buildSyntheticUserMessage } from "./hooks/usePromptHandler";
import { useViewActions } from "./hooks/useViewActions";
import { useModelConfig } from "./hooks/useModelConfig";

type View = "chat" | "session-list" | "undo" | "mcp-status";

type AppProps = {
  projectRoot: string;
  initialPrompt?: string;
  onRestart?: () => void;
};

export function App({ projectRoot, initialPrompt, onRestart }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout, write } = useStdout();
  const { columns, rows } = useWindowSize();
  const { mode, setMode } = useRawModeContext();
  const initialPromptSubmittedRef = useRef(false);
  const processStdoutRef = useRef<Map<number, string>>(new Map());
  const rawModeRef = useRef<RawMode>(mode);
  const writeRef = useRef(write);
  const lastRenderedColumnsRef = useRef<number | null>(null);
  const messagesRef = useRef<SessionMessage[]>([]);
  const limaCommandAbortRef = useRef<AbortController | null>(null);
  const [view, setView] = useState<View>("chat");
  const [busy, setBusy] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [undoTargets, setUndoTargets] = useState<UndoTarget[]>([]);
  const [promptDraft, setPromptDraft] = useState<PromptDraft | null>(null);
  const [statusLine, setStatusLine] = useState<string>("");
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const [streamProgress, setStreamProgress] = useState<LlmStreamProgress | null>(null);
  const [runningProcesses, setRunningProcesses] = useState<SessionEntry["processes"]>(null);
  const [activeStatus, setActiveStatus] = useState<SessionStatus | null>(null);
  const [activeEntry, setActiveEntry] = useState<SessionEntry | null>(null);
  const [dismissedQuestionIds, setDismissedQuestionIds] = useState<Set<string>>(() => new Set());
  const [isExiting, setIsExiting] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [welcomeNonce, setWelcomeNonce] = useState(0);
  const [resolvedSettings, setResolvedSettings] = useState(() => resolveCurrentSettings(projectRoot));
  const [nowTick, setNowTick] = useState(0);
  const [mcpStatuses, setMcpStatuses] = useState<ReturnType<typeof sessionManager.getMcpStatus>>([]);
  const [showProcessStdout, setShowProcessStdout] = useState(false);

  rawModeRef.current = mode;
  messagesRef.current = messages;

  // --- Hooks ---
  const sessionManager = useSessionManager(projectRoot, {
    rawModeRef,
    setMessages,
    setActiveEntry,
    setStatusLine,
    setRunningProcesses,
    setActiveStatus,
    setStreamProgress,
    setMcpStatuses,
    processStdoutRef,
  });

  const { handleSubmit, handleInterrupt } = usePromptHandler({
    projectRoot,
    onRestart,
    sessionManager,
    rawModeRef,
    writeRef,
    limaCommandAbortRef,
    refreshSkills: async (sessionId?: string) => {
      try {
        const list = await sessionManager.listSkills(sessionId ?? sessionManager.getActiveSessionId() ?? undefined);
        setSkills(list);
      } catch {
        /* ignore */
      }
    },
    refreshSessionsList: () => setSessions(sessionManager.listSessions()),
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
  });

  const loadVisibleMessages = useCallback(
    (manager: SessionManager, sessionId: string): SessionMessage[] =>
      manager.listSessionMessages(sessionId).filter((m) => m.visible),
    []
  );

  const { handleSelectSession, handleUndoRestore, handleRawModeChange } = useViewActions({
    sessionManager,
    rawModeRef,
    setMode,
    refreshSkills: async (sessionId?: string) => {
      try {
        const list = await sessionManager.listSkills(sessionId ?? sessionManager.getActiveSessionId() ?? undefined);
        setSkills(list);
      } catch {
        /* ignore */
      }
    },
    refreshSessionsList: () => setSessions(sessionManager.listSessions()),
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
  });

  const { handleModelConfigChange } = useModelConfig(projectRoot, sessionManager, setMessages, setResolvedSettings);

  // --- Effects ---
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setNowTick((tick) => tick + 1), 500);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    setSessions(sessionManager.listSessions());
    void (async () => {
      try {
        const list = await sessionManager.listSkills(sessionManager.getActiveSessionId() ?? undefined);
        setSkills(list);
      } catch {
        /* ignore */
      }
    })();
  }, [sessionManager]);

  useEffect(() => {
    createOpenAIClient(projectRoot);
  }, [projectRoot]);

  useEffect(() => {
    return () => {
      sessionManager.dispose();
    };
  }, [sessionManager]);

  useEffect(() => {
    if (initialPromptSubmittedRef.current || !initialPrompt || !initialPrompt.trim()) return;
    initialPromptSubmittedRef.current = true;
    handleSubmit({ text: initialPrompt, imageUrls: [], selectedSkills: undefined });
  }, [handleSubmit, initialPrompt]);

  writeRef.current = write;

  // --- Resize handling ---
  useEffect(() => {
    if (!stdout?.isTTY || columns <= 0) return;
    if (lastRenderedColumnsRef.current === null) {
      lastRenderedColumnsRef.current = columns;
      return;
    }
    if (lastRenderedColumnsRef.current === columns) return;
    lastRenderedColumnsRef.current = columns;

    if (mode === RawMode.Raw) {
      process.stdout.write("\u001B[2J\u001B[3J\u001B[H");
      const activeSessionId = sessionManager.getActiveSessionId();
      const allMessages = activeSessionId ? loadVisibleMessages(sessionManager, activeSessionId) : [];
      for (const msg of allMessages) {
        process.stdout.write("\n");
        process.stdout.write(renderMessageToStdout(msg, mode) + "\n\n");
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
      return;
    }

    writeRef.current("\u001B[2J\u001B[H");
    setMessages([]);
    setShowWelcome(false);
    setWelcomeNonce((n) => n + 1);
    const activeSessionId = sessionManager.getActiveSessionId();
    const nextMessages =
      activeSessionId && !busy ? loadVisibleMessages(sessionManager, activeSessionId) : messagesRef.current;
    setTimeout(() => {
      setMessages(nextMessages);
      setShowWelcome(true);
    }, 0);
  }, [busy, mode, sessionManager, columns, stdout]);

  // --- Callbacks ---
  const handleToggleProcessStdout = useCallback(() => setShowProcessStdout(true), []);
  const handleDismissProcessStdout = useCallback(() => setShowProcessStdout(false), []);
  const handleAdjustBashTimeout = useCallback(
    (deltaMs: number) => sessionManager.adjustActiveBashTimeout(deltaMs),
    [sessionManager]
  );

  const handleQuestionAnswers = useCallback(
    (answers: AskUserQuestionAnswers) => {
      handleSubmit({ text: formatAskUserQuestionAnswers(answers), imageUrls: [] });
    },
    [handleSubmit]
  );

  const pendingQuestion = useMemo(() => findPendingAskUserQuestion(messages, activeStatus), [activeStatus, messages]);
  const shouldShowQuestionPrompt = Boolean(pendingQuestion && !dismissedQuestionIds.has(pendingQuestion.messageId));

  const handleQuestionCancel = useCallback(() => {
    if (!pendingQuestion) return;
    setDismissedQuestionIds((prev) => new Set(prev).add(pendingQuestion.messageId));
  }, [pendingQuestion]);

  // --- Computed values ---
  const screenWidth = useMemo(() => columns ?? stdout?.columns ?? 80, [columns, stdout]);
  const screenHeight = useMemo(() => rows ?? stdout?.rows ?? 24, [rows, stdout]);
  const promptHistory = useMemo(
    () =>
      messages
        .filter((message) => message.role === "user" && typeof message.content === "string")
        .map((message) => (message.content ?? "").trim())
        .filter((content) => content.length > 0),
    [messages]
  );
  const expandedThinkingId = findExpandedThinkingId(messages);
  const loadingText = useMemo(
    () => (busy ? buildLoadingText({ progress: streamProgress, processes: runningProcesses, now: Date.now() }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nowTick forces periodic recalculation for spinner animation
    [busy, streamProgress, runningProcesses, nowTick]
  );
  const runtimeStatus = useMemo(
    () =>
      buildRuntimeStatusViewModel({
        entry: activeEntry,
        progress: streamProgress,
        processes: runningProcesses,
        mcpStatuses,
        settings: {
          model: resolvedSettings.model,
          thinkingEnabled: resolvedSettings.thinkingEnabled,
          reasoningEffort: resolvedSettings.reasoningEffort,
        },
        errorLine,
        now: Date.now(),
        busy,
        width: screenWidth,
      }),
    [
      activeEntry,
      busy,
      errorLine,
      mcpStatuses,
      resolvedSettings.model,
      resolvedSettings.reasoningEffort,
      resolvedSettings.thinkingEnabled,
      runningProcesses,
      screenWidth,
      streamProgress,
    ]
  );
  const promptScreenWidth =
    runtimeStatus.visible && runtimeStatus.layoutMode === "wide"
      ? Math.max(80, screenWidth - RUNTIME_STATUS_PANEL_WIDTH)
      : screenWidth;

  const welcomeItem: SessionMessage = useMemo(
    () => ({
      id: `__welcome__${welcomeNonce}`,
      sessionId: "",
      role: "system",
      content: "",
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: "",
      updateTime: "",
    }),
    [welcomeNonce]
  );
  const staticItems = useMemo(() => {
    if (mode === RawMode.Raw) return [];
    if (showWelcome && view === "chat") return [welcomeItem, ...messages];
    return messages;
  }, [mode, showWelcome, view, messages, welcomeItem]);

  // --- Render ---
  if (mode === RawMode.Raw) {
    return <RawModeExitPrompt onExit={(prev) => handleRawModeChange(prev)} />;
  }

  return (
    <Box flexDirection="column" width={screenWidth} minWidth={80} overflowX={"visible"}>
      <Static items={staticItems}>
        {(item) => {
          if (item.id.startsWith("__welcome__")) {
            return (
              <WelcomeScreen
                key={item.id}
                projectRoot={projectRoot}
                settings={resolvedSettings}
                skills={skills}
                width={screenWidth}
              />
            );
          }
          return (
            <MessageView
              key={item.id}
              message={item}
              collapsed={isCollapsedThinking(item, expandedThinkingId)}
              width={screenWidth}
            />
          );
        }}
      </Static>
      {!runtimeStatus.visible && statusLine ? (
        <Box>
          <Text dimColor>{statusLine}</Text>
        </Box>
      ) : null}
      {errorLine ? (
        <Box>
          <Text color="red">Error: {errorLine}</Text>
        </Box>
      ) : null}
      {showProcessStdout ? (
        <ProcessStdoutView
          processStdoutRef={processStdoutRef}
          runningProcesses={runningProcesses}
          onDismiss={handleDismissProcessStdout}
          onAdjustTimeout={handleAdjustBashTimeout}
          screenWidth={screenWidth}
          screenHeight={screenHeight}
        />
      ) : view === "session-list" ? (
        <SessionList
          sessions={sessions}
          onSelect={(id) => void handleSelectSession(id)}
          onCancel={() => setView("chat")}
        />
      ) : view === "undo" ? (
        <UndoSelector
          targets={undoTargets}
          onSelect={(target, restoreMode) => void handleUndoRestore(target, restoreMode)}
          onCancel={() => {
            setView("chat");
            setShowWelcome(true);
          }}
        />
      ) : view === "mcp-status" ? (
        <McpStatusList
          statuses={mcpStatuses}
          onCancel={() => setView("chat")}
          onReconnect={(name) => {
            const latest = resolveCurrentSettings(projectRoot);
            void sessionManager.reconnectMcpServer(name, latest.mcpServers?.[name]);
          }}
        />
      ) : shouldShowQuestionPrompt && pendingQuestion && !busy ? (
        <AskUserQuestionPrompt
          questions={pendingQuestion.questions}
          onSubmit={handleQuestionAnswers}
          onCancel={handleQuestionCancel}
        />
      ) : isExiting ? null : (
        <Box
          flexDirection={runtimeStatus.visible && runtimeStatus.layoutMode === "wide" ? "row" : "column"}
          width={screenWidth}
        >
          {runtimeStatus.visible && runtimeStatus.layoutMode !== "wide" ? (
            <RuntimeStatusPanel viewModel={runtimeStatus} width={screenWidth} />
          ) : null}
          <Box width={promptScreenWidth}>
            <PromptInput
              projectRoot={projectRoot}
              screenWidth={promptScreenWidth}
              skills={skills}
              modelConfig={resolvedSettings}
              promptHistory={promptHistory}
              busy={busy}
              loadingText={loadingText}
              runningProcesses={runningProcesses}
              promptDraft={promptDraft}
              onSubmit={handleSubmit}
              onModelConfigChange={handleModelConfigChange}
              onRawModeChange={handleRawModeChange}
              onInterrupt={handleInterrupt}
              onToggleProcessStdout={handleToggleProcessStdout}
              placeholder="输入消息..."
            />
          </Box>
          {runtimeStatus.visible && runtimeStatus.layoutMode === "wide" ? (
            <RuntimeStatusPanel viewModel={runtimeStatus} width={RUNTIME_STATUS_PANEL_WIDTH} />
          ) : null}
        </Box>
      )}
    </Box>
  );
}

// --- Helpers (kept local for App.tsx rendering) ---

function isCollapsedThinking(message: SessionMessage, expandedId: string | null): boolean {
  if (message.role !== "assistant") return false;
  if (!message.meta?.asThinking) return false;
  return message.id !== expandedId;
}

// Re-export for backward compatibility
export { buildPromptDraftFromSessionMessage } from "./hooks/useViewActions";
export { buildStatusLine } from "./session-status";
export { createOpenAIClient } from "../common/openai-client";
// Re-export settings functions for backward compatibility
export {
  readSettings,
  readProjectSettings,
  writeSettings,
  writeProjectSettings,
  writeModelConfigSelection,
  resolveCurrentSettings,
} from "./settings-io";
