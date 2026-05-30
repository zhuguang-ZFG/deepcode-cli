import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runHeadless } from "../headless";

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("runHeadless parses non-stream JSON chat responses from LiMa", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-headless-json-"));
  tempDirs.push(projectRoot);
  const fetchUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    fetchUrls.push(url);
    if (url.endsWith("/chat/completions")) {
      assert.equal(init?.method, "POST");
      assert.equal(JSON.parse(String(init?.body)).stream, false);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "lima_code_cli_smoke_ok" } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }
    if (url.endsWith("/agent/learn/outcome")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("unexpected", { status: 404 });
  }) as typeof fetch;

  const result = await runHeadless("Reply exactly: lima_code_cli_smoke_ok", {
    json: true,
    projectRoot,
  });

  assert.equal(result.ok, true);
  assert.equal(result.content, "lima_code_cli_smoke_ok");
  assert.match(result.sessionId, /^hls-/);
  assert.equal(
    fetchUrls.some((url) => url.endsWith("/agent/learn/outcome")),
    true
  );
});

test("runHeadless parses Anthropic-style SSE text from LiMa", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-headless-sse-"));
  tempDirs.push(projectRoot);

  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith("/chat/completions")) {
      const body = [
        'event: message_start\ndata: {"type":"message_start","message":{"content":[]}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lima_code"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"_cli_smoke_ok"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ].join("");
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    if (url.endsWith("/agent/learn/outcome")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("unexpected", { status: 404 });
  }) as typeof fetch;

  const result = await runHeadless("Reply exactly: lima_code_cli_smoke_ok", {
    json: true,
    projectRoot,
  });

  assert.equal(result.ok, true);
  assert.equal(result.content, "lima_code_cli_smoke_ok");
  assert.match(result.sessionId, /^hls-/);
});

test("runHeadless exposes model retry telemetry when the first call fails", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-headless-retry-"));
  tempDirs.push(projectRoot);
  let chatCalls = 0;

  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/chat/completions")) {
      chatCalls++;
      assert.ok(init?.signal instanceof AbortSignal);
      if (chatCalls === 1) {
        throw new Error("simulated provider reset");
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "retry_ok" } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }
    if (url.endsWith("/agent/learn/outcome")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("unexpected", { status: 404 });
  }) as typeof fetch;

  const result = await runHeadless("Reply exactly: retry_ok", {
    json: true,
    projectRoot,
  });

  assert.equal(result.ok, true);
  assert.equal(result.content, "retry_ok");
  assert.equal(result.telemetry.retryCount, 1);
  assert.equal(result.telemetry.modelCalls.length, 2);
  assert.equal(result.telemetry.modelCalls[0].ok, false);
  assert.match(result.telemetry.modelCalls[0].error ?? "", /simulated provider reset/);
  assert.equal(result.telemetry.modelCalls[1].ok, true);
});

test("runHeadless reports model tool-call capability telemetry", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lima-headless-tool-"));
  tempDirs.push(projectRoot);
  let chatCalls = 0;

  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/chat/completions")) {
      chatCalls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(Array.isArray(body.tools), true);
      if (chatCalls === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "bash",
                        arguments: JSON.stringify({ command: "echo tool_ok" }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      assert.equal(
        body.messages.some((message: { role?: string; content?: string }) => {
          return message.role === "tool" && String(message.content ?? "").includes("tool_ok");
        }),
        true
      );
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "tool_done" } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }
    if (url.endsWith("/agent/learn/outcome")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("unexpected", { status: 404 });
  }) as typeof fetch;

  const result = await runHeadless("Use a tool then reply tool_done", {
    json: true,
    projectRoot,
  });

  assert.equal(result.ok, true);
  assert.equal(result.content, "tool_done");
  assert.equal(result.toolCalls, 1);
  assert.equal(result.telemetry.toolCapability.requested, true);
  assert.equal(result.telemetry.toolCapability.observed, true);
  assert.equal(result.telemetry.toolCapability.protocol, "openai");
  assert.equal(result.telemetry.modelCalls[0].toolCalls, 1);
});
