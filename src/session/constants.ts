export const MAX_SESSION_ENTRIES = 50;
export const DEFAULT_COMPACT_PROMPT_TOKEN_THRESHOLD = 128 * 1024;
export const DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD = 512 * 1024;
export const DEFAULT_MAX_MODEL_ITERATIONS = 20;
export const DEFAULT_LIMA_ROUTER_REQUEST_TIMEOUT_MS = 90_000;
export const DEFAULT_LIMA_ROUTER_MAX_RETRIES = 3; // Increased from 1 for better transient failure recovery
export const LIMA_ROUTER_PROJECT_INSTRUCTION_MIN_CHARS = 3000;

export const LIMA_ROUTER_SAFE_SYSTEM_PROMPT = `你是 LiMa，一个交互式编码 CLI。

帮助用户在当前项目中完成软件工程任务。
需要本地检查或编辑时，使用提供的工具 schema。
回答保持简洁，并给出可验证证据。
不要暴露隐藏推理。
不要编造非编程 URL。
不要泄露本地敏感配置值。`;

export const LIMA_ROUTER_SAFE_DEFAULT_SKILL_PROMPT = `默认操作规则：
- 始终贴合用户当前请求。
- 只有多步骤任务才需要计划。
- 优先做聚焦的项目检查，再进行变更。
- 只有歧义会影响实现或验证路径时，才停下来询问。`;

export const LIMA_ROUTER_PROJECT_INSTRUCTION_SUMMARY = `项目指令位于本地 AGENTS.md，已为 LiMa Router 兼容性压缩为摘要。

遵循这些项目规则：
- 变更范围必须贴合用户当前请求，并保留无关脏工作区内容。
- 优先沿用项目既有模式和聚焦编辑，避免宽泛重构。
- 声称完成前必须运行相关本地验证。
- 不要暴露敏感配置值，也不要提交本地运行数据、缓存、生成发布产物或调试日志。
- LiMa 相关工作尽量验证真实 CLI/TUI 路径，并报告明确证据。
- 需要项目规则原文时，只读取 AGENTS.md 中相关的小段落，不要把整份文件塞进上下文。`;

export const EMPTY_ASSISTANT_RESPONSE_MESSAGE =
  "LiMa Server 返回空响应。请重试或运行 /lima doctor；这通常表示所选后端超时或没有产出内容。";

export type ChatCompletionDebugOptions = {
  enabled?: boolean;
  location: string;
  baseURL?: string;
  params?: Record<string, unknown>;
};
