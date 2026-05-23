import * as fs from "fs";
import * as path from "path";
import type { LiMaAgentTaskRequest, LiMaAgentTaskResult } from "./agent-task-types";
import { buildLiMaEvidenceBundle } from "./evidence";

export type LiMaAuditEntry = {
  timestamp: string;
  task_id: string;
  mode: LiMaAgentTaskRequest["mode"];
  status: LiMaAgentTaskResult["status"];
  repo: string;
  changed_files: string[];
  test_commands: string[];
  summary: string;
};

export function getLiMaAuditLogPath(projectRoot: string): string {
  return path.join(projectRoot, ".lima-code", "audit.jsonl");
}

export function appendLiMaAuditEntry(
  projectRoot: string,
  task: Pick<LiMaAgentTaskRequest, "task_id" | "mode" | "repo">,
  result: LiMaAgentTaskResult,
  now: Date = new Date()
): LiMaAuditEntry {
  const evidence = buildLiMaEvidenceBundle(result);
  const entry: LiMaAuditEntry = {
    timestamp: now.toISOString(),
    task_id: task.task_id,
    mode: task.mode,
    status: result.status,
    repo: task.repo,
    changed_files: evidence.changed_files,
    test_commands: evidence.test_commands,
    summary: evidence.summary,
  };

  const auditPath = getLiMaAuditLogPath(projectRoot);
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}
