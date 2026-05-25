import { LiMaAgentTaskClient } from "./agent-task-client";
import type { LiMaAgentTaskClientResult } from "./agent-task-client";
import type { LiMaAgentTaskRequest, LiMaAgentTaskResult } from "./agent-task-types";
import { appendLiMaAuditEntry } from "./audit-log";
import { formatAuditSummary, readRecentAuditEntries } from "./audit-reader";
import { formatLiMaCommandHelp, parseLiMaCommand } from "./commands";
import { formatLiMaDoctorReport, runLiMaDoctor } from "./doctor";
import { recordTaskFailure, shouldQuarantineTask } from "./failure-quarantine";
import { createLiMaFilesystemLifecycleHooks, type LiMaLifecycleHooks } from "./lifecycle-hooks";
import { evaluateLiMaSkillActivationForProject } from "./skill-activation";
import { runLiMaAgentTask, type LiMaTaskRunnerConfig, type LiMaTaskRunnerRequest } from "./task-runner";
import { sendLiMaTelegramEvent, type LiMaTelegramEvent } from "./telegram-notifier";
import { createWorkerBudget } from "./worker-budget";
import { readWorkerStop, requestWorkerStop } from "./worker-control";

export type LiMaCommandRunnerClient = {
  isConfigured(): boolean;
  fetchTask(taskId: string): Promise<LiMaAgentTaskClientResult<LiMaAgentTaskRequest>>;
  fetchPendingTask(): Promise<LiMaAgentTaskClientResult<LiMaAgentTaskRequest | null>>;
  submitResult(result: LiMaAgentTaskResult): Promise<LiMaAgentTaskClientResult<{ accepted: boolean }>>;
  fetchTaskEvents(taskId: string): Promise<LiMaAgentTaskClientResult<unknown[]>>;
  quarantineTask?(taskId: string): Promise<LiMaAgentTaskClientResult<{ status: "quarantined" }>>;
};

export type LiMaCommandRunnerResult = {
  ok: boolean;
  message: string;
};

export type LiMaCommandRunnerNotifier = (event: LiMaTelegramEvent) => Promise<boolean>;

export type LiMaCommandRunnerOptions = {
  projectRoot: string;
  client?: LiMaCommandRunnerClient;
  runTask?: (task: LiMaTaskRunnerRequest, config: LiMaTaskRunnerConfig) => Promise<LiMaAgentTaskResult>;
  appendAudit?: (projectRoot: string, task: LiMaAgentTaskRequest, result: LiMaAgentTaskResult) => void;
  notify?: LiMaCommandRunnerNotifier;
  lifecycleHooks?: LiMaLifecycleHooks | false;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
};

export async function executeLiMaCommand(
  input: string,
  options: LiMaCommandRunnerOptions
): Promise<LiMaCommandRunnerResult> {
  const parsed = parseLiMaCommand(input);
  if (!parsed.ok) {
    return { ok: false, message: parsed.error };
  }

  const client = options.client ?? new LiMaAgentTaskClient();
  const runTask = options.runTask ?? runLiMaAgentTask;
  const writeAudit = options.appendAudit ?? appendLiMaAuditEntry;
  const notify = options.notify ?? sendLiMaTelegramEvent;
  const lifecycleHooks = resolveLifecycleHooks(options);

  if (parsed.command.kind === "connect") {
    return client.isConfigured()
      ? { ok: true, message: "LiMa Server connection is configured." }
      : { ok: false, message: "LiMa Server is not configured. Set LIMA_CODE_SERVER_URL and LIMA_CODE_API_KEY." };
  }

  if (parsed.command.kind === "status") {
    return {
      ok: true,
      message: [
        `LiMa Code project: ${options.projectRoot}`,
        `LiMa Server configured: ${client.isConfigured() ? "yes" : "no"}`,
      ].join("\n"),
    };
  }

  if (parsed.command.kind === "doctor") {
    const report = await runLiMaDoctor({ projectRoot: options.projectRoot, client });
    return { ok: report.ok, message: formatLiMaDoctorReport(report) };
  }

  if (parsed.command.kind === "plan") {
    const task = buildLocalPlanTask(options.projectRoot);
    const result = await runTask(task, { currentWorkspace: options.projectRoot, projectRoot: options.projectRoot });
    writeAudit(options.projectRoot, task, result);
    return formatTaskResult(result, false);
  }

  if (parsed.command.kind === "test") {
    const task = buildLocalTestTask(options.projectRoot, parsed.command.command);
    const result = await runTask(task, { currentWorkspace: options.projectRoot, projectRoot: options.projectRoot });
    writeAudit(options.projectRoot, task, result);
    return formatTaskResult(result, false);
  }

  if (parsed.command.kind === "review") {
    const task = buildLocalReviewTask(options.projectRoot);
    const result = await runTask(task, { currentWorkspace: options.projectRoot, projectRoot: options.projectRoot });
    writeAudit(options.projectRoot, task, result);
    return formatTaskResult(result, false);
  }

  if (parsed.command.kind === "ship") {
    const task = buildLocalShipTask(options.projectRoot);
    const result = await runTask(task, { currentWorkspace: options.projectRoot, projectRoot: options.projectRoot });
    writeAudit(options.projectRoot, task, result);
    return formatTaskResult(result, false);
  }

  if (parsed.command.kind === "audit") {
    return {
      ok: true,
      message: formatAuditSummary(readRecentAuditEntries(options.projectRoot, parsed.command.limit)),
    };
  }

  if (parsed.command.kind === "daemon") {
    if (parsed.command.action === "stop") {
      const marker = requestWorkerStop(options.projectRoot);
      return { ok: true, message: `LiMa worker stop requested: ${marker}` };
    }
    const stop = readWorkerStop(options.projectRoot);
    return {
      ok: true,
      message: stop.stop ? `LiMa worker stop pending: ${stop.reason}` : "LiMa worker stop is not pending.",
    };
  }

  if (parsed.command.kind === "next") {
    const fetched = await client.fetchPendingTask();
    if (!fetched.ok) {
      return { ok: false, message: fetched.error };
    }
    if (!fetched.value) {
      return { ok: true, message: "No pending LiMa task is available." };
    }
    return runAndSubmitTask(fetched.value, options.projectRoot, client, runTask, writeAudit, notify, lifecycleHooks);
  }

  if (parsed.command.kind === "work") {
    return runWorkLoop({
      command: parsed.command,
      projectRoot: options.projectRoot,
      client,
      runTask,
      writeAudit,
      notify,
      lifecycleHooks,
      sleep: options.sleep ?? sleep,
      now: options.now,
      signal: options.signal,
    });
  }

  const fetched = await client.fetchTask(parsed.command.taskId);
  if (!fetched.ok) {
    return { ok: false, message: fetched.error };
  }

  return runAndSubmitTask(fetched.value, options.projectRoot, client, runTask, writeAudit, notify, lifecycleHooks);
}

function buildLocalReviewTask(projectRoot: string): LiMaTaskRunnerRequest {
  return {
    task_id: "local-review",
    repo: projectRoot,
    branch: "local",
    goal: "Review current git diff",
    constraints: [],
    allowed_tools: ["git_diff"],
    max_runtime_sec: 300,
    mode: "review",
  };
}

function buildLocalPlanTask(projectRoot: string): LiMaTaskRunnerRequest {
  return {
    task_id: "local-plan",
    repo: projectRoot,
    branch: "local",
    goal: "Plan the next LiMa Code work slice",
    constraints: [
      "Keep the plan scoped to the current repository.",
      "Prefer small, testable changes with explicit verification commands.",
    ],
    allowed_tools: ["git_diff"],
    max_runtime_sec: 300,
    mode: "plan",
  };
}

function buildLocalTestTask(projectRoot: string, command: string): LiMaTaskRunnerRequest {
  return {
    task_id: "local-test",
    repo: projectRoot,
    branch: "local",
    goal: "Run local verification command",
    constraints: [`Command: ${command}`],
    allowed_tools: ["test"],
    max_runtime_sec: 600,
    mode: "test",
    test_commands: [command],
  };
}

function buildLocalShipTask(projectRoot: string): LiMaTaskRunnerRequest {
  return {
    task_id: "local-ship",
    repo: projectRoot,
    branch: "local",
    goal: "Ship readiness review for current git diff",
    constraints: [
      "Confirm changed files, verification evidence, rollback notes, and residual risks.",
      "Do not deploy or push from this local readiness check.",
    ],
    allowed_tools: ["git_diff"],
    max_runtime_sec: 300,
    mode: "ship",
  };
}

function formatTaskResult(result: LiMaAgentTaskResult, submitted: boolean): LiMaCommandRunnerResult {
  const lines = [
    `LiMa task ${result.task_id}: ${result.status}`,
    result.summary,
    submitted ? "Result submitted to LiMa Server." : "Result kept local.",
  ];
  if (result.changed_files.length > 0) {
    lines.push(`Changed files: ${result.changed_files.join(", ")}`);
  }
  if (result.next_action) {
    lines.push(`Next: ${result.next_action}`);
  }
  return { ok: result.status !== "failed" && result.status !== "blocked", message: lines.join("\n") };
}

async function runAndSubmitTask(
  task: LiMaAgentTaskRequest,
  projectRoot: string,
  client: LiMaCommandRunnerClient,
  runTask: (task: LiMaTaskRunnerRequest, config: LiMaTaskRunnerConfig) => Promise<LiMaAgentTaskResult>,
  writeAudit: (projectRoot: string, task: LiMaAgentTaskRequest, result: LiMaAgentTaskResult) => void,
  notify: LiMaCommandRunnerNotifier,
  lifecycleHooks: LiMaLifecycleHooks | null
): Promise<LiMaCommandRunnerResult> {
  await notifyBestEffort(notify, {
    type: "task_started",
    taskId: task.task_id,
    status: "running",
    summary: task.goal,
  });
  const activeSkills = evaluateLiMaSkillActivationForProject(task, projectRoot);
  runLifecycleHookBestEffort(() => lifecycleHooks?.onTaskStart(task, activeSkills));
  const result = await runTask(task, { currentWorkspace: projectRoot, projectRoot });
  writeAudit(projectRoot, task, result);
  runLifecycleHookBestEffort(() => lifecycleHooks?.onTaskStop(result));

  const submitted = await client.submitResult(result);
  if (!submitted.ok) {
    return { ok: false, message: `Task ${result.task_id} ran but result submission failed: ${submitted.error}` };
  }

  await notifyBestEffort(notify, eventForTaskResult(result));
  return formatTaskResult(result, true);
}

async function runWorkLoop(options: {
  command: { mode: "once" | "loop"; maxTasks: number; maxMinutes: number; intervalMs: number; backoffMs: number };
  projectRoot: string;
  client: LiMaCommandRunnerClient;
  runTask: (task: LiMaTaskRunnerRequest, config: LiMaTaskRunnerConfig) => Promise<LiMaAgentTaskResult>;
  writeAudit: (projectRoot: string, task: LiMaAgentTaskRequest, result: LiMaAgentTaskResult) => void;
  notify: LiMaCommandRunnerNotifier;
  lifecycleHooks: LiMaLifecycleHooks | null;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
}): Promise<LiMaCommandRunnerResult> {
  const taskLines: string[] = [];
  const budget = createWorkerBudget({
    maxTasks: options.command.maxTasks,
    maxMinutes: options.command.maxMinutes,
    now: options.now,
  });
  let processed = 0;

  while (true) {
    const stop = readWorkerStop(options.projectRoot);
    if (stop.stop) {
      await notifyBestEffort(options.notify, {
        type: "work_stopped",
        summary: `LiMa work stopped by marker: ${stop.reason}`,
      });
      return { ok: true, message: `LiMa work stopped by marker: ${stop.reason}` };
    }

    if (options.signal?.aborted) {
      await notifyBestEffort(options.notify, {
        type: "work_stopped",
        summary: `LiMa work aborted after ${processed} task(s).`,
      });
      return { ok: false, message: `LiMa work aborted after ${processed} task(s).` };
    }

    const budgetDecision = budget.canStartNext();
    if (!budgetDecision.ok) {
      await notifyBestEffort(options.notify, {
        type: "work_stopped",
        summary: budgetDecision.reason,
      });
      return {
        ok: true,
        message: [`LiMa work processed ${processed} task(s).`, ...taskLines, budgetDecision.reason].join("\n"),
      };
    }

    const fetched = await options.client.fetchPendingTask();
    if (!fetched.ok) {
      await waitAfterFailure(options.command.backoffMs, options.sleep, options.signal);
      await notifyBestEffort(options.notify, {
        type: "work_stopped",
        summary: `LiMa work stopped after fetch error: ${fetched.error}`,
      });
      return { ok: false, message: `LiMa work stopped after fetch error: ${fetched.error}` };
    }
    if (!fetched.value) {
      const prefix = processed > 0 ? `LiMa work processed ${processed} task(s). ` : "";
      await notifyBestEffort(options.notify, {
        type: "work_stopped",
        summary: `${prefix}No pending LiMa task is available.`,
      });
      return { ok: true, message: `${prefix}No pending LiMa task is available.` };
    }

    const result = await runAndSubmitTask(
      fetched.value,
      options.projectRoot,
      options.client,
      options.runTask,
      options.writeAudit,
      options.notify,
      options.lifecycleHooks
    );
    processed += 1;
    budget.recordTask();
    taskLines.push(firstLine(result.message));
    if (!result.ok) {
      const failure = recordTaskFailure(options.projectRoot, fetched.value.task_id, result.message);
      const quarantine = shouldQuarantineTask(options.projectRoot, fetched.value.task_id, 3);
      if (quarantine.quarantine && options.client.quarantineTask) {
        await notifyBestEffort(options.notify, {
          type: "quarantine_requested",
          taskId: fetched.value.task_id,
          status: "quarantined",
          summary: quarantine.reason,
        });
        const quarantined = await options.client.quarantineTask(fetched.value.task_id);
        if (!quarantined.ok) {
          return {
            ok: false,
            message: [
              `LiMa work stopped after ${processed} task(s).`,
              ...taskLines,
              `Task ${fetched.value.task_id} reached quarantine threshold but Server update failed: ${quarantined.error}`,
            ].join("\n"),
          };
        }
        return {
          ok: false,
          message: [
            `LiMa work stopped after ${processed} task(s).`,
            ...taskLines,
            `Task ${fetched.value.task_id} quarantined after ${failure.failure_count} failure(s): ${quarantine.reason}`,
          ].join("\n"),
        };
      }
      await waitAfterFailure(options.command.backoffMs, options.sleep, options.signal);
      return {
        ok: false,
        message: [`LiMa work stopped after ${processed} task(s).`, ...taskLines, result.message].join("\n"),
      };
    }

    if (options.command.mode === "once" || processed >= options.command.maxTasks) {
      break;
    }
    await options.sleep(options.command.intervalMs, options.signal);
  }

  return { ok: true, message: [`LiMa work processed ${processed} task(s).`, ...taskLines].join("\n") };
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0] ?? value;
}

function eventForTaskResult(result: LiMaAgentTaskResult): LiMaTelegramEvent {
  if (result.status === "needs_review") {
    return {
      type: "task_needs_review",
      taskId: result.task_id,
      status: result.status,
      summary: result.summary,
      changedFiles: result.changed_files,
    };
  }
  if (result.status === "failed" || result.status === "blocked") {
    return {
      type: "task_failed",
      taskId: result.task_id,
      status: result.status,
      summary: result.summary,
      changedFiles: result.changed_files,
    };
  }
  return {
    type: "task_finished",
    taskId: result.task_id,
    status: result.status,
    summary: result.summary,
    changedFiles: result.changed_files,
  };
}

async function notifyBestEffort(notify: LiMaCommandRunnerNotifier, event: LiMaTelegramEvent): Promise<void> {
  try {
    await notify(event);
  } catch {
    // Notification failure must not change worker task semantics.
  }
}

function resolveLifecycleHooks(options: LiMaCommandRunnerOptions): LiMaLifecycleHooks | null {
  if (options.lifecycleHooks === false) {
    return null;
  }
  if (options.lifecycleHooks) {
    return options.lifecycleHooks;
  }
  if (options.client) {
    return null;
  }
  return createLiMaFilesystemLifecycleHooks(options.projectRoot);
}

function runLifecycleHookBestEffort(callback: () => void): void {
  try {
    callback();
  } catch {
    // Lifecycle hook failure must not change worker task semantics.
  }
}

async function waitAfterFailure(
  backoffMs: number,
  sleepImpl: (ms: number, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  try {
    await sleepImpl(backoffMs, signal);
  } catch {
    // An abort during backoff should not hide the original failure.
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("LiMa work aborted."));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("LiMa work aborted."));
      },
      { once: true }
    );
  });
}

export function formatLiMaCommandRunnerHelp(): string {
  return formatLiMaCommandHelp();
}
