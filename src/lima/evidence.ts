import type { LiMaAgentTaskResult, LiMaAgentTaskTestResult } from "./agent-task-types";
import { truncateText } from "./result-builder";

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]"],
  [/\bghp_[A-Za-z0-9]{36}\b/g, "ghp_[REDACTED]"],
  [/\bgho_[A-Za-z0-9]{36}\b/g, "gho_[REDACTED]"],
  [/\bAKIA[A-Z0-9]{16}\b/g, "AKIA[REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "eyJ...[REDACTED]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer [REDACTED]"],
  [/\b(api[_-]?key|token|password|secret|credential)=([^\s&]+)/gi, "$1=[REDACTED]"],
  [/"(api[_-]?key|token|password|secret|credential)"\s*:\s*"[^"]+"/gi, '"$1":"[REDACTED]"'],
  [/-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g, "[PRIVATE_KEY_REDACTED]"],
  [/mongodb(\+srv)?:\/\/[^\s"']+/gi, "mongodb://[REDACTED]"],
  [/postgres(ql)?:\/\/[^\s"']+/gi, "postgres://[REDACTED]"],
  [/mysql:\/\/[^\s"']+/gi, "mysql://[REDACTED]"],
  [/redis:\/\/[^\s"']+/gi, "redis://[REDACTED]"],
];

export type LiMaEvidenceBundle = {
  task_id: string;
  status: LiMaAgentTaskResult["status"];
  summary: string;
  changed_files: string[];
  test_commands: string[];
  test_results: LiMaAgentTaskTestResult[];
  diff_preview: string;
  risks: string[];
  next_action: string;
};

export function buildLiMaEvidenceBundle(result: LiMaAgentTaskResult): LiMaEvidenceBundle {
  return {
    task_id: result.task_id,
    status: result.status,
    summary: redactSecrets(truncateText(result.summary)),
    changed_files: result.changed_files,
    test_commands: result.test_commands,
    test_results: result.test_results.map((testResult) => ({
      ...testResult,
      stdout: testResult.stdout ? redactSecrets(truncateText(testResult.stdout)) : undefined,
      stderr: testResult.stderr ? redactSecrets(truncateText(testResult.stderr)) : undefined,
    })),
    diff_preview: redactSecrets(truncateText(result.diff_preview)),
    risks: result.risks.map((risk) => redactSecrets(truncateText(risk))),
    next_action: redactSecrets(truncateText(result.next_action)),
  };
}

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);
}
