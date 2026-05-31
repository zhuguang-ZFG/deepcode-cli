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
      ? { ok: true, message: "LiMa Server 连接已配置。" }
      : { ok: false, message: "LiMa Server 尚未配置。请设置 LIMA_CODE_SERVER_URL 和 LIMA_CODE_API_KEY。" };
  }

  if (parsed.command.kind === "status") {
    return {
      ok: true,
      message: [
        `LiMa Code 项目: ${options.projectRoot}`,
        `LiMa Server 配置: ${client.isConfigured() ? "已配置" : "未配置"}`,
      ].join("\n"),
    };
  }

  if (parsed.command.kind === "start") {
    return { ok: true, message: formatLiMaStartWorkbench(options.projectRoot, client.isConfigured()) };
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

  if (parsed.command.kind === "fix") {
    return runFixWorkflow(options.projectRoot, client, runTask, writeAudit, notify, lifecycleHooks);
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

  if (parsed.command.kind === "probe") {
    const { probeOnly } = await import("./drone");
    const output = probeOnly(options.projectRoot, parsed.command.json);
    return { ok: true, message: output };
  }

  if (parsed.command.kind === "drone") {
    return runDroneMode(parsed.command, options, client, runTask, writeAudit, notify);
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
      return { ok: true, message: `已请求停止 LiMa worker: ${marker}` };
    }
    if (parsed.command.action === "start") {
      if (process.env.LIMA_CODE_WORKER_DAEMON !== "1") {
        return {
          ok: false,
          message: "常驻 daemon 受开关保护。经操作者批准后设置 LIMA_CODE_WORKER_DAEMON=1，再重试 /lima daemon start。",
        };
      }
      return runWorkLoop({
        command: {
          mode: "loop",
          maxTasks: 100,
          maxMinutes: parsed.command.maxMinutes,
          intervalMs: parsed.command.intervalMs,
          backoffMs: parsed.command.backoffMs,
        },
        projectRoot: options.projectRoot,
        client,
        runTask,
        writeAudit,
        notify,
        lifecycleHooks,
        sleep: options.sleep ?? sleep,
        now: options.now,
        signal: options.signal,
        idleRetry: true,
      });
    }
    const stop = readWorkerStop(options.projectRoot);
    return {
      ok: true,
      message: stop.stop ? `LiMa worker 停止请求待处理: ${stop.reason}` : "LiMa worker 当前没有停止请求。",
    };
  }

  if (parsed.command.kind === "next") {
    const fetched = await client.fetchPendingTask();
    if (!fetched.ok) {
      return { ok: false, message: fetched.error };
    }
    if (!fetched.value) {
      return { ok: true, message: "当前没有待处理的 LiMa 任务。" };
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

function formatLiMaStartWorkbench(projectRoot: string, serverConfigured: boolean): string {
  return [
    "LiMa Code 工作台",
    `项目: ${projectRoot}`,
    `LiMa Server 配置: ${serverConfigured ? "已配置" : "未配置"}`,
    "",
    "从这里开始:",
    "1. /lima doctor",
    "2. /lima review",
    '3. /lima test --cmd "npm run check"',
    "4. 提问: 修复/审查/部署这个项目",
    "",
    "服务端任务:",
    "/lima next",
    "/lima work --once",
    "/lima work --loop --max-tasks <n>",
  ].join("\n");
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
    goal: "运行本地验证命令",
    constraints: [`命令: ${command}`],
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
    goal: "审查当前 git diff 的交付就绪状态",
    constraints: ["确认变更文件、验证证据、回滚说明和残余风险。", "不要从这个本地就绪检查中部署或推送。"],
    allowed_tools: ["git_diff"],
    max_runtime_sec: 300,
    mode: "ship",
  };
}

function formatTaskResult(result: LiMaAgentTaskResult, submitted: boolean): LiMaCommandRunnerResult {
  const lines = [
    `LiMa task ${result.task_id}: ${result.status}`,
    result.summary,
    submitted ? "结果已提交到 LiMa Server。" : "结果保留在本地。",
  ];
  if (result.changed_files.length > 0) {
    lines.push(`变更文件: ${result.changed_files.join(", ")}`);
  }
  if (result.next_action) {
    lines.push(`下一步: ${result.next_action}`);
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
    return { ok: false, message: `任务 ${result.task_id} 已运行，但结果提交失败: ${submitted.error}` };
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
  idleRetry?: boolean;
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
        summary: `LiMa work 因停止标记退出: ${stop.reason}`,
      });
      return { ok: true, message: `LiMa work 因停止标记退出: ${stop.reason}` };
    }

    if (options.signal?.aborted) {
      await notifyBestEffort(options.notify, {
        type: "work_stopped",
        summary: `LiMa work 在处理 ${processed} 个任务后被中断。`,
      });
      return { ok: false, message: `LiMa work 在处理 ${processed} 个任务后被中断。` };
    }

    const budgetDecision = budget.canStartNext();
    if (!budgetDecision.ok) {
      await notifyBestEffort(options.notify, {
        type: "work_stopped",
        summary: budgetDecision.reason,
      });
      return {
        ok: true,
        message: [`LiMa work 已处理 ${processed} 个任务。`, ...taskLines, budgetDecision.reason].join("\n"),
      };
    }

    const fetched = await options.client.fetchPendingTask();
    if (!fetched.ok) {
      await waitAfterFailure(options.command.backoffMs, options.sleep, options.signal);
      await notifyBestEffort(options.notify, {
        type: "work_stopped",
        summary: `LiMa work 因拉取任务失败而停止: ${fetched.error}`,
      });
      return { ok: false, message: `LiMa work 因拉取任务失败而停止: ${fetched.error}` };
    }
    if (!fetched.value) {
      if (options.idleRetry) {
        await options.sleep(options.command.intervalMs, options.signal);
        continue;
      }
      const prefix = processed > 0 ? `LiMa work 已处理 ${processed} 个任务。` : "";
      await notifyBestEffort(options.notify, {
        type: "work_stopped",
        summary: `${prefix}当前没有待处理的 LiMa 任务。`,
      });
      return { ok: true, message: `${prefix}当前没有待处理的 LiMa 任务。` };
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
              `LiMa work 在处理 ${processed} 个任务后停止。`,
              ...taskLines,
              `任务 ${fetched.value.task_id} 已达到隔离阈值，但 Server 更新失败: ${quarantined.error}`,
            ].join("\n"),
          };
        }
        return {
          ok: false,
          message: [
            `LiMa work 在处理 ${processed} 个任务后停止。`,
            ...taskLines,
            `任务 ${fetched.value.task_id} 在 ${failure.failure_count} 次失败后被隔离: ${quarantine.reason}`,
          ].join("\n"),
        };
      }
      await waitAfterFailure(options.command.backoffMs, options.sleep, options.signal);
      return {
        ok: false,
        message: [`LiMa work 在处理 ${processed} 个任务后停止。`, ...taskLines, result.message].join("\n"),
      };
    }

    if (options.command.mode === "once" || processed >= options.command.maxTasks) {
      break;
    }
    await options.sleep(options.command.intervalMs, options.signal);
  }

  return { ok: true, message: [`LiMa work 已处理 ${processed} 个任务。`, ...taskLines].join("\n") };
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
      reject(new Error("LiMa work 已中断。"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("LiMa work 已中断。"));
      },
      { once: true }
    );
  });
}

async function runFixWorkflow(
  projectRoot: string,
  client: LiMaCommandRunnerClient,
  runTask: (task: LiMaTaskRunnerRequest, config: LiMaTaskRunnerConfig) => Promise<LiMaAgentTaskResult>,
  writeAudit: (projectRoot: string, task: LiMaAgentTaskRequest, result: LiMaAgentTaskResult) => void,
  notify: LiMaCommandRunnerNotifier,
  lifecycleHooks: LiMaLifecycleHooks | null
): Promise<LiMaCommandRunnerResult> {
  // Step 1: Claim a pending task
  const fetched = await client.fetchPendingTask();
  if (!fetched.ok) {
    return { ok: false, message: `拉取任务失败: ${fetched.error}` };
  }
  if (!fetched.value) {
    return { ok: true, message: "当前没有待处理的 LiMa 任务。" };
  }

  const task = fetched.value;
  await notifyBestEffort(notify, {
    type: "task_started",
    taskId: task.task_id,
    status: "running",
    summary: task.goal,
  });

  const activeSkills = evaluateLiMaSkillActivationForProject(task, projectRoot);
  runLifecycleHookBestEffort(() => lifecycleHooks?.onTaskStart(task, activeSkills));

  // Step 2: Generate context and plan artifact
  const planResult = await runTask(
    { ...(task as LiMaTaskRunnerRequest), mode: "plan" },
    { currentWorkspace: projectRoot, projectRoot }
  );

  // Step 3: Run tests if specified
  let testResult: LiMaAgentTaskResult | null = null;
  const testCommands = task.test_commands ?? [];
  if (testCommands.length > 0) {
    testResult = await runTask(
      {
        ...(task as LiMaTaskRunnerRequest),
        mode: "test",
        test_commands: testCommands,
        allowed_tools: [...task.allowed_tools, "test"],
      },
      { currentWorkspace: projectRoot, projectRoot }
    );
  }

  const lines = [
    `LiMa fix 工作流已为任务 ${task.task_id} 准备就绪: ${task.goal}`,
    `产物目录: .lima/artifacts/${task.task_id}/`,
    testResult ? `测试结果: ${testResult.status === "succeeded" ? "全部通过" : "发现失败"}` : "未指定测试命令。",
    planResult.artifacts.length > 0 ? `计划文件: ${planResult.artifacts.join(", ")}` : "计划产物已写入。",
    "",
    "下一步:",
    "1. 审查 plan.md 和 context.json",
    "2. 修复失败测试或实现任务",
    testCommands.length > 0 ? `3. 验证: /lima test --cmd "${testCommands[0]}"` : "",
    testCommands.length > 1 ? `   ...其余命令: ${testCommands.slice(1).join(", ")}` : "",
    `4. 准备好后交付: /lima ship（会提交结果）`,
    testResult && testResult.status !== "succeeded" ? "\n提示: 查看产物目录中的 tests.json 了解失败详情。" : "",
  ]
    .filter(Boolean)
    .join("\n");

  writeAudit(projectRoot, task, planResult);
  return { ok: true, message: lines };
}

async function runDroneMode(
  command: { maxTasks: number; maxMinutes: number; allowMediumRisk: boolean; intervalMs: number },
  options: LiMaCommandRunnerOptions,
  client: LiMaCommandRunnerClient,
  runTask: (task: LiMaTaskRunnerRequest, config: LiMaTaskRunnerConfig) => Promise<LiMaAgentTaskResult>,
  writeAudit: (projectRoot: string, task: LiMaAgentTaskRequest, result: LiMaAgentTaskResult) => void,
  notify: LiMaCommandRunnerNotifier
): Promise<LiMaCommandRunnerResult> {
  const { runDroneLoop } = await import("./drone");

  const report = await runDroneLoop(
    {
      projectRoot: options.projectRoot,
      maxTasks: command.maxTasks,
      maxMinutes: command.maxMinutes,
      allowMediumRisk: command.allowMediumRisk,
      intervalMs: command.intervalMs,
      signal: options.signal,
    },
    {
      runTask,
      submitResult: client.isConfigured()
        ? async (result) => {
            const r = await client.submitResult(result);
            return { ok: r.ok, error: r.ok ? undefined : r.error };
          }
        : undefined,
      writeAudit,
      notify: options.notify ?? notify,
    }
  );

  const lines = [
    `Drone 已完成，用时 ${(report.durationMs / 1000).toFixed(1)}s`,
    `任务: ${report.tasksSucceeded}/${report.tasksAttempted} 成功，${report.tasksFailed} 失败`,
    `发现项: ${report.findingsResolved} 已解决，${report.findingsRemaining} 剩余`,
    report.checkpointUsed ? "已使用 checkpoint 恢复" : "",
    "",
    ...report.messages,
  ]
    .filter(Boolean)
    .join("\n");

  return { ok: report.tasksFailed === 0, message: lines };
}

export function formatLiMaCommandRunnerHelp(): string {
  return formatLiMaCommandHelp();
}
