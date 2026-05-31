import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL_COMMAND_THINKING_OPTIONS } from "../ui";

test("model thinking menu labels are Chinese-first", () => {
  const labels = MODEL_COMMAND_THINKING_OPTIONS.map((option) => option.label).join("\n");
  assert.match(labels, /思考模式/);
  assert.match(labels, /关闭思考/);
  assert.doesNotMatch(labels, /Thinking mode|No thinking/i);
});
