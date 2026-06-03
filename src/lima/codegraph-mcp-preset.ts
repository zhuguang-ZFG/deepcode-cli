/**
 * CodeGraph MCP preset — auto-detects a CodeGraph installation and returns
 * a McpServerConfig that deepcode-cli's McpManager can consume over stdio.
 *
 * Detection order:
 *   1. `codegraph` on $PATH  (globally installed via npm)
 *   2. `_codegraph_repo/dist/bin/codegraph.js` relative to the project root
 *      (local development checkout)
 *
 * Returns `null` when CodeGraph is not available so callers can degrade
 * gracefully (Principle 0 — never break the host CLI).
 */

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import type { McpServerConfig } from "../settings";

const CODEGRAPH_REPO_DIR = "_codegraph_repo";
const CODEGRAPH_BIN_RELATIVE = path.join(CODEGRAPH_REPO_DIR, "dist", "bin", "codegraph.js");
const CODEGRAPH_DIR_MARKER = ".codegraph";

/**
 * Check whether the project root (or an ancestor) contains a `.codegraph/`
 * directory — the signal that CodeGraph has been initialised for this workspace.
 */
export function hasCodeGraphIndex(projectRoot: string): boolean {
  const marker = path.join(projectRoot, CODEGRAPH_DIR_MARKER);
  try {
    return fs.statSync(marker).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve the `codegraph` CLI command.  Prefers the globally-installed binary
 * on $PATH; falls back to a local `_codegraph_repo` build when present.
 *
 * Returns `null` when no usable installation is found.
 */
export function resolveCodeGraphCommand(projectRoot: string): string | null {
  // 1. Global install on PATH
  if (isCodeGraphOnPath()) {
    return "codegraph";
  }

  // 2. Local build in sibling / child `_codegraph_repo`
  const localBin = path.resolve(projectRoot, CODEGRAPH_BIN_RELATIVE);
  if (fs.existsSync(localBin)) {
    return localBin;
  }

  // Also check one level up (monorepo layout: deepcode-cli/ + _codegraph_repo/)
  const parentLocalBin = path.resolve(projectRoot, "..", CODEGRAPH_BIN_RELATIVE);
  if (fs.existsSync(parentLocalBin)) {
    return parentLocalBin;
  }

  return null;
}

/**
 * Build a McpServerConfig for CodeGraph MCP, or `null` when CodeGraph is not
 * available for this project.
 */
export function getCodeGraphMcpConfig(projectRoot: string): McpServerConfig | null {
  if (!hasCodeGraphIndex(projectRoot)) {
    return null;
  }

  const command = resolveCodeGraphCommand(projectRoot);
  if (!command) {
    return null;
  }

  // When the command is an absolute path to a .js file, run it with `node`.
  // When it is the bare `codegraph` CLI name, invoke it directly.
  if (path.isAbsolute(command)) {
    return {
      command: process.execPath,
      args: [command, "serve", "--mcp", "--path", projectRoot],
    };
  }

  return {
    command,
    args: ["serve", "--mcp", "--path", projectRoot],
  };
}

/**
 * Build a Record suitable for merging into `mcpServers` settings, or
 * `undefined` when CodeGraph is not available.
 */
export function getCodeGraphMcpServers(projectRoot: string): Record<string, McpServerConfig> | undefined {
  const config = getCodeGraphMcpConfig(projectRoot);
  if (!config) {
    return undefined;
  }
  return { codegraph: config };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isCodeGraphOnPath(): boolean {
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    execFileSync(whichCmd, ["codegraph"], { stdio: "ignore", windowsHide: true, timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
