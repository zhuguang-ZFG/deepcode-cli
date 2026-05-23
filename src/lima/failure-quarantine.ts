import * as fs from "fs";
import * as path from "path";

type QuarantineRecord = {
  task_id: string;
  failure_count: number;
  last_error: string;
  updated_at: string;
};

type QuarantineState = Record<string, QuarantineRecord>;

export function recordTaskFailure(projectRoot: string, taskId: string, error: string): QuarantineRecord {
  const state = readState(projectRoot);
  const previous = state[taskId];
  const record: QuarantineRecord = {
    task_id: taskId,
    failure_count: (previous?.failure_count ?? 0) + 1,
    last_error: error,
    updated_at: new Date().toISOString(),
  };
  state[taskId] = record;
  writeState(projectRoot, state);
  return record;
}

export function shouldQuarantineTask(
  projectRoot: string,
  taskId: string,
  threshold = 3
): { quarantine: boolean; failureCount: number; reason: string } {
  const record = readState(projectRoot)[taskId];
  const failureCount = record?.failure_count ?? 0;
  return {
    quarantine: failureCount >= threshold,
    failureCount,
    reason: record?.last_error ?? "",
  };
}

function quarantinePath(projectRoot: string): string {
  return path.join(projectRoot, ".lima-code", "quarantine.json");
}

function readState(projectRoot: string): QuarantineState {
  const file = quarantinePath(projectRoot);
  if (!fs.existsSync(file)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as QuarantineState;
  } catch {
    return {};
  }
}

function writeState(projectRoot: string, state: QuarantineState): void {
  const file = quarantinePath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
}
