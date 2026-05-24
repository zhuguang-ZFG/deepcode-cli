# LiMa Code Hooks + Skill Activation Design

Updated: 2026-05-23
Status: implementation-approved

## Goal

LiMa Code should make each worker task easier to supervise by recording a small local task workspace and by selecting candidate skills from the task shape before execution.

This is a controlled-autonomy step. It does not add inbound Telegram commands, remote shell control, automatic skill promotion, automatic commits, or automatic deployment.

## Architecture

```text
LiMa task request
  -> skill activation rules
  -> lifecycle start hook writes .lima-code/dev/active/<task>/context.md
  -> existing task runner executes
  -> lifecycle stop hook writes summary.md and touched-files.txt
  -> existing audit / submit / Telegram flow continues
```

## Components

- `src/lima/skill-activation.ts`
  - Pure rule evaluation.
  - Reads task mode, goal, constraints, allowed tools, patch files, and test commands.
  - Returns ordered active skill candidates with reasons.
  - Reads optional project rules from `.lima-code/skill-rules.json`.

- `src/lima/lifecycle-hooks.ts`
  - File-system hook writer.
  - Sanitizes task IDs before creating directories.
  - Writes only under `.lima-code/dev/active`.
  - Hook failures are best-effort and must not change task execution semantics.

- `src/lima/command-runner.ts`
  - Calls the lifecycle start hook before `runTask`.
  - Calls the lifecycle stop hook after result creation and audit.
  - Keeps Server task contract unchanged.

## Default Skill Rules

The first version uses conservative built-in rules:

- `superpowers:test-driven-development` for patch/test tasks, write tool usage, or explicit test commands.
- `security-review` when task text mentions auth, token, secret, key, permission, webhook, or Telegram.
- `deployment-patterns` when task text mentions deploy, VPS, PM2, systemd, Docker, port, firewall, or restart.
- `source-command-python-review` for Python files.
- `source-command-go-review` for Go files.
- `source-command-rust-review` for Rust files.
- `source-command-flutter-review` for Dart/Flutter files.
- `superpowers:requesting-code-review` for review mode or `git_diff`.

The rules only create local hints. They do not load skills into the model automatically yet.

## Project Skill Rules

Projects may add `.lima-code/skill-rules.json`:

```json
{
  "rules": [
    {
      "name": "lima-code:telegram-review",
      "reason": "Telegram worker changes require callback and secret review.",
      "keywords": ["telegram", "callback", "bot"],
      "files": ["src/lima/*.ts"],
      "modes": ["patch", "review"],
      "tools": ["write", "git_diff"]
    }
  ]
}
```

All configured condition groups must match when present. Within each group, any item may match.
Malformed or missing config is ignored so worker execution cannot fail because of project rule loading.

## Safety Boundaries

1. Hooks never execute commands.
2. Hooks never submit approvals.
3. Hooks never promote candidate skills.
4. Hooks write only inside the current project root.
5. Hook write failures are captured as warnings and do not fail the worker.
6. Existing allowlist, budget, quarantine, review gate, and audit behavior remain authoritative.

## Testing

- Unit test skill rule matching and deduplication.
- Unit test lifecycle hook file paths and output contents.
- Unit test command runner integration with injected hooks.
- Run targeted LiMa Code tests.
- Run `npm run check`.
