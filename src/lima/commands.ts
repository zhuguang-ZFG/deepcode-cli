export type LiMaCommand =
  | { kind: "connect" }
  | { kind: "status" }
  | { kind: "next" }
  | { kind: "task"; taskId: string }
  | { kind: "review" };

export type LiMaCommandParseResult = { ok: true; command: LiMaCommand } | { ok: false; error: string };

export function parseLiMaCommand(input: string): LiMaCommandParseResult {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts[0] !== "/lima") {
    return { ok: false, error: "LiMa command must start with /lima." };
  }

  const subcommand = parts[1] ?? "";
  if (subcommand === "connect") {
    return { ok: true, command: { kind: "connect" } };
  }
  if (subcommand === "status") {
    return { ok: true, command: { kind: "status" } };
  }
  if (subcommand === "next") {
    return { ok: true, command: { kind: "next" } };
  }
  if (subcommand === "review") {
    return { ok: true, command: { kind: "review" } };
  }
  if (subcommand === "task") {
    const taskId = parts[2] ?? "";
    if (!taskId) {
      return { ok: false, error: "Usage: /lima task <task_id>" };
    }
    return { ok: true, command: { kind: "task", taskId } };
  }

  return { ok: false, error: "Usage: /lima connect | /lima status | /lima next | /lima task <task_id> | /lima review" };
}

export function formatLiMaCommandHelp(): string {
  return ["/lima connect", "/lima status", "/lima next", "/lima task <task_id>", "/lima review"].join("\n");
}
