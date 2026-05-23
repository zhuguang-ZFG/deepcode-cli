import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLiMaCommandHelp, parseLiMaCommand } from "../lima/commands";

test("parseLiMaCommand parses connect", () => {
  assert.deepEqual(parseLiMaCommand("/lima connect"), { ok: true, command: { kind: "connect" } });
});

test("parseLiMaCommand parses status", () => {
  assert.deepEqual(parseLiMaCommand("/lima status"), { ok: true, command: { kind: "status" } });
});

test("parseLiMaCommand parses task id", () => {
  assert.deepEqual(parseLiMaCommand("/lima task task-123"), {
    ok: true,
    command: { kind: "task", taskId: "task-123" },
  });
});

test("parseLiMaCommand parses next pending task", () => {
  assert.deepEqual(parseLiMaCommand("/lima next"), { ok: true, command: { kind: "next" } });
});

test("parseLiMaCommand parses work once", () => {
  assert.deepEqual(parseLiMaCommand("/lima work --once"), {
    ok: true,
    command: { kind: "work", mode: "once", maxTasks: 1, maxMinutes: 60, intervalMs: 5000, backoffMs: 30000 },
  });
});

test("parseLiMaCommand parses bounded work loop", () => {
  assert.deepEqual(
    parseLiMaCommand("/lima work --loop --max-tasks 2 --max-minutes 3 --interval-ms 10 --backoff-ms 20"),
    {
      ok: true,
      command: { kind: "work", mode: "loop", maxTasks: 2, maxMinutes: 3, intervalMs: 10, backoffMs: 20 },
    }
  );
});

test("parseLiMaCommand rejects invalid max minutes", () => {
  const result = parseLiMaCommand("/lima work --loop --max-tasks 2 --max-minutes 0");

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /max-minutes/);
});

test("parseLiMaCommand preserves default work loop budget", () => {
  assert.deepEqual(parseLiMaCommand("/lima work --loop --max-tasks 2 --interval-ms 10 --backoff-ms 20"), {
    ok: true,
    command: { kind: "work", mode: "loop", maxTasks: 2, maxMinutes: 60, intervalMs: 10, backoffMs: 20 },
  });
});

test("parseLiMaCommand rejects unbounded work loop", () => {
  const result = parseLiMaCommand("/lima work --loop");

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /max-tasks/);
});

test("parseLiMaCommand parses review", () => {
  assert.deepEqual(parseLiMaCommand("/lima review"), { ok: true, command: { kind: "review" } });
});

test("parseLiMaCommand fails safely when task id is missing", () => {
  const result = parseLiMaCommand("/lima task");

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /task <task_id>/);
});

test("parseLiMaCommand rejects unrelated slash commands", () => {
  const result = parseLiMaCommand("/mcp");

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /\/lima/);
});

test("formatLiMaCommandHelp lists supported subcommands", () => {
  const help = formatLiMaCommandHelp();

  assert.match(help, /\/lima connect/);
  assert.match(help, /\/lima next/);
  assert.match(help, /\/lima work --once/);
  assert.match(help, /\/lima task <task_id>/);
});
