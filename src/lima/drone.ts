/**
 * Drone autonomous coding loop.
 *
 * probe -> plan/patch -> learn -> re-probe
 *
 * Safety: risk classification, file snapshots, checkpoint/resume,
 * quarantine, budget limits, stop marker.
 */

import {
  loadCheckpoint,
  saveCheckpoint,
  clearCheckpoint,
  snapshotFiles,
  rollbackSnapshots,
  isStale,
  type Checkpoint,
} from "./checkpoint";
import { probeCodebase, findingToTask, type ProbeFinding, type ProbeResult } from "./probe";
import type { LiMaTaskRunnerConfig, LiMaTaskRunnerRequest } from "./task-runner";
import { readWorkerStop } from "./worker-control";
import { recordTaskFailure, shouldQuarantineTask } from "./failure-quarantine";
import type { LiMaAgentTaskResult, LiMaAgentTaskRequest } from "./agent-task-types";
import type { LiMaTelegramEvent } from "./telegram-notifier";
import { createWorkerBudget } from "./worker-budget";
import { execSync } from "child_process";

export type DroneConfig = {
  projectRoot: string;
  maxTasks: number;
  maxMinutes: number;
  allowMediumRisk: boolean;
  intervalMs: number;
  signal?: AbortSignal;
};

export type DroneReport = {
  tasksAttempted: number;
  tasksSucceeded: number;
  tasksFailed: number;
  findingsResolved: number;
  findingsRemaining: number;
  durationMs: number;
  checkpointUsed: boolean;
  messages: string[];
};

export type DroneCallbacks = {
  runTask: (task: LiMaTaskRunnerRequest, config: LiMaTaskRunnerConfig) => Promise<LiMaAgentTaskResult>;
  submitResult?: (result: LiMaAgentTaskResult) => Promise<{ ok: boolean; error?: string }>;
  writeAudit?: (projectRoot: string, task: LiMaAgentTaskRequest, result: LiMaAgentTaskResult) => void;
  notify?: (event: LiMaTelegramEvent) => Promise<boolean>;
};

export async function runDroneLoop(config: DroneConfig, callbacks: DroneCallbacks): Promise<DroneReport> {
  const t0 = Date.now();
  const messages: string[] = [];
  let tasksAttempted = 0;
  let tasksSucceeded = 0;
  let tasksFailed = 0;
  let checkpointUsed = false;

  const budget = createWorkerBudget({
    maxTasks: config.maxTasks,
    maxMinutes: config.maxMinutes,
  });

  // Step 1: Recover from checkpoint.
  const existingCp = loadCheckpoint(config.projectRoot);
  if (existingCp && !isStale(existingCp)) {
    messages.push(`从 checkpoint 恢复: 任务 ${existingCp.taskId} (${existingCp.mode})`);
    checkpointUsed = true;
    const restored = rollbackSnapshots(config.projectRoot, existingCp);
    messages.push(`已回滚 ${restored} 个文件`);
    clearCheckpoint(config.projectRoot);
  } else if (existingCp && isStale(existingCp)) {
    messages.push(`发现过期 checkpoint (任务 ${existingCp.taskId})，正在回滚`);
    rollbackSnapshots(config.projectRoot, existingCp);
    clearCheckpoint(config.projectRoot);
  }

  // Step 2: Initial probe.
  const probeResult = probeCodebase(config.projectRoot);
  const findings = filterFindings(probeResult.findings, config.allowMediumRisk);
  messages.push(
    `探测: 已扫描 ${probeResult.scannedFiles} 个文件，用时 ${probeResult.scanDurationMs}ms，可处理问题 ${findings.length} 个`
  );

  if (findings.length === 0) {
    return buildReport(0, 0, 0, 0, probeResult.findings.length, t0, checkpointUsed, messages);
  }

  // Step 3: Execute findings.
  const processed = new Set<string>();

  while (findings.length > 0 && budget.canStartNext().ok) {
    const stop = readWorkerStop(config.projectRoot);
    if (stop.stop) {
      messages.push(`收到停止请求: ${stop.reason}`);
      break;
    }

    if (config.signal?.aborted) {
      messages.push("已被外部信号中止");
      break;
    }

    const finding = findings[0];
    if (processed.has(finding.id)) {
      findings.shift();
      continue;
    }

    tasksAttempted++;
    budget.recordTask();

    const taskConfig = findingToTask(finding, config.projectRoot);
    const taskId = `drone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const branch = getCurrentBranch(config.projectRoot);

    const taskRequest: LiMaAgentTaskRequest = {
      task_id: taskId,
      repo: config.projectRoot,
      branch,
      goal: taskConfig.goal,
      constraints: taskConfig.constraints,
      allowed_tools: taskConfig.allowedTools,
      max_runtime_sec: 300,
      mode: taskConfig.mode,
    };

    const affectedFiles = [finding.file];
    const snapDir = snapshotFiles(config.projectRoot, affectedFiles);

    const checkpoint: Checkpoint = {
      taskId,
      findingId: finding.id,
      mode: taskConfig.mode,
      status: "executing",
      snapshotDir: snapDir,
      startedAt: new Date().toISOString(),
      progress: ["claimed"],
    };
    saveCheckpoint(config.projectRoot, checkpoint);

    messages.push(
      `[${tasksAttempted}/${config.maxTasks}] ${finding.severity} ${finding.rule} -> ${finding.file}:${finding.line}`
    );

    await notifyBestEffort(callbacks.notify, {
      type: "task_started",
      taskId,
      status: "running",
      summary: finding.message,
    });

    try {
      const result = await callbacks.runTask(taskRequest, {
        currentWorkspace: config.projectRoot,
        projectRoot: config.projectRoot,
      });

      callbacks.writeAudit?.(config.projectRoot, taskRequest, result);

      if (result.status === "needs_review" || result.status === "succeeded") {
        tasksSucceeded++;
        processed.add(finding.id);
        messages.push(`  完成 ${result.status}: ${result.summary.slice(0, 80)}`);

        if (callbacks.submitResult) {
          const submitResult = await callbacks.submitResult(result);
          if (!submitResult.ok) {
            messages.push(`  提交失败: ${submitResult.error}`);
          }
        }

        await notifyBestEffort(callbacks.notify, {
          type: "task_finished",
          taskId,
          status: result.status,
          summary: result.summary,
        });
      } else {
        tasksFailed++;
        messages.push(`  失败 ${result.status}: ${result.summary.slice(0, 80)}`);

        recordTaskFailure(config.projectRoot, taskId, result.summary);
        const quarantine = shouldQuarantineTask(config.projectRoot, taskId);
        if (quarantine.quarantine) {
          messages.push(`  已隔离: 连续失败 ${quarantine.failureCount} 次`);
          await notifyBestEffort(callbacks.notify, {
            type: "task_failed",
            taskId,
            status: "quarantined",
            summary: `已隔离: ${quarantine.reason}`,
          });
          break;
        }

        const restored = rollbackSnapshots(config.projectRoot, checkpoint);
        if (restored > 0) {
          messages.push(`  已回滚 ${restored} 个文件`);
        }

        await notifyBestEffort(callbacks.notify, {
          type: "task_failed",
          taskId,
          status: result.status,
          summary: result.summary,
        });
      }
    } catch (err) {
      tasksFailed++;
      const errMsg = err instanceof Error ? err.message : String(err);
      messages.push(`  错误: ${errMsg.slice(0, 100)}`);
      recordTaskFailure(config.projectRoot, taskId, errMsg);

      rollbackSnapshots(config.projectRoot, checkpoint);
    }

    clearCheckpoint(config.projectRoot);

    findings.shift();

    if (findings.length > 0 && config.intervalMs > 0) {
      await sleepMs(config.intervalMs);
    }
  }

  // Step 4: Re-probe.
  const finalProbe = probeCodebase(config.projectRoot);
  const remainingFindings = filterFindings(finalProbe.findings, config.allowMediumRisk);
  const resolved = probeResult.findings.length - remainingFindings.length;

  messages.push(`最终探测: 剩余 ${remainingFindings.length} 个问题，已解决 ${resolved} 个`);

  return buildReport(
    tasksAttempted,
    tasksSucceeded,
    tasksFailed,
    resolved,
    remainingFindings.length,
    t0,
    checkpointUsed,
    messages
  );
}

export function probeOnly(projectRoot: string, asJson: boolean): string {
  const result = probeCodebase(projectRoot);
  if (asJson) {
    return JSON.stringify(result, null, 2);
  }
  return formatProbeTable(result);
}

function filterFindings(findings: ProbeFinding[], allowMedium: boolean): ProbeFinding[] {
  return findings.filter((f) => {
    if (f.severity === "medium" && !allowMedium) return false;
    return true;
  });
}

function formatProbeTable(result: ProbeResult): string {
  const lines: string[] = [
    `已扫描 ${result.scannedFiles} 个文件，用时 ${result.scanDurationMs}ms`,
    `发现 ${result.findings.length} 个问题`,
    "",
  ];

  if (result.findings.length === 0) {
    lines.push("未发现可处理问题，代码库看起来干净。");
    return lines.join("\n");
  }

  const bySeverity: Record<string, ProbeFinding[]> = { medium: [], small: [], trivial: [] };
  for (const f of result.findings) {
    bySeverity[f.severity]?.push(f);
  }

  for (const [sev, items] of Object.entries(bySeverity)) {
    if (items.length === 0) continue;
    lines.push(`-- ${sev.toUpperCase()} (${items.length}) --`);
    for (const f of items) {
      lines.push(`  ${f.file}:${f.line}  [${f.rule}]  ${f.message}`);
    }
    lines.push("");
  }

  lines.push("运行 /lima drone 自动处理 trivial 和 small 问题。");
  return lines.join("\n");
}

function buildReport(
  attempted: number,
  succeeded: number,
  failed: number,
  resolved: number,
  remaining: number,
  t0: number,
  checkpointUsed: boolean,
  messages: string[]
): DroneReport {
  return {
    tasksAttempted: attempted,
    tasksSucceeded: succeeded,
    tasksFailed: failed,
    findingsResolved: resolved,
    findingsRemaining: remaining,
    durationMs: Date.now() - t0,
    checkpointUsed,
    messages,
  };
}

function getCurrentBranch(projectRoot: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  } catch {
    return "main";
  }
}

async function notifyBestEffort(
  notify: ((event: LiMaTelegramEvent) => Promise<boolean>) | undefined,
  event: LiMaTelegramEvent
): Promise<void> {
  try {
    await notify?.(event);
  } catch {
    // Best effort only; caller reports operator-visible failures.
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
