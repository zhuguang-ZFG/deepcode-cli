# LiMa Code Doctor Design

## Purpose

LiMa Code needs a safe preflight command before real-machine testing. The command should tell the user whether the local worker is ready to talk to LiMa Server and run a bounded smoke task, without fetching and executing work.

## Scope

Add `/lima doctor` as a read-only diagnostic command.

It checks:

- Project root exists.
- LiMa Server credentials are configured.
- LiMa Server pending-task endpoint is reachable through the existing client.
- Worker stop marker is not pending.
- Telegram outbound notifications are configured or absent as an optional warning.
- Project skill rules file is present or absent as an optional warning.
- Local audit log is present or absent as an optional warning.

It does not:

- Execute a task.
- Submit a result.
- Modify repository files.
- Clear stop markers.
- Send Telegram messages.
- Print API keys, bot tokens, or secrets.

## Architecture

Create `src/lima/doctor.ts` with one responsibility: collect and format diagnostic checks. The command runner calls this module when parsing `/lima doctor`.

The doctor module depends on existing small modules:

- `worker-control.ts` for stop-marker state.
- `telegram-notifier.ts` for Telegram configuration status.
- `agent-task-client.ts` interface shape through dependency injection.

## Check Severity

Diagnostic checks use four statuses:

- `pass`: safe for smoke testing.
- `warn`: optional capability missing or local evidence absent.
- `fail`: real-machine smoke should not start.
- `skip`: a dependent check was intentionally skipped because an earlier required check failed.

The overall result is `ok=true` only when there are no `fail` checks.

## Testing

Use TDD:

- Parse `/lima doctor`.
- Format command help with `/lima doctor`.
- Run doctor with a configured fake client and verify it reports pass/warn without leaking secrets.
- Run doctor with missing server config and verify it fails before network calls.
- Run doctor with a stop marker and verify it fails because work loops would stop immediately.

## Real-Machine Use

Expected first real-machine sequence:

```text
/lima doctor
/lima status
/lima audit --last 5
/lima work --once
```

If doctor fails, fix the failing item before running `/lima work`.
