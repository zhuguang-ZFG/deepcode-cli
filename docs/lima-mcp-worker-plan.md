# LiMa MCP Worker Integration Plan

## Status

This document tracks the LiMa Code side of the LiMa worker integration. LiMa Code remains a local coding worker; LiMa Server remains the router, memory, policy, and task broker.

## Phase 6: LiMa MCP Preset And Task Permissions

### Goal

Expose a small, explicit LiMa MCP preset for LiMa Server endpoints and add a task-scoped permission check so MCP calls are only available when the task contract includes `mcp`.

### Decisions

- Keep the existing stdio MCP manager unchanged in this phase.
- Represent LiMa Server MCP as an HTTP preset first, with normalized `/mcp/tools/list` and `/mcp/tools/call` endpoints.
- Do not store tokens in project settings; read them from `LIMA_CODE_API_KEY` or explicit runtime config.
- Require `allowed_tools` to include `mcp` before any LiMa task may call an MCP tool.
- Defer wiring HTTP MCP transport into `McpManager` until LiMa Server's MCP response format is stable.

### Implementation Scope

- `src/lima/mcp-preset.ts`: build and validate LiMa MCP preset metadata.
- `src/lima/mcp-permissions.ts`: enforce task-scoped MCP permission.
- `src/lima/workspace-guard.ts`: include `mcp` in the safe task tool allowlist.
- Tests for preset normalization, missing config, and MCP permission behavior.

### Out Of Scope

- No server deployment.
- No real token examples.
- No replacement of stdio MCP with HTTP MCP in the core manager yet.
- No automatic GitHub/browser/database MCP enablement.

## Phase 7: LiMa HTTP MCP Client

### Goal

Add a LiMa-only HTTP MCP client that can call the preset endpoints without changing the generic stdio MCP manager.

### Decisions

- Use `GET /mcp/tools/list` for tool discovery.
- Use `POST /mcp/tools/call` with `{ name, arguments }` for tool execution.
- Accept both native MCP-style responses and simple LiMa Server responses, then normalize them into LiMa Code's existing MCP-like shape.
- Keep fetch injectable so tests do not need network access.

### Implementation Scope

- `src/lima/http-mcp-client.ts`: list tools and call tools over HTTP.
- Tests for request shape, response normalization, and HTTP error handling.

## Later Phase

Add a small HTTP MCP adapter once LiMa Server exposes stable tool list and tool call schemas. Then decide whether to plug it into `McpManager` directly or keep it as a LiMa-only worker channel.

## Phase 8: LiMa Task Command Runner

### Goal

Make the LiMa worker path usable from the CLI, not only from isolated modules.

### Decisions

- `/lima task <task_id>` is handled locally by LiMa Code and is not sent to the model as a chat prompt.
- `/lima next` claims one pending `accepted` task from LiMa Server, runs it locally, and submits the result.
- LiMa Code fetches the task from LiMa Server, runs it through the guarded local task runner, writes a local audit entry, and submits the structured result back to LiMa Server.
- `/lima review` remains local-only and uses the same guarded review path against the current git diff.
- Local audit output is written under `.lima-code/audit.jsonl`; `.lima-code/` is ignored by Git because it may contain local settings or credentials.
- Bash timeout handling waits for process close after killing the tree on Windows so temporary workspaces are not removed while still locked.

### Evidence

- Targeted LiMa tests: `41 passed`.
- Tool handler regression tests: `22 passed`.
- `npm.cmd run check`: passed.
- Full LiMa Code test suite: `368 passed, 7 skipped`.
- Public end-to-end smoke:
  - LiMa Server created task `4d6c02b3`.
  - LiMa Code executed `/lima task 4d6c02b3` against `https://chat.donglicao.com`.
  - Worker ran read-only `review` mode over `D:\GIT\deepcode-cli`.
  - Result submitted to Server as `needs_review`.
  - Server event endpoint returned `created,result_submitted`.

## Phase 9: Single-Claim Worker Command

### Goal

Let LiMa Code behave like a worker without requiring the user to manually copy a task id.

### Decisions

- Add `/lima next` as a single-claim command.
- It uses `GET /agent/tasks?status=accepted&limit=1` through `LiMaAgentTaskClient.fetchPendingTask()`.
- If no task exists, it exits successfully with a clear "No pending LiMa task" message.
- It deliberately claims only one task per invocation. A daemon loop should be a later phase with explicit pause/backoff/stop controls.

### Evidence

- Parser and runner regression tests cover `/lima next`, no-task behavior, execution, and result submission.
- LiMa worker targeted tests: `52 passed`.
- `npm.cmd run check`: passed.
- Full LiMa Code test suite: `371 passed, 7 skipped`.
- Public end-to-end smoke:
  - LiMa Server created task `eb9410e1`.
  - LiMa Code executed `/lima next` against `https://chat.donglicao.com`.
  - Worker selected the pending task, ran read-only review mode, and submitted `needs_review`.
  - Server detail confirmed `hasResult=true`; events endpoint returned `created,result_submitted`.
