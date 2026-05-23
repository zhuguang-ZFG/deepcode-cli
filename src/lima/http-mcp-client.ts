import type { LiMaMcpPreset } from "./mcp-preset";

export type LiMaHttpMcpToolDefinition = {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
};

export type LiMaHttpMcpCallResult = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

export type LiMaHttpMcpFetchResponse = {
  ok: boolean;
  status: number;
  statusText?: string;
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
};

export type LiMaHttpMcpFetch = (
  url: string,
  init: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
  }
) => Promise<LiMaHttpMcpFetchResponse>;

export class LiMaHttpMcpClient {
  constructor(
    private readonly preset: LiMaMcpPreset,
    private readonly fetchImpl: LiMaHttpMcpFetch = defaultFetch
  ) {}

  async listTools(): Promise<LiMaHttpMcpToolDefinition[]> {
    const payload = await this.request(this.preset.toolsListUrl, { method: "GET" });
    return normalizeToolList(payload);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<LiMaHttpMcpCallResult> {
    const payload = await this.request(this.preset.toolCallUrl, {
      method: "POST",
      body: JSON.stringify({ name, arguments: args }),
    });
    return normalizeCallResult(payload);
  }

  private async request(url: string, init: { method: "GET" | "POST"; body?: string }): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      method: init.method,
      headers: {
        ...this.preset.headers,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body,
    });

    if (!response.ok) {
      const detail = response.text ? await response.text().catch(() => "") : "";
      const suffix = detail ? `: ${detail}` : "";
      throw new Error(`LiMa MCP HTTP ${response.status} ${response.statusText ?? ""}${suffix}`.trim());
    }

    return response.json();
  }
}

function normalizeToolList(payload: unknown): LiMaHttpMcpToolDefinition[] {
  const rawTools =
    readArray(payload, "tools") ?? readArray(payload, "data") ?? (Array.isArray(payload) ? payload : null);
  if (!rawTools) {
    return [];
  }

  return rawTools
    .map((tool) => normalizeToolDefinition(tool))
    .filter((tool): tool is LiMaHttpMcpToolDefinition => Boolean(tool));
}

function normalizeToolDefinition(value: unknown): LiMaHttpMcpToolDefinition | null {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) {
    return null;
  }

  const inputSchema = isRecord(value.inputSchema) ? value.inputSchema : {};
  return {
    name: value.name.trim(),
    description: typeof value.description === "string" ? value.description : undefined,
    inputSchema: {
      type: "object",
      properties: isRecord(inputSchema.properties) ? inputSchema.properties : {},
      required: Array.isArray(inputSchema.required) ? inputSchema.required.filter(isString) : undefined,
      additionalProperties:
        typeof inputSchema.additionalProperties === "boolean" ? inputSchema.additionalProperties : undefined,
    },
  };
}

function normalizeCallResult(payload: unknown): LiMaHttpMcpCallResult {
  if (isRecord(payload) && Array.isArray(payload.content)) {
    return {
      content: payload.content
        .map(normalizeContentItem)
        .filter((item): item is { type: string; text?: string } => Boolean(item)),
      isError: typeof payload.isError === "boolean" ? payload.isError : undefined,
    };
  }

  if (isRecord(payload) && typeof payload.output === "string") {
    return { content: [{ type: "text", text: payload.output }] };
  }

  if (typeof payload === "string") {
    return { content: [{ type: "text", text: payload }] };
  }

  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function normalizeContentItem(value: unknown): { type: string; text?: string } | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }
  return {
    type: value.type,
    text: typeof value.text === "string" ? value.text : undefined,
  };
}

function readArray(value: unknown, key: string): unknown[] | null {
  if (!isRecord(value)) {
    return null;
  }
  return Array.isArray(value[key]) ? value[key] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

async function defaultFetch(
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string }
): Promise<LiMaHttpMcpFetchResponse> {
  return fetch(url, init);
}
