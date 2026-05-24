import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { formatLiMaDoctorReport, runLiMaDoctor } from "../lima/doctor";
import { requestWorkerStop } from "../lima/worker-control";

test("runLiMaDoctor passes required checks for a configured reachable server", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-doctor-ok-"));
  fs.mkdirSync(path.join(projectRoot, ".lima-code"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".lima-code", "audit.jsonl"), "", "utf8");
  fs.writeFileSync(path.join(projectRoot, ".lima-code", "skill-rules.json"), JSON.stringify({ rules: [] }), "utf8");
  let fetched = 0;

  const report = await runLiMaDoctor({
    projectRoot,
    env: {
      LIMA_CODE_TELEGRAM_BOT_TOKEN: "bot-token-secret",
      LIMA_CODE_TELEGRAM_CHAT_ID: "chat-1",
    },
    client: {
      isConfigured: () => true,
      fetchPendingTask: async () => {
        fetched += 1;
        return { ok: true, value: null };
      },
    },
  });
  const message = formatLiMaDoctorReport(report);

  assert.equal(report.ok, true);
  assert.equal(fetched, 1);
  assert.match(message, /LiMa doctor/);
  assert.match(message, /\[pass\] server_reachable/);
  assert.doesNotMatch(message, /bot-token-secret/);
});

test("runLiMaDoctor fails when server config is missing and skips network checks", async () => {
  let fetched = 0;

  const report = await runLiMaDoctor({
    projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), "lima-doctor-missing-server-")),
    client: {
      isConfigured: () => false,
      fetchPendingTask: async () => {
        fetched += 1;
        return { ok: true, value: null };
      },
    },
  });

  assert.equal(report.ok, false);
  assert.equal(fetched, 0);
  assert.equal(
    report.checks.some((check) => check.name === "server_config" && check.status === "fail"),
    true
  );
  assert.equal(
    report.checks.some((check) => check.name === "server_reachable" && check.status === "skip"),
    true
  );
});

test("runLiMaDoctor fails when a worker stop marker is pending", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-doctor-stop-"));
  requestWorkerStop(projectRoot, "manual_test_stop");

  const report = await runLiMaDoctor({
    projectRoot,
    client: {
      isConfigured: () => true,
      fetchPendingTask: async () => ({ ok: true, value: null }),
    },
  });

  assert.equal(report.ok, false);
  assert.equal(
    report.checks.some((check) => check.name === "worker_stop" && check.status === "fail"),
    true
  );
  assert.match(formatLiMaDoctorReport(report), /manual_test_stop/);
});
