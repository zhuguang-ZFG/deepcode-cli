import * as fs from "fs";
import * as path from "path";

export function requestWorkerStop(projectRoot: string, reason = "user_requested"): string {
  const file = stopMarkerPath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ reason, requested_at: new Date().toISOString() }, null, 2), "utf8");
  return file;
}

export function clearWorkerStop(projectRoot: string): void {
  const file = stopMarkerPath(projectRoot);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

export function readWorkerStop(projectRoot: string): { stop: boolean; reason: string } {
  const file = stopMarkerPath(projectRoot);
  if (!fs.existsSync(file)) {
    return { stop: false, reason: "" };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { reason?: string };
    return { stop: true, reason: parsed.reason ?? "user_requested" };
  } catch {
    return { stop: true, reason: "unreadable_stop_marker" };
  }
}

function stopMarkerPath(projectRoot: string): string {
  return path.join(projectRoot, ".lima-code", "worker.stop.json");
}
