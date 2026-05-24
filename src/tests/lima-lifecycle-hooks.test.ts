import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeLiMaTaskStartHook, writeLiMaTaskStopHook } from "../lima/lifecycle-hooks";
import type { LiMaAgentTaskRequest, LiMaAgentTaskResult } from "../lima/agent-task-types";
import type { LiMaActiveSkill } from "../lima/skill-activation";

const task: LiMaAgentTaskRequest = {
  task_id: "../task weird id",
  repo: process.cwd(),
  branch: "main",
  goal: "Patch README",
  constraints: ["Keep it small"],
  allowed_tools: ["write", "test"],
  max_runtime_sec: 60,
  mode: "patch",
  test_commands: ["npm test"],
};

const activeSkills: LiMaActiveSkill[] = [
  { name: "superpowers:test-driven-development", reason: "Patch task requires test-first discipline." },
];

const result: LiMaAgentTaskResult = {
  task_id: "../task weird id",
  status: "needs_review",
  summary: "Patch applied.",
  changed_files: ["README.md"],
  test_commands: ["npm test"],
  test_results: [{ command: "npm test", exit_code: 0, duration_ms: 10 }],
  diff_preview: "diff --git a/README.md b/README.md",
  artifacts: [],
  risks: ["Manual review still required."],
  next_action: "Review diff.",
};

test("lifecycle hooks write task context and summary under the project root", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-hooks-"));
  const start = writeLiMaTaskStartHook(projectRoot, task, activeSkills);
  assert.equal(start.ok, true);

  const stop = writeLiMaTaskStopHook(projectRoot, result);
  assert.equal(stop.ok, true);

  assert.equal(path.relative(projectRoot, start.dir).startsWith(".."), false);
  assert.equal(start.dir, stop.dir);
  assert.match(fs.readFileSync(path.join(start.dir, "context.md"), "utf8"), /Patch README/);
  assert.match(fs.readFileSync(path.join(start.dir, "context.md"), "utf8"), /superpowers:test-driven-development/);
  assert.match(fs.readFileSync(path.join(start.dir, "tasks.md"), "utf8"), /Run requested tests/);
  assert.match(fs.readFileSync(path.join(stop.dir, "summary.md"), "utf8"), /needs_review/);
  assert.match(fs.readFileSync(path.join(stop.dir, "touched-files.txt"), "utf8"), /README.md/);
});

test("lifecycle hooks report write failures without throwing", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-hooks-file-"));
  const blockedPath = path.join(projectRoot, ".lima-code");
  fs.writeFileSync(blockedPath, "not a directory", "utf8");

  const start = writeLiMaTaskStartHook(projectRoot, task, activeSkills);

  assert.equal(start.ok, false);
  assert.match(start.error, /\.lima-code/);
});
