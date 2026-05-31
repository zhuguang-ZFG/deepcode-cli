import type { LlmStreamProgress, ModelUsage, SessionEntry, SessionProcessEntry } from "../session";
import type { McpServerStatus } from "../mcp/mcp-manager";

export type RuntimeLayoutMode = "wide" | "medium" | "narrow";

export type RuntimeStatusItem = {
  label: string;
  value: string;
  tone?: "normal" | "muted" | "warn" | "danger" | "success";
};

export type RuntimeStatusViewModel = {
  visible: boolean;
  layoutMode: RuntimeLayoutMode;
  phaseLabel: string;
  elapsedLabel: string | null;
  summary: string;
  items: RuntimeStatusItem[];
};

export type RuntimeStatusInput = {
  entry?: SessionEntry | null;
  progress?: LlmStreamProgress | null;
  processes?: SessionEntry["processes"];
  mcpStatuses?: McpServerStatus[];
  settings?: {
    model?: string;
    thinkingEnabled?: boolean;
    reasoningEffort?: string;
  };
  errorLine?: string | null;
  now: number;
  busy: boolean;
  width?: number;
};

type UsageSummary = {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cacheMissTokens: number;
  totalReqs: number;
};

const WIDE_MIN_COLUMNS = 118;
const MEDIUM_MIN_COLUMNS = 88;

export function selectRuntimeLayoutMode(width: number): RuntimeLayoutMode {
  if (width >= WIDE_MIN_COLUMNS) {
    return "wide";
  }
  if (width >= MEDIUM_MIN_COLUMNS) {
    return "medium";
  }
  return "narrow";
}

export function formatRuntimeMetric(value: number): string {
  return value.toLocaleString("en-US");
}

export function buildRuntimeStatusViewModel(input: RuntimeStatusInput): RuntimeStatusViewModel {
  const entry = input.entry ?? null;
  const processes = input.processes ?? entry?.processes ?? null;
  const progress = input.progress ?? null;
  const usage = sumRuntimeUsage(entry?.usagePerModel ?? null);
  const model = progress?.model || input.settings?.model || firstUsageModel(entry?.usagePerModel) || "-";
  const phase = resolvePhaseLabel({ entry, progress, processes, busy: input.busy });
  const elapsedLabel = resolveElapsedLabel({ progress, processes, now: input.now });
  const mcp = summarizeMcp(input.mcpStatuses ?? []);
  const risk = resolveRisk(input.errorLine ?? entry?.failReason ?? null, mcp);

  const retryText =
    typeof progress?.attempt === "number" && typeof progress.maxAttempts === "number" && progress.maxAttempts > 1
      ? ` · retry ${progress.attempt}/${progress.maxAttempts}`
      : "";

  const items: RuntimeStatusItem[] = [
    {
      label: "Router",
      value: elapsedLabel ? `${phase} ${elapsedLabel}` : phase,
      tone: entry?.status === "failed" ? "danger" : input.busy ? "warn" : "normal",
    },
    { label: "Model", value: model },
    { label: "Thinking", value: formatThinking(input.settings) },
    {
      label: "Token",
      value: `本轮 ${formatRuntimeMetric(entry?.activeTokens ?? 0)} / 入 ${formatRuntimeMetric(
        usage.promptTokens
      )} / 出 ${formatRuntimeMetric(usage.completionTokens)}`,
    },
    { label: "Cache", value: formatCacheSummary(usage) },
    { label: "Req", value: `${formatRuntimeMetric(usage.totalReqs)}${retryText}` },
    { label: "Tools", value: formatProcessSummary(processes, input.now) },
    { label: "MCP", value: mcp.total > 0 ? `${mcp.ready}/${mcp.total} ready` : "0 configured" },
    { label: "Risk", value: risk.label, tone: risk.tone },
  ];

  const visible =
    input.busy || Boolean(entry) || Boolean(progress) || Boolean(input.errorLine) || hasProcesses(processes);
  const summaryParts = [entry?.status ?? (input.busy ? "processing" : "idle")];
  if (phase !== entry?.status) {
    summaryParts.push(elapsedLabel ? `${phase} ${elapsedLabel}` : phase);
  }
  summaryParts.push(`model ${model}`);

  return {
    visible,
    layoutMode: selectRuntimeLayoutMode(input.width ?? 80),
    phaseLabel: phase,
    elapsedLabel,
    summary: summaryParts.join(" · "),
    items,
  };
}

function resolvePhaseLabel(input: {
  entry: SessionEntry | null;
  progress: LlmStreamProgress | null;
  processes: SessionEntry["processes"];
  busy: boolean;
}): string {
  if (input.entry?.status === "failed") {
    return "失败";
  }
  if (hasProcesses(input.processes)) {
    return "tool_running";
  }
  if (!input.progress) {
    return input.busy ? "processing" : (input.entry?.status ?? "idle");
  }
  if (input.progress.estimatedTokens <= 0) {
    return input.progress.transport === "non_stream" ? "等待首 token" : "等待首 token";
  }
  return "streaming";
}

function resolveElapsedLabel(input: {
  progress: LlmStreamProgress | null;
  processes: SessionEntry["processes"];
  now: number;
}): string | null {
  const progressStartedAt = input.progress?.startedAt;
  if (progressStartedAt) {
    return formatElapsed(progressStartedAt, input.now);
  }
  const firstProcess = getFirstProcess(input.processes);
  if (firstProcess) {
    return formatElapsed(firstProcess.startTime, input.now);
  }
  return null;
}

function formatElapsed(startTimeIso: string, now: number): string | null {
  const start = Date.parse(startTimeIso);
  if (!Number.isFinite(start)) {
    return null;
  }
  return formatDuration(Math.max(0, now - start));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m${seconds}s`;
  }
  return `${seconds}s`;
}

function formatThinking(settings: RuntimeStatusInput["settings"]): string {
  if (!settings || typeof settings.thinkingEnabled !== "boolean") {
    return "-";
  }
  if (!settings.thinkingEnabled) {
    return "off";
  }
  return settings.reasoningEffort ? `on · ${settings.reasoningEffort}` : "on";
}

function formatCacheSummary(usage: UsageSummary): string {
  if (usage.cachedTokens <= 0) {
    return "0";
  }
  const denominator =
    usage.cacheMissTokens > 0 ? usage.cachedTokens + usage.cacheMissTokens : Math.max(usage.promptTokens, 1);
  const hitRate = (usage.cachedTokens / denominator) * 100;
  return `${formatRuntimeMetric(usage.cachedTokens)} (${hitRate.toFixed(1)}%)`;
}

function formatProcessSummary(processes: SessionEntry["processes"], now: number): string {
  if (!processes || processes.size === 0) {
    return "0 running";
  }
  const first = getFirstProcess(processes);
  const elapsed = first ? formatElapsed(first.startTime, now) : null;
  const command = first?.command ? ` · ${truncateText(first.command, 24)}` : "";
  return `${processes.size} running${command}${elapsed ? ` · ${elapsed}` : ""}`;
}

function resolveRisk(
  rawReason: string | null,
  mcp: { failed: number }
): { label: string; tone: RuntimeStatusItem["tone"] } {
  if (rawReason) {
    if (/\b401\b|unauthorized|api key/i.test(rawReason)) {
      return { label: "401 auth", tone: "danger" };
    }
    if (/\b402\b|insufficient balance|quota|balance/i.test(rawReason)) {
      return { label: "402 quota/balance", tone: "danger" };
    }
    if (/\b429\b|rate limit/i.test(rawReason)) {
      return { label: "429 rate limit", tone: "warn" };
    }
    if (/empty response|空响应/i.test(rawReason)) {
      return { label: "empty response", tone: "warn" };
    }
    if (/timeout|timed out|超时/i.test(rawReason)) {
      return { label: "timeout", tone: "warn" };
    }
    return { label: truncateText(rawReason, 32), tone: "danger" };
  }
  if (mcp.failed > 0) {
    return { label: "MCP failed", tone: "warn" };
  }
  return { label: "none", tone: "success" };
}

function summarizeMcp(statuses: McpServerStatus[]): { ready: number; failed: number; total: number } {
  let ready = 0;
  let failed = 0;
  for (const status of statuses) {
    if (status.status === "ready" && status.connected) {
      ready += 1;
    }
    if (status.status === "failed") {
      failed += 1;
    }
  }
  return { ready, failed, total: statuses.length };
}

function sumRuntimeUsage(usagePerModel: Record<string, ModelUsage> | null): UsageSummary {
  const totals = {
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    cacheMissTokens: 0,
    totalReqs: 0,
  };
  if (!usagePerModel) {
    return totals;
  }
  for (const usage of Object.values(usagePerModel)) {
    totals.promptTokens += numberField(usage.prompt_tokens);
    totals.completionTokens += numberField(usage.completion_tokens);
    totals.cachedTokens += extractCachedTokens(usage);
    totals.cacheMissTokens += numberField(usage.prompt_cache_miss_tokens);
    totals.totalReqs += numberField(usage.total_reqs);
  }
  return totals;
}

function extractCachedTokens(usage: ModelUsage): number {
  const promptDetails = usage.prompt_tokens_details;
  const cachedFromDetails =
    promptDetails && typeof promptDetails.cached_tokens === "number" ? promptDetails.cached_tokens : 0;
  return cachedFromDetails || numberField(usage.prompt_cache_hit_tokens);
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function firstUsageModel(usagePerModel: Record<string, ModelUsage> | null | undefined): string | null {
  if (!usagePerModel) {
    return null;
  }
  return Object.keys(usagePerModel)[0] ?? null;
}

function getFirstProcess(processes: SessionEntry["processes"]): SessionProcessEntry | null {
  if (!processes || processes.size === 0) {
    return null;
  }
  return processes.values().next().value ?? null;
}

function hasProcesses(processes: SessionEntry["processes"]): boolean {
  return Boolean(processes && processes.size > 0);
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
