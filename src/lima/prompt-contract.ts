export const DEFAULT_PROMPT_OUTPUT =
  "Return needs_review with summary JSON: changed_files, tests_run, remaining_risks, review_status.";

const MAX_CONTEXT = 2000;
const MAX_TASK = 1000;
const MAX_CONSTRAINT_ITEM = 500;
const MAX_CONSTRAINTS = 20;
const MAX_VERIFY_ITEM = 500;
const MAX_VERIFY = 10;
const MAX_OUTPUT = 1000;

export type LiMaPromptContract = {
  context: string;
  task: string;
  constraints: string[];
  verify: string[];
  output: string;
};

export type LiMaLegacyTaskFields = {
  goal: string;
  constraints?: string[];
  test_commands?: string[];
  mode?: string;
};

function checkLen(value: string, maxLen: number, label: string): void {
  if (value.length > maxLen) {
    throw new Error(`${label} exceeds max length ${maxLen}`);
  }
}

function checkStrList(items: unknown, label: string, itemMax: number, countMax: number): string[] {
  if (!Array.isArray(items)) {
    throw new Error(`${label} must be a list`);
  }
  if (items.length > countMax) {
    throw new Error(`${label} exceeds max count ${countMax}`);
  }
  return items.map((item, idx) => {
    if (typeof item !== "string") {
      throw new Error(`${label}[${idx}] must be a string`);
    }
    checkLen(item, itemMax, `${label}[${idx}]`);
    return item;
  });
}

export function outputHintForMode(mode: string): string {
  if (mode === "plan") {
    return (
      "Return needs_review with plan artifact paths and summary JSON: " +
      "changed_files, tests_run, remaining_risks, review_status."
    );
  }
  if (mode === "review") {
    return (
      "Return needs_review with diff review findings and summary JSON: " +
      "changed_files, tests_run, remaining_risks, review_status."
    );
  }
  if (mode === "test") {
    return (
      "Return succeeded or failed with test evidence and summary JSON: " +
      "changed_files, tests_run, remaining_risks, review_status."
    );
  }
  return DEFAULT_PROMPT_OUTPUT;
}

export function parsePromptContract(raw: unknown): LiMaPromptContract {
  if (!raw) {
    return { context: "", task: "", constraints: [], verify: [], output: "" };
  }
  if (typeof raw !== "object" || raw === null) {
    throw new Error("prompt_contract must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const context = obj.context ?? "";
  const task = obj.task ?? "";
  const output = obj.output ?? "";
  if (typeof context !== "string" || typeof task !== "string" || typeof output !== "string") {
    throw new Error("prompt_contract string fields must be strings");
  }
  checkLen(context, MAX_CONTEXT, "prompt_contract.context");
  checkLen(task, MAX_TASK, "prompt_contract.task");
  checkLen(output, MAX_OUTPUT, "prompt_contract.output");
  return {
    context,
    task,
    constraints: checkStrList(
      obj.constraints ?? [],
      "prompt_contract.constraints",
      MAX_CONSTRAINT_ITEM,
      MAX_CONSTRAINTS
    ),
    verify: checkStrList(obj.verify ?? [], "prompt_contract.verify", MAX_VERIFY_ITEM, MAX_VERIFY),
    output,
  };
}

export function migrateFromLegacy(fields: LiMaLegacyTaskFields): LiMaPromptContract {
  const task = fields.goal.trim();
  if (!task) {
    throw new Error("goal must not be empty");
  }
  return {
    context: "",
    task,
    constraints: [...(fields.constraints ?? [])],
    verify: [...(fields.test_commands ?? [])],
    output: outputHintForMode(fields.mode ?? "patch"),
  };
}

export function resolvePromptContract(fields: LiMaLegacyTaskFields, promptContract?: unknown): LiMaPromptContract {
  const migrated = migrateFromLegacy(fields);
  if (!promptContract) {
    return migrated;
  }
  if (typeof promptContract !== "object" || promptContract === null) {
    throw new Error("prompt_contract must be an object");
  }
  const obj = promptContract as Record<string, unknown>;
  const parsed = parsePromptContract(promptContract);
  return {
    context: "context" in obj ? parsed.context : migrated.context,
    task: parsed.task || migrated.task,
    constraints: "constraints" in obj ? parsed.constraints : migrated.constraints,
    verify: "verify" in obj ? parsed.verify : migrated.verify,
    output: parsed.output || migrated.output,
  };
}

export function renderPromptContract(contract: LiMaPromptContract): string {
  const context = contract.context.trim() || "(none)";
  const task = contract.task.trim() || "(none)";
  const output = contract.output.trim() || DEFAULT_PROMPT_OUTPUT;
  const lines = ["## Context", context, "", "## Task", task, "", "## Constraints"];
  if (contract.constraints.length > 0) {
    lines.push(...contract.constraints.map((item) => `- ${item}`));
  } else {
    lines.push("- (none)");
  }
  lines.push("", "## Verify");
  if (contract.verify.length > 0) {
    lines.push(...contract.verify.map((item) => `- ${item}`));
  } else {
    lines.push("- (none)");
  }
  lines.push("", "## Output", output);
  return lines.join("\n");
}

export function resolveTaskPromptContract(
  task: LiMaLegacyTaskFields & { prompt_contract?: unknown }
): LiMaPromptContract {
  return resolvePromptContract(
    {
      goal: task.goal,
      constraints: task.constraints,
      test_commands: task.test_commands,
      mode: task.mode,
    },
    task.prompt_contract
  );
}
