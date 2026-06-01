import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCliHelpText } from "../cliHelp";

test("buildCliHelpText renders Chinese-first command help", () => {
  const help = buildCliHelpText();
  assert.match(help, /用法：/);
  assert.match(help, /配置：/);
  assert.match(help, /TUI 内快捷键：/);
  assert.match(help, /聊天命令：/);
  assert.match(help, /LiMa Worker 命令：/);
  assert.match(help, /\/lima vibe/);
  assert.doesNotMatch(help, /Usage:|Configuration:|Inside the TUI|Chat Commands|LiMa Worker Commands/);
});
