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
        return { ok: false, reason: `LiMa worker 任务预算已达到: ${taskCount}/${config.maxTasks}` };
      }

      const elapsedMs = now() - startedAt;
      if (elapsedMs > config.maxMinutes * 60_000) {
        return { ok: false, reason: `LiMa worker 时间预算已达到: ${config.maxMinutes} 分钟` };
      }

      return { ok: true };
    },
  };
}
