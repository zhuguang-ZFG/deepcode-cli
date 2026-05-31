import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRuntimeStatusViewModel, formatRuntimeMetric, selectRuntimeLayoutMode } from "../ui/runtimeStatus";
import type { LlmStreamProgress, SessionEntry } from "../session";
import type { McpServerStatus } from "../mcp/mcp-manager";

const BASE_SESSION: SessionEntry = {
  id: "session-1",
  summary: null,
  assistantReply: null,
  assistantThinking: null,
  assistantRefusal: null,
  toolCalls: null,
  status: "processing",
  failReason: null,
  usage: null,
  usagePerModel: null,
  activeTokens: 0,
  createTime: "2026-01-01T00:00:00.000Z",
  updateTime: "2026-01-01T00:00:01.000Z",
  processes: null,
};

test("selectRuntimeLayoutMode uses stable terminal width breakpoints", () => {
  assert.equal(selectRuntimeLayoutMode(140), "wide");
  assert.equal(selectRuntimeLayoutMode(118), "wide");
  assert.equal(selectRuntimeLayoutMode(117), "medium");
  assert.equal(selectRuntimeLayoutMode(88), "medium");
  assert.equal(selectRuntimeLayoutMode(87), "narrow");
});

test("formatRuntimeMetric keeps large numbers readable", () => {
  assert.equal(formatRuntimeMetric(0), "0");
  assert.equal(formatRuntimeMetric(1204), "1,204");
  assert.equal(formatRuntimeMetric(1_000_000), "1,000,000");
});

test("buildRuntimeStatusViewModel exposes waiting first token state and cache usage", () => {
  const progress: LlmStreamProgress = {
    requestId: "request-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    estimatedTokens: 0,
    formattedTokens: "0",
    phase: "update",
    transport: "non_stream",
    model: "lima-1.3",
    attempt: 1,
    maxAttempts: 2,
    timeoutMs: 90_000,
  };

  const model = buildRuntimeStatusViewModel({
    entry: {
      ...BASE_SESSION,
      usagePerModel: {
        "lima-1.3": {
          prompt_tokens: 1200,
          completion_tokens: 0,
          total_tokens: 1200,
          prompt_tokens_details: { cached_tokens: 1188 },
          prompt_cache_miss_tokens: 12,
          total_reqs: 1,
        },
      },
      activeTokens: 1200,
    },
    progress,
    now: Date.parse("2026-01-01T00:00:42.000Z"),
    busy: true,
    settings: { model: "lima-1.3", thinkingEnabled: false },
    mcpStatuses: [
      readyMcp("filesystem"),
      { ...readyMcp("browser"), status: "failed", connected: false, error: "startup failed" },
    ],
  });

  assert.equal(model.visible, true);
  assert.equal(model.phaseLabel, "等待首 token");
  assert.equal(model.elapsedLabel, "42s");
  assert.deepEqual(
    model.items.map((item) => [item.label, item.value]),
    [
      ["路由", "等待首 token 42s"],
      ["模型", "lima-1.3"],
      ["思考", "关闭"],
      ["Token", "本轮 1,200 / 入 1,200 / 出 0"],
      ["缓存", "1,188 (99.0%)"],
      ["请求", "1 · 重试 1/2"],
      ["工具", "0 个运行中"],
      ["MCP", "1/2 就绪"],
      ["风险", "MCP 失败"],
    ]
  );
  const rendered = model.items.map((item) => `${item.label}: ${item.value}`).join("\n");
  assert.doesNotMatch(rendered, /Router|Model:|Thinking|Tools|Risk|ready|configured|running|none|off|retry/i);
});

test("buildRuntimeStatusViewModel surfaces process and failure layers", () => {
  const processes = new Map([
    [
      "1234",
      {
        startTime: "2026-01-01T00:00:00.000Z",
        command: "npm.cmd test",
        timeoutMs: 90_000,
      },
    ],
  ]);

  const model = buildRuntimeStatusViewModel({
    entry: {
      ...BASE_SESSION,
      status: "failed",
      failReason: "402 Insufficient Balance",
      processes,
    },
    processes,
    now: Date.parse("2026-01-01T00:01:05.000Z"),
    busy: false,
    settings: { model: "lima-1.3", thinkingEnabled: true, reasoningEffort: "max" },
    errorLine: "Request failed: 402 Insufficient Balance",
  });

  assert.equal(model.phaseLabel, "失败");
  assert.equal(model.items.find((item) => item.label === "工具")?.value, "1 个运行中 · npm.cmd test · 1m5s");
  assert.equal(model.items.find((item) => item.label === "风险")?.value, "402 额度/余额");
});

function readyMcp(name: string): McpServerStatus {
  return {
    name,
    status: "ready",
    connected: true,
    toolCount: 1,
    tools: ["tool"],
    promptCount: 0,
    prompts: [],
    resourceCount: 0,
    resources: [],
  };
}
