import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatLiMaTelegramEvent,
  readLiMaTelegramConfig,
  redactTelegramText,
  sendLiMaTelegramEvent,
} from "../lima/telegram-notifier";

test("readLiMaTelegramConfig reads outbound Telegram settings", () => {
  const config = readLiMaTelegramConfig({
    LIMA_CODE_TELEGRAM_BOT_TOKEN: "bot-token",
    LIMA_CODE_TELEGRAM_CHAT_ID: "12345",
    LIMA_CODE_TELEGRAM_PROXY: "http://127.0.0.1:7897",
  });

  assert.equal(config.configured, true);
  assert.equal(config.botToken, "bot-token");
  assert.equal(config.chatId, "12345");
  assert.equal(config.proxyUrl, "http://127.0.0.1:7897");
});

test("redactTelegramText removes common secrets from notifications", () => {
  const tokenValue = "abc1234567890" + "1234567890";
  const bearerValue = "secret-token-" + "123456789";
  const openAiValue = "sk-" + "abcdef1234567890";
  const text = redactTelegramText(`token=${tokenValue} Bearer ${bearerValue} ${openAiValue}`);

  assert.doesNotMatch(text, /abc123456789/);
  assert.doesNotMatch(text, /secret-token/);
  assert.doesNotMatch(text, /sk-abcdef/);
  assert.match(text, /token=\*\*\*/);
});

test("formatLiMaTelegramEvent includes task status without leaking secrets", () => {
  const secretValue = "super-secret-token-" + "123456";
  const text = formatLiMaTelegramEvent({
    type: "task_failed",
    taskId: "task-1",
    status: "failed",
    summary: `failed with api_key=${secretValue}`,
    changedFiles: ["README.md"],
  });

  assert.match(text, /task-1/);
  assert.match(text, /failed/);
  assert.match(text, /README.md/);
  assert.doesNotMatch(text, /super-secret-token/);
});

test("sendLiMaTelegramEvent posts to Telegram and hides token from result", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const botToken = "bot-" + "token";
  const ok = await sendLiMaTelegramEvent(
    {
      type: "task_started",
      taskId: "task-1",
      status: "running",
      summary: "starting",
    },
    {
      config: {
        configured: true,
        botToken,
        chatId: "12345",
        proxyUrl: "",
      },
      fetch: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    }
  );

  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, `https://api.telegram.org/bot${botToken}/sendMessage`);
  assert.deepEqual(calls[0]?.body, {
    chat_id: "12345",
    text: "LiMa Code task_started\nTask: task-1\nStatus: running\nstarting",
  });
});

test("sendLiMaTelegramEvent is best effort on network failure", async () => {
  const botToken = "bot-" + "token";
  const ok = await sendLiMaTelegramEvent(
    {
      type: "task_finished",
      taskId: "task-1",
      status: "succeeded",
      summary: "done",
    },
    {
      config: {
        configured: true,
        botToken,
        chatId: "12345",
        proxyUrl: "",
      },
      fetch: async () => {
        throw new Error("network down");
      },
    }
  );

  assert.equal(ok, false);
});
