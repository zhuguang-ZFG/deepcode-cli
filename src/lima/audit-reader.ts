import * as fs from "fs";
import * as path from "path";

export type LiMaAuditSummaryEntry = {
  task_id?: string;
  status?: string;
  mode?: string;
  created_at?: string;
  timestamp?: string;
  repo?: string;
};

export function readRecentAuditEntries(projectRoot: string, limit = 10): LiMaAuditSummaryEntry[] {
  const file = path.join(projectRoot, ".lima-code", "audit.jsonl");
  if (!fs.existsSync(file)) {
    return [];
  }

  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => safeParse(line))
    .filter((entry): entry is LiMaAuditSummaryEntry => Boolean(entry))
    .map(normalizeEntry)
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    .slice(0, limit);
}

export function formatAuditSummary(entries: LiMaAuditSummaryEntry[]): string {
  if (entries.length === 0) {
    return "No LiMa audit entries found.";
  }

  return entries
    .map((entry) =>
      [
        entry.created_at ?? "unknown",
        entry.task_id ?? "unknown",
        entry.status ?? "unknown",
        entry.mode ?? "",
        entry.repo ?? "",
      ]
        .filter(Boolean)
        .join(" ")
    )
    .join("\n");
}

function safeParse(line: string): LiMaAuditSummaryEntry | null {
  try {
    return JSON.parse(line) as LiMaAuditSummaryEntry;
  } catch {
    return null;
  }
}

function normalizeEntry(entry: LiMaAuditSummaryEntry): LiMaAuditSummaryEntry {
  return {
    ...entry,
    created_at: entry.created_at ?? entry.timestamp,
  };
}
