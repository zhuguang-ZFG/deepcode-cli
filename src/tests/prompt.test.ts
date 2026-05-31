import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { getDefaultSkillPrompt, getRuntimeContext, getSystemPrompt, getTools } from "../prompt";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("getTools always includes WebSearch", () => {
  const names = getTools().map((tool) => tool.function.name);
  assert.equal(names.includes("WebSearch"), true);
});

test("getTools includes UpdatePlan with string plan schema", () => {
  const tool = getTools().find((candidate) => candidate.function.name === "UpdatePlan");
  assert.ok(tool);
  assert.deepEqual(tool.function.parameters.required, ["plan"]);
  assert.equal((tool.function.parameters.properties.plan as { type?: unknown }).type, "string");
});

test("getSystemPrompt always includes WebSearch docs", () => {
  const prompt = getSystemPrompt("/tmp/project");
  assert.equal(prompt.includes("## WebSearch"), true);
});

test("getSystemPrompt includes UpdatePlan docs", () => {
  const prompt = getSystemPrompt("/tmp/project");
  assert.equal(prompt.includes("## UpdatePlan"), true);
  assert.equal(prompt.includes("The `plan` argument is a markdown string, not an array of step objects."), true);
});

test("getSystemPrompt does not include runtime context", () => {
  const prompt = getSystemPrompt("/tmp/project");
  assert.equal(prompt.includes("# Local Workspace Environment"), false);
  assert.equal(prompt.includes('"root path": "/tmp/project"'), false);
});

test("getDefaultSkillPrompt loads default skill templates in order", () => {
  const prompt = getDefaultSkillPrompt();
  const agentDriftIndex = prompt.indexOf("<agent-drift-guard-skill>");
  const planIndex = prompt.indexOf("<plan-and-execute-skill>");

  assert.notEqual(agentDriftIndex, -1);
  assert.notEqual(planIndex, -1);
  assert.equal(agentDriftIndex < planIndex, true);
  assert.equal(prompt.includes("以下技能文档用于辅助完成当前任务："), true);
  assert.equal(prompt.includes("Use the skill documents below to assist the user:"), false);
  assert.equal(prompt.includes('path="templates/skills/'), false);
});

test("getSystemPrompt does not include current date guidance", () => {
  const now = new Date();
  const expected = `今天是 ${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日。随着对话进行，时间在流逝。`;
  const prompt = getSystemPrompt("/tmp/project");
  assert.equal(prompt.includes(expected), false);
});

test("getRuntimeContext includes current date and model guidance", () => {
  const now = new Date();
  const expectedDate = `今天是 ${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日。随着对话进行，时间在流逝。`;
  const prompt = getRuntimeContext("/tmp/project", "deepseek-v4-pro");
  assert.equal(prompt.includes(expectedDate), true);
  assert.equal(prompt.includes("当前 LLM 模型为 deepseek-v4-pro，可通过 /model 命令切换模型。"), true);
  assert.equal(prompt.includes("# Local Workspace Environment"), true);
  assert.equal(prompt.includes('"root path": "/tmp/project"'), true);
});

test("getSystemPrompt uses readable LiMa Code base instructions", () => {
  const prompt = getSystemPrompt("/tmp/project");
  assert.equal(prompt.includes("你是名叫 LiMa Code 的交互式 CLI 工具"), true);
  assert.equal(prompt.includes("浣犳槸"), false);
  assert.equal(prompt.includes("閲嶈"), false);
});

test("getSystemPrompt renders Read docs for non-multimodal models", () => {
  const prompt = getSystemPrompt("/tmp/project", { model: "deepseek-chat" });
  assert.equal(prompt.includes("the current model is not multimodal"), true);
  assert.equal(prompt.includes("the contents are presented visually"), false);
});

test("runtime prompt assets live under templates", () => {
  assert.equal(fs.existsSync(path.join(repoRoot, "templates", "tools", "web-search.md")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "templates", "tools", "read.md.ejs")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "templates", "prompts", "init_command.md.ejs")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "templates", "skills", "agent-drift-guard.md")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "templates", "skills", "plan-and-execute.md")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "templates", "tools", "read.md")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "docs", "tools")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "docs", "prompts")), false);
});
