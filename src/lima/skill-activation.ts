import * as fs from "fs";
import * as path from "path";
import type { LiMaAgentTaskRequest } from "./agent-task-types";

export type LiMaActiveSkill = {
  name: string;
  reason: string;
};

export type LiMaSkillActivationRule = {
  name: string;
  reason: string;
  matches: (task: LiMaAgentTaskRequest, context: LiMaSkillActivationContext) => boolean;
};

export type LiMaSkillRuleConfig = {
  name: string;
  reason?: string;
  keywords?: string[];
  files?: string[];
  modes?: string[];
  tools?: string[];
};

type LiMaSkillActivationContext = {
  text: string;
  files: string[];
};

export const DEFAULT_LIMA_SKILL_RULES: LiMaSkillActivationRule[] = [
  {
    name: "superpowers:test-driven-development",
    reason: "Patch/test task shape requires test-first discipline.",
    matches: (task, context) =>
      task.mode === "patch" ||
      task.mode === "test" ||
      task.allowed_tools.includes("write") ||
      task.allowed_tools.includes("test") ||
      context.text.includes("test:"),
  },
  {
    name: "security-review",
    reason: "Task text mentions auth, token, secret, key, permission, webhook, or Telegram.",
    matches: (_task, context) => /\b(auth|token|secret|key|permission|webhook|telegram)\b/i.test(context.text),
  },
  {
    name: "deployment-patterns",
    reason: "Task text mentions deployment, VPS, process, port, firewall, or restart concerns.",
    matches: (_task, context) =>
      /\b(deploy|deployment|vps|pm2|systemd|docker|port|firewall|restart)\b/i.test(context.text),
  },
  {
    name: "source-command-python-review",
    reason: "Task touches Python files.",
    matches: (_task, context) => context.files.some((file) => file.endsWith(".py")),
  },
  {
    name: "source-command-go-review",
    reason: "Task touches Go files.",
    matches: (_task, context) => context.files.some((file) => file.endsWith(".go")),
  },
  {
    name: "source-command-rust-review",
    reason: "Task touches Rust files.",
    matches: (_task, context) => context.files.some((file) => file.endsWith(".rs")),
  },
  {
    name: "source-command-flutter-review",
    reason: "Task touches Dart or Flutter files.",
    matches: (_task, context) =>
      context.files.some((file) => file.endsWith(".dart")) || /\bflutter\b/i.test(context.text),
  },
  {
    name: "superpowers:requesting-code-review",
    reason: "Review mode or git diff access should end with an explicit review gate.",
    matches: (task) => task.mode === "review" || task.allowed_tools.includes("git_diff"),
  },
];

export function evaluateLiMaSkillActivation(
  task: LiMaAgentTaskRequest,
  rules: LiMaSkillActivationRule[] = DEFAULT_LIMA_SKILL_RULES
): LiMaActiveSkill[] {
  const context = buildActivationContext(task);
  const seen = new Set<string>();
  const active: LiMaActiveSkill[] = [];

  for (const rule of rules) {
    if (seen.has(rule.name) || !rule.matches(task, context)) {
      continue;
    }
    seen.add(rule.name);
    active.push({ name: rule.name, reason: rule.reason });
  }

  return active;
}

export function evaluateLiMaSkillActivationForProject(
  task: LiMaAgentTaskRequest,
  projectRoot: string
): LiMaActiveSkill[] {
  return evaluateLiMaSkillActivation(task, [...DEFAULT_LIMA_SKILL_RULES, ...loadProjectSkillRules(projectRoot)]);
}

export function loadProjectSkillRules(projectRoot: string): LiMaSkillActivationRule[] {
  const configPath = path.join(projectRoot, ".lima-code", "skill-rules.json");
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as { rules?: unknown };
    if (!Array.isArray(raw.rules)) {
      return [];
    }
    return raw.rules
      .map((item) => buildProjectRule(item))
      .filter((rule): rule is LiMaSkillActivationRule => Boolean(rule));
  } catch {
    return [];
  }
}

function buildActivationContext(task: LiMaAgentTaskRequest): LiMaSkillActivationContext {
  const files = (task.patch_files ?? []).map((file) => file.file_path.toLowerCase());
  const text = [
    task.mode,
    task.goal,
    ...task.constraints,
    ...task.allowed_tools,
    ...(task.test_commands ?? []),
    ...files,
  ]
    .join("\n")
    .toLowerCase();

  return { text, files };
}

function buildProjectRule(value: unknown): LiMaSkillActivationRule | null {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) {
    return null;
  }
  const config: LiMaSkillRuleConfig = {
    name: value.name.trim(),
    reason: typeof value.reason === "string" ? value.reason : "Project skill rule matched.",
    keywords: readStringArray(value.keywords),
    files: readStringArray(value.files),
    modes: readStringArray(value.modes),
    tools: readStringArray(value.tools),
  };

  return {
    name: config.name,
    reason: config.reason ?? "Project skill rule matched.",
    matches: (task, context) => projectRuleMatches(config, task, context),
  };
}

function projectRuleMatches(
  config: LiMaSkillRuleConfig,
  task: LiMaAgentTaskRequest,
  context: LiMaSkillActivationContext
): boolean {
  return (
    groupMatches(config.keywords, (keyword) => context.text.includes(keyword.toLowerCase())) &&
    groupMatches(config.files, (pattern) => context.files.some((file) => filePatternMatches(pattern, file))) &&
    groupMatches(config.modes, (mode) => task.mode === mode) &&
    groupMatches(config.tools, (tool) => task.allowed_tools.includes(tool))
  );
}

function groupMatches(values: string[] | undefined, predicate: (value: string) => boolean): boolean {
  if (!values || values.length === 0) {
    return true;
  }
  return values.some(predicate);
}

function filePatternMatches(pattern: string, file: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, "/").toLowerCase();
  const normalizedFile = file.replace(/\\/g, "/").toLowerCase();
  if (!normalizedPattern.includes("*")) {
    return normalizedFile === normalizedPattern || normalizedFile.endsWith(normalizedPattern);
  }
  const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`).test(normalizedFile);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
