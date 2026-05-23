import type { LiMaAgentTaskRequest, LiMaAgentTaskResult, LiMaAgentTaskStatus } from "./agent-task-types";

const MAX_TEXT_CHARS = 4000;

export function buildLiMaTaskResult(
  task: Pick<LiMaAgentTaskRequest, "task_id">,
  input: {
    status: LiMaAgentTaskStatus;
    summary: string;
    changedFiles?: string[];
    testCommands?: string[];
    testResults?: LiMaAgentTaskResult["test_results"];
    diffPreview?: string;
    artifacts?: string[];
    risks?: string[];
    nextAction?: string;
  }
): LiMaAgentTaskResult {
  return {
    task_id: task.task_id,
    status: input.status,
    summary: truncateText(input.summary),
    changed_files: input.changedFiles ?? [],
    test_commands: input.testCommands ?? [],
    test_results: input.testResults ?? [],
    diff_preview: truncateText(input.diffPreview ?? ""),
    artifacts: input.artifacts ?? [],
    risks: input.risks ?? [],
    next_action: input.nextAction ?? "",
  };
}

export function parseChangedFilesFromGitNameOnly(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function truncateText(value: string, maxChars = MAX_TEXT_CHARS): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}
