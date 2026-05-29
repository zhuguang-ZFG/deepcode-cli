import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { runDroneLoop, probeOnly, type DroneConfig, type DroneCallbacks } from "../lima/drone";
import type { LiMaAgentTaskResult } from "../lima/agent-task-types";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lima-drone-test-"));
}

function makeSuccessResult(taskId: string): LiMaAgentTaskResult {
  return {
    task_id: taskId,
    status: "needs_review",
    summary: "Fixed bare except",
    changed_files: ["a.py"],
    test_commands: [],
    test_results: [],
    diff_preview: "",
    risks: [],
    next_action: "",
    artifacts: [],
  };
}

function makeFailedResult(taskId: string): LiMaAgentTaskResult {
  return {
    task_id: taskId,
    status: "failed",
    summary: "Could not fix",
    changed_files: [],
    test_commands: [],
    test_results: [],
    diff_preview: "",
    risks: ["might break"],
    next_action: "",
    artifacts: [],
  };
}

test("probeOnly: returns JSON when requested", () => {
  const tmpDir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmpDir, "a.py"), "TODO: fix\n");
    const output = probeOnly(tmpDir, true);
    const parsed = JSON.parse(output);
    assert.ok("findings" in parsed);
    assert.ok("scannedFiles" in parsed);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("probeOnly: returns human-readable table by default", () => {
  const tmpDir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmpDir, "a.py"), "TODO: fix\n");
    const output = probeOnly(tmpDir, false);
    assert.ok(output.includes("Scanned"));
    assert.ok(output.includes("TODO"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("probeOnly: reports clean codebase", () => {
  const tmpDir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmpDir, "clean.py"), "def hello():\n    return 1\n");
    const output = probeOnly(tmpDir, false);
    assert.ok(output.includes("No actionable findings"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("drone: empty report for clean codebase", async () => {
  const tmpDir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmpDir, "clean.py"), "def hello():\n    return 1\n");
    const callbacks: DroneCallbacks = {
      runTask: async () => makeSuccessResult("test"),
    };
    const config: DroneConfig = {
      projectRoot: tmpDir,
      maxTasks: 5,
      maxMinutes: 1,
      allowMediumRisk: false,
      intervalMs: 0,
    };
    const report = await runDroneLoop(config, callbacks);
    assert.equal(report.tasksAttempted, 0);
    assert.equal(report.findingsRemaining, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("drone: executes trivial findings", async () => {
  const tmpDir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmpDir, "bare.py"), "try:\n    pass\nexcept:\n    pass\n");
    const executed: string[] = [];
    const callbacks: DroneCallbacks = {
      runTask: async (task) => {
        executed.push(task.task_id);
        return makeSuccessResult(task.task_id);
      },
    };
    const config: DroneConfig = {
      projectRoot: tmpDir,
      maxTasks: 5,
      maxMinutes: 1,
      allowMediumRisk: false,
      intervalMs: 0,
    };
    const report = await runDroneLoop(config, callbacks);
    assert.ok(report.tasksAttempted >= 1);
    assert.ok(report.tasksSucceeded >= 1);
    assert.ok(executed.length >= 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("drone: respects maxTasks budget", async () => {
  const tmpDir = makeTmpDir();
  try {
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(tmpDir, `file${i}.py`), "try:\n    pass\nexcept:\n    pass\n");
    }
    let count = 0;
    const callbacks: DroneCallbacks = {
      runTask: async (task) => {
        count++;
        return makeSuccessResult(task.task_id);
      },
    };
    const config: DroneConfig = {
      projectRoot: tmpDir,
      maxTasks: 3,
      maxMinutes: 10,
      allowMediumRisk: false,
      intervalMs: 0,
    };
    const report = await runDroneLoop(config, callbacks);
    // Budget limits: exactly maxTasks tasks should be executed
    assert.ok(
      report.tasksSucceeded + report.tasksFailed <= config.maxTasks,
      `expected total <= ${config.maxTasks}, got ${report.tasksSucceeded + report.tasksFailed}`
    );
    assert.ok(count <= config.maxTasks, `expected count <= ${config.maxTasks}, got ${count}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("drone: includes messages in report", async () => {
  const tmpDir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmpDir, "clean.py"), "def hello():\n    return 1\n");
    const callbacks: DroneCallbacks = {
      runTask: async () => makeSuccessResult("test"),
    };
    const config: DroneConfig = {
      projectRoot: tmpDir,
      maxTasks: 5,
      maxMinutes: 1,
      allowMediumRisk: false,
      intervalMs: 0,
    };
    const report = await runDroneLoop(config, callbacks);
    assert.ok(report.messages.length > 0);
    assert.ok(report.messages.some((m) => m.includes("Probe:")));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("drone: submitResult called when configured", async () => {
  const tmpDir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmpDir, "bare.py"), "try:\n    pass\nexcept:\n    pass\n");
    let submitted = false;
    const callbacks: DroneCallbacks = {
      runTask: async (task) => makeSuccessResult(task.task_id),
      submitResult: async () => {
        submitted = true;
        return { ok: true };
      },
    };
    const config: DroneConfig = {
      projectRoot: tmpDir,
      maxTasks: 5,
      maxMinutes: 1,
      allowMediumRisk: false,
      intervalMs: 0,
    };
    await runDroneLoop(config, callbacks);
    assert.ok(submitted);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
