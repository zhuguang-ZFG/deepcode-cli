import * as fs from "fs";
import * as path from "path";
import type { LiMaAgentTaskClientResult } from "./agent-task-client";
import type { LiMaAgentTaskRequest } from "./agent-task-types";
import { readLiMaTelegramConfig, redactTelegramText } from "./telegram-notifier";
import { readWorkerStop } from "./worker-control";

export type LiMaDoctorStatus = "pass" | "warn" | "fail" | "skip";

export type LiMaDoctorCheck = {
  name: string;
  status: LiMaDoctorStatus;
  detail: string;
};

export type LiMaDoctorReport = {
  ok: boolean;
  checks: LiMaDoctorCheck[];
};

export type LiMaDoctorClient = {
  isConfigured(): boolean;
  fetchPendingTask(): Promise<LiMaAgentTaskClientResult<LiMaAgentTaskRequest | null>>;
};

export type LiMaDoctorOptions = {
  projectRoot: string;
  client: LiMaDoctorClient;
  env?: NodeJS.ProcessEnv;
};

export async function runLiMaDoctor(options: LiMaDoctorOptions): Promise<LiMaDoctorReport> {
  const checks: LiMaDoctorCheck[] = [];

  checks.push(checkProjectRoot(options.projectRoot));

  const configured = options.client.isConfigured();
  checks.push({
    name: "server_config",
    status: configured ? "pass" : "fail",
    detail: configured ? "LiMa Server URL 和 API key 已配置。" : "请设置 LIMA_CODE_SERVER_URL 和 LIMA_CODE_API_KEY。",
  });

  if (configured) {
    checks.push(await checkServerReachable(options.client));
  } else {
    checks.push({
      name: "server_reachable",
      status: "skip",
      detail: "已跳过：LiMa Server 配置缺失。",
    });
  }

  checks.push(checkWorkerStop(options.projectRoot));
  checks.push(checkTelegram(options.env));
  checks.push(checkSkillRules(options.projectRoot));
  checks.push(checkAuditLog(options.projectRoot));

  return {
    ok: !checks.some((check) => check.status === "fail"),
    checks,
  };
}

export function formatLiMaDoctorReport(report: LiMaDoctorReport): string {
  const lines = [`LiMa doctor：${report.ok ? "就绪" : "需要处理"}`];
  for (const check of report.checks) {
    lines.push(`[${formatDoctorStatus(check.status)}] ${formatDoctorCheckName(check.name)}: ${check.detail}`);
  }
  return redactTelegramText(lines.join("\n"));
}

function formatDoctorStatus(status: LiMaDoctorStatus): string {
  switch (status) {
    case "pass":
      return "通过";
    case "warn":
      return "警告";
    case "fail":
      return "失败";
    case "skip":
      return "跳过";
  }
}

function formatDoctorCheckName(name: string): string {
  const labels: Record<string, string> = {
    project_root: "项目目录",
    server_config: "服务配置",
    server_reachable: "服务连通",
    worker_stop: "停止标记",
    telegram_outbound: "Telegram 通知",
    project_skill_rules: "项目技能规则",
    audit_log: "本地审计日志",
  };
  return labels[name] ?? name;
}

function checkProjectRoot(projectRoot: string): LiMaDoctorCheck {
  try {
    const stat = fs.statSync(projectRoot);
    return stat.isDirectory()
      ? { name: "project_root", status: "pass", detail: projectRoot }
      : { name: "project_root", status: "fail", detail: `${projectRoot} 不是目录。` };
  } catch {
    return { name: "project_root", status: "fail", detail: `${projectRoot} 不存在。` };
  }
}

async function checkServerReachable(client: LiMaDoctorClient): Promise<LiMaDoctorCheck> {
  const pending = await client.fetchPendingTask();
  if (!pending.ok) {
    return { name: "server_reachable", status: "fail", detail: pending.error };
  }
  return {
    name: "server_reachable",
    status: "pass",
    detail: pending.value ? `可见待处理任务: ${pending.value.task_id}` : "pending-task 接口可访问。",
  };
}

function checkWorkerStop(projectRoot: string): LiMaDoctorCheck {
  const stop = readWorkerStop(projectRoot);
  if (stop.stop) {
    return {
      name: "worker_stop",
      status: "fail",
      detail: `存在 worker 停止标记: ${stop.reason}`,
    };
  }
  return { name: "worker_stop", status: "pass", detail: "没有待处理的 worker 停止标记。" };
}

function checkTelegram(env: NodeJS.ProcessEnv | undefined): LiMaDoctorCheck {
  const config = readLiMaTelegramConfig(env);
  return config.configured
    ? { name: "telegram_outbound", status: "pass", detail: "Telegram 出站通知配置已存在。" }
    : { name: "telegram_outbound", status: "warn", detail: "Telegram 出站通知未配置（可选）。" };
}

function checkSkillRules(projectRoot: string): LiMaDoctorCheck {
  const file = path.join(projectRoot, ".lima-code", "skill-rules.json");
  return fs.existsSync(file)
    ? { name: "project_skill_rules", status: "pass", detail: ".lima-code/skill-rules.json 已存在。" }
    : { name: "project_skill_rules", status: "warn", detail: "未找到项目 skill rules 文件。" };
}

function checkAuditLog(projectRoot: string): LiMaDoctorCheck {
  const file = path.join(projectRoot, ".lima-code", "audit.jsonl");
  return fs.existsSync(file)
    ? { name: "audit_log", status: "pass", detail: ".lima-code/audit.jsonl 已存在。" }
    : { name: "audit_log", status: "warn", detail: "还没有本地 LiMa 审计日志。" };
}
