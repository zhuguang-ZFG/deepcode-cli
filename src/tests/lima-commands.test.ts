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
  assert.match(help, /\/lima task <task_id>/);
});
