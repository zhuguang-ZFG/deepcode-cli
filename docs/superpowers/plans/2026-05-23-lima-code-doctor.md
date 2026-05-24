# LiMa Code Doctor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/lima doctor`, a read-only preflight command for LiMa Code real-machine smoke testing.

**Architecture:** Keep diagnostics in a focused `src/lima/doctor.ts` module. The parser recognizes `/lima doctor`, and the command runner delegates to the doctor module without executing tasks or mutating worker state.

**Tech Stack:** TypeScript, Node.js `node:test`, existing LiMa Code command runner and local `.lima-code` state files.

---

### Task 1: Parse Doctor Command

**Files:**
- Modify: `src/lima/commands.ts`
- Test: `src/tests/lima-commands.test.ts`

- [x] **Step 1: Write the failing test**

Add a test asserting:

```typescript
assert.deepEqual(parseLiMaCommand("/lima doctor"), { ok: true, command: { kind: "doctor" } });
```

Also assert `formatLiMaCommandHelp()` includes `/lima doctor`.

- [x] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- src/tests/lima-commands.test.ts`
Expected: FAIL because `/lima doctor` is not parsed yet.

- [x] **Step 3: Implement parser support**

Add `{ kind: "doctor" }` to `LiMaCommand`, parse the subcommand, and include it in help and usage text.

- [x] **Step 4: Run parser tests**

Run: `npm.cmd test -- src/tests/lima-commands.test.ts`
Expected: PASS.

### Task 2: Doctor Module

**Files:**
- Create: `src/lima/doctor.ts`
- Test: `src/tests/lima-doctor.test.ts`

- [x] **Step 1: Write failing tests**

Cover:

- Configured Server returns `pass` for server checks.
- Missing Server config returns a `fail` check and does not call `fetchPendingTask`.
- Pending stop marker returns a `fail` check.
- Output redacts common secret values.

- [x] **Step 2: Run tests to verify they fail**

Run: `npm.cmd test -- src/tests/lima-doctor.test.ts`
Expected: FAIL because `src/lima/doctor.ts` does not exist.

- [x] **Step 3: Implement minimal module**

Export:

```typescript
export type LiMaDoctorStatus = "pass" | "warn" | "fail";
export type LiMaDoctorCheck = { name: string; status: LiMaDoctorStatus; detail: string };
export type LiMaDoctorReport = { ok: boolean; checks: LiMaDoctorCheck[] };
export async function runLiMaDoctor(options: LiMaDoctorOptions): Promise<LiMaDoctorReport>;
export function formatLiMaDoctorReport(report: LiMaDoctorReport): string;
```

- [x] **Step 4: Run doctor tests**

Run: `npm.cmd test -- src/tests/lima-doctor.test.ts`
Expected: PASS.

### Task 3: Command Runner Integration

**Files:**
- Modify: `src/lima/command-runner.ts`
- Test: `src/tests/lima-command-runner.test.ts`

- [x] **Step 1: Write failing integration test**

Add a test that runs `/lima doctor` with a fake configured client and asserts:

- `response.ok === true`
- message includes `LiMa doctor`
- no task execution or result submission occurs.

- [x] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- src/tests/lima-command-runner.test.ts`
Expected: FAIL because the runner does not handle `doctor` yet.

- [x] **Step 3: Implement runner branch**

Call `runLiMaDoctor({ projectRoot, client })` and return formatted output.

- [x] **Step 4: Run integration tests**

Run: `npm.cmd test -- src/tests/lima-doctor.test.ts src/tests/lima-commands.test.ts src/tests/lima-command-runner.test.ts`
Expected: PASS.

### Task 4: Verification

**Files:**
- No new files.

- [x] **Step 1: Run LiMa targeted tests**

Run:

```powershell
npm.cmd test -- src/tests/lima-doctor.test.ts src/tests/lima-commands.test.ts src/tests/lima-command-runner.test.ts
```

Expected: all selected tests pass.

- [x] **Step 2: Run full check**

Run: `npm.cmd run check`
Expected: typecheck, lint, and format check pass.
