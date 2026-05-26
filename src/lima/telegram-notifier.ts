export type LiMaTelegramConfig = {
  configured: boolean;
  botToken: string;
  chatId: string;
  proxyUrl: string;
  b2bEnabled: boolean;
  serverBotUsername: string;
};

export type LiMaTelegramEventType =
  | "task_started"
  | "task_finished"
  | "task_failed"
  | "task_needs_review"
  | "work_stopped"
  | "quarantine_requested";

export type LiMaTelegramEvent = {
  type: LiMaTelegramEventType;
  taskId?: string;
  status?: string;
  summary: string;
  changedFiles?: string[];
};

export type LiMaTelegramSendOptions = {
  config?: LiMaTelegramConfig;
  fetch?: typeof fetch;
};

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, "$1***"],
  [/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "***"],
  [/\b(gh[pousr]_[A-Za-z0-9_]{12,})\b/g, "***"],
  [/\b(cfut_[A-Za-z0-9._~+/=-]{8,})\b/g, "***"],
  [/\b(api[_-]?key|token|secret|password)=([^\s&]+)/gi, "$1=***"],
];

export function readLiMaTelegramConfig(env: NodeJS.ProcessEnv = process.env): LiMaTelegramConfig {
  const botToken = (env.LIMA_CODE_TELEGRAM_BOT_TOKEN ?? "").trim();
  const chatId = (env.LIMA_CODE_TELEGRAM_CHAT_ID ?? "").trim();
  const proxyUrl = (env.LIMA_CODE_TELEGRAM_PROXY ?? "").trim();
  const b2bRaw = (env.LIMA_CODE_TELEGRAM_B2B ?? "").trim().toLowerCase();
  const serverBotUsername = (env.LIMA_SERVER_BOT_USERNAME ?? "").trim().replace(/^@/, "");
  const b2bEnabled = b2bRaw === "1" || b2bRaw === "true" || b2bRaw === "yes" || b2bRaw === "on";
  const configured = Boolean(botToken && (chatId || (b2bEnabled && serverBotUsername)));
  return {
    configured,
    botToken,
    chatId,
    proxyUrl,
    b2bEnabled,
    serverBotUsername,
  };
}

export function redactTelegramText(value: string): string {
  let text = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

export function formatLiMaTelegramEvent(event: LiMaTelegramEvent): string {
  const lines = [`LiMa Code ${event.type}`];
  if (event.taskId) {
    lines.push(`Task: ${event.taskId}`);
  }
  if (event.status) {
    lines.push(`Status: ${event.status}`);
  }
  lines.push(event.summary);
  if (event.changedFiles && event.changedFiles.length > 0) {
    lines.push(`Files: ${event.changedFiles.slice(0, 10).join(", ")}`);
  }
  return redactTelegramText(lines.join("\n"));
}

const B2B_PREFIX = "LIMA_B2B\n";

export function formatLiMaB2BPayload(event: LiMaTelegramEvent): string {
  const payload = {
    v: 1,
    type: event.type,
    task_id: event.taskId ?? "",
    status: event.status ?? "",
    summary: redactTelegramText(event.summary),
    changed_files: event.changedFiles?.slice(0, 20) ?? [],
  };
  return B2B_PREFIX + JSON.stringify(payload);
}

function resolveTelegramTarget(config: LiMaTelegramConfig, event: LiMaTelegramEvent): { chatId: string; text: string } {
  if (config.b2bEnabled && config.serverBotUsername) {
    return {
      chatId: `@${config.serverBotUsername}`,
      text: formatLiMaB2BPayload(event),
    };
  }
  return { chatId: config.chatId, text: formatLiMaTelegramEvent(event) };
}

export async function sendLiMaTelegramEvent(
  event: LiMaTelegramEvent,
  options: LiMaTelegramSendOptions = {}
): Promise<boolean> {
  const config = options.config ?? readLiMaTelegramConfig();
  if (!config.configured) {
    return false;
  }

  const target = resolveTelegramTarget(config, event);
  const fetchImpl = options.fetch ?? fetch;
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: target.chatId,
      text: target.text,
    }),
  };
  if (config.proxyUrl && !options.fetch) {
    const { ProxyAgent } = await import("undici");
    const proxiedInit = init as unknown as { dispatcher?: unknown };
    proxiedInit.dispatcher = new ProxyAgent(config.proxyUrl) as unknown;
  }

  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${config.botToken}/sendMessage`, init);
    return response.ok;
  } catch {
    return false;
  }
}
