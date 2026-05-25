import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type {
  LiMaAgentTaskPatchFile,
  LiMaAgentTaskRequest,
  LiMaAgentTaskResult,
  LiMaAgentTaskTestResult,
} from "./agent-task-types";
import {
  snapshotContext,
  writePlanArtifacts,
  writeReviewArtifacts,
  writeShipArtifacts,
  writeTestArtifacts,
  type ArtifactBundle,
  type ContextSnapshot,
} from "./artifact-bundle";
import { buildLiMaTaskResult, parseChangedFilesFromGitNameOnly, truncateText } from "./result-builder";
import {
  assertLiMaTaskToolsAllowed,
  resolveLiMaTaskRepo,
  resolveLiMaTaskRuntimeSec,
  type LiMaWorkspaceGuardConfig,
} from "./workspace-guard";

export type LiMaPatchFile = LiMaAgentTaskPatchFile;

export type LiMaTaskRunnerRequest = LiMaAgentTaskRequest & {
  test_commands?: string[];
  patch_files?: LiMaPatchFile[];
};

export type LiMaCommandExecution = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type LiMaTaskRunnerConfig = LiMaWorkspaceGuardConfig & {
  executeCommand?: (command: string, cwd: string, timeoutSec: number) => Promise<LiMaCommandExecution>;
  projectRoot?: string;
};

export async function runLiMaAgentTask(
  task: LiMaTaskRunnerRequest,
  config: LiMaTaskRunnerConfig
): Promise<LiMaAgentTaskResult> {
  const guard = prepareTask(task, config);
  if (!guard.ok) {
    return blockedResult(task, guard.error);
  }

  switch (task.mode) {
    case "plan":
      return runPlanMode(task, config.projectRoot ?? guard.value.repoRoot);
    case "patch":
      return runPatchMode(task, guard.value.repoRoot, guard.value.runtimeSec, config);
    case "test":
      return runTestMode(task, guard.value.repoRoot, guard.value.runtimeSec, config);
    case "review":
      return runReviewMode(task, guard.value.repoRoot, guard.value.runtimeSec, config);
    case "ship":
      return runShipMode(task, guard.value.repoRoot, guard.value.runtimeSec, config);
  }
}

function prepareTask(
  task: LiMaTaskRunnerRequest,
  config: LiMaTaskRunnerConfig
): { ok: true; value: { repoRoot: string; runtimeSec: number } } | { ok: false; error: string } {
  const repo = resolveLiMaTaskRepo(task.repo, config);
  if (!repo.ok) {
    return repo;
  }
  const tools = assertLiMaTaskToolsAllowed(task.allowed_tools);
  if (!tools.ok) {
    return tools;
  }
  const runtime = resolveLiMaTaskRuntimeSec(task.max_runtime_sec, config);
  if (!runtime.ok) {
    return runtime;
  }
  return { ok: true, value: { repoRoot: repo.value, runtimeSec: runtime.value } };
}

function runPlanMode(task: LiMaTaskRunnerRequest, projectRoot: string): LiMaAgentTaskResult {
  const context = snapshotContext(projectRoot);
  const suggestedSlice = buildSuggestedSlice(task, context);

  const bundle = writePlanArtifacts(projectRoot, {
    task,
    context,
    suggestedSlice,
  });

  return buildLiMaTaskResult(task, {
    status: "needs_review",
    summary: [
      `Plan written for: ${task.goal}`,
      `Context: ${context.changedFiles.length} changed file(s), ${context.recentFiles.length} recent file(s).`,
      `Artifact bundle: ${bundle.dir}`,
      `Files: ${bundle.files.join(", ")}`,
    ].join("\n"),
    changedFiles: context.changedFiles,
    artifacts: bundle.files.map((f) => `${bundle.dir}/${f}`),
    risks: context.existingRisks.slice(0, 5),
    nextAction: "Review plan.md, context.json, and risks.md, then decide on patch/test/ship.",
  });
}

function buildSuggestedSlice(task: LiMaTaskRunnerRequest, context: ContextSnapshot): string {
  const lines = [
    `Based on current repository state:`,
    `- Branch: ${context.branch}`,
    `- Changed files: ${context.changedFiles.length > 0 ? context.changedFiles.join(", ") : "(clean working tree)"}`,
    `- Task goal: ${task.goal}`,
    ``,
    `Suggested approach:`,
    `1. Review the changed files and existing risks above.`,
    `2. Identify the smallest change that moves toward the goal.`,
    `3. Write a patch, run tests, and review with /lima ship.`,
  ];
  if (context.changedFiles.length === 0) {
    lines.push(`4. Start with a focused edit to one file, then re-run /lima plan.`);
  }
  return lines.join("\n");
}

async function runPatchMode(
  task: LiMaTaskRunnerRequest,
  repoRoot: string,
  runtimeSec: number,
  config: LiMaTaskRunnerConfig
): Promise<LiMaAgentTaskResult> {
  if (!task.allowed_tools.includes("write")) {
    return blockedResult(task, "Patch mode requires the write tool.");
  }

  const testCommands = extractTestCommands(task);
  if (testCommands.length > 0 && !task.allowed_tools.includes("test")) {
    return blockedResult(task, "Patch mode with test commands requires the test tool.");
  }

  const patchFiles = task.patch_files ?? [];
  for (const patchFile of patchFiles) {
    const target = resolveRepoFile(repoRoot, patchFile.file_path);
    if (!target.ok) {
      return blockedResult(task, target.error);
    }
    fs.mkdirSync(path.dirname(target.value), { recursive: true });
    fs.writeFileSync(target.value, patchFile.content, "utf8");
  }

  const diff = await runGitDiff(repoRoot, runtimeSec, config);
  if (patchFiles.length === 0) {
    return buildLiMaTaskResult(task, {
      status: "blocked",
      summary: "Patch mode requires explicit patch_files; no files were modified.",
      changedFiles: diff.changedFiles,
      diffPreview: diff.preview,
      nextAction: "Provide explicit patch_files.",
    });
  }

  if (testCommands.length > 0) {
    const testRun = await runTestCommands(testCommands, repoRoot, runtimeSec, config);
    if (!testRun.ok) {
      return buildLiMaTaskResult(task, {
        status: "failed",
        summary: `Applied ${patchFiles.length} file update(s), but test command failed: ${testRun.failedCommand}`,
        changedFiles: diff.changedFiles,
        diffPreview: diff.preview,
        testCommands: testRun.commands,
        testResults: testRun.results,
        nextAction: "Fix failing tests before submitting.",
      });
    }

    return buildLiMaTaskResult(task, {
      status: "needs_review",
      summary: `Applied ${patchFiles.length} file update(s) and all requested test commands passed. No commit was created.`,
      changedFiles: diff.changedFiles,
      diffPreview: diff.preview,
      testCommands: testRun.commands,
      testResults: testRun.results,
      nextAction: "Review diff and submit result to LiMa Server.",
    });
  }

  return buildLiMaTaskResult(task, {
    status: "needs_review",
    summary: `Applied ${patchFiles.length} file update(s). No commit was created.`,
    changedFiles: diff.changedFiles,
    diffPreview: diff.preview,
    nextAction: "Review diff and run tests.",
  });
}

async function runTestMode(
  task: LiMaTaskRunnerRequest,
  repoRoot: string,
  runtimeSec: number,
  config: LiMaTaskRunnerConfig
): Promise<LiMaAgentTaskResult> {
  if (!task.allowed_tools.includes("test")) {
    return blockedResult(task, "Test mode requires the test tool.");
  }

  const commands = extractTestCommands(task);
  if (commands.length === 0) {
    return blockedResult(task, "Test mode requires at least one test command.");
  }

  const testRun = await runTestCommands(commands, repoRoot, runtimeSec, config);
  writeTestArtifacts(config.projectRoot ?? repoRoot, {
    task,
    commands,
    results: testRun.results,
  });
  if (!testRun.ok) {
    return buildLiMaTaskResult(task, {
      status: "failed",
      summary: `Test command failed: ${testRun.failedCommand}`,
      testCommands: testRun.commands,
      testResults: testRun.results,
      nextAction: "Fix failing tests before submitting.",
    });
  }

  return buildLiMaTaskResult(task, {
    status: "succeeded",
    summary: "All requested test commands passed.",
    testCommands: testRun.commands,
    testResults: testRun.results,
    nextAction: "Submit result to LiMa Server.",
  });
}

async function runReviewMode(
  task: LiMaTaskRunnerRequest,
  repoRoot: string,
  runtimeSec: number,
  config: LiMaTaskRunnerConfig
): Promise<LiMaAgentTaskResult> {
  if (!task.allowed_tools.includes("git_diff")) {
    return blockedResult(task, "Review mode requires the git_diff tool.");
  }

  const diff = await runGitDiff(repoRoot, runtimeSec, config);
  const findings = diff.preview ? ["Git diff detected changes for review."] : [];
  writeReviewArtifacts(config.projectRoot ?? repoRoot, {
    task,
    diffPreview: diff.preview,
    changedFiles: diff.changedFiles,
    findings,
  });
  return buildLiMaTaskResult(task, {
    status: "needs_review",
    summary: diff.preview ? "Review current diff for risks before patch submission." : "No git diff found to review.",
    changedFiles: diff.changedFiles,
    diffPreview: diff.preview,
    nextAction: diff.preview ? "Inspect findings and decide whether to patch." : "No action required.",
  });
}

async function runShipMode(
  task: LiMaTaskRunnerRequest,
  repoRoot: string,
  runtimeSec: number,
  config: LiMaTaskRunnerConfig
): Promise<LiMaAgentTaskResult> {
  if (!task.allowed_tools.includes("git_diff")) {
    return blockedResult(task, "Ship mode requires the git_diff tool.");
  }

  const projectRoot = config.projectRoot ?? repoRoot;
  const context = snapshotContext(projectRoot);
  const diff = await runGitDiff(repoRoot, runtimeSec, config);

  const remainingRisks = [
    ...context.existingRisks.slice(0, 5),
    ...(diff.changedFiles.length > 3 ? [`Large change: ${diff.changedFiles.length} files modified.`] : []),
    ...(diff.changedFiles.length === 0 ? ["No changes to ship."] : []),
  ];

  const rollbackNotes =
    context.changedFiles.length > 0
      ? `To rollback: git checkout ${context.changedFiles.map((f) => `'${f}'`).join(" ")}`
      : "No changes to rollback.";

  const commitSummary = context.changedFiles.length > 0 ? `feat: ${task.goal.slice(0, 60)}` : "";

  const bundle = writeShipArtifacts(projectRoot, {
    task,
    diffPreview: diff.preview,
    changedFiles: diff.changedFiles,
    remainingRisks,
    rollbackNotes,
    commitSummary,
  });

  return buildLiMaTaskResult(task, {
    status: "needs_review",
    summary: [
      `Ship review written for: ${task.goal}`,
      `Changed files: ${diff.changedFiles.length}.`,
      `Remaining risks: ${remainingRisks.length}.`,
      `Artifact bundle: ${bundle.dir}`,
      `Files: ${bundle.files.join(", ")}`,
    ].join("\n"),
    changedFiles: diff.changedFiles,
    diffPreview: diff.preview,
    artifacts: bundle.files.map((f) => `${bundle.dir}/${f}`),
    risks: remainingRisks,
    nextAction: "Review ship.md, diff.patch, and risks before committing. Do NOT deploy or push from this check.",
  });
}

async function runGitDiff(
  repoRoot: string,
  runtimeSec: number,
  config: LiMaTaskRunnerConfig
): Promise<{ changedFiles: string[]; preview: string }> {
  const names = await executeCommand("git diff --name-only", repoRoot, runtimeSec, config);
  const diff = await executeCommand("git diff --", repoRoot, runtimeSec, config);
  return {
    changedFiles: parseChangedFilesFromGitNameOnly(names.stdout),
    preview: diff.stdout,
  };
}

function blockedResult(task: Pick<LiMaAgentTaskRequest, "task_id">, reason: string): LiMaAgentTaskResult {
  return buildLiMaTaskResult(task, {
    status: "blocked",
    summary: reason,
    risks: [reason],
    nextAction: "Fix task configuration and retry.",
  });
}

function extractTestCommands(task: LiMaTaskRunnerRequest): string[] {
  const explicit = task.test_commands ?? [];
  const fromConstraints = task.constraints
    .map((item) => item.trim())
    .filter((item) => item.toLowerCase().startsWith("test:"))
    .map((item) => item.slice("test:".length).trim())
    .filter(Boolean);
  return Array.from(new Set([...explicit, ...fromConstraints]));
}

async function runTestCommands(
  commands: string[],
  repoRoot: string,
  runtimeSec: number,
  config: LiMaTaskRunnerConfig
): Promise<
  | { ok: true; commands: string[]; results: LiMaAgentTaskTestResult[] }
  | { ok: false; commands: string[]; results: LiMaAgentTaskTestResult[]; failedCommand: string }
> {
  const results: LiMaAgentTaskTestResult[] = [];
  for (const command of commands) {
    const execution = await executeCommand(command, repoRoot, runtimeSec, config);
    results.push({
      command,
      exit_code: execution.exitCode,
      duration_ms: execution.durationMs,
      stdout: truncateText(execution.stdout),
      stderr: truncateText(execution.stderr),
    });
    if (execution.exitCode !== 0) {
      return { ok: false, commands, results, failedCommand: command };
    }
  }
  return { ok: true, commands, results };
}

function resolveRepoFile(
  repoRoot: string,
  filePath: string
): { ok: true; value: string } | { ok: false; error: string } {
  const target = path.resolve(repoRoot, filePath);
  const relative = path.relative(repoRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, error: `Patch target is outside repo: ${filePath}` };
  }
  return { ok: true, value: target };
}

async function executeCommand(
  command: string,
  cwd: string,
  timeoutSec: number,
  config: LiMaTaskRunnerConfig
): Promise<LiMaCommandExecution> {
  if (config.executeCommand) {
    return config.executeCommand(command, cwd, timeoutSec);
  }
  return spawnCommand(command, cwd, timeoutSec);
}

function spawnCommand(command: string, cwd: string, timeoutSec: number): Promise<LiMaCommandExecution> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const [executable, ...args] = splitCommand(command);
    if (!executable) {
      resolve({ exitCode: 1, stdout: "", stderr: "Empty command.", durationMs: 0 });
      return;
    }

    const child = spawn(executable, args, { cwd, shell: false, windowsHide: true });
    const timer = setTimeout(() => child.kill(), timeoutSec * 1000);
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      stderr += error.message;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function splitCommand(command: string): string[] {
  return command.match(/"[^"]+"|'[^']+'|\S+/g)?.map((part) => part.replace(/^["']|["']$/g, "")) ?? [];
}
