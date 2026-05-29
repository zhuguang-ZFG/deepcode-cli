import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
  hasActiveCheckpoint,
  snapshotFiles,
  rollbackSnapshots,
  isStale,
  type Checkpoint,
} from "../lima/checkpoint";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lima-cp-test-"));
}

function makeCheckpoint(overrides?: Partial<Checkpoint>): Checkpoint {
  return {
    taskId: "test-001",
    findingId: "f-abc",
    mode: "patch",
    status: "executing",
    snapshotDir: "",
    startedAt: new Date().toISOString(),
    progress: ["claimed"],
    ...overrides,
  };
}

test("checkpoint: save and load", () => {
  const tmpDir = makeTmpDir();
  try {
    const cp = makeCheckpoint();
    saveCheckpoint(tmpDir, cp);
    const loaded = loadCheckpoint(tmpDir);
    assert.notEqual(loaded, null);
    assert.equal(loaded!.taskId, "test-001");
    assert.equal(loaded!.mode, "patch");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("checkpoint: load returns null when no checkpoint", () => {
  const tmpDir = makeTmpDir();
  try {
    assert.equal(loadCheckpoint(tmpDir), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("checkpoint: clear removes current checkpoint", () => {
  const tmpDir = makeTmpDir();
  try {
    saveCheckpoint(tmpDir, makeCheckpoint());
    assert.notEqual(loadCheckpoint(tmpDir), null);
    clearCheckpoint(tmpDir);
    assert.equal(loadCheckpoint(tmpDir), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("checkpoint: clear moves previous to history", () => {
  const tmpDir = makeTmpDir();
  try {
    saveCheckpoint(tmpDir, makeCheckpoint({ taskId: "first" }));
    saveCheckpoint(tmpDir, makeCheckpoint({ taskId: "second" }));
    clearCheckpoint(tmpDir);
    assert.equal(loadCheckpoint(tmpDir), null);
    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, ".lima-code", "checkpoint.json"), "utf8"));
    assert.equal(raw.history.length, 2);
    assert.equal(raw.history[0].taskId, "second");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("checkpoint: hasActiveCheckpoint", () => {
  const tmpDir = makeTmpDir();
  try {
    assert.equal(hasActiveCheckpoint(tmpDir), false);
    saveCheckpoint(tmpDir, makeCheckpoint());
    assert.equal(hasActiveCheckpoint(tmpDir), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("checkpoint: isStale for old checkpoint", () => {
  const cp = makeCheckpoint({
    startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  assert.equal(isStale(cp), true);
});

test("checkpoint: isStale for fresh checkpoint", () => {
  const cp = makeCheckpoint();
  assert.equal(isStale(cp), false);
});

test("checkpoint: isStale for invalid date", () => {
  const cp = makeCheckpoint({ startedAt: "not-a-date" });
  assert.equal(isStale(cp), true);
});

test("checkpoint: snapshotFiles copies files", () => {
  const tmpDir = makeTmpDir();
  try {
    const file1 = path.join(tmpDir, "src", "test.py");
    fs.mkdirSync(path.dirname(file1), { recursive: true });
    fs.writeFileSync(file1, "print('hello')\n");

    const snapDir = snapshotFiles(tmpDir, ["src/test.py"]);
    assert.ok(fs.existsSync(snapDir));
    assert.equal(fs.readFileSync(path.join(snapDir, "src", "test.py"), "utf8"), "print('hello')\n");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("checkpoint: rollbackSnapshots restores and cleans up", () => {
  const tmpDir = makeTmpDir();
  try {
    const file1 = path.join(tmpDir, "src", "test.py");
    fs.mkdirSync(path.dirname(file1), { recursive: true });
    fs.writeFileSync(file1, "original content");

    const snapDir = snapshotFiles(tmpDir, ["src/test.py"]);
    fs.writeFileSync(file1, "modified content");

    const cp = makeCheckpoint({ snapshotDir: snapDir });
    const restored = rollbackSnapshots(tmpDir, cp);
    assert.equal(restored, 1);
    assert.equal(fs.readFileSync(file1, "utf8"), "original content");
    assert.ok(!fs.existsSync(snapDir));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("checkpoint: snapshotFiles skips nonexistent files", () => {
  const tmpDir = makeTmpDir();
  try {
    const snapDir = snapshotFiles(tmpDir, ["nonexistent.py"]);
    assert.ok(fs.existsSync(snapDir));
    const entries = fs.readdirSync(snapDir);
    assert.equal(entries.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
