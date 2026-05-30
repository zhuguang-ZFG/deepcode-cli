import type { ReasoningEffort } from "../settings";

type ThinkingConfig = {
  type: "enabled" | "disabled";
};

type ThinkingRequestOptions = {
  thinking?: ThinkingConfig;
  extra_body?: {
    reasoning_effort?: ReasoningEffort;
  };
};

export function buildThinkingRequestOptions(
  thinkingEnabled: boolean,
  baseURL?: string,
  reasoningEffort: ReasoningEffort = "max"
): ThinkingRequestOptions {
  if (isLiMaRouterBaseURL(baseURL)) {
    return {};
  }

  const thinking: ThinkingConfig = { type: thinkingEnabled ? "enabled" : "disabled" };

  return {
    thinking,
    ...(thinkingEnabled ? { extra_body: { reasoning_effort: reasoningEffort } } : {}),
  };
}

function isLiMaRouterBaseURL(baseURL: string | undefined): boolean {
  if (!baseURL) {
    return false;
  }
  try {
    const url = new URL(baseURL);
    return url.hostname === "chat.donglicao.com" || url.hostname === "api.donglicao.com";
  } catch {
    return baseURL.includes("chat.donglicao.com") || baseURL.includes("api.donglicao.com");
  }
}
