import { assertLiMaTaskToolsAllowed, type LiMaWorkspaceGuardResult } from "./workspace-guard";

export function assertLiMaMcpToolAllowed(allowedTools: string[], toolName: string): LiMaWorkspaceGuardResult<string> {
  const tools = assertLiMaTaskToolsAllowed(allowedTools);
  if (!tools.ok) {
    return tools;
  }

  const normalizedToolName = toolName.trim();
  if (!normalizedToolName.startsWith("mcp__")) {
    return { ok: false, error: `LiMa MCP permission check requires an MCP tool name: ${toolName}` };
  }

  if (!tools.value.includes("mcp")) {
    return { ok: false, error: `LiMa task must include allowed tool "mcp" to call ${normalizedToolName}.` };
  }

  return { ok: true, value: normalizedToolName };
}
