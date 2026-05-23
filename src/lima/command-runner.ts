import { LiMaAgentTaskClient } from "./agent-task-client";
import type { LiMaAgentTaskClientResult } from "./agent-task-client";
import type { LiMaAgentTaskRequest, LiMaAgentTaskResult } from "./agent-task-types";
import { appendLiMaAuditEntry } from "./audit-log";
import { formatLiMaCommandHelp, parseLiMaCommand } from "./commands";
import { runLiMaAgentTask, type LiMaTaskRunnerConfig, type LiMaTaskRunnerRequest } from "./task-runner";

export type LiMaCommandRunnerClient = {
  isConfigured(): boolean;
  fetchTask(taskId: string): Promise<LiMaAgentTaskClientResult<LiMaAgentTaskRequest>>;
  fetchPendingTask(): Promise<LiMaAgentTaskClientResult<LiMaAgentTaskRequest | null>>;
  submitResult(result: LiMaAgentTaskResult): Promise<LiMaAgentTaskClientResult<{ accepted: boolean }>>;
  fetchTaskEvents(taskId: string): Promise<LiMaAgentTaskClientResult<unknown[]>>;
};

export type LiMaCommandRunnerResult = {
  ok: boolean;
  message: string;
};

export type LiMaCommandRunnerOptions = {
  projectRoot: string;
  client?: LiMaCommandRunnerClient;
  runTask?: (task: LiMaTaskRunnerRequest, config: LiMaTaskRunnerConfig) => Promise<LiMaAgentTaskResult>;
  appendAudit?: (projectRoot: string, task: LiMaAgentTaskRequest, result: LiMaAgentTaskResult) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
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

  if (parsed.command.kind === "review") {
    const task = buildLocalReviewTask(options.projectRoot);
    const result = await runTask(task, { currentWorkspace: options.projectRoot });
    writeAudit(options.projectRoot, task, result);
    return formatTaskResult(result, false);
  }

  if (parsed.command.kind === "next") {
    const fetched = await client.fetchPendingTask();
    if (!fetched.ok) {
      return { ok: false, message: fetched.error };
    }
    if (!fetched.value) {
      return { ok: true, message: "No pending LiMa task is available." };
    }
    return runAndSubmitTask(fetched.value, options.projectRoot, client, runTask, writeAudit);
  }

  if (parsed.command.kind === "work") {
    return runWorkLoop({
      command: parsed.command,
      projectRoot: options.projectRoot,
      client,
      runTask,
      writeAudit,
      sleep: options.sleep ?? sleep,
      signal: options.signal,
    });
  }

  const fetched = await client.fetchTask(parsed.command.taskId);
  if (!fetched.ok) {
    return { ok: false, message: fetched.error };
  }

  return runAndSubmitTask(fetched.value, options.projectRoot, client, runTask, writeAudit);
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
  writeAudit: (projectRoot: string, task: LiMaAgentTaskRequest, result: LiMaAgentTaskResult) => void
): Promise<LiMaCommandRunnerResult> {
  const result = await runTask(task, { currentWorkspace: projectRoot });
  writeAudit(projectRoot, task, result);

  const submitted = await client.submitResult(result);
  if (!submitted.ok) {
    return { ok: false, message: `Task ${result.task_id} ran but result submission failed: ${submitted.error}` };
  }

  return formatTaskResult(result, true);
}

async function runWorkLoop(options: {
  command: { mode: "once" | "loop"; maxTasks: number; intervalMs: number; backoffMs: number };
  projectRoot: string;
  client: LiMaCommandRunnerClient;
  runTask: (task: LiMaTaskRunnerRequest, config: LiMaTaskRunnerConfig) => Promise<LiMaAgentTaskResult>;
  writeAudit: (projectRoot: string, task: LiMaAgentTaskRequest, result: LiMaAgentTaskResult) => void;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}): Promise<LiMaCommandRunnerResult> {
  const taskLines: string[] = [];
  let processed = 0;

  while (processed < options.command.maxTasks) {
    if (options.signal?.aborted) {
      return { ok: false, message: `LiMa work aborted after ${processed} task(s).` };
    }

    const fetched = await options.client.fetchPendingTask();
    if (!fetched.ok) {
      await waitAfterFailure(options.command.backoffMs, options.sleep, options.signal);
      return { ok: false, message: `LiMa work stopped after fetch error: ${fetched.error}` };
    }
    if (!fetched.value) {
      const prefix = processed > 0 ? `LiMa work processed ${processed} task(s). ` : "";
      return { ok: true, message: `${prefix}No pending LiMa task is available.` };
    }

    const result = await runAndSubmitTask(
      fetched.value,
      options.projectRoot,
      options.client,
      options.runTask,
      options.writeAudit
    );
    processed += 1;
    taskLines.push(firstLine(result.message));
    if (!result.ok) {
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
