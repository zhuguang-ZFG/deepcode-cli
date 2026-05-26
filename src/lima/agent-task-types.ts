import { z } from "zod";

export const LIMA_AGENT_TASK_MODES = ["plan", "patch", "test", "review", "ship"] as const;
export const LIMA_AGENT_TASK_STATUSES = [
  "accepted",
  "claimed",
  "running",
  "needs_review",
  "approved",
  "rejected",
  "applied",
  "succeeded",
  "failed",
  "blocked",
  "cancel_requested",
  "cancelled",
  "quarantined",
] as const;

export type LiMaAgentTaskMode = (typeof LIMA_AGENT_TASK_MODES)[number];
export type LiMaAgentTaskStatus = (typeof LIMA_AGENT_TASK_STATUSES)[number];

export type LiMaTaskValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type LiMaAgentTaskPatchFile = {
  file_path: string;
  content: string;
};

export type LiMaPromptContract = {
  context: string;
  task: string;
  constraints: string[];
  verify: string[];
  output: string;
};

export type LiMaAgentTaskRequest = {
  task_id: string;
  repo: string;
  branch: string;
  goal: string;
  constraints: string[];
  allowed_tools: string[];
  max_runtime_sec: number;
  mode: LiMaAgentTaskMode;
  worker_id?: string;
  lease_expires_at?: number;
  cancel_requested?: boolean;
  failure_count?: number;
  patch_files?: LiMaAgentTaskPatchFile[];
  test_commands?: string[];
  prompt_contract?: LiMaPromptContract;
};

export type LiMaAgentTaskTestResult = {
  command: string;
  exit_code: number | null;
  duration_ms?: number;
  stdout?: string;
  stderr?: string;
};

export type LiMaAgentTaskResult = {
  task_id: string;
  status: LiMaAgentTaskStatus;
  summary: string;
  changed_files: string[];
  test_commands: string[];
  test_results: LiMaAgentTaskTestResult[];
  diff_preview: string;
  artifacts: string[];
  risks: string[];
  next_action: string;
};

const taskRequestSchema = z.object({
  task_id: z.string().trim().min(1),
  repo: z.string().trim().min(1),
  branch: z.string().trim().min(1),
  goal: z.string().trim().min(1),
  constraints: z.array(z.string()),
  allowed_tools: z.array(z.string().trim().min(1)),
  max_runtime_sec: z.number().int().positive(),
  mode: z.enum(LIMA_AGENT_TASK_MODES),
  worker_id: z.string().optional(),
  lease_expires_at: z.number().nonnegative().optional(),
  cancel_requested: z.boolean().optional(),
  failure_count: z.number().int().nonnegative().optional(),
  patch_files: z
    .array(
      z.object({
        file_path: z.string().trim().min(1),
        content: z.string(),
      })
    )
    .optional(),
  test_commands: z.array(z.string().trim().min(1)).optional(),
  prompt_contract: z
    .object({
      context: z.string(),
      task: z.string(),
      constraints: z.array(z.string()),
      verify: z.array(z.string()),
      output: z.string(),
    })
    .optional(),
});

const taskTestResultSchema = z.object({
  command: z.string().trim().min(1),
  exit_code: z.number().int().nullable(),
  duration_ms: z.number().int().nonnegative().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
});

const taskResultSchema = z.object({
  task_id: z.string().trim().min(1),
  status: z.enum(LIMA_AGENT_TASK_STATUSES),
  summary: z.string(),
  changed_files: z.array(z.string()),
  test_commands: z.array(z.string()),
  test_results: z.array(taskTestResultSchema),
  diff_preview: z.string(),
  artifacts: z.array(z.string()),
  risks: z.array(z.string()),
  next_action: z.string(),
});

export function validateLiMaAgentTaskRequest(value: unknown): LiMaTaskValidationResult<LiMaAgentTaskRequest> {
  const parsed = taskRequestSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: formatValidationError("LiMa agent task request", parsed.error) };
  }
  return { ok: true, value: parsed.data };
}

export function validateLiMaAgentTaskResult(value: unknown): LiMaTaskValidationResult<LiMaAgentTaskResult> {
  const parsed = taskResultSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: formatValidationError("LiMa agent task result", parsed.error) };
  }
  return { ok: true, value: parsed.data };
}

function formatValidationError(label: string, error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return `${label} is invalid.`;
  }
  const path = issue.path.length > 0 ? issue.path.join(".") : "payload";
  return `${label} is invalid at ${path}: ${issue.message}`;
}
