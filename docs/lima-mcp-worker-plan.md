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

### Next Phase

Add a small HTTP MCP adapter once LiMa Server exposes stable tool list and tool call schemas. Then decide whether to plug it into `McpManager` directly or keep it as a LiMa-only worker channel.
