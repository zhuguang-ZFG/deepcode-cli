import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PROMPT_OUTPUT,
  migrateFromLegacy,
  renderPromptContract,
  resolvePromptContract,
} from "../lima/prompt-contract";

test("migrateFromLegacy maps goal and test commands", () => {
  const contract = migrateFromLegacy({
    goal: "fix routing bug",
    constraints: ["no deploy"],
    test_commands: ["pytest -q"],
    mode: "patch",
  });
  const rendered = renderPromptContract(contract);
  assert.match(rendered, /## Task\nfix routing bug/);
  assert.match(rendered, /## Verify\n- pytest -q/);
  assert.match(rendered, /## Output\n/);
  assert.match(rendered, new RegExp(DEFAULT_PROMPT_OUTPUT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("resolvePromptContract prefers explicit task", () => {
  const contract = resolvePromptContract({ goal: "legacy", mode: "patch" }, { task: "explicit", context: "ctx" });
  assert.equal(contract.task, "explicit");
  assert.equal(contract.context, "ctx");
});
