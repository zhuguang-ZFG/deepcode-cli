import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateLiMaAgentTaskRequest,
  validateLiMaAgentTaskResult,
  type LiMaAgentTaskRequest,
  type LiMaAgentTaskResult,
} from "../lima/agent-task-types";

const validRequest: LiMaAgentTaskRequest = {
  task_id: "task-1",
  repo: "D:/GIT/demo",
  branch: "main",
  goal: "Review current diff",
  constraints: ["Do not commit"],
  allowed_tools: ["read", "git_diff"],
  max_runtime_sec: 600,
  mode: "review",
};

const validResult: LiMaAgentTaskResult = {
  task_id: "task-1",
  status: "succeeded",
  summary: "Reviewed current diff.",
  changed_files: [],
  test_commands: ["npm.cmd run check"],
  test_results: [
    {
      command: "npm.cmd run check",
      exit_code: 0,
      duration_ms: 1200,
      stdout: "ok",
    },
  ],
  diff_preview: "",
  artifacts: [],
  risks: [],
  next_action: "ready_for_human_review",
};

test("validateLiMaAgentTaskRequest accepts the server task contract", () => {
  const result = validateLiMaAgentTaskRequest(validRequest);

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.mode : "", "review");
});

test("validateLiMaAgentTaskRequest rejects invalid modes with a typed error", () => {
  const result = validateLiMaAgentTaskRequest({ ...validRequest, mode: "deploy" });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /mode/);
});

test("validateLiMaAgentTaskRequest rejects missing configuration fields", () => {
  const result = validateLiMaAgentTaskRequest({ ...validRequest, repo: "" });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /repo/);
});

test("validateLiMaAgentTaskRequest accepts lifecycle metadata", () => {
  const result = validateLiMaAgentTaskRequest({
    ...validRequest,
    worker_id: "worker-local",
    lease_expires_at: 123,
    cancel_requested: false,
    failure_count: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.worker_id : "", "worker-local");
});

test("validateLiMaAgentTaskResult accepts the worker result contract", () => {
  const result = validateLiMaAgentTaskResult(validResult);

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.status : "", "succeeded");
});

test("validateLiMaAgentTaskResult accepts lifecycle statuses", () => {
  for (const status of [
    "claimed",
    "running",
    "approved",
    "rejected",
    "applied",
    "cancel_requested",
    "cancelled",
    "quarantined",
  ]) {
    const result = validateLiMaAgentTaskResult({ ...validResult, status });
    assert.equal(result.ok, true, status);
  }
});

test("validateLiMaAgentTaskResult rejects invalid statuses with a typed error", () => {
  const result = validateLiMaAgentTaskResult({ ...validResult, status: "done" });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /status/);
});
