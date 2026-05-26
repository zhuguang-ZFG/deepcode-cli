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

test("executeLiMaCommand emits Telegram lifecycle events for review tasks", async () => {
  const task: LiMaTaskRunnerRequest = {
    task_id: "task-telegram",
    repo: process.cwd(),
    branch: "main",
    goal: "Run review",
    constraints: [],
    allowed_tools: ["git_diff"],
    max_runtime_sec: 60,
    mode: "review",
  };
  const result: LiMaAgentTaskResult = {
    task_id: "task-telegram",
    status: "needs_review",
    summary: "Review ready.",
    changed_files: ["README.md"],
    test_commands: [],
    test_results: [],
    diff_preview: "",
    artifacts: [],
    risks: [],
    next_action: "Approve or reject.",
  };
  const events: string[] = [];

  const response = await executeLiMaCommand("/lima task task-telegram", {
    projectRoot: process.cwd(),
    client: {
      isConfigured: () => true,
      fetchTask: async () => ({ ok: true, value: task }),
      fetchPendingTask: async () => {
        throw new Error("fetchPendingTask should not be called");
      },
      submitResult: async () => ({ ok: true, value: { accepted: true } }),
      fetchTaskEvents: async () => {
        throw new Error("fetchTaskEvents should not be called");
      },
    },
    runTask: async () => result,
    appendAudit: () => undefined,
    notify: async (event) => {
      events.push(`${event.type}:${event.taskId}:${event.status}`);
      return true;
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(events, ["task_started:task-telegram:running", "task_needs_review:task-telegram:needs_review"]);
});

test("executeLiMaCommand runs lifecycle hooks with active skill candidates", async () => {
  const task: LiMaTaskRunnerRequest = {
    task_id: "task-hooks",
    repo: process.cwd(),
    branch: "main",
    goal: "Patch Telegram token handling",
    constraints: ["test: npm test"],
    allowed_tools: ["write", "test"],
    max_runtime_sec: 60,
    mode: "patch",
    test_commands: ["npm test"],
  };
  const result: LiMaAgentTaskResult = {
    task_id: "task-hooks",
    status: "needs_review",
    summary: "Patch ready.",
    changed_files: ["src/lima/telegram-notifier.ts"],
    test_commands: ["npm test"],
    test_results: [{ command: "npm test", exit_code: 0 }],
    diff_preview: "",
    artifacts: [],
    risks: [],
    next_action: "Approve or reject.",
  };
  const events: string[] = [];

  const response = await executeLiMaCommand("/lima task task-hooks", {
    projectRoot: process.cwd(),
    client: {
      isConfigured: () => true,
      fetchTask: async () => ({ ok: true, value: task }),
      fetchPendingTask: async () => {
        throw new Error("fetchPendingTask should not be called");
      },
      submitResult: async () => {
        events.push("submit");
        return { ok: true, value: { accepted: true } };
      },
      fetchTaskEvents: async () => {
        throw new Error("fetchTaskEvents should not be called");
      },
    },
    runTask: async () => {
      events.push("run");
      return result;
    },
    appendAudit: () => undefined,
    lifecycleHooks: {
      onTaskStart: (_task, activeSkills) => {
        events.push(`start:${activeSkills.map((skill) => skill.name).join(",")}`);
        return { ok: true, dir: process.cwd(), warnings: [] };
      },
      onTaskStop: (taskResult) => {
        events.push(`stop:${taskResult.status}`);
        return { ok: true, dir: process.cwd(), warnings: [] };
      },
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(events, [
    "start:superpowers:test-driven-development,security-review",
    "run",
    "stop:needs_review",
    "submit",
  ]);
});

test("executeLiMaCommand includes project skill rules in lifecycle hooks", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-project-rule-runner-"));
  fs.mkdirSync(path.join(projectRoot, ".lima-code"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, ".lima-code", "skill-rules.json"),
    JSON.stringify({
      rules: [
        {
          name: "lima-code:server-task-audit",
          reason: "Server task route changes require audit review.",
          keywords: ["agent", "audit"],
          files: ["routes/*.py"],
          modes: ["patch"],
        },
      ],
    }),
    "utf8"
  );
  const task: LiMaTaskRunnerRequest = {
    task_id: "task-project-rules",
    repo: projectRoot,
    branch: "main",
    goal: "Patch agent audit route",
    constraints: [],
    allowed_tools: ["write"],
    max_runtime_sec: 60,
    mode: "patch",
    patch_files: [{ file_path: "routes/agent_tasks.py", content: "" }],
  };
  const result = buildReviewResult("task-project-rules");
  const starts: string[][] = [];

  const response = await executeLiMaCommand("/lima task task-project-rules", {
    projectRoot,
    client: {
      isConfigured: () => true,
      fetchTask: async () => ({ ok: true, value: task }),
      fetchPendingTask: async () => {
        throw new Error("fetchPendingTask should not be called");
      },
      submitResult: async () => ({ ok: true, value: { accepted: true } }),
      fetchTaskEvents: async () => {
        throw new Error("fetchTaskEvents should not be called");
      },
    },
    runTask: async () => result,
    appendAudit: () => undefined,
    lifecycleHooks: {
      onTaskStart: (_task, activeSkills) => {
        starts.push(activeSkills.map((skill) => skill.name));
        return { ok: true, dir: projectRoot, warnings: [] };
      },
      onTaskStop: () => ({ ok: true, dir: projectRoot, warnings: [] }),
    },
  });

  assert.equal(response.ok, true);
  assert.equal(starts[0]?.includes("lima-code:server-task-audit"), true);
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

test("executeLiMaCommand runs local plan stage without server submission", async () => {
  const response = await executeLiMaCommand("/lima plan", {
    projectRoot: process.cwd(),
    client: inertClient(),
    runTask: async (task) => {
      assert.equal(task.task_id, "local-plan");
      assert.equal(task.mode, "plan");
      assert.match(task.goal, /Plan/);
      return buildReviewResult("local-plan");
    },
    appendAudit: () => undefined,
  });

  assert.equal(response.ok, true);
  assert.match(response.message, /local-plan/);
});

test("executeLiMaCommand runs local test stage with explicit command", async () => {
  const response = await executeLiMaCommand("/lima test --cmd npm run check", {
    projectRoot: process.cwd(),
    client: inertClient(),
    runTask: async (task) => {
      assert.equal(task.task_id, "local-test");
      assert.equal(task.mode, "test");
      assert.deepEqual(task.allowed_tools, ["test"]);
      assert.deepEqual(task.test_commands, ["npm run check"]);
      assert.equal(
        task.constraints.some((constraint) => constraint.toLowerCase().startsWith("test:")),
        false
      );
      return {
        ...buildReviewResult("local-test"),
        status: "succeeded",
        summary: "All requested test commands passed.",
      };
    },
    appendAudit: () => undefined,
  });

  assert.equal(response.ok, true);
  assert.match(response.message, /local-test/);
  assert.match(response.message, /succeeded/);
});

test("executeLiMaCommand runs local ship readiness stage without deploy or push", async () => {
  const response = await executeLiMaCommand("/lima ship", {
    projectRoot: process.cwd(),
    client: inertClient(),
    runTask: async (task) => {
      assert.equal(task.task_id, "local-ship");
      assert.equal(task.mode, "ship");
      assert.deepEqual(task.allowed_tools, ["git_diff"]);
      assert.match(task.goal, /Ship readiness/);
      assert.equal(
        task.constraints.some((constraint) => /Do not deploy or push/i.test(constraint)),
        true
      );
      return buildReviewResult("local-ship");
    },
    appendAudit: () => undefined,
  });

  assert.equal(response.ok, true);
  assert.match(response.message, /local-ship/);
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

test("executeLiMaCommand rejects daemon start when env gate is off", async () => {
  const previous = process.env.LIMA_CODE_WORKER_DAEMON;
  delete process.env.LIMA_CODE_WORKER_DAEMON;
  try {
    const response = await executeLiMaCommand("/lima daemon start --max-minutes 1 --interval-ms 1", {
      projectRoot: process.cwd(),
      client: inertClient(),
    });
    assert.equal(response.ok, false);
    assert.match(response.message, /LIMA_CODE_WORKER_DAEMON=1/);
  } finally {
    if (previous === undefined) {
      delete process.env.LIMA_CODE_WORKER_DAEMON;
    } else {
      process.env.LIMA_CODE_WORKER_DAEMON = previous;
    }
  }
});

test("executeLiMaCommand daemon start idle-retries until a task appears", async () => {
  const previous = process.env.LIMA_CODE_WORKER_DAEMON;
  process.env.LIMA_CODE_WORKER_DAEMON = "1";
  let polls = 0;
  let clock = 0;
  const task: LiMaTaskRunnerRequest = {
    task_id: "daemon-task",
    repo: process.cwd(),
    branch: "main",
    goal: "Daemon smoke",
    constraints: [],
    allowed_tools: ["git_diff"],
    max_runtime_sec: 60,
    mode: "review",
  };
  const result: LiMaAgentTaskResult = {
    task_id: "daemon-task",
    status: "needs_review",
    summary: "Daemon ok",
    changed_files: [],
    test_commands: [],
    test_results: [],
    diff_preview: "",
    artifacts: [],
    risks: [],
    next_action: "approve",
  };
  try {
    const response = await executeLiMaCommand("/lima daemon start --max-minutes 1 --interval-ms 1 --backoff-ms 1", {
      projectRoot: process.cwd(),
      client: {
        ...inertClient(),
        fetchPendingTask: async () => {
          polls += 1;
          if (polls < 2) {
            return { ok: true, value: null };
          }
          if (polls === 2) {
            return { ok: true, value: task };
          }
          return { ok: true, value: null };
        },
        submitResult: async () => ({ ok: true, value: { accepted: true } }),
      },
      runTask: async () => result,
      appendAudit: () => undefined,
      sleep: async () => {
        clock += polls >= 2 ? 61_000 : 1;
      },
      now: () => clock,
    });
    assert.equal(response.ok, true);
    assert.match(response.message, /daemon-task/);
    assert.ok(polls >= 2);
  } finally {
    if (previous === undefined) {
      delete process.env.LIMA_CODE_WORKER_DAEMON;
    } else {
      process.env.LIMA_CODE_WORKER_DAEMON = previous;
    }
  }
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

test("executeLiMaCommand runs doctor without executing tasks", async () => {
  let pendingChecks = 0;

  const response = await executeLiMaCommand("/lima doctor", {
    projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), "lima-doctor-runner-")),
    client: {
      isConfigured: () => true,
      fetchTask: async () => {
        throw new Error("fetchTask should not be called");
      },
      fetchPendingTask: async () => {
        pendingChecks += 1;
        return { ok: true, value: null };
      },
      submitResult: async () => {
        throw new Error("submitResult should not be called");
      },
      fetchTaskEvents: async () => {
        throw new Error("fetchTaskEvents should not be called");
      },
    },
    runTask: async () => {
      throw new Error("runTask should not be called");
    },
    appendAudit: () => {
      throw new Error("appendAudit should not be called");
    },
  });

  assert.equal(response.ok, true);
  assert.equal(pendingChecks, 1);
  assert.match(response.message, /LiMa doctor/);
  assert.match(response.message, /server_reachable/);
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
