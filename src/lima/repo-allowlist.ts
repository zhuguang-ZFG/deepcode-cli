import * as path from "path";

export type LiMaRepoAllowlistConfig = {
  currentWorkspace: string;
  allowedRepos?: string[];
};

export type LiMaRepoAllowlistResult = { ok: true; value: string } | { ok: false; error: string };

export function normalizeAllowedRepos(repos: string[] = []): string[] {
  return repos.map((repo) => path.resolve(repo));
}

export function isRepoAllowed(repo: string, config: LiMaRepoAllowlistConfig): LiMaRepoAllowlistResult {
  const resolvedRepo = path.resolve(repo);
  const allowed = [config.currentWorkspace, ...normalizeAllowedRepos(config.allowedRepos)].map((root) =>
    normalizePath(root)
  );
  const comparableRepo = normalizePath(resolvedRepo);

  if (allowed.some((root) => isSameOrInside(comparableRepo, root))) {
    return { ok: true, value: resolvedRepo };
  }
  return { ok: false, error: `LiMa task repo is not allowlisted: ${resolvedRepo}` };
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isSameOrInside(child: string, parent: string): boolean {
  if (child === parent) {
    return true;
  }
  const relative = path.relative(parent, child);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
