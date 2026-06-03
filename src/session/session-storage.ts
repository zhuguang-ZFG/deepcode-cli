import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import type {
  ModelUsage,
  SessionEntry,
  SessionMessage,
  SessionProcessEntry,
  SessionStatus,
  SessionsIndex,
} from "./types";
import { isUsageRecord } from "./helpers";

export function getProjectCode(projectRoot: string): string {
  return projectRoot.replace(/[\\/]/g, "-").replace(/:/g, "");
}

export function getProjectStorage(projectRoot: string): {
  projectCode: string;
  projectDir: string;
  sessionsIndexPath: string;
} {
  const projectCode = getProjectCode(projectRoot);
  const projectDir = path.join(os.homedir(), ".deepcode", "projects", projectCode);
  const sessionsIndexPath = path.join(projectDir, "sessions-index.json");
  return { projectCode, projectDir, sessionsIndexPath };
}

export function ensureProjectDir(projectRoot: string): string {
  const { projectDir } = getProjectStorage(projectRoot);
  fs.mkdirSync(projectDir, { recursive: true });
  return projectDir;
}

export function getSessionMessagesPath(projectRoot: string, sessionId: string): string {
  const { projectDir } = getProjectStorage(projectRoot);
  return path.join(projectDir, `${sessionId}.jsonl`);
}

export function loadSessionsIndex(projectRoot: string): SessionsIndex {
  const { sessionsIndexPath } = getProjectStorage(projectRoot);
  ensureProjectDir(projectRoot);

  if (!fs.existsSync(sessionsIndexPath)) {
    return { version: 1, entries: [], originalPath: projectRoot };
  }

  try {
    const raw = fs.readFileSync(sessionsIndexPath, "utf8");
    const parsed = JSON.parse(raw) as SessionsIndex;
    const entries = Array.isArray(parsed.entries) ? parsed.entries.map((entry) => normalizeSessionEntry(entry)) : [];
    return {
      version: 1,
      entries,
      originalPath: parsed.originalPath || projectRoot,
    };
  } catch {
    return { version: 1, entries: [], originalPath: projectRoot };
  }
}

export function saveSessionsIndex(projectRoot: string, index: SessionsIndex): void {
  const { sessionsIndexPath } = getProjectStorage(projectRoot);
  ensureProjectDir(projectRoot);
  const normalized = {
    version: 1,
    entries: index.entries.map((entry) => ({
      ...entry,
      processes: serializeProcesses(entry.processes),
    })),
    originalPath: projectRoot,
  };
  fs.writeFileSync(sessionsIndexPath, JSON.stringify(normalized, null, 2), "utf8");
}

export function removeSessionMessages(projectRoot: string, sessionIds: string[]): void {
  for (const sessionId of sessionIds) {
    const messagePath = getSessionMessagesPath(projectRoot, sessionId);
    try {
      if (fs.existsSync(messagePath)) {
        fs.unlinkSync(messagePath);
      }
    } catch {
      // ignore delete failures
    }
  }
}

export function appendSessionMessage(projectRoot: string, sessionId: string, message: SessionMessage): void {
  ensureProjectDir(projectRoot);
  const messagePath = getSessionMessagesPath(projectRoot, sessionId);
  fs.appendFileSync(messagePath, `${JSON.stringify(message)}\n`, "utf8");
}

export function saveSessionMessages(projectRoot: string, sessionId: string, messages: SessionMessage[]): void {
  ensureProjectDir(projectRoot);
  const messagePath = getSessionMessagesPath(projectRoot, sessionId);
  const payload = messages.map((message) => JSON.stringify(message)).join("\n");
  fs.writeFileSync(messagePath, payload ? `${payload}\n` : "", "utf8");
}

export function listSessionMessages(projectRoot: string, sessionId: string): SessionMessage[] {
  const messagePath = getSessionMessagesPath(projectRoot, sessionId);
  if (!fs.existsSync(messagePath)) {
    return [];
  }

  const raw = fs.readFileSync(messagePath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const messages: SessionMessage[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as SessionMessage;
      messages.push(normalizeSessionMessage(projectRoot, parsed));
    } catch {
      // ignore malformed line
    }
  }
  return messages;
}

export function isUndoTargetMessage(message: SessionMessage): boolean {
  return message.role === "user" && message.visible && !message.compacted;
}

export function normalizeSessionEntry(entry: unknown): SessionEntry {
  const value = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
  return {
    id: typeof value.id === "string" ? value.id : crypto.randomUUID(),
    summary: typeof value.summary === "string" ? value.summary : null,
    assistantReply: typeof value.assistantReply === "string" ? value.assistantReply : null,
    assistantThinking: typeof value.assistantThinking === "string" ? value.assistantThinking : null,
    assistantRefusal: typeof value.assistantRefusal === "string" ? value.assistantRefusal : null,
    toolCalls: Array.isArray(value.toolCalls) ? value.toolCalls : null,
    status: normalizeSessionStatus(value.status),
    failReason: typeof value.failReason === "string" ? value.failReason : null,
    usage: (value.usage as ModelUsage) ?? null,
    usagePerModel: normalizeUsagePerModel(value),
    activeTokens: typeof value.activeTokens === "number" ? value.activeTokens : 0,
    createTime: typeof value.createTime === "string" ? value.createTime : new Date().toISOString(),
    updateTime: typeof value.updateTime === "string" ? value.updateTime : new Date().toISOString(),
    processes: deserializeProcesses(value.processes),
  };
}

export function normalizeSessionStatus(status: unknown): SessionStatus {
  if (
    status === "failed" ||
    status === "pending" ||
    status === "processing" ||
    status === "waiting_for_user" ||
    status === "completed" ||
    status === "interrupted"
  ) {
    return status;
  }
  return "pending";
}

export function normalizeUsagePerModel(entry: Record<string, unknown>): Record<string, ModelUsage> | null {
  if (!Object.prototype.hasOwnProperty.call(entry, "usagePerModel")) {
    return null;
  }
  if (!isUsageRecord(entry.usagePerModel)) {
    return null;
  }
  const usagePerModel: Record<string, ModelUsage> = {};
  for (const [model, usage] of Object.entries(entry.usagePerModel)) {
    if (!model || !isUsageRecord(usage)) {
      continue;
    }
    usagePerModel[model] = usage as ModelUsage;
  }
  return usagePerModel;
}

export function deserializeProcesses(value: unknown): Map<string, SessionProcessEntry> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const processes = new Map<string, SessionProcessEntry>();
  for (const [pid, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!pid) {
      continue;
    }
    if (typeof entry === "string") {
      processes.set(pid, { startTime: entry, command: "Running process..." });
    } else if (typeof entry === "object" && entry !== null) {
      const obj = entry as {
        startTime?: unknown;
        command?: unknown;
        timeoutMs?: unknown;
        deadlineAt?: unknown;
        timedOut?: unknown;
      };
      const startTime = typeof obj.startTime === "string" ? obj.startTime : new Date().toISOString();
      const command = typeof obj.command === "string" ? obj.command : "Running process...";
      processes.set(pid, {
        startTime,
        command,
        timeoutMs: typeof obj.timeoutMs === "number" ? obj.timeoutMs : undefined,
        deadlineAt: typeof obj.deadlineAt === "string" ? obj.deadlineAt : undefined,
        timedOut: typeof obj.timedOut === "boolean" ? obj.timedOut : undefined,
      });
    }
  }
  return processes.size > 0 ? processes : null;
}

export function serializeProcesses(
  processes: Map<string, SessionProcessEntry> | null
): Record<string, SessionProcessEntry> | null {
  if (!processes || processes.size === 0) {
    return null;
  }
  const serialized: Record<string, SessionProcessEntry> = {};
  for (const [pid, entry] of processes.entries()) {
    serialized[pid] = entry;
  }
  return serialized;
}

function normalizeSessionMessage(projectRoot: string, message: SessionMessage): SessionMessage {
  if (message.role !== "tool") {
    return message;
  }

  const nextMeta = message.meta ? { ...message.meta } : undefined;
  const normalizedParamsMd = buildToolParamsSnippet(projectRoot, nextMeta?.function ?? null);
  if (nextMeta && normalizedParamsMd) {
    nextMeta.paramsMd = normalizedParamsMd;
  }

  const normalizedResultMd = typeof message.content === "string" ? buildToolResultSnippet(message.content) : "";
  if (nextMeta && normalizedResultMd) {
    nextMeta.resultMd = normalizedResultMd;
  }

  return {
    ...message,
    visible: typeof message.content === "string" ? !isInvisibleExecution(message.content) : message.visible,
    meta: nextMeta,
  };
}

export function buildToolParamsSnippet(projectRoot: string, toolFunction: unknown | null): string {
  if (!toolFunction || typeof toolFunction !== "object") {
    return "";
  }
  const args = (toolFunction as { arguments?: unknown }).arguments;
  const toolName = (toolFunction as { name?: unknown }).name;
  if (typeof args !== "string") {
    return "";
  }
  const trimmed = args.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return formatToolParamsSnippet(
        projectRoot,
        typeof toolName === "string" ? toolName : null,
        parsed as Record<string, unknown>
      );
    }
  } catch {
    // fall back to raw string
  }
  return trimmed;
}

function formatToolParamsSnippet(projectRoot: string, toolName: string | null, args: Record<string, unknown>): string {
  if (toolName === "bash") {
    const command = typeof args.command === "string" ? args.command.trim() : "";
    const description = typeof args.description === "string" ? args.description.trim() : "";
    if (command && description) {
      return `${command}  # ${description}`;
    }
    if (command) {
      return command;
    }
    if (description) {
      return description;
    }
  } else if (toolName === "UpdatePlan") {
    return typeof args.explanation === "string" ? args.explanation.trim() : "";
  } else if (toolName === "write") {
    return typeof args.file_path === "string" ? args.file_path.trim() : "";
  }

  const firstKey = Object.keys(args)[0];
  if (!firstKey) {
    return "";
  }

  const value = args[firstKey];
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (toolName === "read" && text.startsWith(projectRoot)) {
    return text.slice(projectRoot.length).replace(/^[\\/]/, "");
  }
  return text;
}

export function buildToolResultSnippet(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }

  const maxLength = 2000;

  try {
    const parsed = JSON.parse(content) as { output?: unknown };
    if (parsed.output !== undefined) {
      if (typeof parsed.output === "string") {
        return formatToolResultSnippet(parsed.output, maxLength);
      }
      return formatToolResultSnippet(JSON.stringify(parsed.output), maxLength);
    }
  } catch {
    // fall back to raw content
  }

  return formatToolResultSnippet(content, maxLength);
}

function formatToolResultSnippet(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}... (total ${value.length} chars)`;
}

export function isInvisibleExecution(content: string): boolean {
  if (!content.trim()) {
    return false;
  }
  try {
    const parsed = JSON.parse(content) as { name?: unknown; ok?: unknown };
    return parsed.name === "bash" && parsed.ok !== true;
  } catch {
    return false;
  }
}
