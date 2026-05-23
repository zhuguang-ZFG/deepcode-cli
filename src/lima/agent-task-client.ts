import { validateLiMaAgentTaskRequest, type LiMaAgentTaskRequest, type LiMaAgentTaskResult } from "./agent-task-types";

export type LiMaAgentTaskClientConfig = {
  serverUrl?: string;
  apiKey?: string;
  fetch?: typeof fetch;
};

export type LiMaAgentTaskClientResult<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };

type TaskEnvelope = {
  task?: unknown;
};

export class LiMaAgentTaskClient {
  private readonly serverUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: LiMaAgentTaskClientConfig = {}) {
    this.serverUrl = normalizeServerUrl(config.serverUrl ?? process.env.LIMA_CODE_SERVER_URL ?? "");
    this.apiKey = (config.apiKey ?? process.env.LIMA_CODE_API_KEY ?? "").trim();
    this.fetchImpl = config.fetch ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.serverUrl && this.apiKey);
  }

  async fetchTask(taskId: string): Promise<LiMaAgentTaskClientResult<LiMaAgentTaskRequest>> {
    const ready = this.requireConfig();
    if (!ready.ok) {
      return ready;
    }
    const id = taskId.trim();
    if (!id) {
      return { ok: false, error: "LiMa task id is required." };
    }

    const response = await this.request(`/agent/tasks/${encodeURIComponent(id)}`);
    if (!response.ok) {
      return response;
    }
    const payload = (await response.value.json()) as TaskEnvelope | LiMaAgentTaskRequest;
    const task = isRecord(payload) && "task" in payload ? payload.task : payload;
    const parsed = validateLiMaAgentTaskRequest(task);
    if (!parsed.ok) {
      return parsed;
    }
    return { ok: true, value: parsed.value };
  }

  async fetchPendingTask(): Promise<LiMaAgentTaskClientResult<LiMaAgentTaskRequest | null>> {
    const ready = this.requireConfig();
    if (!ready.ok) {
      return ready;
    }

    const response = await this.request("/agent/tasks?status=accepted&limit=1");
    if (!response.ok) {
      return response;
    }
    const payload = (await response.value.json()) as { tasks?: unknown[] };
    const first = Array.isArray(payload.tasks) ? payload.tasks[0] : null;
    if (!first) {
      return { ok: true, value: null };
    }
    const parsed = validateLiMaAgentTaskRequest(first);
    if (!parsed.ok) {
      return parsed;
    }
    return { ok: true, value: parsed.value };
  }

  async submitResult(result: LiMaAgentTaskResult): Promise<LiMaAgentTaskClientResult<{ accepted: boolean }>> {
    const ready = this.requireConfig();
    if (!ready.ok) {
      return ready;
    }

    const response = await this.request(`/agent/tasks/${encodeURIComponent(result.task_id)}/result`, {
      method: "POST",
      body: JSON.stringify(result),
    });
    if (!response.ok) {
      return response;
    }
    return { ok: true, value: { accepted: true } };
  }

  async fetchTaskEvents(taskId: string): Promise<LiMaAgentTaskClientResult<unknown[]>> {
    const ready = this.requireConfig();
    if (!ready.ok) {
      return ready;
    }
    const id = taskId.trim();
    if (!id) {
      return { ok: false, error: "LiMa task id is required." };
    }

    const response = await this.request(`/agent/tasks/${encodeURIComponent(id)}/events`);
    if (!response.ok) {
      return response;
    }
    const payload = (await response.value.json()) as { events?: unknown[] };
    return { ok: true, value: Array.isArray(payload.events) ? payload.events : [] };
  }

  private requireConfig(): LiMaAgentTaskClientResult<never> | { ok: true } {
    if (!this.serverUrl) {
      return { ok: false, error: "LIMA_CODE_SERVER_URL or lima.serverUrl is required." };
    }
    if (!this.apiKey) {
      return { ok: false, error: "LIMA_CODE_API_KEY or lima.apiKey is required." };
    }
    return { ok: true };
  }

  private async request(path: string, init: RequestInit = {}): Promise<LiMaAgentTaskClientResult<Response>> {
    try {
      const response = await this.fetchImpl(`${this.serverUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        return { ok: false, error: `LiMa Server returned HTTP ${response.status}.`, status: response.status };
      }
      return { ok: true, value: response };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `LiMa Server request failed: ${message}` };
    }
  }
}

function normalizeServerUrl(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
