import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { evaluateLiMaSkillActivation, evaluateLiMaSkillActivationForProject } from "../lima/skill-activation";
import type { LiMaAgentTaskRequest } from "../lima/agent-task-types";

function buildTask(overrides: Partial<LiMaAgentTaskRequest> = {}): LiMaAgentTaskRequest {
  return {
    task_id: "task-1",
    repo: process.cwd(),
    branch: "main",
    goal: "Review current change",
    constraints: [],
    allowed_tools: ["git_diff"],
    max_runtime_sec: 60,
    mode: "review",
    ...overrides,
  };
}

test("evaluateLiMaSkillActivation activates TDD and security rules for patch tasks", () => {
  const active = evaluateLiMaSkillActivation(
    buildTask({
      goal: "Patch Telegram token handling",
      constraints: ["test: npm test"],
      allowed_tools: ["write", "test"],
      mode: "patch",
      test_commands: ["npm test"],
    })
  );

  assert.deepEqual(
    active.map((skill) => skill.name),
    ["superpowers:test-driven-development", "security-review"]
  );
  assert.match(active[0]?.reason ?? "", /patch/i);
});

test("evaluateLiMaSkillActivation deduplicates rules and includes file based review skills", () => {
  const active = evaluateLiMaSkillActivation(
    buildTask({
      goal: "Review Python deployment patch",
      constraints: ["deploy to VPS", "restart service"],
      allowed_tools: ["git_diff"],
      mode: "review",
      patch_files: [
        { file_path: "server.py", content: "print('ok')\n" },
        { file_path: "infra/deploy.py", content: "print('deploy')\n" },
      ],
    })
  );

  assert.deepEqual(
    active.map((skill) => skill.name),
    ["deployment-patterns", "source-command-python-review", "superpowers:requesting-code-review"]
  );
});

test("evaluateLiMaSkillActivationForProject activates project skill rules", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-skill-rules-"));
  fs.mkdirSync(path.join(projectRoot, ".lima-code"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, ".lima-code", "skill-rules.json"),
    JSON.stringify({
      rules: [
        {
          name: "lima-code:telegram-review",
          reason: "Telegram changes require callback and secret review.",
          keywords: ["telegram", "callback", "bot"],
          files: ["src/lima/*.ts"],
          modes: ["patch", "review"],
          tools: ["write", "git_diff"],
        },
      ],
    }),
    "utf8"
  );

  const active = evaluateLiMaSkillActivationForProject(
    buildTask({
      goal: "Patch Telegram callback handling",
      allowed_tools: ["write", "git_diff"],
      mode: "patch",
      patch_files: [{ file_path: "src/lima/telegram-notifier.ts", content: "" }],
    }),
    projectRoot
  );

  assert.equal(
    active.some((skill) => skill.name === "lima-code:telegram-review"),
    true
  );
});

test("evaluateLiMaSkillActivationForProject ignores malformed project rules", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-bad-skill-rules-"));
  fs.mkdirSync(path.join(projectRoot, ".lima-code"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".lima-code", "skill-rules.json"), "{not-json", "utf8");

  const active = evaluateLiMaSkillActivationForProject(
    buildTask({
      goal: "Patch Telegram token handling",
      allowed_tools: ["write"],
      mode: "patch",
    }),
    projectRoot
  );

  assert.deepEqual(
    active.map((skill) => skill.name),
    ["superpowers:test-driven-development", "security-review"]
  );
});
