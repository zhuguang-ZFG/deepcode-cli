import { test } from "node:test";
import assert from "node:assert/strict";
import type { LiMaAgentTaskRequest, LiMaAgentTaskResult } from "../lima/agent-task-types";
import { executeLiMaCommand } from "../lima/command-runner";

test("executeLiMaCommand runs a server task and submits the result", async () => {
  const task: LiMaAgentTaskRequest = {
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
