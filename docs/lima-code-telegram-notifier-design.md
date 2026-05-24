# LiMa Code Telegram Notifier Design

Updated: 2026-05-23
Status: implementation-ready

## Goal

LiMa Code should send task lifecycle notifications to Telegram so the user can
watch worker activity from a phone. This phase is outbound-only: LiMa Code does
not accept Telegram commands directly.

## Architecture

```text
LiMa Code command runner / work loop
  -> telegram notifier
  -> Telegram Bot API
```

LiMa Server remains the source of tasks, task status, and human review APIs.
Telegram approval buttons continue to belong on the Server side.

## Boundaries

1. No remote shell execution from Telegram.
2. No inbound Telegram polling or webhook in LiMa Code.
3. No secrets in messages, audit logs, or command output.
4. Notifications are best-effort and must not fail the worker task.

## Configuration

| Variable | Required | Purpose |
|---|---:|---|
| `LIMA_CODE_TELEGRAM_BOT_TOKEN` | yes | Bot token used only for outbound messages. |
| `LIMA_CODE_TELEGRAM_CHAT_ID` | yes | Single authorized chat target. |
| `LIMA_CODE_TELEGRAM_PROXY` | no | Optional HTTP(S) proxy for Telegram API access. |

## Events

- `task_started`
- `task_finished`
- `task_failed`
- `task_needs_review`
- `work_stopped`
- `quarantine_requested`

## Implementation Plan

- Create `src/lima/telegram-notifier.ts` for config, redaction, formatting, and
  best-effort `sendMessage` calls.
- Modify `src/lima/command-runner.ts` to accept an injected notifier and emit
  task/work lifecycle events.
- Add `src/tests/lima-telegram-notifier.test.ts` for config, redaction, payload,
  and failure isolation.
- Extend `src/tests/lima-command-runner.test.ts` to verify worker events are
  emitted without changing task execution semantics.

## Testing

- Unit test notifier config and redaction behavior.
- Unit test command runner with an injected notifier.
- Run targeted LiMa tests.
- Run `npm run check`.
