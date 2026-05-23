import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { isRepoAllowed, normalizeAllowedRepos } from "../lima/repo-allowlist";

test("normalizeAllowedRepos resolves absolute directories", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lima-allowed-"));

  assert.deepEqual(normalizeAllowedRepos([repo]), [path.resolve(repo)]);
});

test("isRepoAllowed accepts the current workspace", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lima-workspace-"));

  assert.equal(isRepoAllowed(workspace, { currentWorkspace: workspace, allowedRepos: [] }).ok, true);
});

test("isRepoAllowed rejects a sibling repo without explicit allowlist", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lima-workspace-"));
  const sibling = fs.mkdtempSync(path.join(os.tmpdir(), "lima-sibling-"));

  const result = isRepoAllowed(sibling, { currentWorkspace: workspace, allowedRepos: [] });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /not allowlisted/);
});

test("isRepoAllowed accepts configured additional repos", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lima-workspace-"));
  const sibling = fs.mkdtempSync(path.join(os.tmpdir(), "lima-sibling-"));

  const result = isRepoAllowed(sibling, { currentWorkspace: workspace, allowedRepos: [sibling] });

  assert.equal(result.ok, true);
});
