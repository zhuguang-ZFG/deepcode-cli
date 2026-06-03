/**
 * High-level helpers for interacting with the CodeGraph MCP server.
 *
 * These thin wrappers are used by the Lima agent mode to invoke CodeGraph
 * tools through the MCP protocol without coupling to raw JSON-RPC shapes.
 * When CodeGraph is not available the helpers return `null` / empty arrays
 * so callers can degrade gracefully.
 */

import type { McpManager } from "../mcp/mcp-manager";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CodeGraphToolResult = {
  ok: boolean;
  content: string;
  isError?: boolean;
};

// ---------------------------------------------------------------------------
// Generic executor
// ---------------------------------------------------------------------------

/**
 * Call any CodeGraph MCP tool by name.  The McpManager namespaces tool names
 * as `mcp__<server>__<tool>`, so the effective name is `mcp__codegraph__<tool>`.
 *
 * Returns `null` when the CodeGraph MCP server is not connected or the tool
 * does not exist.
 */
export async function callCodeGraphTool(
  mcpManager: McpManager,
  toolName: string,
  args: Record<string, unknown>
): Promise<CodeGraphToolResult | null> {
  const namespacedName = `mcp__codegraph__${toolName}`;
  try {
    const result = await mcpManager.executeMcpTool(namespacedName, args);
    if (!result) {
      return null;
    }
    return {
      ok: result.ok,
      content: result.ok ? (result.output ?? "") : (result.error ?? ""),
      isError: !result.ok,
    };
  } catch (error) {
    // Allow programming errors to propagate; swallow MCP transport errors
    if (error instanceof TypeError || error instanceof ReferenceError) throw error;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

/**
 * Search for symbols by name (fuzzy).
 * Equivalent to `codegraph_search`.
 */
export function querySymbol(
  mcpManager: McpManager,
  query: string,
  projectPath: string,
  limit = 10
): Promise<CodeGraphToolResult | null> {
  return callCodeGraphTool(mcpManager, "codegraph_search", {
    query,
    projectPath,
    limit,
  });
}

/**
 * Get rich context for a symbol or area — composes search + node + callers +
 * callees in a single round-trip.
 * Equivalent to `codegraph_context`.
 */
export function getContext(
  mcpManager: McpManager,
  query: string,
  projectPath: string
): Promise<CodeGraphToolResult | null> {
  return callCodeGraphTool(mcpManager, "codegraph_context", {
    query,
    projectPath,
  });
}

/**
 * Trace the call path from one symbol to another (including dynamic dispatch).
 * Equivalent to `codegraph_trace`.
 */
export function traceCallGraph(
  mcpManager: McpManager,
  from: string,
  to: string,
  projectPath: string
): Promise<CodeGraphToolResult | null> {
  return callCodeGraphTool(mcpManager, "codegraph_trace", {
    from,
    to,
    projectPath,
  });
}

/**
 * Return the blast radius of changing a symbol.
 * Equivalent to `codegraph_impact`.
 */
export function impactAnalysis(
  mcpManager: McpManager,
  symbol: string,
  projectPath: string
): Promise<CodeGraphToolResult | null> {
  return callCodeGraphTool(mcpManager, "codegraph_impact", {
    symbol,
    projectPath,
  });
}

/**
 * List callers of a symbol.
 * Equivalent to `codegraph_callers`.
 */
export function getCallers(
  mcpManager: McpManager,
  symbol: string,
  projectPath: string
): Promise<CodeGraphToolResult | null> {
  return callCodeGraphTool(mcpManager, "codegraph_callers", {
    symbol,
    projectPath,
  });
}

/**
 * List callees of a symbol.
 * Equivalent to `codegraph_callees`.
 */
export function getCallees(
  mcpManager: McpManager,
  symbol: string,
  projectPath: string
): Promise<CodeGraphToolResult | null> {
  return callCodeGraphTool(mcpManager, "codegraph_callees", {
    symbol,
    projectPath,
  });
}

/**
 * Check the index status (freshness, pending files).
 * Equivalent to `codegraph_status`.
 */
export function getIndexStatus(mcpManager: McpManager, projectPath: string): Promise<CodeGraphToolResult | null> {
  return callCodeGraphTool(mcpManager, "codegraph_status", {
    projectPath,
  });
}

/**
 * Returns `true` when the CodeGraph MCP server is connected and its tools are
 * available.
 */
export function isCodeGraphMcpReady(mcpManager: McpManager): boolean {
  const statuses = mcpManager.getStatus();
  const cg = statuses.find((s) => s.name === "codegraph");
  return cg?.status === "ready" && cg.connected;
}
