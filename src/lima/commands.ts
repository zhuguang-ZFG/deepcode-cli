export type LiMaCommand =
  | { kind: "connect" }
  | { kind: "status" }
  | { kind: "next" }
  | { kind: "work"; mode: "once" | "loop"; maxTasks: number; intervalMs: number; backoffMs: number }
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
  if (subcommand === "work") {
    return parseWorkCommand(parts.slice(2));
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

  return { ok: false, error: usageText() };
}

export function formatLiMaCommandHelp(): string {
  return [
    "/lima connect",
    "/lima status",
    "/lima next",
    "/lima work --once",
    "/lima work --loop --max-tasks <n> [--interval-ms <ms>] [--backoff-ms <ms>]",
    "/lima task <task_id>",
    "/lima review",
  ].join("\n");
}

function parseWorkCommand(args: string[]): LiMaCommandParseResult {
  const mode = args.includes("--loop") ? "loop" : "once";
  const maxTasks = readPositiveInt(args, "--max-tasks", mode === "once" ? 1 : null);
  if (!maxTasks.ok) {
    return maxTasks;
  }
  if (mode === "loop" && !args.includes("--max-tasks")) {
    return { ok: false, error: "Usage: /lima work --loop requires --max-tasks <n>." };
  }
  const intervalMs = readPositiveInt(args, "--interval-ms", 5000);
  if (!intervalMs.ok) {
    return intervalMs;
  }
  const backoffMs = readPositiveInt(args, "--backoff-ms", 30000);
  if (!backoffMs.ok) {
    return backoffMs;
  }
  if (maxTasks.value > 100) {
    return { ok: false, error: "Usage: /lima work --max-tasks must be 100 or less." };
  }
  return {
    ok: true,
    command: {
      kind: "work",
      mode,
      maxTasks: maxTasks.value,
      intervalMs: intervalMs.value,
      backoffMs: backoffMs.value,
    },
  };
}

function readPositiveInt(
  args: string[],
  name: string,
  defaultValue: number | null
): { ok: true; value: number } | { ok: false; error: string } {
  const index = args.indexOf(name);
  if (index < 0) {
    if (defaultValue === null) {
      return { ok: false, error: `Usage: ${name} <n> is required.` };
    }
    return { ok: true, value: defaultValue };
  }
  const raw = args[index + 1] ?? "";
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, error: `Usage: ${name} must be a positive integer.` };
  }
  return { ok: true, value };
}

function usageText(): string {
  return "Usage: /lima connect | /lima status | /lima next | /lima work --once | /lima work --loop --max-tasks <n> | /lima task <task_id> | /lima review";
}
