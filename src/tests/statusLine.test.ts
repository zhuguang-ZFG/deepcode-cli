import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStatusLine } from "../ui";
import type { SessionEntry } from "../session";

test("buildStatusLine includes token, cache, and request telemetry", () => {
  const line = buildStatusLine({
    id: "session-1",
    summary: null,
    assistantReply: null,
    assistantThinking: null,
    assistantRefusal: null,
    toolCalls: null,
    status: "completed",
    failReason: null,
    usage: null,
    usagePerModel: {
      "lima-1.3": {
        prompt_tokens: 1200,
        completion_tokens: 80,
        total_tokens: 1280,
        prompt_tokens_details: { cached_tokens: 900 },
        prompt_cache_miss_tokens: 300,
        total_reqs: 2,
      },
      "deepseek-v4-pro": {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_cache_hit_tokens: 50,
        prompt_cache_miss_tokens: 50,
        total_reqs: 1,
      },
    },
    activeTokens: 1280,
    createTime: "2026-01-01T00:00:00.000Z",
    updateTime: "2026-01-01T00:00:01.000Z",
    processes: null,
  } satisfies SessionEntry);

  assert.equal(line, "状态: completed · 本轮: 1,280 · 输入: 1,300 · 输出: 100 · 缓存: 950 (73.1%) · 请求: 3");
});
