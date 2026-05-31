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
      `计划已写入: ${task.goal}`,
      `上下文: ${context.changedFiles.length} 个变更文件，${context.recentFiles.length} 个近期文件。`,
      `产物包: ${bundle.dir}`,
      `文件: ${bundle.files.join(", ")}`,
    ].join("\n"),
    changedFiles: context.changedFiles,
    artifacts: bundle.files.map((f) => `${bundle.dir}/${f}`),
    risks: context.existingRisks.slice(0, 5),
    nextAction: "审查 plan.md、context.json 和 risks.md，然后决定 patch/test/ship。",
  });
}

function buildSuggestedSlice(task: LiMaTaskRunnerRequest, context: ContextSnapshot): string {
  const lines = [
    `基于当前仓库状态：`,
    `- 分支: ${context.branch}`,
    `- 变更文件: ${context.changedFiles.length > 0 ? context.changedFiles.join(", ") : "(工作区干净)"}`,
    `- 任务目标: ${task.goal}`,
    ``,
    `建议路径：`,
    `1. 审查上面的变更文件和既有风险。`,
    `2. 找到能推进目标的最小改动。`,
    `3. 编写补丁、运行测试，并用 /lima ship 审查。`,
  ];
  if (context.changedFiles.length === 0) {
    lines.push(`4. 从一个聚焦文件改动开始，然后重新运行 /lima plan。`);
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
    return blockedResult(task, "patch 模式需要 write 工具。");
  }

  const testCommands = extractTestCommands(task);
  if (testCommands.length > 0 && !task.allowed_tools.includes("test")) {
    return blockedResult(task, "带测试命令的 patch 模式需要 test 工具。");
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
      summary: "patch 模式需要明确的 patch_files；未修改任何文件。",
      changedFiles: diff.changedFiles,
      diffPreview: diff.preview,
      nextAction: "提供明确的 patch_files。",
    });
  }

  if (testCommands.length > 0) {
    const testRun = await runTestCommands(testCommands, repoRoot, runtimeSec, config);
    if (!testRun.ok) {
      return buildLiMaTaskResult(task, {
        status: "failed",
        summary: `已应用 ${patchFiles.length} 个文件更新，但测试命令失败: ${testRun.failedCommand}`,
        changedFiles: diff.changedFiles,
        diffPreview: diff.preview,
        testCommands: testRun.commands,
        testResults: testRun.results,
        nextAction: "提交前先修复失败测试。",
      });
    }

    return buildLiMaTaskResult(task, {
      status: "needs_review",
      summary: `已应用 ${patchFiles.length} 个文件更新，且所有请求的测试命令已通过。未创建 commit。`,
      changedFiles: diff.changedFiles,
      diffPreview: diff.preview,
      testCommands: testRun.commands,
      testResults: testRun.results,
      nextAction: "审查 diff 并将结果提交到 LiMa Server。",
    });
  }

  return buildLiMaTaskResult(task, {
    status: "needs_review",
    summary: `已应用 ${patchFiles.length} 个文件更新。未创建 commit。`,
    changedFiles: diff.changedFiles,
    diffPreview: diff.preview,
    nextAction: "审查 diff 并运行测试。",
  });
}

async function runTestMode(
  task: LiMaTaskRunnerRequest,
  repoRoot: string,
  runtimeSec: number,
  config: LiMaTaskRunnerConfig
): Promise<LiMaAgentTaskResult> {
  if (!task.allowed_tools.includes("test")) {
    return blockedResult(task, "test 模式需要 test 工具。");
  }

  const commands = extractTestCommands(task);
  if (commands.length === 0) {
    return blockedResult(task, "test 模式至少需要一个测试命令。");
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
      summary: `测试命令失败: ${testRun.failedCommand}`,
      testCommands: testRun.commands,
      testResults: testRun.results,
      nextAction: "提交前先修复失败测试。",
    });
  }

  return buildLiMaTaskResult(task, {
    status: "succeeded",
    summary: "所有请求的测试命令已通过。",
    testCommands: testRun.commands,
    testResults: testRun.results,
    nextAction: "提交结果到 LiMa Server。",
  });
}

async function runReviewMode(
  task: LiMaTaskRunnerRequest,
  repoRoot: string,
  runtimeSec: number,
  config: LiMaTaskRunnerConfig
): Promise<LiMaAgentTaskResult> {
  if (!task.allowed_tools.includes("git_diff")) {
    return blockedResult(task, "review 模式需要 git_diff 工具。");
  }

  const diff = await runGitDiff(repoRoot, runtimeSec, config);
  const findings = diff.preview ? ["检测到 git diff 变更，需要审查。"] : [];
  writeReviewArtifacts(config.projectRoot ?? repoRoot, {
    task,
    diffPreview: diff.preview,
    changedFiles: diff.changedFiles,
    findings,
  });
  return buildLiMaTaskResult(task, {
    status: "needs_review",
    summary: diff.preview ? "提交 patch 前审查当前 diff 风险。" : "没有可审查的 git diff。",
    changedFiles: diff.changedFiles,
    diffPreview: diff.preview,
    nextAction: diff.preview ? "检查发现项并决定是否打补丁。" : "无需操作。",
  });
}

async function runShipMode(
  task: LiMaTaskRunnerRequest,
  repoRoot: string,
  runtimeSec: number,
  config: LiMaTaskRunnerConfig
): Promise<LiMaAgentTaskResult> {
  if (!task.allowed_tools.includes("git_diff")) {
    return blockedResult(task, "ship 模式需要 git_diff 工具。");
  }

  const projectRoot = config.projectRoot ?? repoRoot;
  const context = snapshotContext(projectRoot);
  const diff = await runGitDiff(repoRoot, runtimeSec, config);

  const remainingRisks = [
    ...context.existingRisks.slice(0, 5),
    ...(diff.changedFiles.length > 3 ? [`变更较大: 修改了 ${diff.changedFiles.length} 个文件。`] : []),
    ...(diff.changedFiles.length === 0 ? ["没有可交付的变更。"] : []),
  ];

  const rollbackNotes =
    context.changedFiles.length > 0
      ? `回滚命令: git checkout ${context.changedFiles.map((f) => `'${f}'`).join(" ")}`
      : "没有需要回滚的变更。";

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
      `交付审查已写入: ${task.goal}`,
      `变更文件: ${diff.changedFiles.length}。`,
      `剩余风险: ${remainingRisks.length}。`,
      `产物包: ${bundle.dir}`,
      `文件: ${bundle.files.join(", ")}`,
    ].join("\n"),
    changedFiles: diff.changedFiles,
    diffPreview: diff.preview,
    artifacts: bundle.files.map((f) => `${bundle.dir}/${f}`),
    risks: remainingRisks,
    nextAction: "提交前审查 ship.md、diff.patch 和风险。不要在此检查中部署或推送。",
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
    nextAction: "修复任务配置后重试。",
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
