import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLiMaMcpPreset, normalizeLiMaServerUrl } from "../lima/mcp-preset";

test("normalizeLiMaServerUrl strips OpenAI-compatible v1 suffix", () => {
  assert.equal(normalizeLiMaServerUrl("https://chat.donglicao.com/v1"), "https://chat.donglicao.com");
  assert.equal(normalizeLiMaServerUrl("http://127.0.0.1:8080/v1/"), "http://127.0.0.1:8080");
});

test("buildLiMaMcpPreset builds LiMa Server MCP endpoint metadata from env", () => {
  const result = buildLiMaMcpPreset(
    {},
    {
      LIMA_CODE_BASE_URL: "https://chat.donglicao.com/v1",
      LIMA_CODE_API_KEY: "test-key",
    }
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    name: "lima",
    transport: "http",
    baseUrl: "https://chat.donglicao.com",
    toolsListUrl: "https://chat.donglicao.com/mcp/tools/list",
    toolCallUrl: "https://chat.donglicao.com/mcp/tools/call",
    headers: {
      Authorization: "Bearer test-key",
      "x-api-key": "test-key",
    },
  });
});

test("buildLiMaMcpPreset prefers explicit config over env", () => {
  const result = buildLiMaMcpPreset(
    {
      name: "LiMa Server",
      serverUrl: "http://localhost:8080",
      apiKey: "explicit-key",
    },
    {
      LIMA_CODE_BASE_URL: "https://chat.donglicao.com/v1",
      LIMA_CODE_API_KEY: "env-key",
    }
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.name, "LiMa_Server");
  assert.equal(result.value.baseUrl, "http://localhost:8080");
  assert.equal(result.value.headers.Authorization, "Bearer explicit-key");
});

test("buildLiMaMcpPreset fails safely without server URL or key", () => {
  assert.deepEqual(buildLiMaMcpPreset({}, {}), {
    ok: false,
    error: "LiMa MCP preset requires LIMA_CODE_SERVER_URL or LIMA_CODE_BASE_URL.",
  });

  assert.deepEqual(buildLiMaMcpPreset({}, { LIMA_CODE_BASE_URL: "https://chat.donglicao.com" }), {
    ok: false,
    error: "LiMa MCP preset requires LIMA_CODE_API_KEY.",
  });
});
