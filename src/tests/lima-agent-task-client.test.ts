import { test } from "node:test";
import assert from "node:assert/strict";
import { LiMaAgentTaskClient } from "../lima/agent-task-client";
import type { LiMaAgentTaskRequest, LiMaAgentTaskResult } from "../lima/agent-task-types";

const validTask: LiMaAgentTaskRequest = {
  task_id: "task-1",
  repo: "D:/GIT/demo",
  branch: "main",
  goal: "Run tests",
  constraints: ["Do not commit"],
  allowed_tools: ["read", "test"],
  max_runtime_sec: 600,
  mode: "test",
};

const validResult: LiMaAgentTaskResult = {
  task_id: "task-1",
  status: "succeeded",
  summary: "Tests passed.",
  changed_files: [],
  test_commands: ["npm.cmd run check"],
  test_results: [{ command: "npm.cmd run check", exit_code: 0 }],
  diff_preview: "",
  artifacts: [],
  risks: [],
  next_action: "ready_for_human_review",
};

test("LiMaAgentTaskClient reports missing server URL without throwing", async () => {
  const client = new LiMaAgentTaskClient({ apiKey: "sk-test" });
  const result = await client.fetchTask("task-1");

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /SERVER_URL/);
});

test("LiMaAgentTaskClient reports missing API key without throwing", async () => {
  const client = new LiMaAgentTaskClient({ serverUrl: "https://lima.example.com" });
  const result = await client.fetchTask("task-1");

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /API_KEY/);
});

test("LiMaAgentTaskClient fetches and validates a task by id", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new LiMaAgentTaskClient({
    serverUrl: "https://lima.example.com/",
    apiKey: "sk-test",
    fetch: createFetch(calls, { task: validTask }),
  });

  const result = await client.fetchTask("task-1");

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.task_id : "", "task-1");
  assert.equal(calls[0]?.url, "https://lima.example.com/agent/tasks/task-1");
  assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, "Bearer sk-test");
});

test("LiMaAgentTaskClient rejects invalid task payloads", async () => {
  const client = new LiMaAgentTaskClient({
    serverUrl: "https://lima.example.com",
    apiKey: "sk-test",
    fetch: createFetch([], { task: { ...validTask, mode: "deploy" } }),
  });

  const result = await client.fetchTask("task-1");

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /mode/);
});

test("LiMaAgentTaskClient fetches the first pending task", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new LiMaAgentTaskClient({
    serverUrl: "https://lima.example.com",
    apiKey: "sk-test",
    fetch: createFetch(calls, { tasks: [validTask] }),
  });

  const result = await client.fetchPendingTask();

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value?.task_id : "", "task-1");
  assert.equal(calls[0]?.url, "https://lima.example.com/agent/tasks?status=accepted&limit=1");
});

test("LiMaAgentTaskClient returns null when no pending task exists", async () => {
  const client = new LiMaAgentTaskClient({
    serverUrl: "https://lima.example.com",
    apiKey: "sk-test",
    fetch: createFetch([], { tasks: [] }),
  });

  const result = await client.fetchPendingTask();

  assert.deepEqual(result, { ok: true, value: null });
});

test("LiMaAgentTaskClient submits task results", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new LiMaAgentTaskClient({
    serverUrl: "https://lima.example.com",
    apiKey: "sk-test",
    fetch: createFetch(calls, { ok: true }),
  });

  const result = await client.submitResult(validResult);

  assert.deepEqual(result, { ok: true, value: { accepted: true } });
  assert.equal(calls[0]?.url, "https://lima.example.com/agent/tasks/task-1/result");
  assert.equal(calls[0]?.init.method, "POST");
  assert.equal(JSON.parse(String(calls[0]?.init.body)).status, "succeeded");
});

test("LiMaAgentTaskClient fetches task events", async () => {
  const client = new LiMaAgentTaskClient({
    serverUrl: "https://lima.example.com",
    apiKey: "sk-test",
    fetch: createFetch([], { events: [{ type: "started" }] }),
  });

  const result = await client.fetchTaskEvents("task-1");

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value : [], [{ type: "started" }]);
});

function createFetch(calls: Array<{ url: string; init: RequestInit }>, payload: unknown, status = 200): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    } as Response;
  }) as typeof fetch;
}
