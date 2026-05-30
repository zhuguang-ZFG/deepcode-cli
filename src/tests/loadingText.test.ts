import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLoadingText } from "../ui";

test("buildLoadingText returns plain Thinking... when no progress", () => {
  assert.equal(buildLoadingText({ progress: null, now: Date.now() }), "Thinking...");
});

test("buildLoadingText shows running process elapsed time before thinking progress", () => {
  const startedAt = "2026-04-28T00:00:00.000Z";
  const now = Date.parse(startedAt) + 5_750;
  const processes = new Map([["123", { startTime: startedAt, command: "yarn install" }]]);
  const text = buildLoadingText({
    processes,
    progress: {
      requestId: "r",
      startedAt,
      estimatedTokens: 850,
      formattedTokens: "850",
      phase: "update",
    },
    now,
  });
  assert.equal(text, "(5s) yarn install");
});

test("buildLoadingText formats long-running process time with minutes", () => {
  const startedAt = "2026-04-28T00:00:00.000Z";
  const now = Date.parse(startedAt) + 65_250;
  const processes = new Map([["web-search", { startTime: startedAt, command: "WebSearch: latest node release" }]]);
  assert.equal(buildLoadingText({ processes, progress: null, now }), "(1m5s) WebSearch: latest node release");
});

test("buildLoadingText returns plain Thinking... while elapsed below 3s", () => {
  const startedAt = "2026-04-28T00:00:00.000Z";
  const now = Date.parse(startedAt) + 1500;
  const text = buildLoadingText({
    progress: {
      requestId: "r",
      startedAt,
      estimatedTokens: 12,
      formattedTokens: "12",
      phase: "update",
    },
    now,
  });
  assert.equal(text, "Thinking...");
});

test("buildLoadingText shows elapsed seconds and tokens once past the threshold", () => {
  const startedAt = "2026-04-28T00:00:00.000Z";
  const now = Date.parse(startedAt) + 5_750;
  const text = buildLoadingText({
    progress: {
      requestId: "r",
      startedAt,
      estimatedTokens: 850,
      formattedTokens: "850",
      phase: "update",
    },
    now,
  });
  assert.equal(text, "Thinking... (5s) - 850 tokens");
});

test("buildLoadingText shows first-token wait when no stream text has arrived", () => {
  const startedAt = "2026-04-28T00:00:00.000Z";
  const now = Date.parse(startedAt) + 4_000;
  const text = buildLoadingText({
    progress: {
      requestId: "r",
      startedAt,
      estimatedTokens: 0,
      formattedTokens: "",
      phase: "update",
    },
    now,
  });
  assert.equal(text, "Thinking... (4s) - waiting for first token");
});

test("buildLoadingText shows response wait for non-stream requests", () => {
  const startedAt = "2026-04-28T00:00:00.000Z";
  const now = Date.parse(startedAt) + 4_000;
  const text = buildLoadingText({
    progress: {
      requestId: "r",
      startedAt,
      estimatedTokens: 0,
      formattedTokens: "",
      phase: "update",
      transport: "non_stream",
    },
    now,
  });
  assert.equal(text, "Thinking... (4s) - waiting for response");
});

test("buildLoadingText shows non-stream timeout and retry telemetry", () => {
  const startedAt = "2026-04-28T00:00:00.000Z";
  const now = Date.parse(startedAt) + 4_000;
  const text = buildLoadingText({
    progress: {
      requestId: "r",
      startedAt,
      estimatedTokens: 0,
      formattedTokens: "",
      phase: "update",
      transport: "non_stream",
      attempt: 1,
      maxAttempts: 2,
      timeoutMs: 90_000,
    },
    now,
  });
  assert.equal(text, "Thinking... (4s) - waiting for response (try 1/2, timeout 1m30s)");
});

test("buildLoadingText falls back to Thinking... when timestamp is unparseable", () => {
  const text = buildLoadingText({
    progress: {
      requestId: "r",
      startedAt: "not-a-date",
      estimatedTokens: 0,
      formattedTokens: "0",
      phase: "update",
    },
    now: Date.now(),
  });
  assert.equal(text, "Thinking...");
});
