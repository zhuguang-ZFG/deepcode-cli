import type { LiMaAgentTaskResult, LiMaAgentTaskTestResult } from "./agent-task-types";
import { truncateText } from "./result-builder";

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer [REDACTED]"],
  [/\b(api[_-]?key|token|password|secret)=([^\s&]+)/gi, "$1=[REDACTED]"],
  [/"(api[_-]?key|token|password|secret)"\s*:\s*"[^"]+"/gi, '"$1":"[REDACTED]"'],
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
