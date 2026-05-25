/** Artifact bundle — structured review packet for LiMa Code task outputs.

Each task run writes to .lima/artifacts/<task_id>/:
  plan.md       — context, goal, constraints, suggested next slice
  context.json  — git diff summary, recent changed files, AGENTS.md rules, open risks
  risks.md      — identified risks with mitigation notes
  tests.json    — test command results (exit code, duration, stdout/stderr)
  diff.patch    — full git diff output
  ship.md       — rollback notes, commit summary, review checklist, residual risks

The bundle can be inspected by a human or consumed by LiMa Server directly,
without scrolling through terminal output.
*/
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import type { LiMaAgentTaskRequest, LiMaAgentTaskResult, LiMaAgentTaskTestResult } from "./agent-task-types";

const ARTIFACTS_DIR = ".lima/artifacts";

export type ContextSnapshot = {
  branch: string;
  recentFiles: string[];
  changedFiles: string[];
  gitStatus: string;
  agentsRules: string;
  existingRisks: string[];
};

export type ArtifactBundle = {
  taskId: string;
  dir: string;
  files: string[];
};

export type WritePlanOptions = {
  task: LiMaAgentTaskRequest;
  context: ContextSnapshot;
  suggestedSlice?: string;
};

export type WriteTestOptions = {
  task: LiMaAgentTaskRequest;
  commands: string[];
  results: LiMaAgentTaskTestResult[];
};

export type WriteShipOptions = {
  task: LiMaAgentTaskRequest;
  diffPreview: string;
  changedFiles: string[];
  testResults?: LiMaAgentTaskTestResult[];
  remainingRisks: string[];
  rollbackNotes: string;
  commitSummary: string;
};

export type WriteReviewOptions = {
  task: LiMaAgentTaskRequest;
  diffPreview: string;
  changedFiles: string[];
  findings: string[];
};

export function artifactDir(projectRoot: string, taskId: string): string {
  return path.join(projectRoot, ARTIFACTS_DIR, taskId);
}

export function ensureArtifactDir(projectRoot: string, taskId: string): string {
  const dir = artifactDir(projectRoot, taskId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writePlanArtifacts(projectRoot: string, options: WritePlanOptions): ArtifactBundle {
  const dir = ensureArtifactDir(projectRoot, options.task.task_id);
  const files: string[] = [];

  // plan.md
  const planLines = [
    `# Plan: ${options.task.goal}`,
    `> task_id: ${options.task.task_id}`,
    `> branch: ${options.task.branch}`,
    `> repo: ${options.task.repo}`,
    ``,
    `## Goal`,
    options.task.goal,
    ``,
    `## Constraints`,
    ...options.task.constraints.map((c) => `- ${c}`),
    ``,
    `## Context`,
    `- Changed files (${options.context.changedFiles.length}): ${options.context.changedFiles.join(", ") || "(none)"}`,
    `- Recent files (${options.context.recentFiles.length}): ${options.context.recentFiles.join(", ") || "(none)"}`,
    ``,
    `## Suggested Next Slice`,
    options.suggestedSlice || "Review context above and decide on the next implementation step.",
    ``,
  ];
  const planPath = path.join(dir, "plan.md");
  fs.writeFileSync(planPath, planLines.join("\n"), "utf8");
  files.push("plan.md");

  // context.json
  const contextPayload = {
    task_id: options.task.task_id,
    branch: options.task.branch,
    repo: options.task.repo,
    goal: options.task.goal,
    constraints: options.task.constraints,
    changed_files: options.context.changedFiles,
    recent_files: options.context.recentFiles,
    git_status: options.context.gitStatus,
    agents_rules_present: !!options.context.agentsRules,
  };
  const contextPath = path.join(dir, "context.json");
  fs.writeFileSync(contextPath, JSON.stringify(contextPayload, null, 2), "utf8");
  files.push("context.json");

  // risks.md
  const risksLines = [
    `# Risks: ${options.task.goal}`,
    ``,
    `## Pre-existing Risks`,
    ...options.context.existingRisks.map((r) => `- ${r}`),
    ...(options.context.existingRisks.length === 0 ? ["(none recorded)"] : []),
    ``,
    `## New Risks Identified`,
    `- (to be filled by reviewer)`,
    ``,
    `## Mitigation`,
    `- Each risk should have at least one mitigation or acceptance rationale.`,
    ``,
  ];
  const risksPath = path.join(dir, "risks.md");
  fs.writeFileSync(risksPath, risksLines.join("\n"), "utf8");
  files.push("risks.md");

  return { taskId: options.task.task_id, dir, files };
}

export function writeTestArtifacts(projectRoot: string, options: WriteTestOptions): ArtifactBundle {
  const dir = ensureArtifactDir(projectRoot, options.task.task_id);
  const files: string[] = [];

  const payload = options.results.map((r) => ({
    command: r.command,
    exit_code: r.exit_code,
    duration_ms: r.duration_ms,
    stdout: (r.stdout ?? "").slice(0, 2000),
    stderr: (r.stderr ?? "").slice(0, 2000),
  }));
  const testPath = path.join(dir, "tests.json");
  fs.writeFileSync(testPath, JSON.stringify(payload, null, 2), "utf8");
  files.push("tests.json");

  return { taskId: options.task.task_id, dir, files };
}

export function writeShipArtifacts(projectRoot: string, options: WriteShipOptions): ArtifactBundle {
  const dir = ensureArtifactDir(projectRoot, options.task.task_id);
  const files: string[] = [];

  // diff.patch
  if (options.diffPreview) {
    const diffPath = path.join(dir, "diff.patch");
    fs.writeFileSync(diffPath, options.diffPreview, "utf8");
    files.push("diff.patch");
  }

  // ship.md
  const shipLines = [
    `# Ship Review: ${options.task.goal}`,
    `> task_id: ${options.task.task_id}`,
    `> branch: ${options.task.branch}`,
    ``,
    `## Changed Files`,
    ...options.changedFiles.map((f) => `- ${f}`),
    ...(options.changedFiles.length === 0 ? ["(no changes)"] : []),
    ``,
    `## Test Results`,
    ...(options.testResults ?? []).map((r) => `- ${r.command}: exit=${r.exit_code} (${r.duration_ms}ms)`),
    ...(!options.testResults || options.testResults.length === 0 ? ["(no tests run)"] : []),
    ``,
    `## Remaining Risks`,
    ...options.remainingRisks.map((r) => `- ${r}`),
    ``,
    `## Rollback Notes`,
    options.rollbackNotes || "(none provided)",
    ``,
    `## Commit Summary`,
    options.commitSummary || "(none provided)",
    ``,
    `## Review Checklist`,
    `- [ ] All tests pass`,
    `- [ ] Changed files are scoped to the goal`,
    `- [ ] No credentials, debug statements, or large binaries`,
    `- [ ] Rollback notes are clear`,
    `- [ ] Commit message is conventional`,
    ``,
  ];
  const shipPath = path.join(dir, "ship.md");
  fs.writeFileSync(shipPath, shipLines.join("\n"), "utf8");
  files.push("ship.md");

  return { taskId: options.task.task_id, dir, files };
}

export function writeReviewArtifacts(projectRoot: string, options: WriteReviewOptions): ArtifactBundle {
  const dir = ensureArtifactDir(projectRoot, options.task.task_id);
  const files: string[] = [];

  if (options.diffPreview) {
    const diffPath = path.join(dir, "diff.patch");
    fs.writeFileSync(diffPath, options.diffPreview, "utf8");
    files.push("diff.patch");
  }

  const reviewLines = [
    `# Review: ${options.task.goal}`,
    `> task_id: ${options.task.task_id}`,
    ``,
    `## Changed Files`,
    ...options.changedFiles.map((f) => `- ${f}`),
    ...(options.changedFiles.length === 0 ? ["(no changes)"] : []),
    ``,
    `## Findings`,
    ...options.findings.map((f) => `- ${f}`),
    ...(options.findings.length === 0 ? ["(no findings)"] : []),
    ``,
  ];
  const reviewPath = path.join(dir, "review.md");
  fs.writeFileSync(reviewPath, reviewLines.join("\n"), "utf8");
  files.push("review.md");

  return { taskId: options.task.task_id, dir, files };
}

export function readArtifactDir(projectRoot: string, taskId: string): string[] {
  const dir = artifactDir(projectRoot, taskId);
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile());
}

export function readArtifactContent(projectRoot: string, taskId: string, filename: string): string | null {
  const filePath = path.join(artifactDir(projectRoot, taskId), filename);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

export function snapshotContext(projectRoot: string): ContextSnapshot {
  const changedFiles = readGitChangedFiles(projectRoot).filter((f) => !f.startsWith(".lima"));
  const recentFiles = readGitRecentFiles(projectRoot);
  const gitStatus = readGitStatus(projectRoot);
  const agentsRules =
    readFileIfExists(path.join(projectRoot, "AGENTS.md")) ||
    readFileIfExists(path.join(projectRoot, "CLAUDE.md")) ||
    "";
  const existingRisks = extractRisksFromFindings(projectRoot);

  return {
    branch: readGitBranch(projectRoot),
    recentFiles,
    changedFiles,
    gitStatus,
    agentsRules,
    existingRisks,
  };
}

function readGitBranch(projectRoot: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectRoot,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  } catch {
    return "unknown";
  }
}

function readGitChangedFiles(projectRoot: string): string[] {
  try {
    return execSync("git diff --name-only", { cwd: projectRoot, encoding: "utf8", windowsHide: true })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readGitRecentFiles(projectRoot: string): string[] {
  try {
    return execSync("git log --name-only --oneline -5", { cwd: projectRoot, encoding: "utf8", windowsHide: true })
      .trim()
      .split(/\r?\n/)
      .filter((line: string) => !line.startsWith(" ") && line.includes("."))
      .slice(0, 15);
  } catch {
    return [];
  }
}

function readGitStatus(projectRoot: string): string {
  try {
    return execSync("git status --short", { cwd: projectRoot, encoding: "utf8", windowsHide: true }).trim();
  } catch {
    return "";
  }
}

function readFileIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function extractRisksFromFindings(projectRoot: string): string[] {
  const findingsPath = path.join(projectRoot, "findings.md");
  const content = readFileIfExists(findingsPath);
  if (!content) return [];
  const risks: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("| PROD-") || trimmed.startsWith("| CQ-") || trimmed.startsWith("| PCA-")) {
      risks.push(trimmed);
    }
  }
  return risks.slice(0, 10);
}
