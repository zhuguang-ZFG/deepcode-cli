import * as fs from "fs";
import * as path from "path";
import type { ChatCompletionMessageParam, ChatCompletionContentPart } from "openai/resources/chat/completions";
import { isLiMaRouterBaseURL } from "../common/openai-thinking";
import { supportsMultimodal } from "../common/model-capabilities";
import {
  LIMA_ROUTER_SAFE_SYSTEM_PROMPT,
  LIMA_ROUTER_SAFE_DEFAULT_SKILL_PROMPT,
  LIMA_ROUTER_PROJECT_INSTRUCTION_SUMMARY,
  LIMA_ROUTER_PROJECT_INSTRUCTION_MIN_CHARS,
} from "./constants";
import type { SessionMessage } from "./types";
import { getExtensionRoot } from "./helpers";
import ejs from "ejs";

export function getAssistantToolCalls(message: SessionMessage): unknown[] {
  if (message.role !== "assistant") {
    return [];
  }
  const messageParams = message.messageParams as { tool_calls?: unknown[] } | null;
  return Array.isArray(messageParams?.tool_calls) ? messageParams.tool_calls : [];
}

export function getToolCallId(toolCall: unknown): string | null {
  if (!toolCall || typeof toolCall !== "object") {
    return null;
  }
  const id = (toolCall as { id?: unknown }).id;
  return typeof id === "string" && id ? id : null;
}

export function getToolMessageCallId(message: SessionMessage): string | null {
  const messageParams = message.messageParams as { tool_call_id?: unknown } | null;
  const toolCallId = messageParams?.tool_call_id;
  return typeof toolCallId === "string" && toolCallId ? toolCallId : null;
}

export function buildToolPairingKey(assistantIndex: number, toolCallIndex: number): string {
  return `${assistantIndex}:${toolCallIndex}`;
}

export function isInterruptedToolMessage(message: SessionMessage): boolean {
  if (typeof message.content !== "string" || !message.content.trim()) {
    return false;
  }
  try {
    const parsed = JSON.parse(message.content) as { metadata?: { interrupted?: unknown } };
    return parsed.metadata?.interrupted === true;
  } catch {
    return false;
  }
}

export function findToolFunction(toolCalls: unknown[], toolCallId: string): unknown | null {
  for (const toolCall of toolCalls) {
    if (!toolCall || typeof toolCall !== "object") {
      continue;
    }
    const record = toolCall as { id?: unknown; function?: unknown };
    if (record.id === toolCallId) {
      return record.function ?? null;
    }
  }
  return null;
}

export function normalizeToolCallArguments(args: string): string {
  const trimmed = args.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return JSON.stringify(JSON.parse(trimmed));
  } catch {
    return trimmed;
  }
}

export function getToolCallSignature(toolCall: unknown): string | null {
  if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
    return null;
  }
  const toolFunction = (toolCall as { function?: unknown }).function;
  if (!toolFunction || typeof toolFunction !== "object" || Array.isArray(toolFunction)) {
    return null;
  }
  const name = (toolFunction as { name?: unknown }).name;
  const args = (toolFunction as { arguments?: unknown }).arguments;
  if (typeof name !== "string" || !name.trim()) {
    return null;
  }
  const normalizedArgs = normalizeToolCallArguments(typeof args === "string" ? args : "");
  return `${name.trim()}:${normalizedArgs}`;
}

export function formatToolCallSignatureForDisplay(signature: string): string {
  return signature.length > 160 ? `${signature.slice(0, 157)}...` : signature;
}

export function getRepeatedToolCallLoopMessage(messages: SessionMessage[], toolCalls: unknown[] | null): string | null {
  if (!toolCalls || toolCalls.length === 0) {
    return null;
  }

  const previousCounts = new Map<string, number>();
  for (const message of messages) {
    for (const previousToolCall of getAssistantToolCalls(message)) {
      const signature = getToolCallSignature(previousToolCall);
      if (!signature) {
        continue;
      }
      previousCounts.set(signature, (previousCounts.get(signature) ?? 0) + 1);
    }
  }

  for (const toolCall of toolCalls) {
    const signature = getToolCallSignature(toolCall);
    if (!signature) {
      continue;
    }
    if ((previousCounts.get(signature) ?? 0) >= 2) {
      return `The model repeated the same tool call several times, so LiMa stopped the loop before running it again: ${formatToolCallSignatureForDisplay(signature)}. Refine the prompt or use /continue if you want another pass.`;
    }
  }

  return null;
}

export function stripThinkingContent(content: string): string {
  const thinkTagRe = new RegExp("<think>[\\s\\S]*?<\\/think>\\s*", "g");
  const cleaned = content.replace(thinkTagRe, "").trim();
  const text = cleaned || content.trim();

  const codeBlocks = text.match(/```[\s\S]*?```/g);
  if (codeBlocks && codeBlocks.length > 0) {
    const afterCode = text.substring(text.lastIndexOf("```") + 3).trim();
    return codeBlocks.join("\n\n") + (afterCode.length > 5 ? "\n\n" + afterCode : "");
  }

  const answerMatch =
    text.match(/[答结][案果][是为：:]\s*[「"']?([^。\n"']+)/) ||
    text.match(/[Aa]nswer[:\s]+([^.\n]+)/) ||
    text.match(/F\(\d+\)\s*=\s*(\d[\d,. ]*)/);
  if (answerMatch && answerMatch[1] && answerMatch[1].trim().length > 0) {
    return answerMatch[1].trim();
  }

  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const thinkingRe =
    /^(?:用户[问要需想]|根据[我我的指约]|我[需应可]该|让我[来写提分]|这是一个|简单[来分]析|根据约束|根据指令|作为[一]|首先[我需]|我们需要|值得注意|The user|I need to|Let me|I should|Based on|I can|For this|This is|I will|In this|To solve|We need|It is|There are|My approach|The answer|I think|Let's|Here is|For this)/;
  let thinkingLines = 0;
  for (const line of lines) {
    if (thinkingRe.test(line.trim())) {
      thinkingLines++;
    }
  }

  const numberedThinking = text.match(/^[\d]+\.\s+\S+/gm);
  if (numberedThinking && numberedThinking.length >= 3 && !text.includes("```")) {
    thinkingLines = Math.max(thinkingLines, numberedThinking.length);
  }

  if (thinkingLines >= 1 && thinkingLines >= lines.length * 0.15) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!thinkingRe.test(lines[i].trim()) && lines[i].trim().length > 3) {
        return lines.slice(i).join("\n").trim();
      }
    }
    return content;
  }

  return content;
}

export function buildInterruptedToolResult(toolFunction: unknown | null, reason: string): string {
  const toolName =
    toolFunction && typeof toolFunction === "object" && typeof (toolFunction as { name?: unknown }).name === "string"
      ? (toolFunction as { name: string }).name
      : "tool";
  return JSON.stringify(
    {
      ok: false,
      name: toolName,
      error: reason,
      metadata: {
        interrupted: true,
      },
    },
    null,
    2
  );
}

export function buildInterruptedOpenAIToolMessage(
  toolCalls: unknown[],
  toolCallId: string
): ChatCompletionMessageParam {
  const toolFunction = findToolFunction(toolCalls, toolCallId);
  return {
    role: "tool",
    content: buildInterruptedToolResult(toolFunction, "Previous tool call did not complete."),
    tool_call_id: toolCallId,
  } as ChatCompletionMessageParam;
}

export function pairToolMessages(messages: SessionMessage[]): Map<string, number> {
  const pairings = new Map<string, number>();
  const usedToolMessageIndexes = new Set<number>();

  for (let assistantIndex = 0; assistantIndex < messages.length; assistantIndex += 1) {
    const toolCalls = getAssistantToolCalls(messages[assistantIndex]);
    for (let toolCallIndex = 0; toolCallIndex < toolCalls.length; toolCallIndex += 1) {
      const toolCallId = getToolCallId(toolCalls[toolCallIndex]);
      if (!toolCallId) {
        continue;
      }

      const toolIndex = findPairableToolMessageIndex(messages, assistantIndex, toolCallId, usedToolMessageIndexes);
      if (toolIndex == null) {
        continue;
      }

      usedToolMessageIndexes.add(toolIndex);
      pairings.set(buildToolPairingKey(assistantIndex, toolCallIndex), toolIndex);
    }
  }

  return pairings;
}

function findPairableToolMessageIndex(
  messages: SessionMessage[],
  assistantIndex: number,
  toolCallId: string,
  usedToolMessageIndexes: Set<number>
): number | null {
  let firstMatchingIndex: number | null = null;
  for (let index = assistantIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "tool" || usedToolMessageIndexes.has(index)) {
      continue;
    }

    const candidateToolCallId = getToolMessageCallId(message);
    if (candidateToolCallId !== toolCallId) {
      continue;
    }

    if (firstMatchingIndex == null) {
      firstMatchingIndex = index;
    }
    if (!isInterruptedToolMessage(message)) {
      return index;
    }
  }
  return firstMatchingIndex;
}

export function getTrailingPendingToolCalls(messages: SessionMessage[]): unknown[] {
  const activeMessages = messages.filter((message) => !message.compacted);
  const latestMessage = activeMessages[activeMessages.length - 1];
  if (!latestMessage || latestMessage.role !== "assistant") {
    return [];
  }

  const toolCalls = getAssistantToolCalls(latestMessage);
  if (toolCalls.length === 0) {
    return [];
  }
  return toolCalls.filter((toolCall) => Boolean(getToolCallId(toolCall)));
}

export function renderInitCommandPrompt(agentsMdFile: string | null): string {
  const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "init_command.md.ejs");
  const template = fs.readFileSync(templatePath, "utf8");
  return ejs.render(template, { agentsMdFile });
}

export function renderOpenAIMessageContent(message: SessionMessage, agentsMdFile: string | null): string {
  if (message.role === "user" && message.content === "/init") {
    return renderInitCommandPrompt(agentsMdFile);
  }
  return message.content ?? "";
}

export function sessionMessageToOpenAIMessage(
  message: SessionMessage,
  thinkingEnabled: boolean,
  model: string,
  agentsMdFile: string | null
): ChatCompletionMessageParam {
  const content = renderOpenAIMessageContent(message, agentsMdFile);
  const base: ChatCompletionMessageParam = {
    role: message.role,
    content,
  } as ChatCompletionMessageParam;

  const messageParams = message.messageParams as
    | { tool_calls?: unknown[]; tool_call_id?: string; reasoning_content?: string }
    | null
    | undefined;
  if (messageParams?.tool_calls) {
    (base as { tool_calls?: unknown[] }).tool_calls = messageParams.tool_calls;
  }
  if (messageParams?.tool_call_id) {
    (base as { tool_call_id?: string }).tool_call_id = messageParams.tool_call_id;
  }
  if (typeof messageParams?.reasoning_content === "string") {
    (base as { reasoning_content?: string }).reasoning_content = messageParams.reasoning_content;
  } else if (thinkingEnabled && message.role === "assistant") {
    (base as { reasoning_content?: string }).reasoning_content = "";
  }

  if ((message.role === "user" || message.role === "system") && message.contentParams) {
    const contentParts: ChatCompletionContentPart[] = [];
    if (content) {
      contentParts.push({ type: "text", text: content });
    }
    const params = Array.isArray(message.contentParams) ? message.contentParams : [message.contentParams];
    for (const param of params) {
      const part = param as ChatCompletionContentPart;
      if (part && (part.type !== "image_url" || supportsMultimodal(model))) {
        contentParts.push(part);
      }
    }
    const contentValue: string | ChatCompletionContentPart[] = contentParts.length > 0 ? contentParts : content;
    (base as { content: string | ChatCompletionContentPart[] }).content = contentValue;
  }

  return base;
}

export function buildOpenAIMessages(
  messages: SessionMessage[],
  thinkingEnabled: boolean,
  model: string,
  agentsMdFile: string | null
): ChatCompletionMessageParam[] {
  const activeMessages = messages.filter((message) => !message.compacted);
  const toolPairings = pairToolMessages(activeMessages);
  const openAIMessages: ChatCompletionMessageParam[] = [];

  for (let index = 0; index < activeMessages.length; index += 1) {
    const message = activeMessages[index];
    if (message.role === "tool") {
      continue;
    }

    openAIMessages.push(sessionMessageToOpenAIMessage(message, thinkingEnabled, model, agentsMdFile));

    const toolCalls = getAssistantToolCalls(message);
    if (toolCalls.length === 0) {
      continue;
    }

    for (let toolCallIndex = 0; toolCallIndex < toolCalls.length; toolCallIndex += 1) {
      const toolCallId = getToolCallId(toolCalls[toolCallIndex]);
      if (!toolCallId) {
        continue;
      }

      const pairedToolIndex = toolPairings.get(buildToolPairingKey(index, toolCallIndex));
      if (pairedToolIndex != null) {
        openAIMessages.push(
          sessionMessageToOpenAIMessage(activeMessages[pairedToolIndex], thinkingEnabled, model, agentsMdFile)
        );
        continue;
      }

      openAIMessages.push(buildInterruptedOpenAIToolMessage(toolCalls, toolCallId));
    }
  }

  return openAIMessages;
}

export function isLikelyProjectInstructionBlob(content: string): boolean {
  if (content.length < LIMA_ROUTER_PROJECT_INSTRUCTION_MIN_CHARS) {
    return false;
  }

  const normalized = content.toLowerCase();
  const projectMarkers = [
    "milestone collaboration protocol",
    "codegraph_start",
    "codegraph_end",
    "project-doc",
    "agents.md",
    "agent automatic closeout",
    "vps",
  ];

  return projectMarkers.some((marker) => normalized.includes(marker));
}

export function toLiMaRouterSafeText(content: string): string {
  if (content.includes("# Available Tools")) {
    return LIMA_ROUTER_SAFE_SYSTEM_PROMPT;
  }
  if (content.includes("<agent-drift-guard-skill>") && content.includes("<plan-and-execute-skill>")) {
    return LIMA_ROUTER_SAFE_DEFAULT_SKILL_PROMPT;
  }
  if (!isLikelyProjectInstructionBlob(content)) {
    return content;
  }
  return `${LIMA_ROUTER_PROJECT_INSTRUCTION_SUMMARY}\n\nOriginal project instruction length: ${content.length} characters.`;
}

export function toLiMaRouterSafeMessage(message: ChatCompletionMessageParam): ChatCompletionMessageParam {
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string") {
    return message;
  }
  const safeContent = toLiMaRouterSafeText(content);
  if (safeContent === content) {
    return message;
  }
  return {
    ...message,
    content: safeContent,
  } as ChatCompletionMessageParam;
}

export function buildProviderOpenAIMessages(
  messages: SessionMessage[],
  thinkingEnabled: boolean,
  model: string,
  baseURL: string | undefined,
  agentsMdFile: string | null
): ChatCompletionMessageParam[] {
  const openAIMessages = buildOpenAIMessages(messages, thinkingEnabled, model, agentsMdFile);
  if (!isLiMaRouterBaseURL(baseURL)) {
    return openAIMessages;
  }
  return openAIMessages.map((message) => toLiMaRouterSafeMessage(message));
}
