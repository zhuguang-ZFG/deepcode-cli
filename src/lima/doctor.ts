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
    detail: configured
      ? "LiMa Server URL and API key are configured."
      : "Set LIMA_CODE_SERVER_URL and LIMA_CODE_API_KEY.",
  });

  if (configured) {
    checks.push(await checkServerReachable(options.client));
  } else {
    checks.push({
      name: "server_reachable",
      status: "skip",
      detail: "Skipped because LiMa Server configuration is missing.",
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
  const lines = [`LiMa doctor: ${report.ok ? "ready" : "needs attention"}`];
  for (const check of report.checks) {
    lines.push(`[${check.status}] ${check.name}: ${check.detail}`);
  }
  return redactTelegramText(lines.join("\n"));
}

function checkProjectRoot(projectRoot: string): LiMaDoctorCheck {
  try {
    const stat = fs.statSync(projectRoot);
    return stat.isDirectory()
      ? { name: "project_root", status: "pass", detail: projectRoot }
      : { name: "project_root", status: "fail", detail: `${projectRoot} is not a directory.` };
  } catch {
    return { name: "project_root", status: "fail", detail: `${projectRoot} does not exist.` };
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
    detail: pending.value ? `Pending task visible: ${pending.value.task_id}` : "Pending-task endpoint is reachable.",
  };
}

function checkWorkerStop(projectRoot: string): LiMaDoctorCheck {
  const stop = readWorkerStop(projectRoot);
  if (stop.stop) {
    return {
      name: "worker_stop",
      status: "fail",
      detail: `Worker stop marker is pending: ${stop.reason}`,
    };
  }
  return { name: "worker_stop", status: "pass", detail: "No worker stop marker is pending." };
}

function checkTelegram(env: NodeJS.ProcessEnv | undefined): LiMaDoctorCheck {
  const config = readLiMaTelegramConfig(env);
  return config.configured
    ? { name: "telegram_outbound", status: "pass", detail: "Telegram outbound notification config is present." }
    : { name: "telegram_outbound", status: "warn", detail: "Telegram outbound notification config is optional." };
}

function checkSkillRules(projectRoot: string): LiMaDoctorCheck {
  const file = path.join(projectRoot, ".lima-code", "skill-rules.json");
  return fs.existsSync(file)
    ? { name: "project_skill_rules", status: "pass", detail: ".lima-code/skill-rules.json is present." }
    : { name: "project_skill_rules", status: "warn", detail: "No project skill rules file found." };
}

function checkAuditLog(projectRoot: string): LiMaDoctorCheck {
  const file = path.join(projectRoot, ".lima-code", "audit.jsonl");
  return fs.existsSync(file)
    ? { name: "audit_log", status: "pass", detail: ".lima-code/audit.jsonl is present." }
    : { name: "audit_log", status: "warn", detail: "No local LiMa audit log found yet." };
}
