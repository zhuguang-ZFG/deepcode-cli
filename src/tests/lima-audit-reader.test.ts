import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { formatAuditSummary, readRecentAuditEntries } from "../lima/audit-reader";

test("readRecentAuditEntries returns newest entries first", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lima-audit-read-"));
  const dir = path.join(root, ".lima-code");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "audit.jsonl"),
    [
      JSON.stringify({ task_id: "old", status: "needs_review", created_at: "2026-05-23T00:00:00.000Z" }),
      JSON.stringify({ task_id: "new", status: "failed", created_at: "2026-05-23T00:01:00.000Z" }),
    ].join("\n") + "\n",
    "utf8"
  );

  const entries = readRecentAuditEntries(root, 1);

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.task_id, "new");
});

test("readRecentAuditEntries accepts current audit timestamp field", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lima-audit-read-"));
  const dir = path.join(root, ".lima-code");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "audit.jsonl"),
    JSON.stringify({ task_id: "task-ts", status: "needs_review", timestamp: "2026-05-23T00:02:00.000Z" }) + "\n",
    "utf8"
  );

  const entries = readRecentAuditEntries(root, 1);

  assert.equal(entries[0]?.task_id, "task-ts");
  assert.equal(entries[0]?.created_at, "2026-05-23T00:02:00.000Z");
});

test("formatAuditSummary includes status and task id", () => {
  const text = formatAuditSummary([{ task_id: "task-1", status: "needs_review", mode: "review" }]);

  assert.match(text, /task-1/);
  assert.match(text, /needs_review/);
});
