import * as fs from "fs";
import * as path from "path";
import { isRepoAllowed } from "./repo-allowlist";

export const LIMA_ALLOWED_TASK_TOOLS = ["read", "write", "git_diff", "test", "shell_readonly", "mcp"] as const;

export type LiMaAllowedTaskTool = (typeof LIMA_ALLOWED_TASK_TOOLS)[number];

export type LiMaWorkspaceGuardConfig = {
  currentWorkspace: string;
  allowedRoots?: string[];
  allowedRepos?: string[];
  maxRuntimeCapSec?: number;
};

export type LiMaWorkspaceGuardResult<T> = { ok: true; value: T } | { ok: false; error: string };

const DEFAULT_RUNTIME_SEC = 600;
const DEFAULT_RUNTIME_CAP_SEC = 1800;

const allowedToolSet = new Set<string>(LIMA_ALLOWED_TASK_TOOLS);

export function resolveLiMaTaskRepo(repo: string, config: LiMaWorkspaceGuardConfig): LiMaWorkspaceGuardResult<string> {
  const requested = repo.trim();
  if (!requested) {
    return { ok: false, error: "LiMa task repo is required." };
  }

  const repoRoot = safeRealPath(path.resolve(requested));
  if (!repoRoot) {
    return { ok: false, error: `LiMa task repo does not exist: ${requested}` };
  }

  const allowedRoots = normalizeAllowedRoots(config);
  const allowed = isRepoAllowed(repoRoot, {
    currentWorkspace: config.currentWorkspace,
    allowedRepos: allowedRoots.filter((root) => root !== safeRealPath(path.resolve(config.currentWorkspace))),
  });
  if (!allowed.ok) {
    return allowed;
  }

  return { ok: true, value: repoRoot };
}

export function assertLiMaTaskToolsAllowed(tools: string[]): LiMaWorkspaceGuardResult<LiMaAllowedTaskTool[]> {
  const normalized = tools.map((tool) => tool.trim()).filter(Boolean);
  const disallowed = normalized.filter((tool) => !allowedToolSet.has(tool));
  if (disallowed.length > 0) {
    return { ok: false, error: `LiMa task requested disallowed tools: ${disallowed.join(", ")}` };
  }
  return { ok: true, value: normalized as LiMaAllowedTaskTool[] };
}

export function resolveLiMaTaskRuntimeSec(
  requested: number | null | undefined,
  config: Pick<LiMaWorkspaceGuardConfig, "maxRuntimeCapSec"> = {}
): LiMaWorkspaceGuardResult<number> {
  const cap = config.maxRuntimeCapSec ?? DEFAULT_RUNTIME_CAP_SEC;
  if (!Number.isInteger(cap) || cap <= 0) {
    return { ok: false, error: "LiMa task runtime cap must be a positive integer." };
  }

  const value = requested ?? DEFAULT_RUNTIME_SEC;
  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, error: "LiMa task runtime must be a positive integer." };
  }

  return { ok: true, value: Math.min(value, cap) };
}

function normalizeAllowedRoots(config: LiMaWorkspaceGuardConfig): string[] {
  const roots = [config.currentWorkspace, ...(config.allowedRoots ?? []), ...(config.allowedRepos ?? [])];
  return roots.map((root) => safeRealPath(path.resolve(root))).filter((root): root is string => Boolean(root));
}

function safeRealPath(value: string): string | null {
  try {
    if (!fs.existsSync(value)) {
      return null;
    }
    return normalizePath(fs.realpathSync(value));
  } catch {
    return null;
  }
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
