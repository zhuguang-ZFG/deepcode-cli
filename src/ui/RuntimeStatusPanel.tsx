import React from "react";
import { Box, Text } from "ink";
import type { RuntimeStatusItem, RuntimeStatusViewModel } from "./runtimeStatus";

type RuntimeStatusPanelProps = {
  viewModel: RuntimeStatusViewModel;
  width: number;
};

export const RUNTIME_STATUS_PANEL_WIDTH = 32;

export function RuntimeStatusPanel({ viewModel, width }: RuntimeStatusPanelProps): React.ReactElement | null {
  if (!viewModel.visible) {
    return null;
  }

  if (viewModel.layoutMode === "wide") {
    return (
      <Box
        flexDirection="column"
        width={RUNTIME_STATUS_PANEL_WIDTH}
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
      >
        <Text bold color="cyan">
          运行态
        </Text>
        {viewModel.items.map((item) => (
          <Box key={item.label}>
            <Text color="yellow">{item.label}</Text>
            <Text dimColor>: </Text>
            <ToneText item={item} />
          </Box>
        ))}
      </Box>
    );
  }

  if (viewModel.layoutMode === "medium") {
    const usageLine = viewModel.items
      .filter((item) => ["Token", "Cache", "Req", "Tools", "MCP"].includes(item.label))
      .map((item) => `${item.label} ${item.value}`)
      .join(" · ");
    return (
      <Box flexDirection="column" width={width}>
        <Text dimColor>{viewModel.summary}</Text>
        <Text dimColor>{truncateText(usageLine, width)}</Text>
      </Box>
    );
  }

  return (
    <Box width={width}>
      <Text dimColor>{truncateText(viewModel.summary, width)}</Text>
    </Box>
  );
}

function ToneText({ item }: { item: RuntimeStatusItem }): React.ReactElement {
  if (item.tone === "danger") {
    return <Text color="red">{item.value}</Text>;
  }
  if (item.tone === "warn") {
    return <Text color="yellow">{item.value}</Text>;
  }
  if (item.tone === "success") {
    return <Text color="green">{item.value}</Text>;
  }
  if (item.tone === "muted") {
    return <Text dimColor>{item.value}</Text>;
  }
  return <Text>{item.value}</Text>;
}

function truncateText(value: string, maxWidth: number): string {
  if (maxWidth <= 1) {
    return "";
  }
  if (value.length <= maxWidth) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxWidth - 1))}…`;
}
