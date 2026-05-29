/**
 * Daemon mode — polls LiMa Server for tasks and executes them.
 * Runs as a long-lived process with periodic polling.
 */

import { runLiMaAgentTask, type LiMaTaskRunnerRequest, type LiMaTaskRunnerConfig } from "./lima/task-runner";
import { LiMaAgentTaskClient } from "./lima/agent-task-client";

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const MAX_CONSECUTIVE_ERRORS = 10;

export type DaemonOptions = {
  projectRoot: string;
  serverUrl?: string;
  apiKey?: string;
  verbose?: boolean;
};

export async function runDaemon(options: DaemonOptions): Promise<void> {
  const client = new LiMaAgentTaskClient({
    serverUrl: options.serverUrl,
    apiKey: options.apiKey,
  });

  if (!client.isConfigured()) {
    console.error("[daemon] LiMa Server not configured. Set LIMA_CODE_SERVER_URL and LIMA_CODE_API_KEY.");
    process.exit(1);
  }

  console.log(`[daemon] Starting. Polling every ${POLL_INTERVAL_MS / 1000}s...`);
  console.log(`[daemon] Project: ${options.projectRoot}`);

  let consecutiveErrors = 0;

  const tick = async () => {
    try {
      const taskResult = await client.fetchPendingTask();
      if (!taskResult.ok) {
        console.error(`[daemon] fetch error: ${taskResult.error}`);
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.error(`[daemon] ${MAX_CONSECUTIVE_ERRORS} consecutive errors, shutting down.`);
          process.exit(1);
        }
        return;
      }

      consecutiveErrors = 0;

      if (!taskResult.value) {
        // No pending tasks — normal
        return;
      }

      const task = taskResult.value;
      console.log(`[daemon] Received task: ${task.task_id} (${task.mode || "auto"})`);

      // Execute the task
      const config: LiMaTaskRunnerConfig = {
        currentWorkspace: options.projectRoot,
        projectRoot: options.projectRoot,
      };

      const result = await runLiMaAgentTask(task as LiMaTaskRunnerRequest, config);

      // Submit result back to server
      const submitResult = await client.submitResult(result);
      if (submitResult.ok) {
        console.log(`[daemon] Task ${task.task_id} completed: ${result.status}`);
      } else {
        console.error(`[daemon] Failed to submit result: ${submitResult.error}`);
      }

      if (options.verbose) {
        console.log(`[daemon] Summary: ${result.summary?.slice(0, 200)}`);
        console.log(`[daemon] Changed files: ${result.changed_files?.length || 0}`);
      }
    } catch (err) {
      console.error(`[daemon] Tick error:`, err);
      consecutiveErrors++;
    }
  };

  // Run first tick immediately
  await tick();

  // Then poll periodically
  const interval = setInterval(tick, POLL_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[daemon] Shutting down...");
    clearInterval(interval);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
