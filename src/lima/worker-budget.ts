export type LiMaWorkerBudgetConfig = {
  maxTasks: number;
  maxMinutes: number;
  now?: () => number;
};

export type LiMaWorkerBudgetDecision = { ok: true } | { ok: false; reason: string };

export function createWorkerBudget(config: LiMaWorkerBudgetConfig) {
  const now = config.now ?? Date.now;
  const startedAt = now();
  let taskCount = 0;

  return {
    recordTask(): void {
      taskCount += 1;
    },
    canStartNext(): LiMaWorkerBudgetDecision {
      if (taskCount >= config.maxTasks) {
        return { ok: false, reason: `LiMa worker task budget reached: ${taskCount}/${config.maxTasks}` };
      }

      const elapsedMs = now() - startedAt;
      if (elapsedMs > config.maxMinutes * 60_000) {
        return { ok: false, reason: `LiMa worker time budget reached: ${config.maxMinutes} minute(s)` };
      }

      return { ok: true };
    },
  };
}
