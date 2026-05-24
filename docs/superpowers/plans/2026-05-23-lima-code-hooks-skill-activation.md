# LiMa Code Hooks + Skill Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a controlled LiMa Code worker hook layer that records task context and selects candidate skills before execution.

**Architecture:** Keep the feature local to LiMa Code. Add one pure skill activation module, one file-system lifecycle hook module, and a narrow command runner integration point. The Server task contract and task runner execution semantics remain unchanged.

**Tech Stack:** TypeScript, Node.js `node:test`, local `.lima-code` state files, existing LiMa Code command runner.

---

### Task 1: Skill Activation Rules

**Files:**
- Create: `src/lima/skill-activation.ts`
- Test: `src/tests/lima-skill-activation.test.ts`

- [x] **Step 1: Write failing tests**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateLiMaSkillActivation } from "../lima/skill-activation";

test("evaluateLiMaSkillActivation activates TDD and security rules for patch tasks", () => {
  const active = evaluateLiMaSkillActivation({
    task_id: "task-1",
    repo: process.cwd(),
    branch: "main",
    goal: "Patch Telegram token handling",
    constraints: ["test: npm test"],
    allowed_tools: ["write", "test"],
    max_runtime_sec: 60,
    mode: "patch",
    test_commands: ["npm test"],
  });

  assert.deepEqual(
    active.map((skill) => skill.name),
    ["superpowers:test-driven-development", "security-review"]
  );
  assert.match(active[0]?.reason ?? "", /patch/i);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- src/tests/lima-skill-activation.test.ts`
Expected: FAIL because `../lima/skill-activation` does not exist.

- [x] **Step 3: Implement minimal module**

Create `src/lima/skill-activation.ts` with exported types `LiMaActiveSkill`, `LiMaSkillActivationRule`, and function `evaluateLiMaSkillActivation(task, rules?)`.

- [x] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- src/tests/lima-skill-activation.test.ts`
Expected: PASS.

### Task 2: Lifecycle Hook Writer

**Files:**
- Create: `src/lima/lifecycle-hooks.ts`
- Test: `src/tests/lima-lifecycle-hooks.test.ts`

- [x] **Step 1: Write failing tests**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeLiMaTaskStartHook, writeLiMaTaskStopHook } from "../lima/lifecycle-hooks";

test("lifecycle hooks write task context and summary under the project root", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-hooks-"));
  const start = writeLiMaTaskStartHook(projectRoot, task, activeSkills);
  const stop = writeLiMaTaskStopHook(projectRoot, result);

  assert.equal(start.ok, true);
  assert.equal(stop.ok, true);
  assert.match(fs.readFileSync(path.join(start.dir, "context.md"), "utf8"), /Patch README/);
  assert.match(fs.readFileSync(path.join(stop.dir, "summary.md"), "utf8"), /needs_review/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- src/tests/lima-lifecycle-hooks.test.ts`
Expected: FAIL because `../lima/lifecycle-hooks` does not exist.

- [x] **Step 3: Implement minimal hook writer**

Create `src/lima/lifecycle-hooks.ts` with sanitized task directory creation and markdown writers for `context.md`, `tasks.md`, `summary.md`, and `touched-files.txt`.

- [x] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- src/tests/lima-lifecycle-hooks.test.ts`
Expected: PASS.

### Task 3: Command Runner Integration

**Files:**
- Modify: `src/lima/command-runner.ts`
- Test: `src/tests/lima-command-runner.test.ts`

- [x] **Step 1: Write failing integration test**

Add a test that injects lifecycle hooks into `executeLiMaCommand`, runs `/lima task <id>`, and asserts the start hook receives active skills before the stop hook receives the result.

- [x] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- src/tests/lima-command-runner.test.ts`
Expected: FAIL because command runner does not accept lifecycle hooks yet.

- [x] **Step 3: Implement integration**

Add optional `lifecycleHooks` to `LiMaCommandRunnerOptions`. Default to file-system hooks, but allow `false` for tests or callers that need no local writes.

- [x] **Step 4: Run targeted tests**

Run:

```powershell
npm.cmd test -- src/tests/lima-skill-activation.test.ts src/tests/lima-lifecycle-hooks.test.ts src/tests/lima-command-runner.test.ts
```

Expected: all targeted tests pass.

### Task 4: Full Verification

**Files:**
- No new files.

- [x] **Step 1: Run full check**

Run: `npm.cmd run check`
Expected: typecheck, lint, and format check pass.

- [x] **Step 2: Run relevant LiMa tests**

Run:

```powershell
npm.cmd test -- src/tests/lima-skill-activation.test.ts src/tests/lima-lifecycle-hooks.test.ts src/tests/lima-command-runner.test.ts src/tests/lima-telegram-notifier.test.ts
```

Expected: all selected tests pass.

### Task 5: Project Skill Rules

**Files:**
- Modify: `src/lima/skill-activation.ts`
- Modify: `src/lima/command-runner.ts`
- Test: `src/tests/lima-skill-activation.test.ts`
- Test: `src/tests/lima-command-runner.test.ts`

- [x] **Step 1: Write failing tests**

Add tests proving `.lima-code/skill-rules.json` activates project rules and malformed config falls back to defaults.

- [x] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm.cmd test -- src/tests/lima-skill-activation.test.ts src/tests/lima-command-runner.test.ts
```

Expected: FAIL because project rule loading does not exist.

- [x] **Step 3: Implement rule loading**

Add `evaluateLiMaSkillActivationForProject(task, projectRoot)` that merges default rules with valid `.lima-code/skill-rules.json` rules.

- [x] **Step 4: Wire command runner**

Use project-aware activation before lifecycle start hooks.

- [x] **Step 5: Run verification**

Run:

```powershell
npm.cmd run check
npm.cmd test -- src/tests/lima-skill-activation.test.ts src/tests/lima-lifecycle-hooks.test.ts src/tests/lima-command-runner.test.ts src/tests/lima-telegram-notifier.test.ts
```

Expected: check and selected tests pass.
