import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runLiMaAgentTask, type LiMaTaskRunnerRequest } from "../lima/task-runner";

function baseTask(repo: string, mode: LiMaTaskRunnerRequest["mode"]): LiMaTaskRunnerRequest {
  return {
    task_id: `task-${mode}`,
    repo,
    branch: "main",
    goal: `Run ${mode}`,
    constraints: [],
    allowed_tools: ["read", "write", "git_diff", "test"],
    max_runtime_sec: 600,
    mode,
  };
}

test("plan mode returns a read-only review result with artifacts", async () => {
  const repo = createTempRepo();
  const before = fs.readdirSync(repo);

  const result = await runLiMaAgentTask(
    { ...baseTask(repo, "plan"), constraints: ["Do not commit"] },
    { currentWorkspace: repo, projectRoot: repo }
  );

  assert.equal(result.status, "needs_review");
  assert.deepEqual(result.changed_files, []);
  assert.ok(result.artifacts.length > 0, "plan mode should produce artifacts");
  const after = fs.readdirSync(repo).filter((n) => n !== ".lima");
  assert.deepEqual(after, before);
});

test("patch mode writes explicit patch files inside the guarded repo", async () => {
  const repo = createTempRepo();
  const commands: string[] = [];

  const result = await runLiMaAgentTask(
    {
      ...baseTask(repo, "patch"),
      patch_files: [{ file_path: "src/demo.txt", content: "hello\n" }],
    },
    {
      currentWorkspace: repo,
      executeCommand: async (command) => {
        commands.push(command);
        if (command.includes("--name-only")) {
          return { exitCode: 0, stdout: "src/demo.txt\n", stderr: "", durationMs: 1 };
        }
        return { exitCode: 0, stdout: "diff --git a/src/demo.txt b/src/demo.txt\n", stderr: "", durationMs: 1 };
      },
    }
  );

  assert.equal(result.status, "needs_review");
  assert.equal(fs.readFileSync(path.join(repo, "src", "demo.txt"), "utf8"), "hello\n");
  assert.deepEqual(result.changed_files, ["src/demo.txt"]);
  assert.deepEqual(commands, ["git diff --name-only", "git diff --"]);
});

test("patch mode rejects paths outside the guarded repo", async () => {
  const repo = createTempRepo();

  const result = await runLiMaAgentTask(
    {
      ...baseTask(repo, "patch"),
      patch_files: [{ file_path: "../escape.txt", content: "nope\n" }],
    },
    { currentWorkspace: repo }
  );

  assert.equal(result.status, "blocked");
  assert.match(result.summary, /outside repo/);
});

test("test mode runs explicit test commands and captures evidence", async () => {
  const repo = createTempRepo();

  const result = await runLiMaAgentTask(
    { ...baseTask(repo, "test"), test_commands: ["npm.cmd run check"] },
    {
      currentWorkspace: repo,
      executeCommand: async (command, cwd, timeoutSec) => ({
        exitCode: 0,
        stdout: `${command} in ${cwd} with ${timeoutSec}`,
        stderr: "",
        durationMs: 12,
      }),
    }
  );

  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.test_commands, ["npm.cmd run check"]);
  assert.equal(result.test_results[0]?.exit_code, 0);
});

test("test mode de-duplicates explicit and constraint test commands", async () => {
  const repo = createTempRepo();
  const commands: string[] = [];

  const result = await runLiMaAgentTask(
    {
      ...baseTask(repo, "test"),
      constraints: ["test: npm.cmd run check"],
      test_commands: ["npm.cmd run check"],
    },
    {
      currentWorkspace: repo,
      executeCommand: async (command) => {
        commands.push(command);
        return { exitCode: 0, stdout: "ok", stderr: "", durationMs: 12 };
      },
    }
  );

  assert.equal(result.status, "succeeded");
  assert.deepEqual(commands, ["npm.cmd run check"]);
  assert.deepEqual(result.test_commands, ["npm.cmd run check"]);
});

test("test mode fails on the first failing command", async () => {
  const repo = createTempRepo();

  const result = await runLiMaAgentTask(
    { ...baseTask(repo, "test"), test_commands: ["npm.cmd run check"] },
    {
      currentWorkspace: repo,
      executeCommand: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "lint failed",
        durationMs: 12,
      }),
    }
  );

  assert.equal(result.status, "failed");
  assert.equal(result.test_results[0]?.stderr, "lint failed");
});

test("review mode reads git diff without modifying files", async () => {
  const repo = createTempRepo();
  fs.writeFileSync(path.join(repo, "existing.txt"), "unchanged\n", "utf8");

  const result = await runLiMaAgentTask(baseTask(repo, "review"), {
    currentWorkspace: repo,
    executeCommand: async (command) => {
      if (command.includes("--name-only")) {
        return { exitCode: 0, stdout: "existing.txt\n", stderr: "", durationMs: 1 };
      }
      return { exitCode: 0, stdout: "diff --git a/existing.txt b/existing.txt\n", stderr: "", durationMs: 1 };
    },
  });

  assert.equal(result.status, "needs_review");
  assert.deepEqual(result.changed_files, ["existing.txt"]);
  assert.equal(fs.readFileSync(path.join(repo, "existing.txt"), "utf8"), "unchanged\n");
});

test("runner blocks disallowed tools before execution", async () => {
  const repo = createTempRepo();
  const result = await runLiMaAgentTask(
    { ...baseTask(repo, "test"), allowed_tools: ["shell_write"], test_commands: ["npm.cmd run check"] },
    { currentWorkspace: repo }
  );

  assert.equal(result.status, "blocked");
  assert.match(result.summary, /disallowed tools/);
});

function createTempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lima-task-runner-"));
}
