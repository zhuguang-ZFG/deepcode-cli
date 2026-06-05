import * as path from "path";
import { fileURLToPath } from "url";
import { DEEPSEEK_V4_MODELS } from "../common/model-capabilities";
import {
  DEFAULT_COMPACT_PROMPT_TOKEN_THRESHOLD,
  DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD,
  DEFAULT_LIMA_ROUTER_REQUEST_TIMEOUT_MS,
  DEFAULT_LIMA_ROUTER_MAX_RETRIES,
} from "./constants";
import type { ModelUsage } from "./types";

/** Combine two AbortSignals — aborts when either fires. */
export function anySignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  if (a.aborted || b.aborted) {
    controller.abort();
    return controller.signal;
  }
  const abort = () => controller.abort();
  a.addEventListener("abort", abort, { once: true });
  b.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

export function isUsageRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function summarizeCompletionOptions(options?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!options) {
    return undefined;
  }
  return {
    ...options,
    signal: options.signal instanceof AbortSignal ? { aborted: options.signal.aborted } : options.signal,
  };
}

export function addUsageValue(current: unknown, next: unknown): unknown {
  if (typeof next === "number") {
    return (typeof current === "number" ? current : 0) + next;
  }

  if (isUsageRecord(next)) {
    const currentRecord = isUsageRecord(current) ? current : {};
    const result: Record<string, unknown> = { ...currentRecord };
    for (const [key, value] of Object.entries(next)) {
      result[key] = addUsageValue(currentRecord[key], value);
    }
    return result;
  }

  return next;
}

export function accumulateUsage(current: ModelUsage | null, next: unknown | null | undefined): ModelUsage | null {
  if (next == null) {
    return current ?? null;
  }
  return addUsageValue(current, next) as ModelUsage;
}

export function usageWithRequestCount(usage: ModelUsage): ModelUsage {
  const totalReqs = typeof usage.total_reqs === "number" ? usage.total_reqs + 1 : 1;
  return {
    ...usage,
    total_reqs: totalReqs,
  };
}

export function accumulateUsagePerModel(
  current: Record<string, ModelUsage> | null | undefined,
  model: string,
  next: ModelUsage | null | undefined
): Record<string, ModelUsage> | null {
  if (next == null) {
    return current ?? null;
  }

  const usagePerModel = { ...(current ?? {}) };
  const modelName = model.trim() || "unknown";
  usagePerModel[modelName] = accumulateUsage(usagePerModel[modelName] ?? null, usageWithRequestCount(next))!;
  return usagePerModel;
}

export function getExtensionRoot(): string {
  if (typeof __dirname !== "undefined") {
    return path.resolve(__dirname, "../..");
  }

  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "../..");
}

export function getTotalTokens(usage: ModelUsage | null | undefined): number {
  if (!isUsageRecord(usage)) {
    return 0;
  }
  const totalTokens = usage.total_tokens;
  return typeof totalTokens === "number" ? totalTokens : 0;
}

export function readPositiveIntegerEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export function getLiMaRouterRequestTimeoutMs(): number {
  return readPositiveIntegerEnv("LIMA_TUI_TIMEOUT_MS", DEFAULT_LIMA_ROUTER_REQUEST_TIMEOUT_MS);
}

export function getLiMaRouterMaxRetries(): number {
  return Math.min(5, readPositiveIntegerEnv("LIMA_TUI_MAX_RETRIES", DEFAULT_LIMA_ROUTER_MAX_RETRIES));
}

export function getCompactPromptTokenThreshold(model: string): number {
  return DEEPSEEK_V4_MODELS.has(model)
    ? DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD
    : DEFAULT_COMPACT_PROMPT_TOKEN_THRESHOLD;
}

/**
 * Extract pinned constraints from the system prompt — HIGH PRIORITY constraints,
 * User memory, and Project memory blocks. These are appended to compaction
 * summaries so critical instructions survive context folding.
 *
 * Ported from MiMo-Reasonix `ContextManager.extractPinnedConstraints()`.
 */
export function extractPinnedConstraints(systemPrompt: string): string {
  const pattern = /# (?:HIGH PRIORITY constraints|User memory|Project memory)[\s\S]*?(?=\n# |\n---|$)/g;
  return Array.from(systemPrompt.matchAll(pattern), (m) => m[0]).join("\n\n");
}
