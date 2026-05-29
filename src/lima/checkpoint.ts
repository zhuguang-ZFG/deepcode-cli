/**
 * Drone checkpoint — persist task execution state for crash recovery.
 *
 * Files:
 *   .lima-code/checkpoint.json          current + history
 *   .lima-code/snapshots/{taskId}/      file snapshots for rollback
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// ─── Types ────────────────────────────────────────────────────────────────

export type CheckpointMode = "plan" | "patch" | "test" | "review" | "ship";

export type Checkpoint = {
  taskId: string;
  findingId: string;
  mode: CheckpointMode;
  status: "claimed" | "executing" | "submitted";
  snapshotDir: string;
  startedAt: string;
  progress: string[];
};

type CheckpointStore = {
  current: Checkpoint | null;
  history: Checkpoint[];
};

const MAX_HISTORY = 10;
const DEFAULT_STALE_MS = 30 * 60 * 1000; // 30 minutes

// ─── Save / Load / Clear ──────────────────────────────────────────────────

export function saveCheckpoint(projectRoot: string, checkpoint: Checkpoint): void {
  const store = readStore(projectRoot);
  // Move previous current to history if present
  if (store.current && store.current.taskId !== checkpoint.taskId) {
    store.history.unshift(store.current);
    if (store.history.length > MAX_HISTORY) {
      store.history = store.history.slice(0, MAX_HISTORY);
    }
  }
  store.current = checkpoint;
  writeStore(projectRoot, store);
}

export function loadCheckpoint(projectRoot: string): Checkpoint | null {
  return readStore(projectRoot).current;
}

export function clearCheckpoint(projectRoot: string): void {
  const store = readStore(projectRoot);
  if (store.current) {
    store.history.unshift(store.current);
    if (store.history.length > MAX_HISTORY) {
      store.history = store.history.slice(0, MAX_HISTORY);
    }
  }
  store.current = null;
  writeStore(projectRoot, store);
}

// ─── Checkpoint Lock ──────────────────────────────────────────────────────

export function hasActiveCheckpoint(projectRoot: string): boolean {
  const cp = loadCheckpoint(projectRoot);
  return cp !== null && !isStale(cp);
}

// ─── File Snapshots ───────────────────────────────────────────────────────

export function snapshotFiles(projectRoot: string, files: string[]): string {
  const taskId = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const snapshotDir = path.join(projectRoot, ".lima-code", "snapshots", taskId);
  fs.mkdirSync(snapshotDir, { recursive: true });

  for (const relPath of files) {
    const absPath = path.resolve(projectRoot, relPath);
    if (!fs.existsSync(absPath)) continue;
    // Ensure the relative directory structure is preserved
    const destDir = path.join(snapshotDir, path.dirname(relPath));
    fs.mkdirSync(destDir, { recursive: true });
    try {
      fs.copyFileSync(absPath, path.join(snapshotDir, relPath));
    } catch {
      // Skip unreadable files
    }
  }

  return snapshotDir;
}

export function rollbackSnapshots(projectRoot: string, checkpoint: Checkpoint): number {
  const snapshotDir = checkpoint.snapshotDir;
  if (!snapshotDir || !fs.existsSync(snapshotDir)) return 0;

  let restored = 0;
  walkSnapshotDir(snapshotDir, (relPath, absPath) => {
    const target = path.resolve(projectRoot, relPath);
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(absPath, target);
      restored++;
    } catch {
      // Skip unresolvable targets
    }
  });

  // Clean up snapshots after rollback
  try {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }

  return restored;
}

// ─── Staleness ────────────────────────────────────────────────────────────

export function isStale(checkpoint: Checkpoint, maxAgeMs = DEFAULT_STALE_MS): boolean {
  const started = new Date(checkpoint.startedAt).getTime();
  if (isNaN(started)) return true;
  return Date.now() - started > maxAgeMs;
}

// ─── Internal ─────────────────────────────────────────────────────────────

function checkpointPath(projectRoot: string): string {
  return path.join(projectRoot, ".lima-code", "checkpoint.json");
}

function readStore(projectRoot: string): CheckpointStore {
  const file = checkpointPath(projectRoot);
  if (!fs.existsSync(file)) {
    return { current: null, history: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<CheckpointStore>;
    return {
      current: raw.current ?? null,
      history: Array.isArray(raw.history) ? raw.history.slice(0, MAX_HISTORY) : [],
    };
  } catch {
    return { current: null, history: [] };
  }
}

function writeStore(projectRoot: string, store: CheckpointStore): void {
  const file = checkpointPath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Atomic write: write to tmp then rename
  const tmp = `${file}.tmp.${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function walkSnapshotDir(
  dir: string,
  callback: (relativePath: string, absolutePath: string) => void,
  baseDir?: string
): void {
  const root = baseDir ?? dir;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSnapshotDir(abs, callback, root);
    } else {
      callback(path.relative(root, abs), abs);
    }
  }
}
