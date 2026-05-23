import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { LiMaAgentTaskRequest, LiMaAgentTaskResult } from "../lima/agent-task-types";
import { executeLiMaCommand } from "../lima/command-runner";
import type { LiMaTaskRunnerRequest } from "../lima/task-runner";

test("executeLiMaCommand runs a server task and submits the result", async () => {
  const task: LiMaTaskRunnerRequest = {
    task_id: "task-1",
    repo: process.cwd(),
    branch: "main",
    goal: "Run review",
    constraints: [],
    allowed_tools: ["git_diff"],
    max_runtime_sec: 60,
    mode: "review",
  };
  const result: LiMaAgentTaskResult = {
    task_id: "task-1",
    status: "needs_review",
    summary: "No git diff found to review.",
    changed_files: [],
    test_commands: [],
    test_results: [],
    diff_preview: "",
    artifacts: [],
    risks: [],
    next_action: "No action required.",
  };
  let submitted: LiMaAgentTaskResult | null = null;

  const response = await executeLiMaCommand("/lima task task-1", {
    projectRoot: process.cwd(),
    client: {
      isConfigured: () => true,
      fetchTask: async (id: string) => {
        assert.equal(id, "task-1");
        return { ok: true, value: task };
      },
      fetchPendingTask: async () => {
        throw new Error("fetchPendingTask should not be called");
      },
      submitResult: async (value: LiMaAgentTaskResult) => {
        submitted = value;
        return { ok: true, value: { accepted: true } };
      },
      fetchTaskEvents: async () => {
        throw new Error("fetchTaskEvents should not be called");
      },
    },
    runTask: async (receivedTask, config) => {
      assert.equal(receivedTask, task);
      assert.equal(config.currentWorkspace, process.cwd());
      return result;
    },
    appendAudit: () => undefined,
  });

  assert.equal(response.ok, true);
  assert.match(response.message, /task-1/);
  assert.match(response.message, /needs_review/);
  assert.deepEqual(submitted, result);
});

test("executeLiMaCommand claims the next pending task and submits the result", async () => {
  const task: LiMaAgentTaskRequest = {
    task_id: "task-next",
    repo: process.cwd(),
    branch: "main",
    goal: "Run next review",
    constraints: [],
    allowed_tools: ["git_diff"],
    max_runtime_sec: 60,
    mode: "review",
  };
  const result: LiMaAgentTaskResult = {
    task_id: "task-next",
    status: "needs_review",
    summary: "Next task reviewed.",
    changed_files: [],
    test_commands: [],
    test_results: [],
    diff_preview: "",
    artifacts: [],
    risks: [],
    next_action: "Submit result.",
  };
  let submitted: LiMaAgentTaskResult | null = null;

  const response = await executeLiMaCommand("/lima next", {
    projectRoot: process.cwd(),
    client: {
      isConfigured: () => true,
      fetchTask: async () => {
        throw new Error("fetchTask should not be called");
      },
      fetchPendingTask: async () => ({ ok: true, value: task }),
      submitResult: async (value: LiMaAgentTaskResult) => {
        submitted = value;
        return { ok: true, value: { accepted: true } };
      },
      fetchTaskEvents: async () => {
        throw new Error("fetchTaskEvents should not be called");
      },
    },
    runTask: async (receivedTask) => {
      assert.equal(receivedTask, task);
      return result;
    },
    appendAudit: () => undefined,
  });

  assert.equal(response.ok, true);
  assert.match(response.message, /task-next/);
  assert.deepEqual(submitted, result);
});

test("executeLiMaCommand reports when no pending task exists", async () => {
  const response = await executeLiMaCommand("/lima next", {
    projectRoot: process.cwd(),
    client: {
      isConfigured: () => true,
      fetchTask: async () => {
        throw new Error("fetchTask should not be called");
      },
      fetchPendingTask: async () => ({ ok: true, value: null }),
      submitResult: async () => {
        throw new Error("submitResult should not be called");
      },
      fetchTaskEvents: async () => {
        throw new Error("fetchTaskEvents should not be called");
      },
    },
    appendAudit: () => undefined,
  });

  assert.equal(response.ok, true);
  assert.match(response.message, /No pending LiMa task/);
});

test("executeLiMaCommand shows recent audit entries", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-audit-command-"));
  const dir = path.join(projectRoot, ".lima-code");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "audit.jsonl"),
    [
      JSON.stringify({ task_id: "old", status: "needs_review", mode: "review", timestamp: "2026-05-23T00:00:00.000Z" }),
      JSON.stringify({ task_id: "new", status: "failed", mode: "patch", timestamp: "2026-05-23T00:01:00.000Z" }),
    ].join("\n") + "\n",
    "utf8"
  );

  const response = await executeLiMaCommand("/lima audit --last 1", {
    projectRoot,
    client: inertClient(),
  });

  assert.equal(response.ok, true);
  assert.match(response.message, /new/);
  assert.doesNotMatch(response.message, /old/);
});

test("executeLiMaCommand handles daemon stop and status", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-daemon-control-"));
  const stop = await executeLiMaCommand("/lima daemon stop", {
    projectRoot,
    client: inertClient(),
  });
  const status = await executeLiMaCommand("/lima daemon status", {
    projectRoot,
    client: inertClient(),
  });

  assert.equal(stop.ok, true);
  assert.match(stop.message, /stop requested/);
  assert.equal(status.ok, true);
  assert.match(status.message, /stop pending/);
});

test("executeLiMaCommand work loop stops when marker is present", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-daemon-stop-"));
  await executeLiMaCommand("/lima daemon stop", {
    projectRoot,
    client: inertClient(),
  });

  const response = await executeLiMaCommand("/lima work --once", {
    projectRoot,
    client: {
      ...inertClient(),
      fetchPendingTask: async () => {
        throw new Error("fetchPendingTask should not be called");
      },
    },
    appendAudit: () => undefined,
  });

  assert.equal(response.ok, true);
  assert.match(response.message, /stopped by marker/);
});

test("executeLiMaCommand work loop processes pending tasks up to max-tasks", async () => {
  const tasks = [buildReviewTask("task-a"), buildReviewTask("task-b")];
  const submitted: string[] = [];
  const sleeps: number[] = [];

  const response = await executeLiMaCommand("/lima work --loop --max-tasks 2 --interval-ms 7 --backoff-ms 11", {
    projectRoot: process.cwd(),
    client: {
      isConfigured: () => true,
      fetchTask: async () => {
        throw new Error("fetchTask should not be called");
      },
      fetchPendingTask: async () => ({ ok: true, value: tasks.shift() ?? null }),
      submitResult: async (value: LiMaAgentTaskResult) => {
        submitted.push(value.task_id);
        return { ok: true, value: { accepted: true } };
      },
      fetchTaskEvents: async () => {
        throw new Error("fetchTaskEvents should not be called");
      },
    },
    runTask: async (task) => buildReviewResult(task.task_id),
    appendAudit: () => undefined,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  assert.equal(response.ok, true);
  assert.match(response.message, /processed 2 task/);
  assert.deepEqual(submitted, ["task-a", "task-b"]);
  assert.deepEqual(sleeps, [7]);
});

test("executeLiMaCommand work loop stops when session time budget is reached", async () => {
  let now = 0;
  const tasks = [buildReviewTask("task-a"), buildReviewTask("task-b")];
  const submitted: string[] = [];

  const response = await executeLiMaCommand("/lima work --loop --max-tasks 2 --max-minutes 1 --interval-ms 1", {
    projectRoot: process.cwd(),
    client: {
      isConfigured: () => true,
      fetchTask: async () => {
        throw new Error("fetchTask should not be called");
      },
      fetchPendingTask: async () => ({ ok: true, value: tasks.shift() ?? null }),
      submitResult: async (value: LiMaAgentTaskResult) => {
        submitted.push(value.task_id);
        return { ok: true, value: { accepted: true } };
      },
      fetchTaskEvents: async () => {
        throw new Error("fetchTaskEvents should not be called");
      },
    },
    runTask: async (task) => {
      now = 61_000;
      return buildReviewResult(task.task_id);
    },
    appendAudit: () => undefined,
    sleep: async () => undefined,
    now: () => now,
  });

  assert.equal(response.ok, true);
  assert.match(response.message, /time budget/);
  assert.deepEqual(submitted, ["task-a"]);
});

test("executeLiMaCommand quarantines repeated task failures", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-quarantine-runner-"));
  const stateDir = path.join(projectRoot, ".lima-code");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "quarantine.json"),
    JSON.stringify({
      "task-a": {
        task_id: "task-a",
        failure_count: 2,
        last_error: "previous failure",
        updated_at: "2026-05-23T00:00:00.000Z",
      },
    }),
    "utf8"
  );
  const task = buildReviewTask("task-a");
  let quarantined = "";

  const response = await executeLiMaCommand("/lima work --once --backoff-ms 1", {
    projectRoot,
    client: {
      isConfigured: () => true,
      fetchTask: async () => {
        throw new Error("fetchTask should not be called");
      },
      fetchPendingTask: async () => ({ ok: true, value: task }),
      submitResult: async () => ({ ok: true, value: { accepted: true } }),
      fetchTaskEvents: async () => {
        throw new Error("fetchTaskEvents should not be called");
      },
      quarantineTask: async (taskId: string) => {
        quarantined = taskId;
        return { ok: true, value: { status: "quarantined" } };
      },
    },
    runTask: async () => ({ ...buildReviewResult("task-a"), status: "failed", summary: "failed again" }),
    appendAudit: () => undefined,
  });

  assert.equal(response.ok, false);
  assert.match(response.message, /quarantined/);
  assert.equal(quarantined, "task-a");
});

test("executeLiMaCommand work loop stops cleanly when no task is pending", async () => {
  const response = await executeLiMaCommand("/lima work --loop --max-tasks 3 --interval-ms 1", {
    projectRoot: process.cwd(),
    client: {
      isConfigured: () => true,
      fetchTask: async () => {
        throw new Error("fetchTask should not be called");
      },
      fetchPendingTask: async () => ({ ok: true, value: null }),
      submitResult: async () => {
        throw new Error("submitResult should not be called");
      },
      fetchTaskEvents: async () => {
        throw new Error("fetchTaskEvents should not be called");
      },
    },
    appendAudit: () => undefined,
  });

  assert.equal(response.ok, true);
  assert.match(response.message, /No pending LiMa task/);
});

test("executeLiMaCommand can patch and test a temporary real repo", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lima-real-repo-"));
  fs.writeFileSync(path.join(repo, "README.md"), "# Before\n", "utf8");
  fs.writeFileSync(path.join(repo, "test.js"), "console.log('ok')\n", "utf8");
  execFileSync("git", ["init"], { cwd: repo });
  execFileSync("git", ["add", "README.md"], { cwd: repo });

  const task: LiMaAgentTaskRequest = {
    task_id: "real-repo",
    repo,
    branch: "main",
    goal: "touch file and run tests",
    constraints: [],
    allowed_tools: ["write", "git_diff", "test"],
    max_runtime_sec: 30,
    mode: "patch",
    patch_files: [{ file_path: "README.md", content: "# Smoke\n" }],
    test_commands: ["node test.js"],
  };
  const submitted: LiMaAgentTaskResult[] = [];

  const response = await executeLiMaCommand("/lima task real-repo", {
    projectRoot: repo,
    client: {
      isConfigured: () => true,
      fetchTask: async () => ({ ok: true, value: task }),
      fetchPendingTask: async () => ({ ok: true, value: null }),
      submitResult: async (result) => {
        submitted.push(result);
        return { ok: true, value: { accepted: true } };
      },
      fetchTaskEvents: async () => ({ ok: true, value: [] }),
    },
  });

  assert.equal(response.ok, true);
  assert.equal(submitted.length, 1);
  assert.deepEqual(submitted[0]?.changed_files, ["README.md"]);
  assert.deepEqual(submitted[0]?.test_commands, ["node test.js"]);
  assert.equal(submitted[0]?.test_results[0]?.exit_code, 0);
});

test("executeLiMaCommand work loop respects abort signal", async () => {
  const controller = new AbortController();
  controller.abort();

  const response = await executeLiMaCommand("/lima work --loop --max-tasks 2 --interval-ms 1", {
    projectRoot: process.cwd(),
    signal: controller.signal,
    client: {
      isConfigured: () => true,
      fetchTask: async () => {
        throw new Error("fetchTask should not be called");
      },
      fetchPendingTask: async () => {
        throw new Error("fetchPendingTask should not be called");
      },
      submitResult: async () => {
        throw new Error("submitResult should not be called");
      },
      fetchTaskEvents: async () => {
        throw new Error("fetchTaskEvents should not be called");
      },
    },
    appendAudit: () => undefined,
  });

  assert.equal(response.ok, false);
  assert.match(response.message, /aborted/);
});

test("executeLiMaCommand reports connect status without exposing the api key", async () => {
  const response = await executeLiMaCommand("/lima connect", {
    projectRoot: process.cwd(),
    client: {
      isConfigured: () => true,
      fetchTask: async () => {
        throw new Error("fetchTask should not be called");
      },
      fetchPendingTask: async () => {
        throw new Error("fetchPendingTask should not be called");
      },
      submitResult: async () => {
        throw new Error("submitResult should not be called");
      },
      fetchTaskEvents: async () => {
        throw new Error("fetchTaskEvents should not be called");
      },
    },
  });

  assert.equal(response.ok, true);
  assert.match(response.message, /configured/);
  assert.doesNotMatch(response.message, /secret-key/);
});

test("executeLiMaCommand fails safely for malformed lima commands", async () => {
  const response = await executeLiMaCommand("/lima task", {
    projectRoot: process.cwd(),
    client: {
      isConfigured: () => true,
      fetchTask: async () => {
        throw new Error("fetchTask should not be called");
      },
      fetchPendingTask: async () => {
        throw new Error("fetchPendingTask should not be called");
      },
      submitResult: async () => {
        throw new Error("submitResult should not be called");
      },
      fetchTaskEvents: async () => {
        throw new Error("fetchTaskEvents should not be called");
      },
    },
  });

  assert.equal(response.ok, false);
  assert.match(response.message, /task <task_id>/);
});

function buildReviewTask(taskId: string): LiMaAgentTaskRequest {
  return {
    task_id: taskId,
    repo: process.cwd(),
    branch: "main",
    goal: "Run review",
    constraints: [],
    allowed_tools: ["git_diff"],
    max_runtime_sec: 60,
    mode: "review",
  };
}

function buildReviewResult(taskId: string): LiMaAgentTaskResult {
  return {
    task_id: taskId,
    status: "needs_review",
    summary: "Task reviewed.",
    changed_files: [],
    test_commands: [],
    test_results: [],
    diff_preview: "",
    artifacts: [],
    risks: [],
    next_action: "Submit result.",
  };
}

function inertClient() {
  return {
    isConfigured: () => true,
    fetchTask: async () => {
      throw new Error("fetchTask should not be called");
    },
    fetchPendingTask: async () => {
      throw new Error("fetchPendingTask should not be called");
    },
    submitResult: async () => {
      throw new Error("submitResult should not be called");
    },
    fetchTaskEvents: async () => {
      throw new Error("fetchTaskEvents should not be called");
    },
  };
}
