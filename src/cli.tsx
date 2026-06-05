import React from "react";
import { render } from "ink";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { setShellIfWindows } from "./common/shell-utils";
import { checkForNpmUpdate, promptForPendingUpdate, type PackageInfo } from "./updateCheck";
import { AppContainer } from "./ui";
import { buildCliHelpText } from "./cliHelp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const packageInfo = readPackageInfo();

if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`${packageInfo.version || "unknown"}\n`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(buildCliHelpText());
  process.exit(0);
}

function extractInitialPrompt(args: string[]): string | undefined {
  const promptIndex = args.findIndex((arg) => arg === "-p" || arg === "--prompt");
  if (promptIndex !== -1 && promptIndex + 1 < args.length) {
    return args[promptIndex + 1];
  }
  return undefined;
}

let initialPrompt = extractInitialPrompt(args);
const projectRoot = process.cwd();
const headless = args.includes("--headless");
const daemon = args.includes("--daemon");
const jsonOutput = args.includes("--json");
configureWindowsShell();

// ── Daemon mode ───────────────────────────────────────────────────────
if (daemon) {
  const { runDaemon } = await import("./daemon");
  await runDaemon({
    projectRoot,
    verbose: args.includes("--verbose") || args.includes("-v"),
  });
  process.exit(0);
}

// ── Agent/headless mode ───────────────────────────────────────────────────
if (headless) {
  const { runHeadless } = await import("./headless");

  if (initialPrompt) {
    const result = await runHeadless(initialPrompt, {
      json: jsonOutput,
      projectRoot,
      verbose: args.includes("--verbose"),
    });
    process.exitCode = result.ok ? 0 : 1;
  }

  // Pipe mode: read from stdin
  else if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const input = Buffer.concat(chunks).toString("utf-8").trim();
    if (input) {
      const result = await runHeadless(input, { json: jsonOutput });
      process.exitCode = result.ok ? 0 : 1;
    } else {
      process.stderr.write("未提供输入。\n");
      process.exitCode = 1;
    }
  }

  // Interactive headless: read prompts from stdin line by line
  else {
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin });
    process.stderr.write("LiMa（headless）— 输入提示词后按 Enter：\n");
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "/exit") break;
      await runHeadless(trimmed, { json: jsonOutput });
    }
    process.exitCode = 0;
  }
}

// ── Human TUI mode ────────────────────────────────────────────────────────
if (!headless && !process.stdin.isTTY && !process.env.LIMA_FORCE_TTY) {
  process.stderr.write("lima 需要交互式终端（TTY）。请在真实终端会话中重新运行。\n");
  process.exit(1);
}

if (!headless) {
  void main();
}

async function main(): Promise<void> {
  const updatePromptResult = await promptForPendingUpdate(packageInfo);

  const restartRef: { current: (() => void) | null } = { current: null };

  function startApp(): void {
    let restarting = false;
    const appInitialPrompt = initialPrompt;
    initialPrompt = undefined;
    const inkInstance = render(
      <AppContainer
        projectRoot={projectRoot}
        version={packageInfo.version}
        initialPrompt={appInitialPrompt}
        onRestart={() => restartRef.current?.()}
      />,
      { exitOnCtrlC: false }
    );

    restartRef.current = () => {
      restarting = true;
      process.stdout.write("\u001B[2J\u001B[3J\u001B[H");
      inkInstance.unmount();
      startApp();
    };

    inkInstance.waitUntilExit().then(() => {
      if (!restarting) {
        restartRef.current = null;
        process.exit(0);
      }
    });
  }

  if (!updatePromptResult.installed) {
    void checkForNpmUpdate(packageInfo);
  }

  startApp();
}

function configureWindowsShell(): void {
  process.env.NoDefaultCurrentDirectoryInExePath = "1";
  try {
    setShellIfWindows();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`lima: ${message}\n`);
    process.exit(1);
  }
}

function readPackageInfo(): PackageInfo {
  try {
    const pkgPath = path.resolve(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: unknown; version?: unknown };
    return {
      name: typeof pkg.name === "string" ? pkg.name : "lima",
      version: typeof pkg.version === "string" ? pkg.version : "",
    };
  } catch {
    return { name: "lima", version: "" };
  }
}
