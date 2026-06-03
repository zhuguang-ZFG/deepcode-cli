import * as crypto from "crypto";
import { useCallback } from "react";
import type { SessionManager } from "../../session";
import { type MessageMeta, type SessionMessage } from "../../session";
import { type ModelConfigSelection } from "../../settings";
import { resolveCurrentSettings, writeModelConfigSelection } from "../settings-io";

export function useModelConfig(
  projectRoot: string,
  sessionManager: SessionManager,
  setMessages: React.Dispatch<React.SetStateAction<SessionMessage[]>>,
  setResolvedSettings: React.Dispatch<React.SetStateAction<ReturnType<typeof resolveCurrentSettings>>>
) {
  const handleModelConfigChange = useCallback(
    (selection: ModelConfigSelection): string => {
      const current = resolveCurrentSettings(projectRoot);
      const { changed } = writeModelConfigSelection(selection, current, projectRoot);
      const next = resolveCurrentSettings(projectRoot);
      setResolvedSettings(next);

      if (!changed) {
        return "模型设置未变化";
      }

      const activeSessionId = sessionManager.getActiveSessionId();
      const meta: MessageMeta = {
        isModelChange: true,
      };
      const content = `/model\n└ 已切换模型到 ${selection.model} (${formatThinkingMode(selection)})`;

      if (activeSessionId) {
        sessionManager.addSessionSystemMessage(activeSessionId, content, true, meta);
      } else {
        const now = new Date().toISOString();
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            sessionId: "local",
            role: "system" as const,
            content,
            contentParams: null,
            messageParams: null,
            compacted: false,
            visible: true,
            createTime: now,
            updateTime: now,
            meta,
          },
        ]);
      }

      return `模型设置已更新：${formatModelConfig(current)} → ${formatModelConfig(next)}`;
    },
    [projectRoot, sessionManager, setMessages, setResolvedSettings]
  );

  return { handleModelConfigChange };
}

export function formatThinkingMode(
  settings: Pick<ModelConfigSelection, "thinkingEnabled" | "reasoningEffort">
): string {
  if (!settings.thinkingEnabled) {
    return "关闭思考";
  }
  return `思考 ${settings.reasoningEffort}`;
}

export function formatModelConfig(settings: ModelConfigSelection): string {
  return `${settings.model}, ${formatThinkingMode(settings)}`;
}
