import React, { useMemo, useState } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import type { UndoTarget } from "../session";

export type UndoRestoreMode = "code-and-conversation" | "conversation";

type Props = {
  targets: UndoTarget[];
  onSelect: (target: UndoTarget, mode: UndoRestoreMode) => void;
  onCancel: () => void;
};

type Phase = "message" | "mode";

const MAX_VISIBLE_TARGETS = 7;

export function UndoSelector({ targets, onSelect, onCancel }: Props): React.ReactElement {
  const [phase, setPhase] = useState<Phase>("message");
  const [targetIndex, setTargetIndex] = useState(Math.max(0, targets.length - 1));
  const [modeIndex, setModeIndex] = useState(0);
  const { columns, rows } = useWindowSize();

  const safeTargetIndex = useMemo(() => {
    if (targets.length === 0) {
      return 0;
    }
    return Math.max(0, Math.min(targetIndex, targets.length - 1));
  }, [targetIndex, targets.length]);

  const selectedTarget = targets[safeTargetIndex] ?? null;
  const maxVisible = Math.max(1, Math.min(MAX_VISIBLE_TARGETS, rows - 8));
  const scrollOffset = Math.max(0, Math.min(safeTargetIndex - Math.floor(maxVisible / 2), targets.length - maxVisible));
  const visibleTargets = targets.slice(scrollOffset, scrollOffset + maxVisible);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && (input === "c" || input === "C"))) {
      if (phase === "mode") {
        setPhase("message");
        return;
      }
      onCancel();
      return;
    }

    if (targets.length === 0) {
      return;
    }

    if (phase === "message") {
      if (key.upArrow) {
        setTargetIndex((index) => Math.max(0, index - 1));
        return;
      }
      if (key.downArrow) {
        setTargetIndex((index) => Math.min(targets.length - 1, index + 1));
        return;
      }
      if (key.home) {
        setTargetIndex(0);
        return;
      }
      if (key.end) {
        setTargetIndex(targets.length - 1);
        return;
      }
      if (key.return) {
        setModeIndex(selectedTarget?.canRestoreCode ? 0 : 1);
        setPhase("mode");
      }
      return;
    }

    if (key.upArrow || key.downArrow) {
      setModeIndex((index) => (index === 0 ? 1 : 0));
      return;
    }
    if (key.return && selectedTarget) {
      onSelect(selectedTarget, modeIndex === 0 ? "code-and-conversation" : "conversation");
    }
  });

  if (targets.length === 0) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow">暂无可撤销内容。</Text>
        <Text dimColor>按 Esc 返回。</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      width={Math.max(20, columns - 6)}
      height={Math.max(5, Math.min(rows - 1, 30))}
      overflow="hidden"
      paddingX={1}
      marginTop={1}
    >
      <Box flexDirection="column" borderStyle="round" borderDimColor flexGrow={1} overflow="hidden">
        <Box paddingX={1}>
          <Text bold color="cyanBright">
            撤销
          </Text>
          <Text dimColor> 恢复到某次提示词之前</Text>
        </Box>
        {phase === "message" ? (
          <Box
            borderTop={true}
            borderBottom={true}
            borderLeft={false}
            borderRight={false}
            borderStyle="round"
            borderDimColor
            flexDirection="column"
            flexGrow={1}
            paddingX={1}
            overflow="hidden"
          >
            {visibleTargets.map((target, visibleIndex) => {
              const actualIndex = scrollOffset + visibleIndex;
              const isActive = actualIndex === safeTargetIndex;
              return (
                <Box key={target.message.id} height={2} marginBottom={1}>
                  <Text color="#229ac3">{isActive ? "> " : "  "}</Text>
                  <Box flexDirection="column" flexGrow={1}>
                    <Text color={isActive ? "#229ac3" : undefined} bold={isActive}>
                      {formatUndoMessage(target.message.content)}
                    </Text>
                    <Text dimColor>
                      {formatTimestamp(target.message.createTime)}
                      {target.canRestoreCode ? " · 可恢复代码 checkpoint" : " · 仅会话"}
                    </Text>
                  </Box>
                </Box>
              );
            })}
          </Box>
        ) : (
          <Box
            borderTop={true}
            borderBottom={true}
            borderLeft={false}
            borderRight={false}
            borderStyle="round"
            borderDimColor
            flexDirection="column"
            flexGrow={1}
            paddingX={1}
            overflow="hidden"
          >
            <Text dimColor>已选提示词:</Text>
            <Text>{formatUndoMessage(selectedTarget?.message.content ?? "")}</Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={modeIndex === 0 ? "cyanBright" : undefined}>
                {modeIndex === 0 ? "> " : "  "}恢复代码和会话
              </Text>
              <Text dimColor>
                {"  "}
                {selectedTarget?.canRestoreCode
                  ? "从记录的 Git checkpoint 恢复文件，然后分叉会话。"
                  : "这条提示词没有记录代码 checkpoint。"}
              </Text>
              <Text color={modeIndex === 1 ? "cyanBright" : undefined}>{modeIndex === 1 ? "> " : "  "}仅恢复会话</Text>
              <Text dimColor>{"  "}分叉会话，不改动文件。</Text>
            </Box>
          </Box>
        )}
        <Box>
          <Text dimColor>
            {phase === "message" ? "↑/↓ 导航 · Enter 选择 · Esc 取消" : "↑/↓ 选择恢复模式 · Enter 恢复 · Esc 返回"}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function formatUndoMessage(content: unknown): string {
  const text = typeof content === "string" && content.trim() ? content.trim() : "(空消息)";
  const singleLine = text.replace(/\r?\n/g, " ").replace(/\s+/g, " ");
  return singleLine.length > 90 ? `${singleLine.slice(0, 89)}…` : singleLine;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return date.toLocaleString();
}
