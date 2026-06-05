import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import matter from "gray-matter";
import ejs from "ejs";
import type { ChatCompletionMessageParam, ChatCompletionContentPart } from "openai/resources/chat/completions";
import { launchNotifyScript } from "./common/notify";
import { buildThinkingRequestOptions, isLiMaRouterBaseURL } from "./common/openai-thinking";
import { DEEPSEEK_V4_MODELS, supportsMultimodal } from "./common/model-capabilities";
import {
  getCompactPrompt,
  getDefaultSkillPrompt,
  getRuntimeContext,
  getSystemPrompt,
  getTools,
  type ToolDefinition,
} from "./prompt";
import {
  ToolExecutor,
  type CreateOpenAIClient,
  type ProcessTimeoutControl,
  type ProcessTimeoutInfo,
} from "./tools/executor";
import { McpManager } from "./mcp/mcp-manager";
import type { McpServerConfig } from "./settings";
import { getCodeGraphMcpServers } from "./lima/codegraph-mcp-preset";
import { logApiError } from "./common/error-logger";
import type { logOpenAIChatCompletionDebug } from "./common/debug-logger";
import { normalizeDebugError } from "./common/debug-logger";
import { killProcessTree } from "./common/process-tree";
import { GitFileHistory } from "./common/file-history";
import * as sessionStorage from "./session/session-storage";
import * as llmStream from "./session/llm-stream";
import * as messageBuilder from "./session/message-builder";

// Re-export types, constants, and helpers from sub-modules
export type {
  SessionStatus,
  ModelUsage,
  SessionProcessEntry,
  BashTimeoutAdjustment,
  SessionEntry,
  SessionsIndex,
  SessionMessageRole,
  MessageMeta,
  SessionMessage,
  UndoTarget,
  UserPromptContent,
  SkillInfo,
  LlmStreamProgress,
} from "./session/types";
import type {
  ModelUsage,
  SessionEntry,
  SessionMessage,
  SessionProcessEntry,
  BashTimeoutAdjustment,
  SessionStatus,
  MessageMeta,
  SkillInfo,
  LlmStreamProgress,
  UndoTarget,
  UserPromptContent,
  SessionsIndex,
  SessionMessageRole,
} from "./session/types";

export {
  MAX_SESSION_ENTRIES,
  DEFAULT_COMPACT_PROMPT_TOKEN_THRESHOLD,
  DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD,
  DEFAULT_MAX_MODEL_ITERATIONS,
  DEFAULT_LIMA_ROUTER_REQUEST_TIMEOUT_MS,
  DEFAULT_LIMA_ROUTER_MAX_RETRIES,
  LIMA_ROUTER_PROJECT_INSTRUCTION_MIN_CHARS,
  LIMA_ROUTER_SAFE_SYSTEM_PROMPT,
  LIMA_ROUTER_SAFE_DEFAULT_SKILL_PROMPT,
  LIMA_ROUTER_PROJECT_INSTRUCTION_SUMMARY,
  EMPTY_ASSISTANT_RESPONSE_MESSAGE,
  type ChatCompletionDebugOptions,
} from "./session/constants";
import {
  MAX_SESSION_ENTRIES,
  DEFAULT_COMPACT_PROMPT_TOKEN_THRESHOLD,
  DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD,
  DEFAULT_MAX_MODEL_ITERATIONS,
  DEFAULT_LIMA_ROUTER_REQUEST_TIMEOUT_MS,
  DEFAULT_LIMA_ROUTER_MAX_RETRIES,
  LIMA_ROUTER_PROJECT_INSTRUCTION_MIN_CHARS,
  LIMA_ROUTER_SAFE_SYSTEM_PROMPT,
  LIMA_ROUTER_SAFE_DEFAULT_SKILL_PROMPT,
  LIMA_ROUTER_PROJECT_INSTRUCTION_SUMMARY,
  EMPTY_ASSISTANT_RESPONSE_MESSAGE,
  type ChatCompletionDebugOptions,
} from "./session/constants";

export { getCompactPromptTokenThreshold, extractPinnedConstraints } from "./session/helpers";
import {
  anySignal,
  isUsageRecord,
  summarizeCompletionOptions,
  addUsageValue,
  accumulateUsage,
  usageWithRequestCount,
  accumulateUsagePerModel,
  getExtensionRoot,
  getTotalTokens,
  readPositiveIntegerEnv,
  getLiMaRouterRequestTimeoutMs,
  getLiMaRouterMaxRetries,
  getCompactPromptTokenThreshold,
  extractPinnedConstraints,
} from "./session/helpers";

type SessionManagerOptions = {
  projectRoot: string;
  createOpenAIClient: CreateOpenAIClient;
  getResolvedSettings: () => { model: string; webSearchTool?: string; mcpServers?: Record<string, McpServerConfig> };
  renderMarkdown: (text: string) => string;
  onAssistantMessage: (message: SessionMessage, shouldConnect: boolean) => void;
  onSessionEntryUpdated?: (entry: SessionEntry) => void;
  onLlmStreamProgress?: (progress: LlmStreamProgress) => void;
  onMcpStatusChanged?: () => void;
  onProcessStdout?: (pid: number, chunk: string) => void;
};

export class SessionManager {
  private readonly projectRoot: string;
  private readonly createOpenAIClient: CreateOpenAIClient;
  private readonly getResolvedSettings: () => {
    model: string;
    webSearchTool?: string;
    mcpServers?: Record<string, McpServerConfig>;
  };
  private readonly onAssistantMessage: (message: SessionMessage, shouldConnect: boolean) => void;
  private readonly onSessionEntryUpdated?: (entry: SessionEntry) => void;
  private readonly onLlmStreamProgress?: (progress: LlmStreamProgress) => void;
  private readonly onMcpStatusChanged?: () => void;
  private readonly onProcessStdout?: (pid: number, chunk: string) => void;
  private activeSessionId: string | null = null;
  private activePromptController: AbortController | null = null;
  private readonly sessionControllers = new Map<string, AbortController>();
  private readonly processTimeoutControls = new Map<string, ProcessTimeoutControl>();
  private readonly toolExecutor: ToolExecutor;
  private readonly mcpManager = new McpManager();
  private mcpToolDefinitions: ToolDefinition[] = [];

  constructor(options: SessionManagerOptions) {
    this.projectRoot = options.projectRoot;
    this.createOpenAIClient = options.createOpenAIClient;
    this.getResolvedSettings = options.getResolvedSettings;
    this.onAssistantMessage = options.onAssistantMessage;
    this.onSessionEntryUpdated = options.onSessionEntryUpdated;
    this.onLlmStreamProgress = options.onLlmStreamProgress;
    this.onMcpStatusChanged = options.onMcpStatusChanged;
    this.onProcessStdout = options.onProcessStdout;
    this.toolExecutor = new ToolExecutor(this.projectRoot, this.createOpenAIClient, this.mcpManager);
    this.mcpManager.prepare(this.getResolvedSettings().mcpServers);
  }

  async initMcpServers(servers?: Record<string, McpServerConfig>): Promise<void> {
    // Auto-register CodeGraph MCP when the project has a .codegraph/ index.
    // User-configured servers (from settings) take precedence over auto-detection.
    const codegraphServers = getCodeGraphMcpServers(this.projectRoot);
    const mergedServers = codegraphServers ? { ...codegraphServers, ...servers } : servers;

    this.mcpManager.setOnToolsListChanged(() => {
      this.mcpToolDefinitions = this.mcpManager.getMcpToolDefinitions();
    });
    // 设置状态变更回调，通知 UI 更新
    this.mcpManager.setOnStatusChanged(() => {
      this.onMcpStatusChanged?.();
    });
    await this.mcpManager.initialize(mergedServers);
    this.mcpToolDefinitions = this.mcpManager.getMcpToolDefinitions();
  }

  getMcpStatus() {
    return this.mcpManager.getStatus();
  }

  async reconnectMcpServer(name: string, config?: McpServerConfig): Promise<void> {
    await this.mcpManager.reconnect(name, config);
    this.mcpToolDefinitions = this.mcpManager.getMcpToolDefinitions();
  }

  dispose(): void {
    this.mcpManager.disconnect();
  }

  private get llmCallbacks(): llmStream.ChatCompletionStreamCallbacks {
    return { onLlmStreamProgress: this.onLlmStreamProgress };
  }

  // Pre-compiled CJK character regex for performance
  private static readonly CJK_RE = /[㐀-鿿豈-﫿]/gu;

  private estimateStreamTokens(text: string): number {
    return llmStream.estimateStreamTokens(text);
  }

  private formatEstimatedTokens(tokens: number): string {
    return llmStream.formatEstimatedTokens(tokens);
  }

  private emitLlmStreamProgress(
    requestId: string,
    startedAt: string,
    estimatedTokens: number,
    phase: LlmStreamProgress["phase"],
    sessionId?: string,
    transport?: LlmStreamProgress["transport"],
    telemetry?: Pick<LlmStreamProgress, "attempt" | "maxAttempts" | "timeoutMs" | "lastError" | "model">
  ): void {
    this.onLlmStreamProgress?.({
      requestId,
      sessionId,
      startedAt,
      estimatedTokens: Math.round(estimatedTokens),
      formattedTokens: this.formatEstimatedTokens(estimatedTokens),
      phase,
      transport,
      ...telemetry,
    });
  }

  private isAbortLikeError(error: unknown): boolean {
    return llmStream.isAbortLikeError(error);
  }

  private throwIfAborted(signal?: AbortSignal | null): void {
    llmStream.throwIfAborted(signal);
  }

  private async createChatCompletionStream(
    client: NonNullable<ReturnType<CreateOpenAIClient>["client"]>,
    request: Record<string, unknown>,
    options?: Record<string, unknown>,
    sessionId?: string,
    debug?: ChatCompletionDebugOptions
  ): Promise<{
    choices?: Array<{ message?: Record<string, unknown> }>;
    usage?: ModelUsage | null;
  }> {
    return llmStream.createChatCompletionStream(this.llmCallbacks, client, request, options, sessionId, debug);
  }

  private isLiMaRouterBlockedError(error: unknown): boolean {
    return llmStream.isLiMaRouterBlockedError(error);
  }

  private buildLiMaRouterBlockedFallbackRequest(request: Record<string, unknown>): Record<string, unknown> {
    return llmStream.buildLiMaRouterBlockedFallbackRequest(request);
  }

  private buildLiMaRouterBlockedLocalResponse(
    initialError: unknown,
    fallbackError: unknown
  ): { choices: Array<{ message: Record<string, unknown> }>; usage: null } {
    return llmStream.buildLiMaRouterBlockedLocalResponse(initialError, fallbackError);
  }

  private getLastTextMessageContent(messages: unknown, role: string): string {
    return llmStream.getLastTextMessageContent(messages, role);
  }

  private logChatCompletionDebug(
    debug: ChatCompletionDebugOptions | undefined,
    entry: Parameters<typeof logOpenAIChatCompletionDebug>[0]
  ): void {
    llmStream.logChatCompletionDebug(debug, entry);
  }

  async identifyMatchingSkillNames(
    skills: SkillInfo[],
    userPrompt: string,
    options?: { signal?: AbortSignal; sessionId?: string }
  ): Promise<string[]> {
    this.throwIfAborted(options?.signal);
    let systemPrompt = `When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.\n
Response in JSON format:
\`\`\`
{
  "skillNames": ["", ...]
}
\`\`\`\n
If none of the available skills match, respond with an empty array, i.e. \`{"skillNames": []}\`.\n
The candidate skills are as follows:\n\n`;
    const simpleSkills = skills
      .filter((x) => !x.isLoaded)
      .map((x) => {
        return { name: x.name, description: x.description };
      });
    if (simpleSkills.length === 0) {
      return [];
    }
    systemPrompt += "```\n" + JSON.stringify(simpleSkills, null, 2) + "\n```";

    const { client, model, baseURL, debugLogEnabled } = this.createOpenAIClient();
    if (isLiMaRouterBaseURL(baseURL)) {
      return this.identifyMatchingSkillNamesLocally(skills, userPrompt);
    }
    if (!client) {
      return [];
    }

    try {
      const response = await this.createChatCompletionStream(
        client,
        {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
        },
        options?.signal ? { signal: options.signal } : undefined,
        options?.sessionId,
        {
          enabled: debugLogEnabled,
          location: "SessionManager.identifyMatchingSkillNames",
          baseURL,
          params: { purpose: "skill-matching" },
        }
      );
      this.throwIfAborted(options?.signal);

      const rawContent = response.choices?.[0]?.message?.content;
      const content = typeof rawContent === "string" ? rawContent : "";
      if (!content) {
        return [];
      }

      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.skillNames)) {
        return parsed.skillNames;
      }

      return [];
    } catch (error) {
      if (this.isAbortLikeError(error) || options?.signal?.aborted) {
        throw error;
      }
      return [];
    }
  }

  private identifyMatchingSkillNamesLocally(skills: SkillInfo[], userPrompt: string): string[] {
    const prompt = userPrompt.trim().toLowerCase();
    if (!prompt) {
      return [];
    }

    const unloaded = skills.filter((skill) => !skill.isLoaded);
    const selected: SkillInfo[] = [];

    for (const skill of unloaded) {
      if (prompt.includes(skill.name.toLowerCase())) {
        selected.push(skill);
      }
    }

    return selected.slice(0, 3).map((skill) => skill.name);
  }

  async listSkills(sessionId?: string): Promise<SkillInfo[]> {
    const homeDir = os.homedir();
    const agentsRoot = path.join(homeDir, ".agents", "skills");
    const legacyProjectSkillsRoot = path.join(this.projectRoot, ".deepcode", "skills");
    const projectAgentsSkillsRoot = path.join(this.projectRoot, ".agents", "skills");
    const skillsByName = new Map<string, SkillInfo>();

    const collectSkills = (root: string, displayRoot: string): SkillInfo[] => {
      if (!fs.existsSync(root)) {
        return [];
      }
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        return [];
      }

      const results: SkillInfo[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) {
          continue;
        }
        const skillName = entry.name;
        const skillPath = path.join(root, skillName, "SKILL.md");
        try {
          if (!fs.existsSync(skillPath)) {
            continue;
          }
          const stat = fs.statSync(skillPath);
          if (!stat.isFile()) {
            continue;
          }
        } catch {
          continue;
        }
        results.push(this.readSkillInfo(skillPath, `${displayRoot}/${skillName}/SKILL.md`, skillName));
      }
      return results;
    };

    for (const skill of collectSkills(agentsRoot, "~/.agents/skills")) {
      skillsByName.set(skill.name, skill);
    }
    for (const skill of collectSkills(legacyProjectSkillsRoot, "./.deepcode/skills")) {
      skillsByName.set(skill.name, skill);
    }
    for (const skill of collectSkills(projectAgentsSkillsRoot, "./.agents/skills")) {
      skillsByName.set(skill.name, skill);
    }

    if (sessionId) {
      const loadedSkillKeys = this.getLoadedSkillKeys(sessionId);
      for (const skill of skillsByName.values()) {
        if (loadedSkillKeys.has(this.getSkillKey(skill)) || loadedSkillKeys.has(this.getSkillKeyByName(skill.name))) {
          skill.isLoaded = true;
        }
      }
    }

    return Array.from(skillsByName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  private resolveSkillPath(skillPath: string): string {
    if (skillPath.startsWith("~/")) {
      return path.join(os.homedir(), skillPath.slice(2));
    }
    if (skillPath.startsWith("~\\")) {
      return path.join(os.homedir(), skillPath.slice(2));
    }
    if (skillPath.startsWith("./")) {
      return path.join(this.projectRoot, skillPath.slice(2));
    }
    if (skillPath.startsWith(".\\")) {
      return path.join(this.projectRoot, skillPath.slice(2));
    }
    if (path.isAbsolute(skillPath)) {
      return skillPath;
    }
    return path.join(os.homedir(), skillPath);
  }

  private readSkillInfo(skillPath: string, displayPath: string, fallbackName: string): SkillInfo {
    const fallbackSkill: SkillInfo = {
      name: fallbackName.replace(/_/g, "-"),
      path: displayPath,
      description: "",
    };

    try {
      const skillMd = fs.readFileSync(skillPath, "utf8");
      const parsed = matter(skillMd);
      return {
        name:
          typeof parsed.data.name === "string" && parsed.data.name.trim()
            ? parsed.data.name.trim()
            : fallbackSkill.name,
        path: displayPath,
        description: typeof parsed.data.description === "string" ? parsed.data.description.trim() : "",
      };
    } catch {
      return fallbackSkill;
    }
  }

  private getSkillKey(skill: Pick<SkillInfo, "path">): string {
    return `path:${skill.path}`;
  }

  private getSkillKeyByName(name: string): string {
    return `name:${name}`;
  }

  private getLoadedSkillKeys(sessionId: string): Set<string> {
    const loadedSkillKeys = new Set<string>();
    for (const message of this.listSessionMessages(sessionId)) {
      if (message.role !== "system" || !message.meta?.skill) {
        continue;
      }
      loadedSkillKeys.add(this.getSkillKey(message.meta.skill));
      loadedSkillKeys.add(this.getSkillKeyByName(message.meta.skill.name));
    }
    return loadedSkillKeys;
  }

  private dedupeSkills(skills?: SkillInfo[]): SkillInfo[] | undefined {
    if (!skills || skills.length === 0) {
      return undefined;
    }

    const dedupedSkills = new Map<string, SkillInfo>();
    for (const skill of skills) {
      if (!skill?.name || !skill?.path) {
        continue;
      }
      const key = this.getSkillKey(skill);
      const existingSkill = dedupedSkills.get(key);
      dedupedSkills.set(key, {
        ...existingSkill,
        ...skill,
        description: skill.description ?? existingSkill?.description ?? "",
        isLoaded: Boolean(existingSkill?.isLoaded || skill.isLoaded),
      });
    }

    return Array.from(dedupedSkills.values());
  }

  private async normalizeSkills(skills?: SkillInfo[], sessionId?: string): Promise<SkillInfo[] | undefined> {
    const dedupedSkills = this.dedupeSkills(skills);
    if (!dedupedSkills || dedupedSkills.length === 0) {
      return undefined;
    }

    const availableSkills = await this.listSkills(sessionId);
    const availableSkillsByKey = new Map<string, SkillInfo>();
    for (const skill of availableSkills) {
      availableSkillsByKey.set(this.getSkillKey(skill), skill);
      availableSkillsByKey.set(this.getSkillKeyByName(skill.name), skill);
    }

    return dedupedSkills.map((skill) => {
      const matchedSkill =
        availableSkillsByKey.get(this.getSkillKey(skill)) ??
        availableSkillsByKey.get(this.getSkillKeyByName(skill.name));
      if (!matchedSkill) {
        return skill;
      }
      return {
        ...matchedSkill,
        ...skill,
        description: matchedSkill.description || skill.description,
        isLoaded: Boolean(matchedSkill.isLoaded || skill.isLoaded),
      };
    });
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  setActiveSessionId(sessionId: string | null): void {
    this.activeSessionId = sessionId;
  }

  addSessionSystemMessage(sessionId: string, content: string, visible?: boolean, meta?: MessageMeta): void {
    const message = this.buildSystemMessage(sessionId, content, null, visible, meta);
    if (sessionId) this.appendSessionMessage(sessionId, message);
    this.onAssistantMessage(message, false);
  }

  async handleUserPrompt(userPrompt: UserPromptContent): Promise<void> {
    const controller = new AbortController();
    this.activePromptController = controller;

    try {
      if (!this.activeSessionId || !this.getSession(this.activeSessionId)) {
        await this.createSession(userPrompt, controller);
      } else {
        await this.replySession(this.activeSessionId, userPrompt, controller);
      }
    } catch (error) {
      if (!this.isAbortLikeError(error) && !controller.signal.aborted) {
        throw error;
      }
    } finally {
      if (this.activePromptController === controller) {
        this.activePromptController = null;
      }
    }
  }

  async createSession(userPrompt: UserPromptContent, controller?: AbortController): Promise<string> {
    const signal = controller?.signal;
    this.throwIfAborted(signal);

    const sessionId = crypto.randomUUID();
    this.ensureFileHistorySession(sessionId);
    const now = new Date().toISOString();
    const index = this.loadSessionsIndex();
    const entry: SessionEntry = {
      id: sessionId,
      summary: userPrompt.text ? userPrompt.text.slice(0, 100) : "[Image Prompt]",
      assistantReply: null,
      assistantThinking: null,
      assistantRefusal: null,
      toolCalls: null,
      status: "pending",
      failReason: null,
      usage: null,
      usagePerModel: null,
      activeTokens: 0,
      createTime: now,
      updateTime: now,
      processes: null,
    };
    index.entries.push(entry);
    const sortedEntries = index.entries.slice().sort((a, b) => {
      const aTime = Date.parse(a.updateTime);
      const bTime = Date.parse(b.updateTime);
      if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
        return b.updateTime.localeCompare(a.updateTime);
      }
      return bTime - aTime;
    });
    const keptEntries = sortedEntries.slice(0, MAX_SESSION_ENTRIES);
    const keptIds = new Set(keptEntries.map((item) => item.id));
    const droppedEntries = sortedEntries.filter((item) => !keptIds.has(item.id));
    index.entries = keptEntries;
    this.saveSessionsIndex(index);
    this.removeSessionMessages(droppedEntries.map((item) => item.id));

    const promptToolOptions = this.getPromptToolOptions();
    const systemPrompt = getSystemPrompt(this.projectRoot, promptToolOptions);
    const systemMessage = this.buildSystemMessage(sessionId, systemPrompt);
    this.appendSessionMessage(sessionId, systemMessage);

    const defaultSkillPrompt = getDefaultSkillPrompt();
    if (defaultSkillPrompt) {
      const defaultSkillMessage = this.buildSystemMessage(sessionId, defaultSkillPrompt);
      this.appendSessionMessage(sessionId, defaultSkillMessage);
    }

    const runtimeContextMessage = this.buildSystemMessage(
      sessionId,
      getRuntimeContext(this.projectRoot, promptToolOptions.model)
    );
    this.appendSessionMessage(sessionId, runtimeContextMessage);

    const agentInstructions = this.loadAgentInstructions();
    if (agentInstructions) {
      const instructionsMessage = this.buildSystemMessage(sessionId, agentInstructions);
      this.appendSessionMessage(sessionId, instructionsMessage);
    }

    const userMessage = this.buildUserMessage(sessionId, userPrompt);
    this.appendSessionMessage(sessionId, userMessage);

    if (userPrompt.text) {
      const skills = await this.listSkills();
      const skillNames = await this.identifyMatchingSkillNames(skills, userPrompt.text, { signal });
      this.throwIfAborted(signal);
      const skillSet = new Set(skillNames);
      const matchedSkill = skills.filter((skill) => skillSet.has(skill.name));
      if (Array.isArray(userPrompt.skills)) {
        userPrompt.skills.push(...matchedSkill);
      } else if (matchedSkill.length > 0) {
        userPrompt.skills = matchedSkill;
      }
    }
    userPrompt.skills = await this.normalizeSkills(userPrompt.skills);
    this.throwIfAborted(signal);

    if (userPrompt.skills && userPrompt.skills.length > 0) {
      for (const skill of userPrompt.skills) {
        if (skill.isLoaded) {
          continue;
        }
        const skillMd = fs.readFileSync(this.resolveSkillPath(skill.path), "utf8");
        const skillPrompt = `以下技能文档用于辅助完成当前任务：\n
<${skill.name}-skill path="${this.resolveSkillPath(skill.path)}">
${skillMd}
</${skill.name}-skill>`;
        const skillMessage = this.buildSkillMessage(sessionId, skillPrompt, skill);
        this.appendSessionMessage(sessionId, skillMessage);
        this.onAssistantMessage(skillMessage, true);
      }
    }

    this.activeSessionId = sessionId;
    await this.activateSession(sessionId, controller);
    return sessionId;
  }

  async replySession(sessionId: string, userPrompt: UserPromptContent, controller?: AbortController): Promise<void> {
    const signal = controller?.signal;
    this.throwIfAborted(signal);
    const now = new Date().toISOString();
    const updated = this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "pending",
      failReason: null,
      updateTime: now,
    }));

    if (!updated) {
      await this.createSession(userPrompt, controller);
      return;
    }

    if (this.isContinuePrompt(userPrompt)) {
      this.activeSessionId = sessionId;
      await this.activateSession(sessionId, controller);
      return;
    }

    this.ensureFileHistorySession(sessionId);
    const userMessage = this.buildUserMessage(sessionId, userPrompt);
    this.appendSessionMessage(sessionId, userMessage);

    if (userPrompt.text) {
      const skills = await this.listSkills(sessionId);
      const skillNames = await this.identifyMatchingSkillNames(skills, userPrompt.text, { signal, sessionId });
      this.throwIfAborted(signal);
      const skillSet = new Set(skillNames);
      const matchedSkill = skills.filter((skill) => skillSet.has(skill.name));
      if (Array.isArray(userPrompt.skills)) {
        userPrompt.skills.push(...matchedSkill);
      } else if (matchedSkill.length > 0) {
        userPrompt.skills = matchedSkill;
      }
    }
    userPrompt.skills = await this.normalizeSkills(userPrompt.skills, sessionId);
    this.throwIfAborted(signal);

    if (userPrompt.skills && userPrompt.skills.length > 0) {
      for (const skill of userPrompt.skills) {
        if (skill.isLoaded) {
          continue;
        }
        const skillMd = fs.readFileSync(this.resolveSkillPath(skill.path), "utf8");
        const skillPrompt = `以下技能文档用于辅助完成当前任务：\n
<${skill.name}-skill path="${this.resolveSkillPath(skill.path)}">
${skillMd}
</${skill.name}-skill>`;
        const skillMessage = this.buildSkillMessage(sessionId, skillPrompt, skill);
        this.appendSessionMessage(sessionId, skillMessage);
        this.onAssistantMessage(skillMessage, true);
      }
    }
    this.activeSessionId = sessionId;
    await this.activateSession(sessionId, controller);
  }

  private isContinuePrompt(userPrompt: UserPromptContent): boolean {
    return (
      typeof userPrompt.text === "string" &&
      userPrompt.text.trim() === "/continue" &&
      (!userPrompt.imageUrls || userPrompt.imageUrls.length === 0) &&
      (!userPrompt.skills || userPrompt.skills.length === 0)
    );
  }

  async activateSession(sessionId: string, controller?: AbortController): Promise<void> {
    const startedAt = Date.now();
    const { client, model, baseURL, thinkingEnabled, reasoningEffort, debugLogEnabled, notify, env } =
      this.createOpenAIClient();
    const now = new Date().toISOString();

    if (!client) {
      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: "failed",
        failReason: "OpenAI API key not found",
        updateTime: now,
      }));
      this.onAssistantMessage(
        this.buildAssistantMessage(
          sessionId,
          "OpenAI API key not found. Please configure ~/.lima/settings.json or ./.lima/settings.json. Legacy .deepcode settings are still read as a fallback.",
          null
        ),
        false
      );
      this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
      return;
    }

    const sessionController = controller ?? new AbortController();
    if (sessionController.signal.aborted) {
      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: "interrupted",
        failReason: "interrupted",
        updateTime: now,
      }));
      this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
      return;
    }

    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "processing",
      updateTime: now,
    }));

    this.sessionControllers.set(sessionId, sessionController);

    try {
      const maxIterations = DEFAULT_MAX_MODEL_ITERATIONS;
      let toolCalls: unknown[] | null = null;

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (this.isInterrupted(sessionId)) {
          return;
        }

        const session = this.getSession(sessionId);
        if (session == null || session.status === "interrupted" || session.status === "failed") {
          return;
        }

        const pendingToolCalls = this.getTrailingPendingToolCalls(this.listSessionMessages(sessionId));
        if (pendingToolCalls.length > 0) {
          const toolAppendResult = await this.appendToolMessages(sessionId, pendingToolCalls);
          if (this.isInterrupted(sessionId)) {
            return;
          }
          if (toolAppendResult.waitingForUser) {
            this.updateSessionEntry(sessionId, (entry) => ({
              ...entry,
              toolCalls: pendingToolCalls,
              status: "waiting_for_user",
              updateTime: new Date().toISOString(),
            }));
            return;
          }
        }

        const compactPromptTokenThreshold = getCompactPromptTokenThreshold(model);
        if (session.activeTokens > compactPromptTokenThreshold) {
          const message = this.buildAssistantMessage(
            sessionId,
            "The conversation is getting long, compacting...",
            null
          );
          message.meta = { asThinking: true };
          this.onAssistantMessage(message, false);
          await this.compactSession(sessionId, sessionController.signal);
        }

        const messages = this.buildProviderOpenAIMessages(
          this.listSessionMessages(sessionId),
          thinkingEnabled,
          model,
          baseURL
        );
        const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort);
        const response = await this.createChatCompletionStream(
          client,
          {
            model,
            messages,
            tools: getTools(this.getPromptToolOptions(), this.mcpToolDefinitions),
            ...thinkingOptions,
          },
          { signal: sessionController.signal },
          sessionId,
          {
            enabled: debugLogEnabled,
            location: "SessionManager.activateSession",
            baseURL,
            params: { iteration, thinkingEnabled, reasoningEffort },
          }
        );

        const message = response.choices?.[0]?.message;
        const rawContent = message?.content;
        let content = typeof rawContent === "string" ? rawContent : "";
        const rawToolCalls = (message as { tool_calls?: unknown[] } | undefined)?.tool_calls ?? null;
        toolCalls = this.normalizeLlmToolCalls(rawToolCalls);
        const rawThinking = (message as { reasoning_content?: unknown } | undefined)?.reasoning_content;
        const thinking = typeof rawThinking === "string" ? rawThinking : null;
        const refusal = (message as { refusal?: string } | undefined)?.refusal ?? null;
        const repeatedToolCallLoopMessage = this.getRepeatedToolCallLoopMessage(
          this.listSessionMessages(sessionId),
          toolCalls
        );

        // Strip verbose thinking that some backends return as content
        if (content && !thinking) {
          content = this.stripThinkingContent(content);
        }
        if (repeatedToolCallLoopMessage) {
          content = repeatedToolCallLoopMessage;
          toolCalls = null;
        }
        // const html = content ? this.renderMarkdown(content) : "";

        const emptyAssistantResponse = !content.trim() && !thinking?.trim() && !toolCalls && !refusal;
        if (emptyAssistantResponse) {
          content = EMPTY_ASSISTANT_RESPONSE_MESSAGE;
        }

        if (this.isInterrupted(sessionId)) {
          return;
        }
        const assistantMessage = this.buildAssistantMessage(sessionId, content, toolCalls, thinking);
        this.appendSessionMessage(sessionId, assistantMessage);
        this.onAssistantMessage(assistantMessage, true);

        let waitingForUser = false;
        if (toolCalls) {
          const toolAppendResult = await this.appendToolMessages(sessionId, toolCalls);
          waitingForUser = toolAppendResult.waitingForUser;
        }

        if (this.isInterrupted(sessionId)) {
          return;
        }

        const responseUsage = response.usage ?? null;
        this.updateSessionEntry(sessionId, (entry) => ({
          ...entry,
          assistantReply: content,
          assistantThinking: thinking,
          assistantRefusal: refusal,
          toolCalls,
          usage: accumulateUsage(entry.usage, responseUsage),
          usagePerModel: accumulateUsagePerModel(entry.usagePerModel, model, responseUsage),
          activeTokens: getTotalTokens(responseUsage),
          status:
            refusal || emptyAssistantResponse
              ? "failed"
              : waitingForUser
                ? "waiting_for_user"
                : toolCalls
                  ? "processing"
                  : "completed",
          failReason: refusal ? refusal : emptyAssistantResponse ? EMPTY_ASSISTANT_RESPONSE_MESSAGE : entry.failReason,
          updateTime: new Date().toISOString(),
        }));

        if (refusal) {
          return;
        }

        if (waitingForUser) {
          return;
        }

        if (!toolCalls) {
          return;
        }
      }

      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: "completed",
        updateTime: new Date().toISOString(),
      }));
      this.onAssistantMessage(
        this.buildAssistantMessage(
          sessionId,
          "The AI agent has taken several steps but hasn't reached a conclusion yet. Do you want to continue?",
          null
        ),
        false
      );
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      const aborted = this.isAbortLikeError(error) || sessionController.signal.aborted;
      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: aborted ? "interrupted" : "failed",
        failReason: aborted ? "interrupted" : errMessage,
        updateTime: new Date().toISOString(),
      }));

      if (!aborted) {
        this.onAssistantMessage(this.buildAssistantMessage(sessionId, `请求失败: ${errMessage}`, null), false);
      }
    } finally {
      if (this.sessionControllers.get(sessionId) === sessionController) {
        this.sessionControllers.delete(sessionId);
      }
      this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
    }
  }

  /**
   * Context-aware compaction with token boundary finding, skill pin preservation,
   * and pinned constraint extraction (ported from MiMo-Reasonix ContextManager).
   */
  async compactSession(sessionId: string, signal?: AbortSignal): Promise<void> {
    this.throwIfAborted(signal);
    const { client, model, baseURL, thinkingEnabled, reasoningEffort, debugLogEnabled } = this.createOpenAIClient();
    if (!client) {
      return;
    }
    const sessionMessages = this.listSessionMessages(sessionId).filter((message) => !message.compacted);
    if (sessionMessages.length === 0) {
      return;
    }

    const startIndex = sessionMessages.findIndex((message) => message.role !== "system");
    if (startIndex === -1) {
      return;
    }

    // Token-aware boundary finding (ported from ContextManager.fold):
    // Scan backwards from end, accumulate token estimates, find the user-message
    // boundary that fits within the tail budget (20% of ctxMax = ~25K for 128K models).
    const ctxMax = DEEPSEEK_V4_MODELS.has(model) ? 512 * 1024 : 128 * 1024;
    const tailBudget = Math.floor(ctxMax * 0.2);
    const tokenEstimates = sessionMessages.map((m) => {
      let n = this.estimateStreamTokens(typeof m.content === "string" ? m.content : "");
      const messageParams = m.messageParams as { tool_calls?: unknown[] } | null;
      if (m.role === "assistant" && Array.isArray(messageParams?.tool_calls) && messageParams.tool_calls.length > 0) {
        n += this.estimateStreamTokens(JSON.stringify(messageParams.tool_calls));
      }
      return n;
    });
    const totalEstimate = tokenEstimates.reduce((a, b) => a + b, 0);

    let cumTokens = 0;
    let endIndex = sessionMessages.length;
    for (let i = sessionMessages.length - 1; i >= startIndex; i--) {
      if (cumTokens + tokenEstimates[i]! > tailBudget) break;
      cumTokens += tokenEstimates[i]!;
      if (sessionMessages[i]!.role === "user") endIndex = i;
    }
    // Fallback: if token-aware scan didn't find a good boundary (e.g., all
    // messages are very short, which happens in tests with minimal content),
    // use the old hardcoded 2/3 split so compaction still works.
    if (endIndex <= startIndex || endIndex >= sessionMessages.length) {
      const searchStart = Math.floor(startIndex + ((sessionMessages.length - startIndex) * 2) / 3);
      endIndex = sessionMessages.length;
      for (let i = Math.max(searchStart, startIndex); i < sessionMessages.length; i += 1) {
        if (sessionMessages[i]!.role !== "tool") {
          endIndex = i;
          break;
        }
      }
    }
    if (endIndex <= startIndex || endIndex >= sessionMessages.length) {
      return;
    }
    const headTokens = totalEstimate - cumTokens;
    if (headTokens < totalEstimate * 0.3) return; // refuse if savings < 30%

    const compactPrompt = getCompactPrompt(sessionMessages.slice(startIndex, endIndex));
    const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort);

    // 15s hard timeout for fold summary (ported from ContextManager.summarizeForFold)
    const foldCtrl = new AbortController();
    const timeout = setTimeout(() => foldCtrl.abort(), 15_000);
    const summaryPromise = this.createChatCompletionStream(
      client,
      {
        model,
        messages: [{ role: "user", content: compactPrompt }],
        ...thinkingOptions,
      },
      signal ? { signal: anySignal(signal, foldCtrl.signal) } : { signal: foldCtrl.signal },
      sessionId,
      {
        enabled: debugLogEnabled,
        location: "SessionManager.compactSession",
        baseURL,
        params: { thinkingEnabled, reasoningEffort },
      }
    );

    let response;
    try {
      response = await summaryPromise;
    } catch {
      return; // timeout or abort — skip fold
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    this.throwIfAborted(signal);
    const rawLlmResponse = response.choices?.[0]?.message?.content;
    const llmResponse = typeof rawLlmResponse === "string" ? rawLlmResponse : "";
    const compactedSummary = llmResponse.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "").trim();

    const now = new Date().toISOString();
    const responseUsage = response.usage ?? null;
    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      usage: accumulateUsage(entry.usage, responseUsage),
      usagePerModel: accumulateUsagePerModel(entry.usagePerModel, model, responseUsage),
      activeTokens: getTotalTokens(responseUsage),
      updateTime: now,
    }));

    for (let i = startIndex; i < endIndex; i += 1) {
      sessionMessages[i] = { ...sessionMessages[i], compacted: true, updateTime: now };
    }

    // Cache-friendly: use "assistant" role so the system prompt stays as the ONLY
    // system message, preserving the immutable prefix for prompt caching (>99% hit rate).
    // Pinned constraints (HIGH PRIORITY / User memory / Project memory) are appended
    // so critical instructions survive the fold — same pattern as MiMo-Reasonix.
    const pinned = extractPinnedConstraints(this.getSystemPromptText());
    const pinnedTail = pinned ? `\n\n[PINNED CONSTRAINTS — preserved across compaction]\n\n${pinned}` : "";
    const summaryContent = `Earlier conversation summary:\n\n${compactedSummary}${pinnedTail}`;
    const summaryMessage: SessionMessage = {
      id: crypto.randomUUID(),
      sessionId,
      role: "assistant",
      content: summaryContent,
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: now,
      updateTime: now,
      meta: {
        isSummary: true,
      },
    };
    sessionMessages.splice(endIndex, 0, summaryMessage);
    this.saveSessionMessages(sessionId, sessionMessages);
  }

  private getPromptToolOptions(): { model: string; webSearchEnabled: boolean } {
    return {
      model: this.getResolvedSettings().model,
      webSearchEnabled: true,
    };
  }

  /**
   * Get the current system prompt text for pinned constraint extraction.
   * Used by compactSession to preserve critical instructions across folds.
   * Ported from MiMo-Reasonix cache-first pattern.
   */
  private getSystemPromptText(): string {
    return getSystemPrompt(this.projectRoot, this.getPromptToolOptions());
  }

  interruptActiveSession(): void {
    const controller = this.activePromptController;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }

    const sessionId = this.activeSessionId;
    if (sessionId) {
      this.interruptSession(sessionId);
    }
  }

  interruptSession(sessionId: string): void {
    const session = this.getSession(sessionId);
    const processIds = this.getProcessIds(session?.processes ?? null);
    const killedPids: number[] = [];
    const failedPids: number[] = [];
    for (const pid of processIds) {
      this.processTimeoutControls.delete(this.getProcessControlKey(sessionId, pid));
      if (killProcessTree(pid, "SIGKILL")) {
        killedPids.push(pid);
        continue;
      }
      failedPids.push(pid);
    }

    const controller = this.sessionControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.sessionControllers.delete(sessionId);
    }

    const now = new Date().toISOString();
    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "interrupted",
      failReason: "interrupted",
      processes: null,
      updateTime: now,
    }));

    const contentParts = ["Interrupted."];
    if (killedPids.length > 0) {
      contentParts.push(`Killed processes: ${killedPids.join(", ")}.`);
    }
    if (failedPids.length > 0) {
      contentParts.push(`Failed to kill processes: ${failedPids.join(", ")}.`);
    }

    this.onAssistantMessage(this.buildUserMessage(sessionId, { text: contentParts.join(" ") }), false);
  }

  private isInterrupted(sessionId: string): boolean {
    return !this.sessionControllers.has(sessionId);
  }

  adjustActiveBashTimeout(deltaMs: number): BashTimeoutAdjustment | null {
    const sessionId = this.activeSessionId;
    if (!sessionId || !Number.isFinite(deltaMs)) {
      return null;
    }
    const session = this.getSession(sessionId);
    if (!session?.processes) {
      return null;
    }

    let selectedPid: string | null = null;
    for (const pid of session.processes.keys()) {
      if (this.processTimeoutControls.has(this.getProcessControlKey(sessionId, pid))) {
        selectedPid = pid;
      }
    }
    if (!selectedPid) {
      return null;
    }

    const control = this.processTimeoutControls.get(this.getProcessControlKey(sessionId, selectedPid));
    if (!control) {
      return null;
    }

    const current = control.getInfo();
    const next = control.setTimeoutMs(current.timeoutMs + deltaMs);
    this.updateSessionProcessTimeout(sessionId, selectedPid, next);
    return this.buildBashTimeoutAdjustment(selectedPid, next);
  }

  listSessions(): SessionEntry[] {
    const index = this.loadSessionsIndex();
    return index.entries;
  }

  getSession(sessionId: string): SessionEntry | null {
    const index = this.loadSessionsIndex();
    return index.entries.find((entry) => entry.id === sessionId) ?? null;
  }

  listSessionMessages(sessionId: string): SessionMessage[] {
    return sessionStorage.listSessionMessages(this.projectRoot, sessionId);
  }

  listUndoTargets(sessionId: string): UndoTarget[] {
    return this.listSessionMessages(sessionId)
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => this.isUndoTargetMessage(message))
      .map(({ message, index }) => ({
        message,
        index,
        canRestoreCode: Boolean(
          message.checkpointHash && this.canRestoreCheckpointHash(sessionId, message.checkpointHash)
        ),
      }));
  }

  restoreSessionConversation(sessionId: string, messageId: string): SessionMessage[] {
    const messages = this.listSessionMessages(sessionId);
    const targetIndex = messages.findIndex((message) => message.id === messageId);
    if (targetIndex === -1) {
      throw new Error("Selected message was not found in this session.");
    }

    const keptMessages = messages.slice(0, targetIndex);
    this.saveSessionMessages(sessionId, keptMessages);
    const now = new Date().toISOString();
    const latestAssistant = [...keptMessages].reverse().find((message) => message.role === "assistant");
    const latestAssistantParams = latestAssistant?.messageParams as
      | { tool_calls?: unknown[]; reasoning_content?: string }
      | null
      | undefined;

    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      assistantReply: latestAssistant?.content ?? null,
      assistantThinking:
        typeof latestAssistantParams?.reasoning_content === "string" ? latestAssistantParams.reasoning_content : null,
      assistantRefusal: null,
      toolCalls: null,
      status: "completed",
      failReason: null,
      processes: null,
      updateTime: now,
    }));
    return keptMessages;
  }

  restoreSessionCode(sessionId: string, messageId: string): void {
    const message = this.listSessionMessages(sessionId).find((item) => item.id === messageId);
    if (!message) {
      throw new Error("Selected message was not found in this session.");
    }
    if (!message.checkpointHash) {
      throw new Error("Selected message has no code checkpoint.");
    }
    this.restoreCheckpointHash(sessionId, message.checkpointHash);
  }

  private normalizeSessionMessage(message: SessionMessage): SessionMessage {
    if (message.role !== "tool") {
      return message;
    }

    const nextMeta = message.meta ? { ...message.meta } : undefined;
    const normalizedParamsMd = this.buildToolParamsSnippet(nextMeta?.function ?? null);
    if (nextMeta && normalizedParamsMd) {
      nextMeta.paramsMd = normalizedParamsMd;
    }

    const normalizedResultMd = typeof message.content === "string" ? this.buildToolResultSnippet(message.content) : "";
    if (nextMeta && normalizedResultMd) {
      nextMeta.resultMd = normalizedResultMd;
    }

    return {
      ...message,
      visible: typeof message.content === "string" ? !this.isInvisibleExecution(message.content) : message.visible,
      meta: nextMeta,
    };
  }

  private getProjectCode(projectRoot: string): string {
    return projectRoot.replace(/[\\/]/g, "-").replace(/:/g, "");
  }

  private getProjectStorage(): {
    projectCode: string;
    projectDir: string;
    sessionsIndexPath: string;
  } {
    const projectCode = this.getProjectCode(this.projectRoot);
    const projectDir = path.join(os.homedir(), ".deepcode", "projects", projectCode);
    const sessionsIndexPath = path.join(projectDir, "sessions-index.json");
    return { projectCode, projectDir, sessionsIndexPath };
  }

  private getFileHistory(): GitFileHistory {
    return new GitFileHistory(this.projectRoot, this.getFileHistoryGitDir());
  }

  private getFileHistoryGitDir(): string {
    const { projectDir } = this.getProjectStorage();
    return path.join(projectDir, "file-history", ".git");
  }

  private ensureFileHistorySession(sessionId: string): string | undefined {
    return this.getFileHistory().ensureSession(sessionId);
  }

  private getCurrentCheckpointHash(sessionId: string): string | undefined {
    return this.getFileHistory().getCurrentCheckpointHash(sessionId);
  }

  private prepareFileMutationCheckpoint(sessionId: string, filePath: string): void {
    const fileHistory = this.getFileHistory();
    const previousHash = fileHistory.ensureSession(sessionId);
    if (!previousHash) {
      return;
    }
    this.updateLatestUserCheckpointHash(sessionId, undefined, previousHash);
    const nextHash = fileHistory.recordCheckpoint(sessionId, [filePath], "Pre-mutation checkpoint");
    if (nextHash && nextHash !== previousHash) {
      this.updateLatestUserCheckpointHash(sessionId, previousHash, nextHash);
    }
  }

  private recordFileMutationCheckpoint(sessionId: string, filePath: string): void {
    const fileHistory = this.getFileHistory();
    fileHistory.ensureSession(sessionId);
    fileHistory.recordCheckpoint(sessionId, [filePath], "File mutation checkpoint");
  }

  private updateLatestUserCheckpointHash(sessionId: string, previousHash: string | undefined, nextHash: string): void {
    const messages = this.listSessionMessages(sessionId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || !this.isUndoTargetMessage(message)) {
        continue;
      }
      if (message.checkpointHash && message.checkpointHash !== previousHash) {
        return;
      }
      messages[index] = {
        ...message,
        checkpointHash: nextHash,
        updateTime: new Date().toISOString(),
      };
      this.saveSessionMessages(sessionId, messages);
      return;
    }
  }

  private canRestoreCheckpointHash(sessionId: string, checkpointHash: string): boolean {
    return this.getFileHistory().canRestore(sessionId, checkpointHash);
  }

  private restoreCheckpointHash(sessionId: string, checkpointHash: string): void {
    this.getFileHistory().restore(sessionId, checkpointHash);
  }

  private isUndoTargetMessage(message: SessionMessage): boolean {
    return sessionStorage.isUndoTargetMessage(message);
  }

  private loadSessionsIndex(): SessionsIndex {
    return sessionStorage.loadSessionsIndex(this.projectRoot);
  }

  private saveSessionsIndex(index: SessionsIndex): void {
    sessionStorage.saveSessionsIndex(this.projectRoot, index);
  }

  private getSessionMessagesPath(sessionId: string): string {
    return sessionStorage.getSessionMessagesPath(this.projectRoot, sessionId);
  }

  private removeSessionMessages(sessionIds: string[]): void {
    sessionStorage.removeSessionMessages(this.projectRoot, sessionIds);
  }

  private appendSessionMessage(sessionId: string, message: SessionMessage): void {
    sessionStorage.appendSessionMessage(this.projectRoot, sessionId, message);
  }

  private saveSessionMessages(sessionId: string, messages: SessionMessage[]): void {
    sessionStorage.saveSessionMessages(this.projectRoot, sessionId, messages);
  }

  private updateSessionEntry(sessionId: string, updater: (entry: SessionEntry) => SessionEntry): SessionEntry | null {
    const index = this.loadSessionsIndex();
    const entryIndex = index.entries.findIndex((entry) => entry.id === sessionId);
    if (entryIndex === -1) {
      return null;
    }

    const updated = updater({ ...index.entries[entryIndex] });
    index.entries[entryIndex] = updated;
    this.saveSessionsIndex(index);
    this.onSessionEntryUpdated?.(updated);
    return updated;
  }

  private buildUserMessage(sessionId: string, prompt: UserPromptContent): SessionMessage {
    const now = new Date().toISOString();
    const imageParams =
      prompt.imageUrls
        ?.filter((url) => Boolean(url))
        .map((url) => ({
          type: "image_url",
          image_url: { url },
        })) ?? [];

    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "user",
      content: prompt.text ?? "",
      contentParams: imageParams.length > 0 ? imageParams : null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: now,
      updateTime: now,
      checkpointHash: this.getCurrentCheckpointHash(sessionId),
    };
  }

  private renderInitCommandPrompt(): string {
    const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "init_command.md.ejs");
    const template = fs.readFileSync(templatePath, "utf8");
    return ejs.render(template, {
      agentsMdFile: this.getEffectiveProjectAgentsMdFile(),
    });
  }

  private getEffectiveProjectAgentsMdFile(): string | null {
    return this.loadProjectAgentInstructions()?.displayPath ?? null;
  }

  private loadProjectAgentInstructions(): { content: string; displayPath: string } | null {
    const candidatePaths = [
      {
        absolutePath: path.join(this.projectRoot, ".deepcode", "AGENTS.md"),
        displayPath: "./.deepcode/AGENTS.md",
      },
      {
        absolutePath: path.join(this.projectRoot, "AGENTS.md"),
        displayPath: "./AGENTS.md",
      },
    ];

    for (const candidatePath of candidatePaths) {
      const content = this.readNonEmptyFile(candidatePath.absolutePath);
      if (content) {
        return {
          content,
          displayPath: candidatePath.displayPath,
        };
      }
    }

    return null;
  }

  private readNonEmptyFile(filePath: string): string | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const content = fs.readFileSync(filePath, "utf8").trim();
      return content || null;
    } catch {
      return null;
    }
  }

  private loadAgentInstructions(): string | null {
    const projectInstructions = this.loadProjectAgentInstructions();
    if (projectInstructions) {
      return projectInstructions.content;
    }

    return this.readNonEmptyFile(path.join(os.homedir(), ".deepcode", "AGENTS.md"));
  }

  private buildSystemMessage(
    sessionId: string,
    content: string,
    contentParams: unknown | null = null,
    visible = false,
    meta?: MessageMeta
  ): SessionMessage {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "system",
      content,
      contentParams,
      messageParams: null,
      compacted: false,
      visible,
      createTime: now,
      updateTime: now,
      meta,
    };
  }

  private buildSkillMessage(sessionId: string, content: string, skill: SkillInfo): SessionMessage {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "system",
      content,
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: now,
      updateTime: now,
      meta: { skill: { ...skill, isLoaded: true } },
    };
  }

  private buildAssistantMessage(
    sessionId: string,
    content: string | null,
    toolCalls: unknown[] | null,
    reasoningContent?: string | null
  ): SessionMessage {
    const now = new Date().toISOString();
    const hasReasoningContent = reasoningContent != null;
    const messageParams: { tool_calls?: unknown[]; reasoning_content?: string } | null =
      toolCalls || hasReasoningContent ? {} : null;
    if (toolCalls) {
      messageParams!.tool_calls = toolCalls;
    }
    if (hasReasoningContent) {
      messageParams!.reasoning_content = reasoningContent;
    }
    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "assistant",
      content,
      contentParams: null,
      messageParams,
      compacted: false,
      visible: (content || reasoningContent || "").trim() ? true : false,
      createTime: now,
      updateTime: now,
      meta: toolCalls ? { asThinking: true } : undefined,
    };
  }

  private generateToolCallId(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  /**
   * Strip verbose thinking content that some backends return as the main content.
   * Detects Chinese/English thinking patterns and extracts the actual answer.
   */
  private stripThinkingContent(content: string): string {
    return messageBuilder.stripThinkingContent(content);
  }

  private normalizeLlmToolCalls(rawToolCalls: unknown[] | null | undefined): unknown[] | null {
    return llmStream.normalizeLlmToolCalls(rawToolCalls);
  }

  private getRepeatedToolCallLoopMessage(messages: SessionMessage[], toolCalls: unknown[] | null): string | null {
    return messageBuilder.getRepeatedToolCallLoopMessage(messages, toolCalls);
  }

  private getToolCallSignature(toolCall: unknown): string | null {
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
    const normalizedArgs = this.normalizeToolCallArguments(typeof args === "string" ? args : "");
    return `${name.trim()}:${normalizedArgs}`;
  }

  private normalizeToolCallArguments(args: string): string {
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

  private formatToolCallSignatureForDisplay(signature: string): string {
    return signature.length > 160 ? `${signature.slice(0, 157)}...` : signature;
  }

  private buildToolMessage(
    sessionId: string,
    toolCallId: string,
    content: string,
    toolFunction: unknown | null
  ): SessionMessage {
    const now = new Date().toISOString();
    const paramsMd = this.buildToolParamsSnippet(toolFunction);
    const resultMd = this.buildToolResultSnippet(content);
    const isInvisibleExecution = this.isInvisibleExecution(content);
    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "tool",
      content,
      contentParams: null,
      messageParams: { tool_call_id: toolCallId },
      compacted: false,
      visible: !isInvisibleExecution,
      createTime: now,
      updateTime: now,
      meta: {
        function: toolFunction ?? undefined,
        paramsMd,
        resultMd,
      },
    };
  }

  private async appendToolMessages(sessionId: string, toolCalls: unknown[]): Promise<{ waitingForUser: boolean }> {
    const toolExecutions = await this.toolExecutor.executeToolCalls(sessionId, toolCalls, {
      onProcessStart: (pid, command) => this.addSessionProcess(sessionId, pid, command),
      onProcessExit: (pid) => this.removeSessionProcess(sessionId, pid),
      onProcessStdout: (pid, chunk) => this.onProcessStdout?.(Number(pid), chunk),
      onProcessTimeoutControl: (pid, control) => this.setSessionProcessTimeoutControl(sessionId, pid, control),
      onBeforeFileMutation: (filePath) => this.prepareFileMutationCheckpoint(sessionId, filePath),
      onAfterFileMutation: (filePath) => this.recordFileMutationCheckpoint(sessionId, filePath),
      shouldStop: () => this.isInterrupted(sessionId),
    });
    if (this.isInterrupted(sessionId)) {
      return { waitingForUser: false };
    }
    let waitingForUser = false;
    const followUpMessages: SessionMessage[] = [];
    for (const execution of toolExecutions) {
      if (execution.result.awaitUserResponse === true) {
        waitingForUser = true;
      }
      const toolFunction = this.findToolFunction(toolCalls, execution.toolCallId);
      const toolMessage = this.buildToolMessage(sessionId, execution.toolCallId, execution.content, toolFunction);
      this.appendSessionMessage(sessionId, toolMessage);
      this.onAssistantMessage(toolMessage, true);

      for (const followUpMessage of execution.result.followUpMessages ?? []) {
        if (followUpMessage.role !== "system") {
          continue;
        }
        followUpMessages.push(
          this.buildSystemMessage(sessionId, followUpMessage.content, followUpMessage.contentParams ?? null)
        );
      }
    }

    for (const followUpMessage of followUpMessages) {
      this.appendSessionMessage(sessionId, followUpMessage);
    }
    return { waitingForUser };
  }

  private buildOpenAIMessages(
    messages: SessionMessage[],
    thinkingEnabled: boolean,
    model: string
  ): ChatCompletionMessageParam[] {
    const activeMessages = messages.filter((message) => !message.compacted);
    const toolPairings = this.pairToolMessages(activeMessages);
    const openAIMessages: ChatCompletionMessageParam[] = [];

    for (let index = 0; index < activeMessages.length; index += 1) {
      const message = activeMessages[index];
      if (message.role === "tool") {
        continue;
      }

      openAIMessages.push(this.sessionMessageToOpenAIMessage(message, thinkingEnabled, model));

      const toolCalls = this.getAssistantToolCalls(message);
      if (toolCalls.length === 0) {
        continue;
      }

      for (let toolCallIndex = 0; toolCallIndex < toolCalls.length; toolCallIndex += 1) {
        const toolCallId = this.getToolCallId(toolCalls[toolCallIndex]);
        if (!toolCallId) {
          continue;
        }

        const pairedToolIndex = toolPairings.get(this.buildToolPairingKey(index, toolCallIndex));
        if (pairedToolIndex != null) {
          openAIMessages.push(
            this.sessionMessageToOpenAIMessage(activeMessages[pairedToolIndex], thinkingEnabled, model)
          );
          continue;
        }

        openAIMessages.push(this.buildInterruptedOpenAIToolMessage(toolCalls, toolCallId));
      }
    }

    return openAIMessages;
  }

  private buildProviderOpenAIMessages(
    messages: SessionMessage[],
    thinkingEnabled: boolean,
    model: string,
    baseURL?: string
  ): ChatCompletionMessageParam[] {
    const agentsMdFile = this.getEffectiveProjectAgentsMdFile();
    return messageBuilder.buildProviderOpenAIMessages(messages, thinkingEnabled, model, baseURL, agentsMdFile);
  }

  private toLiMaRouterSafeMessage(message: ChatCompletionMessageParam): ChatCompletionMessageParam {
    const content = (message as { content?: unknown }).content;
    if (typeof content !== "string") {
      return message;
    }
    const safeContent = this.toLiMaRouterSafeText(content);
    if (safeContent === content) {
      return message;
    }
    return {
      ...message,
      content: safeContent,
    } as ChatCompletionMessageParam;
  }

  private toLiMaRouterSafeText(content: string): string {
    if (content.includes("# Available Tools")) {
      return LIMA_ROUTER_SAFE_SYSTEM_PROMPT;
    }
    if (content.includes("<agent-drift-guard-skill>") && content.includes("<plan-and-execute-skill>")) {
      return LIMA_ROUTER_SAFE_DEFAULT_SKILL_PROMPT;
    }
    if (!this.isLikelyProjectInstructionBlob(content)) {
      return content;
    }
    return `${LIMA_ROUTER_PROJECT_INSTRUCTION_SUMMARY}\n\nOriginal project instruction length: ${content.length} characters.`;
  }

  private isLikelyProjectInstructionBlob(content: string): boolean {
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

  private sessionMessageToOpenAIMessage(
    message: SessionMessage,
    thinkingEnabled: boolean,
    model: string
  ): ChatCompletionMessageParam {
    const content = this.renderOpenAIMessageContent(message);
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
      // Thinking-mode providers require every replayed assistant message
      // to include the reasoning_content field, even when it is empty.
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

  private renderOpenAIMessageContent(message: SessionMessage): string {
    if (message.role === "user" && message.content === "/init") {
      return this.renderInitCommandPrompt();
    }
    return message.content ?? "";
  }

  private pairToolMessages(messages: SessionMessage[]): Map<string, number> {
    const pairings = new Map<string, number>();
    const usedToolMessageIndexes = new Set<number>();

    for (let assistantIndex = 0; assistantIndex < messages.length; assistantIndex += 1) {
      const toolCalls = this.getAssistantToolCalls(messages[assistantIndex]);
      for (let toolCallIndex = 0; toolCallIndex < toolCalls.length; toolCallIndex += 1) {
        const toolCallId = this.getToolCallId(toolCalls[toolCallIndex]);
        if (!toolCallId) {
          continue;
        }

        const toolIndex = this.findPairableToolMessageIndex(
          messages,
          assistantIndex,
          toolCallId,
          usedToolMessageIndexes
        );
        if (toolIndex == null) {
          continue;
        }

        usedToolMessageIndexes.add(toolIndex);
        pairings.set(this.buildToolPairingKey(assistantIndex, toolCallIndex), toolIndex);
      }
    }

    return pairings;
  }

  private getTrailingPendingToolCalls(messages: SessionMessage[]): unknown[] {
    const activeMessages = messages.filter((message) => !message.compacted);
    const latestMessage = activeMessages[activeMessages.length - 1];
    if (!latestMessage || latestMessage.role !== "assistant") {
      return [];
    }

    const toolCalls = this.getAssistantToolCalls(latestMessage);
    if (toolCalls.length === 0) {
      return [];
    }
    return toolCalls.filter((toolCall) => Boolean(this.getToolCallId(toolCall)));
  }

  private findPairableToolMessageIndex(
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

      const candidateToolCallId = this.getToolMessageCallId(message);
      if (candidateToolCallId !== toolCallId) {
        continue;
      }

      if (firstMatchingIndex == null) {
        firstMatchingIndex = index;
      }
      if (!this.isInterruptedToolMessage(message)) {
        return index;
      }
    }
    return firstMatchingIndex;
  }

  private getAssistantToolCalls(message: SessionMessage): unknown[] {
    if (message.role !== "assistant") {
      return [];
    }
    const messageParams = message.messageParams as { tool_calls?: unknown[] } | null;
    return Array.isArray(messageParams?.tool_calls) ? messageParams.tool_calls : [];
  }

  private getToolCallId(toolCall: unknown): string | null {
    if (!toolCall || typeof toolCall !== "object") {
      return null;
    }
    const id = (toolCall as { id?: unknown }).id;
    return typeof id === "string" && id ? id : null;
  }

  private getToolMessageCallId(message: SessionMessage): string | null {
    const messageParams = message.messageParams as { tool_call_id?: unknown } | null;
    const toolCallId = messageParams?.tool_call_id;
    return typeof toolCallId === "string" && toolCallId ? toolCallId : null;
  }

  private buildToolPairingKey(assistantIndex: number, toolCallIndex: number): string {
    return `${assistantIndex}:${toolCallIndex}`;
  }

  private isInterruptedToolMessage(message: SessionMessage): boolean {
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

  private buildInterruptedOpenAIToolMessage(toolCalls: unknown[], toolCallId: string): ChatCompletionMessageParam {
    const toolFunction = this.findToolFunction(toolCalls, toolCallId);
    return {
      role: "tool",
      content: this.buildInterruptedToolResult(toolFunction, "Previous tool call did not complete."),
      tool_call_id: toolCallId,
    } as ChatCompletionMessageParam;
  }

  private findToolFunction(toolCalls: unknown[], toolCallId: string): unknown | null {
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

  private buildToolParamsSnippet(toolFunction: unknown | null): string {
    if (!toolFunction || typeof toolFunction !== "object") {
      return "";
    }
    const args = (toolFunction as { arguments?: unknown }).arguments;
    const toolName = (toolFunction as { name?: unknown }).name;
    if (typeof args !== "string") {
      return "";
    }
    const trimmed = args.trim();
    if (!trimmed) {
      return "";
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return this.formatToolParamsSnippet(
          typeof toolName === "string" ? toolName : null,
          parsed as Record<string, unknown>
        );
      }
    } catch {
      // fall back to raw string
    }
    return trimmed;
  }

  private formatToolParamsSnippet(toolName: string | null, args: Record<string, unknown>): string {
    if (toolName === "bash") {
      const command = typeof args.command === "string" ? args.command.trim() : "";
      const description = typeof args.description === "string" ? args.description.trim() : "";
      if (command && description) {
        return `${command}  # ${description}`;
      }
      if (command) {
        return command;
      }
      if (description) {
        return description;
      }
    } else if (toolName === "UpdatePlan") {
      return typeof args.explanation === "string" ? args.explanation.trim() : "";
    } else if (toolName === "write") {
      return typeof args.file_path === "string" ? args.file_path.trim() : "";
    }

    const firstKey = Object.keys(args)[0];
    if (!firstKey) {
      return "";
    }

    const value = args[firstKey];
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (toolName === "read" && text.startsWith(this.projectRoot)) {
      return text.slice(this.projectRoot.length).replace(/^[\\/]/, "");
    }
    return text;
  }

  private buildToolResultSnippet(content: string): string {
    const trimmed = content.trim();
    if (!trimmed) {
      return "";
    }

    const maxLength = 2000;

    try {
      const parsed = JSON.parse(content) as { output?: unknown };
      if (parsed.output !== undefined) {
        if (typeof parsed.output === "string") {
          return this.formatToolResultSnippet(parsed.output, maxLength);
        }
        return this.formatToolResultSnippet(JSON.stringify(parsed.output), maxLength);
      }
    } catch {
      // fall back to raw content
    }

    return this.formatToolResultSnippet(content, maxLength);
  }

  private formatToolResultSnippet(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength)}... (total ${value.length} chars)`;
  }

  private isInvisibleExecution(content: string): boolean {
    if (!content.trim()) {
      return false;
    }
    try {
      const parsed = JSON.parse(content) as { name?: unknown; ok?: unknown };
      return parsed.name === "bash" && parsed.ok !== true;
    } catch {
      return false;
    }
  }

  private maybeNotifyTaskCompletion(
    sessionId: string,
    notifyCommand: string | undefined,
    startedAt: number,
    configuredEnv: Record<string, string> = {}
  ): void {
    if (!notifyCommand) {
      return;
    }

    const session = this.getSession(sessionId);
    if (!session || (session.status !== "completed" && session.status !== "failed")) {
      return;
    }

    // Find the last assistant message body for the BODY env variable.
    let body: string | undefined;
    const messages = this.listSessionMessages(sessionId);
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && msg.role === "assistant" && msg.content) {
        body = msg.content;
        break;
      }
    }

    launchNotifyScript(notifyCommand, Date.now() - startedAt, this.projectRoot, undefined, configuredEnv, {
      status: session.status,
      failReason: session.failReason ?? undefined,
      body,
      title: session.summary ?? undefined,
    });
  }

  private addSessionProcess(sessionId: string, processId: string | number, command: string): void {
    const now = new Date().toISOString();
    this.updateSessionEntry(sessionId, (entry) => {
      const processes = new Map(entry.processes ?? []);
      processes.set(String(processId), { startTime: now, command });
      return {
        ...entry,
        processes,
        updateTime: now,
      };
    });
  }

  private removeSessionProcess(sessionId: string, processId: string | number): void {
    const now = new Date().toISOString();
    this.processTimeoutControls.delete(this.getProcessControlKey(sessionId, processId));
    this.updateSessionEntry(sessionId, (entry) => {
      const processes = new Map(entry.processes ?? []);
      processes.delete(String(processId));
      return {
        ...entry,
        processes: processes.size > 0 ? processes : null,
        updateTime: now,
      };
    });
  }

  private setSessionProcessTimeoutControl(
    sessionId: string,
    processId: string | number,
    control: ProcessTimeoutControl | null
  ): void {
    const key = this.getProcessControlKey(sessionId, processId);
    if (!control) {
      this.processTimeoutControls.delete(key);
      return;
    }

    this.processTimeoutControls.set(key, control);
    this.updateSessionProcessTimeout(sessionId, processId, control.getInfo());
  }

  private updateSessionProcessTimeout(sessionId: string, processId: string | number, info: ProcessTimeoutInfo): void {
    const now = new Date().toISOString();
    this.updateSessionEntry(sessionId, (entry) => {
      const processes = new Map(entry.processes ?? []);
      const pid = String(processId);
      const processInfo = processes.get(pid);
      if (!processInfo) {
        return entry;
      }
      processes.set(pid, {
        ...processInfo,
        timeoutMs: info.timeoutMs,
        deadlineAt: new Date(info.deadlineAtMs).toISOString(),
        timedOut: info.timedOut,
      });
      return {
        ...entry,
        processes,
        updateTime: now,
      };
    });
  }

  private buildBashTimeoutAdjustment(processId: string, info: ProcessTimeoutInfo): BashTimeoutAdjustment {
    return {
      processId,
      timeoutMs: info.timeoutMs,
      deadlineAt: new Date(info.deadlineAtMs).toISOString(),
      timedOut: info.timedOut,
    };
  }

  private getProcessControlKey(sessionId: string, processId: string | number): string {
    return `${sessionId}:${String(processId)}`;
  }

  private getProcessIds(processes: Map<string, SessionProcessEntry> | null): number[] {
    if (!processes) {
      return [];
    }
    const ids: number[] = [];
    for (const pid of processes.keys()) {
      const parsed = Number(pid);
      if (Number.isInteger(parsed) && parsed > 0) {
        ids.push(parsed);
      }
    }
    return ids;
  }

  private buildInterruptedToolResult(toolFunction: unknown | null, reason: string): string {
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

  private normalizeSessionEntry(entry: unknown): SessionEntry {
    return sessionStorage.normalizeSessionEntry(entry);
  }

  private normalizeSessionStatus(status: unknown): SessionStatus {
    return sessionStorage.normalizeSessionStatus(status);
  }

  private normalizeUsagePerModel(entry: Record<string, unknown>): Record<string, ModelUsage> | null {
    return sessionStorage.normalizeUsagePerModel(entry);
  }

  private deserializeProcesses(value: unknown): Map<string, SessionProcessEntry> | null {
    return sessionStorage.deserializeProcesses(value);
  }

  private serializeProcesses(
    processes: Map<string, SessionProcessEntry> | null
  ): Record<string, SessionProcessEntry> | null {
    return sessionStorage.serializeProcesses(processes);
  }
}
