import * as fs from "fs";
import * as path from "path";
import type { LiMaAgentTaskRequest, LiMaAgentTaskResult } from "./agent-task-types";
import { renderPromptContract, resolveTaskPromptContract } from "./prompt-contract";
import type { LiMaActiveSkill } from "./skill-activation";

export type LiMaLifecycleHookResult =
  | { ok: true; dir: string; warnings: string[] }
  | { ok: false; dir: string; error: string; warnings: string[] };

export type LiMaLifecycleHooks = {
  onTaskStart: (task: LiMaAgentTaskRequest, activeSkills: LiMaActiveSkill[]) => LiMaLifecycleHookResult;
  onTaskStop: (result: LiMaAgentTaskResult) => LiMaLifecycleHookResult;
};

export function createLiMaFilesystemLifecycleHooks(projectRoot: string): LiMaLifecycleHooks {
  return {
    onTaskStart: (task, activeSkills) => writeLiMaTaskStartHook(projectRoot, task, activeSkills),
    onTaskStop: (result) => writeLiMaTaskStopHook(projectRoot, result),
  };
}

export function writeLiMaTaskStartHook(
  projectRoot: string,
  task: LiMaAgentTaskRequest,
  activeSkills: LiMaActiveSkill[]
): LiMaLifecycleHookResult {
  const dir = taskDirectory(projectRoot, task.task_id);
  const warnings: string[] = [];
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "context.md"), formatTaskContext(task, activeSkills), "utf8");
    fs.writeFileSync(path.join(dir, "tasks.md"), formatTaskChecklist(task, activeSkills), "utf8");
    return { ok: true, dir, warnings };
  } catch (error) {
    return { ok: false, dir, error: formatError(error), warnings };
  }
}

export function writeLiMaTaskStopHook(projectRoot: string, result: LiMaAgentTaskResult): LiMaLifecycleHookResult {
  const dir = taskDirectory(projectRoot, result.task_id);
  const warnings: string[] = [];
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "summary.md"), formatTaskSummary(result), "utf8");
    fs.writeFileSync(path.join(dir, "touched-files.txt"), formatTouchedFiles(result.changed_files), "utf8");
    return { ok: true, dir, warnings };
  } catch (error) {
    return { ok: false, dir, error: formatError(error), warnings };
  }
}

function taskDirectory(projectRoot: string, taskId: string): string {
  return path.join(projectRoot, ".lima-code", "dev", "active", sanitizeTaskId(taskId));
}

function sanitizeTaskId(taskId: string): string {
  const safe = taskId.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "task";
}

function formatTaskContext(task: LiMaAgentTaskRequest, activeSkills: LiMaActiveSkill[]): string {
  const skills = activeSkills.length > 0 ? activeSkills.map((skill) => `- ${skill.name}: ${skill.reason}`) : ["- none"];
  return [
    `# LiMa Task ${task.task_id}`,
    "",
    `- Mode: ${task.mode}`,
    `- Repo: ${task.repo}`,
    `- Branch: ${task.branch}`,
    `- Max runtime: ${task.max_runtime_sec}s`,
    "",
    "## Prompt Contract",
    "",
    renderPromptContract(resolveTaskPromptContract(task)),
    "",
    "## Allowed Tools",
    "",
    ...listOrNone(task.allowed_tools),
    "",
    "## Active Skill Candidates",
    "",
    ...skills,
    "",
  ].join("\n");
}

function formatTaskChecklist(task: LiMaAgentTaskRequest, activeSkills: LiMaActiveSkill[]): string {
  const lines = [
    `# Task ${task.task_id} Checklist`,
    "",
    "- [ ] Review task goal and constraints",
    "- [ ] Review active skill candidates",
  ];
  if (task.test_commands && task.test_commands.length > 0) {
    lines.push("- [ ] Run requested tests");
  }
  if (activeSkills.some((skill) => skill.name === "superpowers:test-driven-development")) {
    lines.push("- [ ] Preserve TDD evidence when code changes");
  }
  lines.push("- [ ] Record result summary", "- [ ] Leave remaining risks explicit", "");
  return lines.join("\n");
}

function formatTaskSummary(result: LiMaAgentTaskResult): string {
  return [
    `# LiMa Task ${result.task_id} Summary`,
    "",
    `- Status: ${result.status}`,
    `- Next action: ${result.next_action || "none"}`,
    "",
    "## Summary",
    "",
    result.summary || "No summary.",
    "",
    "## Changed Files",
    "",
    ...listOrNone(result.changed_files),
    "",
    "## Test Commands",
    "",
    ...listOrNone(result.test_commands),
    "",
    "## Risks",
    "",
    ...listOrNone(result.risks),
    "",
  ].join("\n");
}

function formatTouchedFiles(files: string[]): string {
  return files.length > 0 ? `${files.join("\n")}\n` : "";
}

function listOrNone(values: string[]): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : ["- none"];
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
