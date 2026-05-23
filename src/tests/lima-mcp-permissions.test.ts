import { test } from "node:test";
import assert from "node:assert/strict";
import { assertLiMaMcpToolAllowed } from "../lima/mcp-permissions";
import { assertLiMaTaskToolsAllowed } from "../lima/workspace-guard";

test("assertLiMaTaskToolsAllowed accepts mcp as a task-scoped tool", () => {
  assert.deepEqual(assertLiMaTaskToolsAllowed(["read", "mcp"]), { ok: true, value: ["read", "mcp"] });
});

test("assertLiMaMcpToolAllowed allows MCP calls only when mcp is in allowed_tools", () => {
  assert.deepEqual(assertLiMaMcpToolAllowed(["read", "mcp"], "mcp__lima__memory_search"), {
    ok: true,
    value: "mcp__lima__memory_search",
  });
});

test("assertLiMaMcpToolAllowed blocks MCP calls without explicit mcp permission", () => {
  const result = assertLiMaMcpToolAllowed(["read"], "mcp__lima__memory_search");

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /allowed tool "mcp"/);
});

test("assertLiMaMcpToolAllowed rejects non-MCP tool names", () => {
  const result = assertLiMaMcpToolAllowed(["mcp"], "shell_readonly");

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /requires an MCP tool name/);
});
