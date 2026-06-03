import type { ModelUsage, SessionEntry } from "../session";

export function buildStatusLine(entry: SessionEntry): string {
  const parts: string[] = [`状态: ${entry.status}`];
  if (typeof entry.activeTokens === "number" && entry.activeTokens > 0) {
    parts.push(`本轮: ${entry.activeTokens.toLocaleString("en-US")}`);
  }
  const totals = sumStatusUsage(entry.usagePerModel);
  if (totals.promptTokens > 0) {
    parts.push(`输入: ${totals.promptTokens.toLocaleString("en-US")}`);
  }
  if (totals.completionTokens > 0) {
    parts.push(`输出: ${totals.completionTokens.toLocaleString("en-US")}`);
  }
  if (totals.cachedTokens > 0) {
    parts.push(`缓存: ${totals.cachedTokens.toLocaleString("en-US")}${formatCacheHitRate(totals)}`);
  }
  if (totals.totalReqs > 0) {
    parts.push(`请求: ${totals.totalReqs.toLocaleString("en-US")}`);
  }
  if (entry.failReason) {
    parts.push(`失败: ${entry.failReason}`);
  }
  return parts.join(" · ");
}

function sumStatusUsage(usagePerModel: Record<string, ModelUsage> | null): {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cacheMissTokens: number;
  totalReqs: number;
} {
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

function formatCacheHitRate(totals: { promptTokens: number; cachedTokens: number; cacheMissTokens: number }): string {
  const denominator = totals.cacheMissTokens > 0 ? totals.cachedTokens + totals.cacheMissTokens : totals.promptTokens;
  if (denominator <= 0) {
    return "";
  }
  const hitRate = (totals.cachedTokens / denominator) * 100;
  if (!Number.isFinite(hitRate) || hitRate <= 0) {
    return "";
  }
  return ` (${hitRate.toFixed(1)}%)`;
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
