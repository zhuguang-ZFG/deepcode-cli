import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { appendLiMaAuditEntry, getLiMaAuditLogPath } from "../lima/audit-log";
import { buildLiMaEvidenceBundle, redactSecrets } from "../lima/evidence";
import type { LiMaAgentTaskRequest, LiMaAgentTaskResult } from "../lima/agent-task-types";

const task: LiMaAgentTaskRequest = {
  task_id: "task-1",
  repo: "D:/GIT/demo",
  branch: "main",
  goal: "Run checks",
  constraints: [],
  allowed_tools: ["test"],
  max_runtime_sec: 600,
  mode: "test",
};

const result: LiMaAgentTaskResult = {
  task_id: "task-1",
  status: "succeeded",
  summary: "Tests passed with token=super-secret",
  changed_files: ["src/demo.ts"],
  test_commands: ["npm.cmd run check"],
  test_results: [
    {
      command: "npm.cmd run check",
      exit_code: 0,
      stdout: "api_key=abc123456789 and sk-1234567890abcdef",
      stderr: 'Bearer abcdefghijklmnop and "password":"hunter2"',
    },
  ],
  diff_preview: "diff contains secret=my-secret",
  artifacts: [],
  risks: ["token=leaked"],
  next_action: "Submit result",
};

test("redactSecrets masks common secret patterns", () => {
  const redacted = redactSecrets('sk-1234567890abcdef Bearer abcdefghijk token=secret "api_key":"secret"');

  assert.equal(redacted.includes("1234567890abcdef"), false);
  assert.equal(redacted.includes("Bearer abcdefghijk"), false);
  assert.equal(redacted.includes("token=secret"), false);
  assert.equal(redacted.includes('"api_key":"secret"'), false);
});

test("buildLiMaEvidenceBundle redacts task evidence", () => {
  const evidence = buildLiMaEvidenceBundle(result);

  assert.equal(evidence.summary.includes("super-secret"), false);
  assert.equal(evidence.test_results[0]?.stdout?.includes("abc123456789"), false);
  assert.equal(evidence.test_results[0]?.stderr?.includes("hunter2"), false);
  assert.equal(evidence.diff_preview.includes("my-secret"), false);
  assert.equal(evidence.risks[0]?.includes("leaked"), false);
});

test("buildLiMaEvidenceBundle truncates oversized output", () => {
  const evidence = buildLiMaEvidenceBundle({
    ...result,
    test_results: [{ command: "cmd", exit_code: 0, stdout: "x".repeat(5000) }],
  });

  assert.match(evidence.test_results[0]?.stdout ?? "", /truncated/);
});

test("appendLiMaAuditEntry writes JSONL audit records", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-audit-"));
  const entry = appendLiMaAuditEntry(projectRoot, task, result, new Date("2026-05-23T00:00:00.000Z"));
  const auditPath = getLiMaAuditLogPath(projectRoot);
  const lines = fs.readFileSync(auditPath, "utf8").trim().split(/\r?\n/);
  const parsed = JSON.parse(lines[0] ?? "{}") as typeof entry;

  assert.equal(lines.length, 1);
  assert.equal(parsed.timestamp, "2026-05-23T00:00:00.000Z");
  assert.equal(parsed.task_id, "task-1");
  assert.equal(parsed.mode, "test");
  assert.equal(parsed.summary.includes("super-secret"), false);
});
