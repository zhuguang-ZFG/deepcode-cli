import { test } from "node:test";
import assert from "node:assert/strict";
import { LiMaHttpMcpClient, type LiMaHttpMcpFetch } from "../lima/http-mcp-client";
import type { LiMaMcpPreset } from "../lima/mcp-preset";

const PRESET: LiMaMcpPreset = {
  name: "lima",
  transport: "http",
  baseUrl: "https://chat.donglicao.com",
  toolsListUrl: "https://chat.donglicao.com/mcp/tools/list",
  toolCallUrl: "https://chat.donglicao.com/mcp/tools/call",
  headers: {
    Authorization: "Bearer test-key",
    "x-api-key": "test-key",
  },
};

test("LiMaHttpMcpClient lists tools with preset headers", async () => {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  const client = new LiMaHttpMcpClient(PRESET, async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers });
    return jsonResponse({
      tools: [
        {
          name: "memory_search",
          description: "Search memory",
          inputSchema: {
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      ],
    });
  });

  const tools = await client.listTools();

  assert.deepEqual(calls, [
    {
      url: "https://chat.donglicao.com/mcp/tools/list",
      method: "GET",
      headers: {
        Authorization: "Bearer test-key",
        "x-api-key": "test-key",
        Accept: "application/json",
      },
    },
  ]);
  assert.deepEqual(tools, [
    {
      name: "memory_search",
      description: "Search memory",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: undefined,
      },
    },
  ]);
});

test("LiMaHttpMcpClient calls tools with MCP-style request body", async () => {
  let body = "";
  const client = new LiMaHttpMcpClient(PRESET, async (_url, init) => {
    body = init.body ?? "";
    return jsonResponse({ content: [{ type: "text", text: "ok" }], isError: false });
  });

  const result = await client.callTool("memory_search", { query: "routing" });

  assert.equal(body, JSON.stringify({ name: "memory_search", arguments: { query: "routing" } }));
  assert.deepEqual(result, {
    content: [{ type: "text", text: "ok" }],
    isError: false,
  });
});

test("LiMaHttpMcpClient normalizes simple output responses", async () => {
  const client = new LiMaHttpMcpClient(PRESET, async () => jsonResponse({ output: "simple text" }));

  assert.deepEqual(await client.callTool("memory_search", {}), {
    content: [{ type: "text", text: "simple text" }],
  });
});

test("LiMaHttpMcpClient reports HTTP errors with response body", async () => {
  const client = new LiMaHttpMcpClient(PRESET, async () => ({
    ok: false,
    status: 403,
    statusText: "Forbidden",
    json: async () => ({}),
    text: async () => "denied",
  }));

  await assert.rejects(() => client.listTools(), /403 Forbidden: denied/);
});

function jsonResponse(payload: unknown): Awaited<ReturnType<LiMaHttpMcpFetch>> {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
  };
}
