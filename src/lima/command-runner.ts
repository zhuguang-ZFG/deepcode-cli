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

  const fetched = await client.fetchTask(parsed.command.taskId);
  if (!fetched.ok) {
    return { ok: false, message: fetched.error };
  }

  const result = await runTask(fetched.value, { currentWorkspace: options.projectRoot });
  writeAudit(options.projectRoot, fetched.value, result);

  const submitted = await client.submitResult(result);
  if (!submitted.ok) {
    return { ok: false, message: `Task ${result.task_id} ran but result submission failed: ${submitted.error}` };
  }

  return formatTaskResult(result, true);
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

export function formatLiMaCommandRunnerHelp(): string {
  return formatLiMaCommandHelp();
}
