import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkerBudget } from "../lima/worker-budget";

test("worker budget allows work within limits", () => {
  const budget = createWorkerBudget({ maxTasks: 2, maxMinutes: 5, now: () => 0 });

  assert.equal(budget.canStartNext().ok, true);
  budget.recordTask();
  assert.equal(budget.canStartNext().ok, true);
});

test("worker budget stops at max tasks", () => {
  const budget = createWorkerBudget({ maxTasks: 1, maxMinutes: 5, now: () => 0 });

  budget.recordTask();
  const result = budget.canStartNext();

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /task budget/);
});

test("worker budget stops at max minutes", () => {
  let now = 0;
  const budget = createWorkerBudget({ maxTasks: 10, maxMinutes: 1, now: () => now });

  now = 61_000;
  const result = budget.canStartNext();

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /time budget/);
});
