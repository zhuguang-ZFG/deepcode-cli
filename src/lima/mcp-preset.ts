export type LiMaMcpPresetConfig = {
  name?: string;
  serverUrl?: string;
  apiKey?: string;
};

export type LiMaMcpPreset = {
  name: string;
  transport: "http";
  baseUrl: string;
  toolsListUrl: string;
  toolCallUrl: string;
  headers: Record<string, string>;
};

export type LiMaMcpPresetResult = { ok: true; value: LiMaMcpPreset } | { ok: false; error: string };

export type LiMaMcpEnv = Record<string, string | undefined>;

const DEFAULT_LIMA_MCP_NAME = "lima";

export function buildLiMaMcpPreset(
  config: LiMaMcpPresetConfig = {},
  env: LiMaMcpEnv = process.env
): LiMaMcpPresetResult {
  const name = normalizeName(config.name ?? DEFAULT_LIMA_MCP_NAME);
  if (!name) {
    return { ok: false, error: "LiMa MCP preset name is required." };
  }

  const baseUrl = normalizeLiMaServerUrl(
    config.serverUrl ?? env.LIMA_CODE_SERVER_URL ?? env.LIMA_CODE_BASE_URL ?? env.DEEPCODE_BASE_URL
  );
  if (!baseUrl) {
    return { ok: false, error: "LiMa MCP preset requires LIMA_CODE_SERVER_URL or LIMA_CODE_BASE_URL." };
  }

  const apiKey = (config.apiKey ?? env.LIMA_CODE_API_KEY ?? env.DEEPCODE_API_KEY ?? "").trim();
  if (!apiKey) {
    return { ok: false, error: "LiMa MCP preset requires LIMA_CODE_API_KEY." };
  }

  return {
    ok: true,
    value: {
      name,
      transport: "http",
      baseUrl,
      toolsListUrl: `${baseUrl}/mcp/tools/list`,
      toolCallUrl: `${baseUrl}/mcp/tools/call`,
      headers: buildAuthHeaders(apiKey),
    },
  };
}

export function normalizeLiMaServerUrl(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "";
  }

  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = stripVersionPath(parsed.pathname);
  return parsed.toString().replace(/\/$/, "");
}

function normalizeName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
}

function stripVersionPath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "");
  if (!normalized || normalized === "/") {
    return "/";
  }
  return normalized.replace(/\/v1$/i, "") || "/";
}

function buildAuthHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "x-api-key": apiKey,
  };
}
