import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeLiMaTaskStartHook } from "../lima/lifecycle-hooks.ts";
import type { LiMaAgentTaskRequest } from "../lima/agent-task-types.ts";

const SECTIONS = ["## Context", "## Task", "## Constraints", "## Verify", "## Output"];

test("writeLiMaTaskStartHook renders prompt contract sections", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-hook-"));
  const task: LiMaAgentTaskRequest = {
    task_id: "hook-smoke",
    repo: projectRoot,
    branch: "main",
    goal: "legacy goal",
    constraints: ["read-only"],
    allowed_tools: ["git_diff"],
    max_runtime_sec: 300,
    mode: "review",
    test_commands: ["pytest -q"],
    prompt_contract: {
      context: "ctx",
      task: "explicit task",
      constraints: ["c1"],
      verify: ["v1"],
      output: "summary json",
    },
  };
  const result = writeLiMaTaskStartHook(projectRoot, task, []);
  assert.equal(result.ok, true);
  const context = fs.readFileSync(path.join(result.dir, "context.md"), "utf8");
  for (const section of SECTIONS) {
    assert.match(context, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(context, /explicit task/);
});
