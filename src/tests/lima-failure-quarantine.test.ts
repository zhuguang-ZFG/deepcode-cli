import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { recordTaskFailure, shouldQuarantineTask } from "../lima/failure-quarantine";

test("failure quarantine starts below threshold", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lima-quarantine-"));

  recordTaskFailure(root, "task-1", "failed once");
  const result = shouldQuarantineTask(root, "task-1", 3);

  assert.equal(result.quarantine, false);
  assert.equal(result.failureCount, 1);
});

test("failure quarantine triggers at threshold", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lima-quarantine-"));

  recordTaskFailure(root, "task-1", "failed 1");
  recordTaskFailure(root, "task-1", "failed 2");
  recordTaskFailure(root, "task-1", "failed 3");
  const result = shouldQuarantineTask(root, "task-1", 3);

  assert.equal(result.quarantine, true);
  assert.equal(result.failureCount, 3);
  assert.match(result.reason, /failed 3/);
});
