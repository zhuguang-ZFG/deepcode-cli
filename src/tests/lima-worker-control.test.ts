import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { clearWorkerStop, readWorkerStop, requestWorkerStop } from "../lima/worker-control";

test("worker control reads no stop marker by default", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lima-worker-control-"));

  assert.deepEqual(readWorkerStop(root), { stop: false, reason: "" });
});

test("worker control writes and clears stop marker", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lima-worker-control-"));

  const file = requestWorkerStop(root, "test_stop");
  assert.equal(fs.existsSync(file), true);
  assert.deepEqual(readWorkerStop(root), { stop: true, reason: "test_stop" });

  clearWorkerStop(root);
  assert.deepEqual(readWorkerStop(root), { stop: false, reason: "" });
});
