import type { LlmStreamProgress, SessionEntry } from "../session";

type RunningProcesses = SessionEntry["processes"];

export type LoadingTextInput = {
  progress: LlmStreamProgress | null;
  processes?: RunningProcesses;
  now: number;
};

const STALL_THRESHOLD_MS = 3000;
const THINKING_TEXT = "思考中...";

export function buildLoadingText(input: LoadingTextInput): string {
  const { progress, processes, now } = input;
  const processText = buildProcessLoadingText(processes, now);
  if (processText) {
    return processText;
  }

  if (!progress) {
    return THINKING_TEXT;
  }

  const startedAt = parseTimestamp(progress.startedAt);
  if (startedAt === null) {
    return THINKING_TEXT;
  }

  const elapsedMs = Math.max(0, now - startedAt);
  if (elapsedMs < STALL_THRESHOLD_MS) {
    return THINKING_TEXT;
  }

  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  if (progress.estimatedTokens <= 0) {
    const waitLabel = progress.transport === "non_stream" ? "等待 LiMa Router 响应" : "等待首个 token";
    return `${THINKING_TEXT} (${elapsedSeconds}s) · ${waitLabel}${buildModelText(progress)}${buildRequestTelemetryText(progress)}`;
  }

  const tokens = progress.formattedTokens || "0";
  return `${THINKING_TEXT} (${elapsedSeconds}s) · ↓ ${tokens} token${buildModelText(progress)}`;
}

function buildModelText(progress: NonNullable<LoadingTextInput["progress"]>): string {
  return progress.model ? ` [${progress.model}]` : "";
}

function buildRequestTelemetryText(progress: NonNullable<LoadingTextInput["progress"]>): string {
  if (progress.transport !== "non_stream") {
    return "";
  }
  const parts: string[] = [];
  if (typeof progress.attempt === "number" && typeof progress.maxAttempts === "number" && progress.maxAttempts > 1) {
    parts.push(`第 ${progress.attempt}/${progress.maxAttempts} 次`);
  }
  if (typeof progress.timeoutMs === "number" && progress.timeoutMs > 0) {
    parts.push(`超时 ${formatDuration(progress.timeoutMs)}`);
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function buildProcessLoadingText(processes: RunningProcesses | undefined, now: number): string | null {
  if (!processes || processes.size === 0) {
    return null;
  }

  const first = processes.values().next().value as { startTime: string; command: string } | undefined;
  if (!first) {
    return null;
  }

  return `(${formatElapsedTime(first.startTime, now)}) ${first.command}`;
}

function formatElapsedTime(startTimeIso: string, now: number): string {
  const startTime = parseTimestamp(startTimeIso);
  const elapsedMs = startTime === null ? 0 : Math.max(0, now - startTime);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  return formatDuration(elapsedSeconds * 1000);
}

function formatDuration(ms: number): string {
  const elapsedSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m${seconds}s`;
  }
  return `${seconds}s`;
}

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}
