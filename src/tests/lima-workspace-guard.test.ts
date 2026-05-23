import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { assertLiMaTaskToolsAllowed, resolveLiMaTaskRepo, resolveLiMaTaskRuntimeSec } from "../lima/workspace-guard";

test("resolveLiMaTaskRepo accepts a repo inside the current workspace", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lima-workspace-"));
  const repo = path.join(workspace, "repo");
  fs.mkdirSync(repo);

  const result = resolveLiMaTaskRepo(repo, { currentWorkspace: workspace });

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value : "", fs.realpathSync(repo).toLowerCase());
});

test("resolveLiMaTaskRepo rejects parent traversal outside the workspace", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lima-workspace-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "lima-outside-"));

  const result = resolveLiMaTaskRepo(path.join(workspace, "..", path.basename(outside)), {
    currentWorkspace: workspace,
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /not allowlisted/);
});

test("resolveLiMaTaskRepo allows explicitly configured additional roots", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lima-workspace-"));
  const extraRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-extra-"));
  const repo = path.join(extraRoot, "repo");
  fs.mkdirSync(repo);

  const result = resolveLiMaTaskRepo(repo, {
    currentWorkspace: workspace,
    allowedRoots: [extraRoot],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value : "", fs.realpathSync(repo).toLowerCase());
});

test("resolveLiMaTaskRepo allows explicitly configured allowed repos", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lima-workspace-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lima-allowed-repo-"));

  const result = resolveLiMaTaskRepo(repo, {
    currentWorkspace: workspace,
    allowedRepos: [repo],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value : "", fs.realpathSync(repo).toLowerCase());
});

test("assertLiMaTaskToolsAllowed accepts task-scoped safe tools", () => {
  const result = assertLiMaTaskToolsAllowed(["read", "git_diff", "test"]);

  assert.deepEqual(result, { ok: true, value: ["read", "git_diff", "test"] });
});

test("assertLiMaTaskToolsAllowed rejects destructive or unknown tools", () => {
  const result = assertLiMaTaskToolsAllowed(["read", "shell_write"]);

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /shell_write/);
});

test("resolveLiMaTaskRuntimeSec defaults to 600 seconds", () => {
  assert.deepEqual(resolveLiMaTaskRuntimeSec(undefined), { ok: true, value: 600 });
});

test("resolveLiMaTaskRuntimeSec caps long-running tasks", () => {
  assert.deepEqual(resolveLiMaTaskRuntimeSec(3600), { ok: true, value: 1800 });
});

test("resolveLiMaTaskRuntimeSec rejects invalid runtimes", () => {
  const result = resolveLiMaTaskRuntimeSec(0);

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /positive integer/);
});
