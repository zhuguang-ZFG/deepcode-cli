#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/common/shell-utils.ts
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as pathWin32 from "path/win32";
function setShellIfWindows() {
  if (process.platform !== "win32") {
    return;
  }
  process.env.SHELL = findGitBashPath();
}
function findGitBashPath() {
  if (cachedGitBashPath) {
    return cachedGitBashPath;
  }
  const bashPath = resolveWindowsGitBashPath({
    findExecutableCandidates: findAllWindowsExecutableCandidates,
    findGitExecPath,
    existsSync: fs.existsSync
  });
  if (bashPath) {
    cachedGitBashPath = bashPath;
    return bashPath;
  }
  throw new Error(
    "LiMa Code on Windows requires Git Bash. Install Git for Windows, or ensure Git's bash.exe is available in PATH."
  );
}
function resolveWindowsGitBashPath(lookup) {
  return firstExistingWindowsPath(
    [
      ...lookup.findExecutableCandidates("bash"),
      ...WINDOWS_BASH_LOCATIONS,
      ...gitExecPathToBashCandidates(lookup.findGitExecPath()),
      ...lookup.findExecutableCandidates("git").flatMap(gitExecutableToBashCandidates)
    ],
    lookup.existsSync
  );
}
function resolveShellPath() {
  if (process.platform === "win32") {
    return findGitBashPath();
  }
  const envShell = process.env.SHELL;
  if (envShell && getShellKind(envShell) !== "unknown") {
    return envShell;
  }
  return "/bin/bash";
}
function getShellKind(shellPath) {
  const executable = shellPath.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  if (executable === "bash" || executable === "bash.exe") {
    return "bash";
  }
  if (executable === "zsh" || executable === "zsh.exe") {
    return "zsh";
  }
  return "unknown";
}
function buildShellInitCommand(shellPath) {
  switch (getShellKind(shellPath)) {
    case "zsh":
      return ['ZSHRC="${ZDOTDIR:-$HOME}/.zshrc"', 'if [ -f "$ZSHRC" ]; then . "$ZSHRC"; fi'].join("; ");
    case "bash":
      return ['BASHRC="${BASH_ENV:-$HOME/.bashrc}"', 'if [ -f "$BASHRC" ]; then . "$BASHRC"; fi'].join("; ");
    default:
      return null;
  }
}
function buildDisableExtglobCommand(shellPath) {
  switch (getShellKind(shellPath)) {
    case "bash":
      return "shopt -u extglob 2>/dev/null || true";
    case "zsh":
      return "setopt NO_EXTENDED_GLOB 2>/dev/null || true";
    default:
      return null;
  }
}
function rewriteWindowsNullRedirect(command) {
  return command.replace(NUL_REDIRECT_REGEX, "$1/dev/null");
}
function windowsPathToPosixPath(windowsPath) {
  if (windowsPath.startsWith("\\\\")) {
    return windowsPath.replace(/\\/g, "/");
  }
  const driveMatch = windowsPath.match(/^([A-Za-z]):[/\\]/);
  if (driveMatch) {
    const driveLetter = driveMatch[1].toLowerCase();
    return `/${driveLetter}${windowsPath.slice(2).replace(/\\/g, "/")}`;
  }
  return windowsPath.replace(/\\/g, "/");
}
function posixPathToWindowsPath(posixPath) {
  if (posixPath.startsWith("//")) {
    return posixPath.replace(/\//g, "\\");
  }
  const cygdriveMatch = posixPath.match(/^\/cygdrive\/([A-Za-z])(\/|$)/);
  if (cygdriveMatch) {
    const driveLetter = cygdriveMatch[1].toUpperCase();
    const rest = posixPath.slice(`/cygdrive/${cygdriveMatch[1]}`.length);
    return `${driveLetter}:${(rest || "\\").replace(/\//g, "\\")}`;
  }
  const driveMatch = posixPath.match(/^\/([A-Za-z])(\/|$)/);
  if (driveMatch) {
    const driveLetter = driveMatch[1].toUpperCase();
    const rest = posixPath.slice(2);
    return `${driveLetter}:${(rest || "\\").replace(/\//g, "\\")}`;
  }
  return posixPath.replace(/\//g, "\\");
}
function toNativeCwd(shellCwd) {
  if (process.platform !== "win32") {
    return shellCwd;
  }
  return posixPathToWindowsPath(shellCwd);
}
function buildShellEnv(shellPath, extraEnv = {}) {
  const env = {
    ...process.env,
    ...extraEnv,
    SHELL: shellPath,
    GIT_EDITOR: "true"
  };
  if (process.platform === "win32") {
    const tmpdir3 = windowsPathToPosixPath(os.tmpdir());
    env.TMPDIR = tmpdir3;
    env.TMPPREFIX = path.posix.join(tmpdir3, "zsh");
  }
  return env;
}
function findAllWindowsExecutableCandidates(executable) {
  const extraCandidates = executable === "git" ? WINDOWS_GIT_LOCATIONS : executable === "bash" ? WINDOWS_BASH_LOCATIONS : [];
  try {
    const output = execFileSync("where.exe", [executable], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
    });
    let whereResults = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (executable === "bash") {
      whereResults = whereResults.filter((candidate) => !/system32[\\/]bash\.exe$/i.test(candidate));
    }
    return filterWindowsExecutableCandidates([...whereResults, ...extraCandidates]);
  } catch {
    return filterWindowsExecutableCandidates(extraCandidates);
  }
}
function findGitExecPath() {
  try {
    const output = execFileSync("git", ["--exec-path"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}
function gitExecPathToBashCandidates(execPath) {
  if (!execPath) {
    return [];
  }
  const normalized = execPath.replace(/\//g, "\\");
  return [
    pathWin32.join(normalized, "..", "..", "..", "bin", "bash.exe"),
    pathWin32.join(normalized, "..", "..", "bin", "bash.exe")
  ];
}
function gitExecutableToBashCandidates(gitPath) {
  return [pathWin32.join(gitPath, "..", "..", "bin", "bash.exe"), pathWin32.join(gitPath, "..", "bin", "bash.exe")];
}
function firstExistingWindowsPath(candidates, existsSync20) {
  const seen = /* @__PURE__ */ new Set();
  for (const candidate of candidates) {
    const normalized = pathWin32.resolve(candidate);
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (getShellKind(normalized) === "bash" && existsSync20(normalized)) {
      return normalized;
    }
  }
  return null;
}
function filterWindowsExecutableCandidates(candidates) {
  const cwd = process.cwd().toLowerCase();
  const seen = /* @__PURE__ */ new Set();
  const results = [];
  for (const candidate of candidates) {
    const normalized = path.resolve(candidate).toLowerCase();
    const candidateDir = path.dirname(normalized).toLowerCase();
    if (candidateDir === cwd || normalized.startsWith(`${cwd}${path.sep}`)) {
      continue;
    }
    if (!seen.has(normalized) && fs.existsSync(candidate)) {
      seen.add(normalized);
      results.push(candidate);
    }
  }
  return results;
}
var WINDOWS_GIT_LOCATIONS, WINDOWS_BASH_LOCATIONS, NUL_REDIRECT_REGEX, cachedGitBashPath;
var init_shell_utils = __esm({
  "src/common/shell-utils.ts"() {
    "use strict";
    WINDOWS_GIT_LOCATIONS = ["C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files (x86)\\Git\\cmd\\git.exe"];
    WINDOWS_BASH_LOCATIONS = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"];
    NUL_REDIRECT_REGEX = /(\d?&?>+\s*)[Nn][Uu][Ll](?=\s|$|[|&;)\n])/g;
    cachedGitBashPath = null;
  }
});

// src/ui/DropdownMenu.tsx
import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { jsx, jsxs } from "react/jsx-runtime";
function calculateVisibleStart(activeIndex, totalItems, maxVisible) {
  return Math.min(Math.max(0, activeIndex - Math.floor((maxVisible - 1) / 2)), Math.max(0, totalItems - maxVisible));
}
var DropdownMenu, DropdownMenu_default;
var init_DropdownMenu = __esm({
  "src/ui/DropdownMenu.tsx"() {
    "use strict";
    DropdownMenu = React.memo(function DropdownMenu2({
      items,
      activeIndex,
      maxVisible = 8,
      width,
      title,
      titleColor = "magenta",
      activeColor = "cyanBright",
      helpText,
      emptyText = "No items found",
      renderItem
    }) {
      const visibleStart = calculateVisibleStart(activeIndex, items?.length, maxVisible);
      const visibleItems = items?.slice(visibleStart, visibleStart + maxVisible);
      const labelColumnWidth = useMemo(() => {
        if (visibleItems.length === 0) {
          return 0;
        }
        const maxContentWidth = Math.max(
          ...visibleItems.map((item) => {
            let width2 = 2;
            if (item.selected !== void 0) {
              width2 += 2;
            }
            width2 += item.label.length;
            if (item.statusIndicator) {
              width2 += 2;
            }
            return width2;
          })
        );
        const maxAllowed = Math.max(10, width - 2 >> 1);
        return Math.min(maxContentWidth, maxAllowed);
      }, [visibleItems, width]);
      if (items?.length === 0) {
        return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginBottom: 1, width, children: [
          title ? /* @__PURE__ */ jsx(Text, { color: titleColor, bold: true, children: title }) : null,
          /* @__PURE__ */ jsx(Text, { dimColor: true, children: emptyText }),
          helpText ? /* @__PURE__ */ jsx(Text, { dimColor: true, children: helpText }) : null
        ] });
      }
      return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginBottom: 1, borderStyle: "round", borderDimColor: true, width, children: [
        title ? /* @__PURE__ */ jsx(
          Box,
          {
            borderStyle: "single",
            borderDimColor: true,
            borderBottom: true,
            borderRight: false,
            borderTop: false,
            borderLeft: false,
            paddingX: 1,
            children: /* @__PURE__ */ jsx(Text, { color: titleColor, bold: true, children: title })
          }
        ) : null,
        visibleStart > 0 ? /* @__PURE__ */ jsx(Box, { marginLeft: 2, children: /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
          "\u2026 ",
          visibleStart,
          " above"
        ] }) }) : null,
        /* @__PURE__ */ jsx(Box, { flexDirection: "column", children: visibleItems.map((item, idx) => {
          const actualIndex = visibleStart + idx;
          const isActive = actualIndex === activeIndex;
          if (renderItem) {
            return /* @__PURE__ */ jsx(React.Fragment, { children: renderItem(item, isActive) }, item.key);
          }
          return /* @__PURE__ */ jsxs(Box, { flexGrow: 1, flexDirection: "row", gap: 2, paddingX: 1, children: [
            /* @__PURE__ */ jsx(Box, { width: labelColumnWidth, flexShrink: 0, children: /* @__PURE__ */ jsxs(Text, { color: isActive ? activeColor : void 0, wrap: "truncate-end", children: [
              isActive ? "> " : "  ",
              item.selected !== void 0 ? item.selected ? "\u25CF" : "\u25CB" : null,
              " ",
              /* @__PURE__ */ jsx(Text, { bold: true, children: item.label }),
              item.statusIndicator ? /* @__PURE__ */ jsxs(Text, { color: item.statusIndicator.color, children: [
                " ",
                item.statusIndicator.symbol
              ] }) : null
            ] }) }),
            /* @__PURE__ */ jsx(Box, { flexGrow: 1, children: item.description ? /* @__PURE__ */ jsx(Text, { dimColor: true, children: `${item.description}` }) : null })
          ] }, item.key);
        }) }),
        visibleStart + visibleItems.length < items.length ? /* @__PURE__ */ jsx(Box, { marginLeft: 2, children: /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
          "\u2026 ",
          items.length - visibleStart - visibleItems.length,
          " more"
        ] }) }) : null,
        helpText ? /* @__PURE__ */ jsx(
          Box,
          {
            borderStyle: "single",
            borderDimColor: true,
            borderBottom: false,
            borderRight: false,
            borderTop: true,
            borderLeft: false,
            paddingX: 1,
            children: /* @__PURE__ */ jsx(Text, { dimColor: true, children: helpText })
          }
        ) : null
      ] });
    });
    DropdownMenu_default = DropdownMenu;
  }
});

// src/ui/components/ModelsDropdown/index.tsx
import { useEffect, useState } from "react";
import { useInput } from "ink";
import { jsx as jsx2 } from "react/jsx-runtime";
function getThinkingOptionIndex(config) {
  const index = MODEL_COMMAND_THINKING_OPTIONS.findIndex((option) => {
    if (!config.thinkingEnabled) {
      return !option.thinkingEnabled;
    }
    return option.thinkingEnabled && option.reasoningEffort === config.reasoningEffort;
  });
  return index >= 0 ? index : 0;
}
var MODEL_COMMAND_MODELS, MODEL_COMMAND_THINKING_OPTIONS, ModelsDropdown, ModelsDropdown_default;
var init_ModelsDropdown = __esm({
  "src/ui/components/ModelsDropdown/index.tsx"() {
    "use strict";
    init_DropdownMenu();
    MODEL_COMMAND_MODELS = ["deepseek-v4-pro", "deepseek-v4-flash"];
    MODEL_COMMAND_THINKING_OPTIONS = [
      { label: "\u601D\u8003\u6A21\u5F0F [max]", thinkingEnabled: true, reasoningEffort: "max" },
      { label: "\u601D\u8003\u6A21\u5F0F [high]", thinkingEnabled: true, reasoningEffort: "high" },
      { label: "\u5173\u95ED\u601D\u8003", thinkingEnabled: false }
    ];
    ModelsDropdown = ({
      open,
      modelConfig,
      width,
      onClose,
      onModelConfigChange,
      onStatusMessage
    }) => {
      const [step, setStep] = useState(null);
      const [activeIndex, setActiveIndex] = useState(0);
      const [pendingModel, setPendingModel] = useState(null);
      useEffect(() => {
        if (open) {
          const currentIndex = MODEL_COMMAND_MODELS.findIndex((m) => m === modelConfig.model);
          setPendingModel(null);
          setStep("model");
          setActiveIndex(currentIndex >= 0 ? currentIndex : 0);
        } else {
          setStep(null);
        }
      }, [open, modelConfig.model]);
      useEffect(() => {
        if (!step) {
          return;
        }
        const optionCount = step === "model" ? MODEL_COMMAND_MODELS.length : MODEL_COMMAND_THINKING_OPTIONS.length;
        if (activeIndex >= optionCount) {
          setActiveIndex(Math.max(0, optionCount - 1));
        }
      }, [activeIndex, step]);
      function selectItem() {
        if (step === "model") {
          const model = MODEL_COMMAND_MODELS[activeIndex] ?? modelConfig.model;
          setPendingModel(model);
          setStep("thinking");
          setActiveIndex(getThinkingOptionIndex(modelConfig));
          return;
        }
        const option = MODEL_COMMAND_THINKING_OPTIONS[activeIndex] ?? MODEL_COMMAND_THINKING_OPTIONS[0];
        const selection = {
          model: pendingModel ?? modelConfig.model,
          thinkingEnabled: option.thinkingEnabled,
          reasoningEffort: option.reasoningEffort ?? modelConfig.reasoningEffort
        };
        onClose();
        Promise.resolve(onModelConfigChange(selection)).then((message) => {
          if (message) {
            onStatusMessage?.(message);
          }
        }).catch((error) => {
          const msg = error instanceof Error ? error.message : String(error);
          onStatusMessage?.(`\u6A21\u578B\u8BBE\u7F6E\u66F4\u65B0\u5931\u8D25\uFF1A${msg}`);
        });
      }
      useInput(
        (input, key) => {
          if (!step) {
            return;
          }
          const optionCount = step === "model" ? MODEL_COMMAND_MODELS.length : MODEL_COMMAND_THINKING_OPTIONS.length;
          if (key.upArrow) {
            setActiveIndex((idx) => (idx - 1 + optionCount) % optionCount);
            return;
          }
          if (key.downArrow) {
            setActiveIndex((idx) => (idx + 1) % optionCount);
            return;
          }
          if (input === " " && !key.ctrl && !key.meta || key.return && !key.shift && !key.meta) {
            selectItem();
            return;
          }
          if (key.tab || key.escape) {
            onClose();
            return;
          }
        },
        { isActive: open }
      );
      if (!open || !step) {
        return null;
      }
      const items = step === "model" ? MODEL_COMMAND_MODELS.map((model) => ({
        key: model,
        label: model,
        description: model === modelConfig.model ? "\u5F53\u524D\u6A21\u578B" : "",
        selected: model === (pendingModel ?? modelConfig.model)
      })) : MODEL_COMMAND_THINKING_OPTIONS.map((option, i) => ({
        key: option.label,
        label: option.label,
        description: option.thinkingEnabled ? `\u63A8\u7406\u5F3A\u5EA6: ${option.reasoningEffort}` : "\u5DF2\u5173\u95ED\u601D\u8003",
        selected: getThinkingOptionIndex(modelConfig) === i
      }));
      return /* @__PURE__ */ jsx2(
        DropdownMenu_default,
        {
          width,
          title: step === "model" ? "\u9009\u62E9\u6A21\u578B" : "\u9009\u62E9\u601D\u8003\u6A21\u5F0F",
          helpText: step === "model" ? "Space/Enter \u9009\u62E9\u6A21\u578B \xB7 Esc \u53D6\u6D88" : "Space/Enter \u5E94\u7528 \xB7 Esc \u53D6\u6D88",
          items,
          activeIndex,
          activeColor: "#229ac3",
          maxVisible: 6
        }
      );
    };
    ModelsDropdown_default = ModelsDropdown;
  }
});

// src/common/openai-thinking.ts
function buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort = "max") {
  if (isLiMaRouterBaseURL(baseURL)) {
    return {};
  }
  const thinking = { type: thinkingEnabled ? "enabled" : "disabled" };
  return {
    thinking,
    ...thinkingEnabled ? { extra_body: { reasoning_effort: reasoningEffort } } : {}
  };
}
function isLiMaRouterBaseURL(baseURL) {
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
var init_openai_thinking = __esm({
  "src/common/openai-thinking.ts"() {
    "use strict";
  }
});

// src/common/openai-client.ts
import * as fs2 from "fs";
import * as os2 from "os";
import * as path2 from "path";
import OpenAI from "openai";
import { Agent, fetch as undiciFetch } from "undici";
function buildLiMaRouterFetchHeaders(inputHeaders) {
  const source = new Headers(inputHeaders);
  const sanitized = new Headers();
  for (const headerName of ["authorization", "content-type", "accept"]) {
    const value = source.get(headerName);
    if (value) {
      sanitized.set(headerName, value);
    }
  }
  return sanitized;
}
function createOpenAIFetch(baseURL) {
  return (url, init) => {
    const headers = isLiMaRouterBaseURL(String(url)) || isLiMaRouterBaseURL(baseURL) ? buildLiMaRouterFetchHeaders(init?.headers) : init?.headers;
    return undiciFetch(url, {
      ...init,
      headers,
      dispatcher: keepAliveAgent
    });
  };
}
function createOpenAIClient(projectRoot2 = process.cwd()) {
  const settings = resolveCurrentSettings(projectRoot2);
  if (!settings.apiKey) {
    return {
      client: null,
      model: settings.model,
      baseURL: settings.baseURL,
      thinkingEnabled: settings.thinkingEnabled,
      reasoningEffort: settings.reasoningEffort,
      debugLogEnabled: settings.debugLogEnabled,
      notify: settings.notify,
      webSearchTool: settings.webSearchTool,
      env: settings.env,
      machineId: getMachineId()
    };
  }
  const cacheKey = `${settings.apiKey}::${settings.baseURL}`;
  if (cachedOpenAI && cachedOpenAIKey === cacheKey) {
    return {
      client: cachedOpenAI,
      model: settings.model,
      baseURL: settings.baseURL,
      thinkingEnabled: settings.thinkingEnabled,
      reasoningEffort: settings.reasoningEffort,
      debugLogEnabled: settings.debugLogEnabled,
      notify: settings.notify,
      webSearchTool: settings.webSearchTool,
      env: settings.env,
      machineId: getMachineId()
    };
  }
  cachedOpenAI = new OpenAI({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL || void 0,
    fetch: createOpenAIFetch(settings.baseURL)
  });
  cachedOpenAIKey = cacheKey;
  void (async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3e3);
    try {
      await cachedOpenAI.models.list({ signal: ac.signal }).catch(() => {
      });
    } finally {
      clearTimeout(timer);
    }
  })();
  return {
    client: cachedOpenAI,
    model: settings.model,
    baseURL: settings.baseURL,
    thinkingEnabled: settings.thinkingEnabled,
    reasoningEffort: settings.reasoningEffort,
    debugLogEnabled: settings.debugLogEnabled,
    notify: settings.notify,
    webSearchTool: settings.webSearchTool,
    env: settings.env,
    machineId: getMachineId()
  };
}
function getMachineId() {
  try {
    const idPath = path2.join(os2.homedir(), ".deepcode", "machine-id");
    if (fs2.existsSync(idPath)) {
      const raw = fs2.readFileSync(idPath, "utf8").trim();
      if (raw) {
        return raw;
      }
    }
    const generated = `${os2.hostname()}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    fs2.mkdirSync(path2.dirname(idPath), { recursive: true });
    fs2.writeFileSync(idPath, generated, "utf8");
    return generated;
  } catch {
    return void 0;
  }
}
var keepAliveAgent, cachedOpenAI, cachedOpenAIKey;
var init_openai_client = __esm({
  "src/common/openai-client.ts"() {
    "use strict";
    init_App();
    init_openai_thinking();
    keepAliveAgent = new Agent({ keepAliveTimeout: 18e4 });
    cachedOpenAI = null;
    cachedOpenAIKey = "";
  }
});

// src/common/notify.ts
import { spawn } from "child_process";
function formatDurationSeconds(durationMs) {
  const safeMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  return String(Math.floor(safeMs / 1e3));
}
function buildNotifyEnv(durationMs, baseEnv = process.env, context = {}) {
  const env = {
    ...baseEnv,
    DURATION: formatDurationSeconds(durationMs)
  };
  delete env.STATUS;
  delete env.FAIL_REASON;
  delete env.BODY;
  delete env.TITLE;
  if (context.status) {
    env.STATUS = context.status;
  }
  if (context.failReason) {
    env.FAIL_REASON = context.failReason;
  }
  if (context.body) {
    env.BODY = context.body;
  }
  if (context.title) {
    env.TITLE = context.title;
  }
  return env;
}
function launchNotifyScript(notifyPath, durationMs, workingDirectory, spawnProcess = spawn, configuredEnv = {}, context = {}) {
  const commandPath = notifyPath?.trim();
  if (!commandPath) {
    return;
  }
  const options = {
    cwd: workingDirectory,
    detached: process.platform !== "win32",
    env: buildNotifyEnv(durationMs, { ...process.env, ...configuredEnv }, context),
    stdio: "ignore"
  };
  try {
    const child = spawnProcess(commandPath, [], options);
    child.once("error", (error) => {
      if (process.platform === "win32") {
        return;
      }
      if (error.code !== "EACCES" && error.code !== "ENOEXEC") {
        return;
      }
      try {
        const fallbackChild = spawnProcess("/bin/sh", [commandPath], options);
        fallbackChild.once("error", () => void 0);
        fallbackChild.unref();
      } catch {
      }
    });
    child.unref();
  } catch {
  }
}
var init_notify = __esm({
  "src/common/notify.ts"() {
    "use strict";
  }
});

// src/common/model-capabilities.ts
function defaultsToThinkingMode(model) {
  return DEEPSEEK_V4_MODELS.has(model);
}
function supportsThinkingMode(model) {
  return DEEPSEEK_V4_MODELS.has(model);
}
function supportsMultimodal(model) {
  return !NON_MULTIMODAL_MODELS.has(model.trim());
}
var DEEPSEEK_V4_MODELS, NON_MULTIMODAL_MODELS;
var init_model_capabilities = __esm({
  "src/common/model-capabilities.ts"() {
    "use strict";
    DEEPSEEK_V4_MODELS = /* @__PURE__ */ new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);
    NON_MULTIMODAL_MODELS = /* @__PURE__ */ new Set([
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "deepseek-chat",
      "deepseek-reasoner"
    ]);
  }
});

// src/prompt.ts
import { execFileSync as execFileSync2, execSync } from "child_process";
import * as fs3 from "fs";
import * as os3 from "os";
import * as path3 from "path";
import { fileURLToPath } from "url";
import ejs from "ejs";
function readToolDocs(extensionRoot, options = {}) {
  const toolsDir = path3.join(extensionRoot, "templates", "tools");
  if (!fs3.existsSync(toolsDir)) {
    return "";
  }
  const entries = fs3.readdirSync(toolsDir);
  const docs = entries.filter((entry) => entry.endsWith(".md") || entry.endsWith(".md.ejs")).sort().map((entry) => {
    const fullPath = path3.join(toolsDir, entry);
    try {
      const template = fs3.readFileSync(fullPath, "utf8");
      const content = entry.endsWith(".ejs") ? ejs.render(template, { supportsMultimodal: supportsMultimodal(options.model ?? "") }) : template;
      return content.trim();
    } catch {
      return "";
    }
  }).filter((content) => content.length > 0);
  return docs.join("\n\n");
}
function readDefaultSkillDocs(extensionRoot) {
  const skillsDir = path3.join(extensionRoot, "templates", "skills");
  return DEFAULT_SKILL_TEMPLATES.map((entry) => {
    const fullPath = path3.join(skillsDir, entry);
    try {
      return {
        name: path3.basename(entry, ".md"),
        content: fs3.readFileSync(fullPath, "utf8").trim()
      };
    } catch {
      return null;
    }
  }).filter((skill) => Boolean(skill?.content));
}
function getDefaultSkillPrompt() {
  const skillDocs = readDefaultSkillDocs(getExtensionRoot());
  if (skillDocs.length === 0) {
    return "";
  }
  const blocks = skillDocs.map(
    (skill) => `<${skill.name}-skill>
${skill.content}
</${skill.name}-skill>`
  );
  return `\u4EE5\u4E0B\u6280\u80FD\u6587\u6863\u7528\u4E8E\u8F85\u52A9\u5B8C\u6210\u5F53\u524D\u4EFB\u52A1\uFF1A
${blocks.join("\n\n")}`;
}
function getCurrentDateAndModelPrompt(model) {
  const date = /* @__PURE__ */ new Date();
  let prompt = `\u4ECA\u5929\u662F ${date.getFullYear()} \u5E74 ${date.getMonth() + 1} \u6708 ${date.getDate()} \u65E5\u3002\u968F\u7740\u5BF9\u8BDD\u8FDB\u884C\uFF0C\u65F6\u95F4\u5728\u6D41\u901D\u3002`;
  prompt += model ? `
\u5F53\u524D LLM \u6A21\u578B\u4E3A ${model}\uFF0C\u53EF\u901A\u8FC7 /model \u547D\u4EE4\u5207\u6362\u6A21\u578B\u3002` : "";
  return prompt;
}
function getSystemPrompt(_projectRoot, options = {}) {
  const toolDocs = readToolDocs(getExtensionRoot(), options);
  const basePrompt = toolDocs ? `${SYSTEM_PROMPT_BASE}

# Available Tools

${toolDocs}` : SYSTEM_PROMPT_BASE;
  return basePrompt;
}
function getCompactPrompt(sessionMessages) {
  const jsonl = sessionMessages.map(
    (message) => JSON.stringify({
      id: message.id,
      role: message.role,
      content: message.content,
      contentParams: message.contentParams,
      messageParams: message.messageParams,
      createTime: message.createTime
    })
  ).join("\n");
  return `${COMPACT_PROMPT_BASE}

conversation below:

\`\`\`jsonl
${jsonl}
\`\`\``;
}
function getRuntimeContext(projectRoot2, model) {
  const uname = getUnameInfo();
  const shellPath = getShellPathInfo();
  const shellModeOpts = process.platform === "win32" ? { "shell mode": "git-bash" } : {};
  const runtimeVersions = getRuntimeVersionInfo();
  const env = {
    "root path": projectRoot2,
    pwd: projectRoot2,
    homedir: os3.homedir(),
    "system info": uname,
    "shell path": shellPath,
    ...shellModeOpts,
    ...runtimeVersions,
    "command installed": {
      ripgrep: checkToolInstalled("rg"),
      jq: checkToolInstalled("jq")
    }
  };
  return `${getCurrentDateAndModelPrompt(model)}

# Local Workspace Environment

\`\`\`json
${JSON.stringify(env, null, 2)}
\`\`\``;
}
function checkToolInstalled(tool) {
  try {
    if (process.platform === "win32") {
      const bashPath = findGitBashPath();
      execFileSync2(bashPath, ["-lc", `command -v ${shellSingleQuote(tool)}`], {
        encoding: "utf8",
        stdio: "ignore",
        windowsHide: true
      });
      return true;
    }
    execSync(`command -v ${tool}`, { encoding: "utf8", stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function getShellPathInfo() {
  try {
    return resolveShellPath();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
function shellSingleQuote(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
function getRuntimeVersionInfo() {
  const versions = {};
  const pythonVersion = getCommandVersion("python3", ["--version"]);
  const nodeVersion = getCommandVersion("node", ["--version"]);
  if (pythonVersion) {
    versions["python3 version"] = pythonVersion.replace(/^Python\s+/i, "");
  }
  if (nodeVersion) {
    versions["node version"] = nodeVersion;
  }
  return versions;
}
function getCommandVersion(command, args2) {
  try {
    const commandText = [command, ...args2].map(shellSingleQuote).join(" ");
    if (process.platform === "win32") {
      return execFileSync2(findGitBashPath(), ["-lc", `${commandText} 2>&1`], {
        encoding: "utf8",
        windowsHide: true
      }).trim();
    }
    return execSync(`${commandText} 2>&1`, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}
function getUnameInfo() {
  try {
    if (process.platform === "win32") {
      return execFileSync2(findGitBashPath(), ["-lc", "uname -a"], {
        encoding: "utf8",
        windowsHide: true
      }).trim();
    }
    return execSync("uname -a", { encoding: "utf8" }).trim();
  } catch {
    return `${os3.type()} ${os3.release()} ${os3.arch()}`;
  }
}
function getExtensionRoot() {
  if (typeof __dirname !== "undefined") {
    return path3.resolve(__dirname, "..");
  }
  const currentFilePath = fileURLToPath(import.meta.url);
  return path3.resolve(path3.dirname(currentFilePath), "..");
}
function getTools(_options = {}, externalTools = []) {
  const tools = [
    {
      type: "function",
      function: {
        name: "bash",
        description: "Execute shell commands in a persistent bash session.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute"
            },
            description: {
              type: "string",
              description: 'Clear, concise description of what this command does in active voice. Never use words like "complex" or "risk" in the description - just describe what it does.'
            }
          },
          required: ["command"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "AskUserQuestion",
        description: "When the task has ambiguities or multiple implementation approaches, use this tool to pause execution and ask the user a question to get clarification or make a decision.",
        parameters: {
          type: "object",
          properties: {
            questions: {
              type: "array",
              description: "Questions to present to the user. Usually only one question is needed at a time.",
              items: {
                type: "object",
                properties: {
                  question: {
                    type: "string",
                    description: "The question to ask the user."
                  },
                  multiSelect: {
                    type: "boolean",
                    description: "Whether the user may choose multiple options."
                  },
                  options: {
                    type: "array",
                    description: "A list of predefined options for the user to choose from.",
                    items: {
                      type: "object",
                      properties: {
                        label: {
                          type: "string",
                          description: "The display text for the option."
                        },
                        description: {
                          type: "string",
                          description: "A detailed explanation or hint about this option to help the user understand what happens if they choose it."
                        }
                      },
                      required: ["label"]
                    }
                  }
                },
                required: ["question", "options"]
              }
            }
          },
          required: ["questions"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "UpdatePlan",
        description: "Update the current task plan. The plan argument must be the complete markdown task list to show as the latest progress state.",
        parameters: {
          type: "object",
          properties: {
            plan: {
              type: "string",
              description: "The complete markdown task list, including task status markers such as [ ], [>], [x], and optional notes."
            },
            explanation: {
              type: "string",
              description: "Optional short reason for changing the plan."
            }
          },
          required: ["plan"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "read",
        description: "Read files from the filesystem (text, images, PDFs, notebooks).",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "UNIX-style path to file"
            },
            offset: {
              type: "number",
              description: "Line number to start reading from"
            },
            limit: {
              type: "number",
              description: "Number of lines to read"
            },
            pages: {
              type: "string",
              description: 'Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files.'
            }
          },
          required: ["file_path"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "write",
        description: "Create files or overwrite them with a complete string payload. Prefer edit for existing files.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Absolute path to file"
            },
            content: {
              type: "string",
              description: "Complete file content as a single string. Serialize JSON documents before writing."
            }
          },
          required: ["file_path", "content"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "edit",
        description: "Perform scoped string replacements in files.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Absolute path to file. Optional when snippet_id is provided."
            },
            snippet_id: {
              type: "string",
              description: "Snippet id returned by the Read or Edit tool to scope the search range after a partial read."
            },
            old_string: {
              type: "string",
              description: "Exact text to replace inside the file or snippet scope"
            },
            new_string: {
              type: "string",
              description: "Replacement text (must differ from old_string)"
            },
            replace_all: {
              type: "boolean",
              description: "Replace all occurences of old_string (default false)",
              default: false
            },
            expected_occurrences: {
              type: "number",
              description: "Expected number of matches, especially useful as a safety check with replace_all"
            }
          },
          required: ["old_string", "new_string"],
          additionalProperties: false
        }
      }
    }
  ];
  tools.push({
    type: "function",
    function: {
      name: "WebSearch",
      description: "Perform web searching using a natural language query.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "A search query phrased as a clear, specific natural language question or statement that includes key context."
          }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  });
  for (const tool of externalTools) {
    tools.push(tool);
  }
  return tools;
}
var COMPACT_PROMPT_BASE, SYSTEM_PROMPT_BASE, DEFAULT_SKILL_TEMPLATES;
var init_prompt = __esm({
  "src/prompt.ts"() {
    "use strict";
    init_shell_utils();
    init_model_capabilities();
    COMPACT_PROMPT_BASE = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like:
     - file names
     - full code snippets
     - function signatures
     - file edits
  - Errors that you ran into and how you fixed them
  - Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable and include a summary of why this file read or edit is important.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.
6. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
7. Current Work: Describe in detail precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages from both user and assistant. Include file names and code snippets where applicable.
8. Optional Next Step: List the next step that you will take that is related to the most recent work you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent explicit requests, and the task you were working on immediately before this summary request. If your last task was concluded, then only list next steps if they are explicitly in line with the users request. Do not start on tangential requests or really old requests that were already completed without confirming with the user first.
                       If there is a next step, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no drift in task interpretation.

Here's an example of how your output should be structured:

<example>
<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]
   - [...]

3. Files and Code Sections:
   - [File Name 1]
      - [Summary of why this file is important]
      - [Summary of the changes made to this file, if any]
      - [Important Code Snippet]
   - [File Name 2]
      - [Important Code Snippet]
   - [...]

4. Errors and fixes:
    - [Detailed description of error 1]:
      - [How you fixed the error]
      - [User feedback on the error if any]
    - [...]

5. Problem Solving:
   [Description of solved problems and ongoing troubleshooting]

6. All user messages: 
    - [Detailed non tool use user message]
    - [...]

7. Pending Tasks:
   - [Task 1]
   - [Task 2]
   - [...]

8. Current Work:
   [Precise description of current work]

9. Optional Next Step:
   [Optional Next step to take]

</summary>`;
    SYSTEM_PROMPT_BASE = `\u4F60\u662F\u540D\u53EB LiMa Code \u7684\u4EA4\u4E92\u5F0F CLI \u5DE5\u5177\uFF0C\u5E2E\u52A9\u7528\u6237\u5B8C\u6210\u8F6F\u4EF6\u5DE5\u7A0B\u4EFB\u52A1\u3002\u8BF7\u9075\u5FAA\u4E0B\u65B9\u6307\u4EE4\uFF0C\u5E76\u4F7F\u7528\u53EF\u7528\u5DE5\u5177\u534F\u52A9\u7528\u6237\u3002

\u91CD\u8981\uFF1A\u4E25\u7981\u7F16\u9020\u4EFB\u4F55\u975E\u7F16\u7A0B\u76F8\u5173\u7684 URL\u3002\u5BF9\u4E8E\u7F16\u7A0B\u94FE\u63A5\uFF0C\u4EC5\u9650\u4F7F\u7528\uFF1A1) \u7528\u6237\u63D0\u4F9B\u7684\u4E0A\u4E0B\u6587\uFF1B2) \u4F60\u786E\u5B9A\u7684\u5B98\u65B9\u6587\u6863\u4E3B\u57DF\u540D\u3002\u5728\u8F93\u51FA\u524D\uFF0C\u5FC5\u987B\u81EA\u67E5\u8BE5\u94FE\u63A5\u662F\u5426\u5B58\u5728\u4E8E\u4F60\u7684\u4E0A\u4E0B\u6587\u8BB0\u5FC6\u4E2D\uFF1B\u82E5\u4E0D\u5B58\u5728\uFF0C\u8BF7\u660E\u786E\u8BF4\u660E\u65E0\u6CD5\u63D0\u4F9B\u3002

\u91CD\u8981\uFF1A\u4E0D\u8981\u5C55\u793A\u63A8\u7406\u8FC7\u7A0B\u3001\u601D\u8003\u6B65\u9AA4\u6216\u5206\u6790\u8FC7\u7A0B\u3002\u4E0D\u8981\u5199"\u7528\u6237\u95EE\u4E86..."\u3001"\u6839\u636E\u6307\u4EE4..."\u3001"\u6211\u53EF\u4EE5\u63D0\u4F9B..."\u3001"\u8FD9\u662F\u4E00\u4E2A..."\u3001"\u6211\u9700\u8981..."\u3001"\u6211\u5E94\u8BE5..."\u3001"\u6211\u4F1A..."\u3001"\u8BA9\u6211..."\u8FD9\u7C7B\u5143\u63CF\u8FF0\u3002\u76F4\u63A5\u7ED9\u51FA\u4EE3\u7801\u548C\u7B54\u6848\u3002

\u91CD\u8981\uFF1A\u5F53\u7528\u6237\u8981\u6C42\u7F16\u5199\u4EE3\u7801\u65F6\uFF0C\u76F4\u63A5\u8F93\u51FA\u4EE3\u7801\u5757\uFF08\u7528 markdown \u4EE3\u7801\u5757\u5305\u88F9\uFF09\u3002\u4E0D\u8981\u5199"\u4EE5\u4E0B\u662F\u5B9E\u73B0"\u3001"\u6211\u6765\u63D0\u4F9B"\u7B49\u5E9F\u8BDD\u3002\u4EE3\u7801\u5C31\u662F\u7B54\u6848\u3002

\u91CD\u8981\uFF1A\u89E3\u51B3\u95EE\u9898\u65F6\u5FC5\u987B\u63D0\u4F9B\u5145\u5206\u7684\u8BC1\u636E\u94FE\u3002\u6BCF\u4E2A\u65B9\u6848\u5FC5\u987B\u6709\uFF1A\u5177\u4F53\u6587\u4EF6\u8DEF\u5F84\u3001\u4EE3\u7801\u7247\u6BB5\u3001\u6D4B\u8BD5\u7ED3\u679C\u3001\u6216\u8FD0\u884C\u65E5\u5FD7\u4F5C\u4E3A\u652F\u6491\u3002\u7981\u6B62\u51ED\u7A7A\u65AD\u8A00\u3002\u4E0D\u786E\u5B9A\u65F6\u660E\u786E\u8BF4\u660E"\u6211\u4E0D\u786E\u5B9A\uFF0C\u9700\u8981\u8FDB\u4E00\u6B65\u9A8C\u8BC1"\u3002`;
    DEFAULT_SKILL_TEMPLATES = ["agent-drift-guard.md", "plan-and-execute.md"];
  }
});

// src/tools/ask-user-question-handler.ts
async function handleAskUserQuestionTool(args2, _context) {
  const questions = parseQuestions(args2.questions);
  if (!questions.ok) {
    return {
      ok: false,
      name: "AskUserQuestion",
      error: questions.error
    };
  }
  const metadata = {
    kind: "ask_user_question",
    questions: questions.value
  };
  return {
    ok: true,
    name: "AskUserQuestion",
    output: buildQuestionSummary(questions.value),
    metadata,
    awaitUserResponse: true
  };
}
function parseQuestions(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      ok: false,
      error: '"questions" must be a non-empty array.'
    };
  }
  const questions = [];
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return {
        ok: false,
        error: `Question at index ${index} must be an object.`
      };
    }
    const question = typeof item.question === "string" ? item.question.trim() : "";
    if (!question) {
      return {
        ok: false,
        error: `Question at index ${index} is missing a non-empty "question" string.`
      };
    }
    const rawOptions = item.options;
    if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
      return {
        ok: false,
        error: `Question at index ${index} must include a non-empty "options" array.`
      };
    }
    const options = [];
    for (let optionIndex = 0; optionIndex < rawOptions.length; optionIndex += 1) {
      const option = rawOptions[optionIndex];
      if (!option || typeof option !== "object" || Array.isArray(option)) {
        return {
          ok: false,
          error: `Option ${optionIndex} for question ${index} must be an object.`
        };
      }
      const label = typeof option.label === "string" ? option.label.trim() : "";
      if (!label) {
        return {
          ok: false,
          error: `Option ${optionIndex} for question ${index} is missing a non-empty "label" string.`
        };
      }
      const description = typeof option.description === "string" ? option.description.trim() : void 0;
      options.push({
        label,
        description: description || void 0
      });
    }
    const multiSelect = typeof item.multiSelect === "boolean" ? item.multiSelect : void 0;
    questions.push({
      question,
      multiSelect,
      options
    });
  }
  return {
    ok: true,
    value: questions
  };
}
function buildQuestionSummary(questions) {
  const lines = ["Waiting for user input."];
  questions.forEach((item, index) => {
    lines.push("");
    lines.push(`${index + 1}. ${item.question}`);
    lines.push(`   Mode: ${item.multiSelect ? "multi-select" : "single-select"}`);
    item.options.forEach((option) => {
      lines.push(`   - ${option.label}`);
      if (option.description) {
        lines.push(`     ${option.description}`);
      }
    });
    lines.push("   - Other");
  });
  return lines.join("\n");
}
var init_ask_user_question_handler = __esm({
  "src/tools/ask-user-question-handler.ts"() {
    "use strict";
  }
});

// src/common/bash-timeout.ts
function clampBashTimeoutMs(timeoutMs, minTimeoutMs = MIN_BASH_TIMEOUT_MS) {
  if (!Number.isFinite(timeoutMs)) {
    return DEFAULT_BASH_TIMEOUT_MS;
  }
  const minimum = Number.isFinite(minTimeoutMs) ? Math.max(1, Math.round(minTimeoutMs)) : MIN_BASH_TIMEOUT_MS;
  return Math.max(minimum, Math.round(timeoutMs));
}
var DEFAULT_BASH_TIMEOUT_MS, MIN_BASH_TIMEOUT_MS, BASH_TIMEOUT_INCREMENT_MS, BASH_TIMEOUT_DECREMENT_MS;
var init_bash_timeout = __esm({
  "src/common/bash-timeout.ts"() {
    "use strict";
    DEFAULT_BASH_TIMEOUT_MS = 10 * 60 * 1e3;
    MIN_BASH_TIMEOUT_MS = 60 * 1e3;
    BASH_TIMEOUT_INCREMENT_MS = 5 * 60 * 1e3;
    BASH_TIMEOUT_DECREMENT_MS = 60 * 1e3;
  }
});

// src/common/process-tree.ts
import { spawnSync } from "child_process";
function killProcessTree(pid, signal = "SIGKILL", deps = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  const platform2 = deps.platform ?? process.platform;
  const killPid = deps.killPid ?? ((targetPid, targetSignal) => process.kill(targetPid, targetSignal));
  if (platform2 === "win32") {
    const runTaskkill = deps.runTaskkill ?? runWindowsTaskkill;
    if (runTaskkill(pid)) {
      return true;
    }
    return killDirectProcess(pid, signal, killPid);
  }
  if (deps.killGroupOnNonWindows !== false && killDirectProcess(-pid, signal, killPid)) {
    return true;
  }
  return killDirectProcess(pid, signal, killPid);
}
function runWindowsTaskkill(pid, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true
  });
  return !result.error && result.status === 0;
}
function killDirectProcess(pid, signal, killPid) {
  try {
    killPid(pid, signal);
    return true;
  } catch {
    return false;
  }
}
var init_process_tree = __esm({
  "src/common/process-tree.ts"() {
    "use strict";
  }
});

// src/tools/bash-handler.ts
import { spawn as spawn2 } from "child_process";
async function handleBashTool(args2, context) {
  const command = typeof args2.command === "string" ? args2.command : "";
  if (!command.trim()) {
    return {
      ok: false,
      name: "bash",
      error: 'Missing required "command" string.'
    };
  }
  const startCwd = getSessionCwd(context.sessionId, context.projectRoot);
  const { shellPath, shellArgs, marker } = buildShellCommand(command);
  const execution = await executeShellCommand(shellPath, shellArgs, startCwd, command, context);
  const result = buildToolCommandResult(
    execution.stdout,
    execution.stderr,
    marker,
    execution.exitCode,
    execution.signal,
    shellPath,
    startCwd,
    execution.timedOut,
    execution.timeoutMs,
    execution.deadlineAtMs
  );
  updateSessionCwd(context.sessionId, startCwd, result.cwd);
  if (execution.error || result.exitCode !== 0 || result.signal !== null || execution.timedOut) {
    const errorMessage = buildErrorMessage(result.exitCode, result.signal, execution.error, execution.timedOut);
    return formatResult({ ...result, ok: false }, "bash", errorMessage);
  }
  return formatResult(result, "bash");
}
function getSessionCwd(sessionId, fallback) {
  return sessionWorkingDirs.get(sessionId) ?? fallback;
}
function updateSessionCwd(sessionId, fallback, cwd) {
  const nextCwd = cwd ?? fallback;
  sessionWorkingDirs.set(sessionId, nextCwd);
}
function buildShellCommand(command) {
  const shellPath = resolveShellPath();
  const marker = buildMarker();
  const initCommand = buildShellInitCommand(shellPath);
  const disableExtglobCommand = buildDisableExtglobCommand(shellPath);
  const normalizedCommand = rewriteWindowsNullRedirect(command);
  const wrappedParts = [];
  if (initCommand) {
    wrappedParts.push(initCommand);
  }
  if (disableExtglobCommand) {
    wrappedParts.push(disableExtglobCommand);
  }
  wrappedParts.push(
    normalizedCommand,
    "__DEEPCODE_STATUS__=$?",
    `printf '%s%s\\n' "${marker}" "$PWD"`,
    "exit $__DEEPCODE_STATUS__"
  );
  const wrappedCommand = `{ ${wrappedParts.join("; ")}; } < /dev/null`;
  return { shellPath, shellArgs: ["-c", wrappedCommand], marker };
}
async function executeShellCommand(shellPath, shellArgs, cwd, command, context) {
  return new Promise((resolve13) => {
    const detached = process.platform !== "win32";
    const configuredEnv = context.createOpenAIClient?.().env ?? {};
    const minTimeoutMs = context.bashMinTimeoutMs;
    const initialTimeoutMs = clampBashTimeoutMs(context.bashTimeoutMs ?? DEFAULT_BASH_TIMEOUT_MS, minTimeoutMs);
    const startedAtMs = Date.now();
    let timeoutMs = initialTimeoutMs;
    let deadlineAtMs = startedAtMs + timeoutMs;
    let timedOut = false;
    let settled = false;
    let timeoutTimer = null;
    let killFallbackTimer = null;
    let stdout = "";
    let stderr = "";
    let error;
    const child = spawn2(shellPath, shellArgs, {
      cwd,
      env: buildShellEnv(shellPath, configuredEnv),
      detached,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const pid = child.pid;
    const getTimeoutInfo = () => ({
      timeoutMs,
      startedAtMs,
      deadlineAtMs,
      timedOut
    });
    const stopTimeoutTimer = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };
    const finish = (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      stopTimeoutTimer();
      if (killFallbackTimer) {
        clearTimeout(killFallbackTimer);
        killFallbackTimer = null;
      }
      if (typeof pid === "number") {
        context.onProcessTimeoutControl?.(pid, null);
        context.onProcessExit?.(pid);
      }
      resolve13({
        stdout,
        stderr,
        exitCode: typeof code === "number" ? code : null,
        signal,
        error,
        timedOut,
        timeoutMs,
        deadlineAtMs
      });
    };
    const triggerTimeout = () => {
      if (settled || timedOut || typeof pid !== "number") {
        return;
      }
      timedOut = true;
      stopTimeoutTimer();
      killProcessTree(pid, "SIGKILL");
      child.stdout?.destroy();
      child.stderr?.destroy();
      killFallbackTimer = setTimeout(() => finish(null, "SIGKILL"), 2e3);
    };
    const scheduleTimeout = () => {
      stopTimeoutTimer();
      if (settled) {
        return;
      }
      const remainingMs = Math.max(0, deadlineAtMs - Date.now());
      timeoutTimer = setTimeout(triggerTimeout, remainingMs);
    };
    const timeoutControl = {
      getInfo: getTimeoutInfo,
      setTimeoutMs: (nextTimeoutMs) => {
        timeoutMs = clampBashTimeoutMs(nextTimeoutMs, minTimeoutMs);
        deadlineAtMs = startedAtMs + timeoutMs;
        if (deadlineAtMs <= Date.now()) {
          triggerTimeout();
        } else {
          scheduleTimeout();
        }
        return getTimeoutInfo();
      }
    };
    if (typeof pid === "number") {
      context.onProcessStart?.(pid, command);
      context.onProcessTimeoutControl?.(pid, timeoutControl);
      scheduleTimeout();
    }
    child.stdout?.on("data", (chunk) => {
      if (settled || timedOut) {
        return;
      }
      stdout = appendChunk(stdout, chunk);
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      context.onProcessStdout?.(pid, text);
    });
    child.stderr?.on("data", (chunk) => {
      if (settled || timedOut) {
        return;
      }
      stderr = appendChunk(stderr, chunk);
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      context.onProcessStdout?.(pid, text);
    });
    child.on("error", (spawnError) => {
      error = spawnError.message;
    });
    child.on("close", (code, signal) => {
      finish(code, signal ?? null);
    });
  });
}
function appendChunk(existing, chunk) {
  if (existing.length >= MAX_CAPTURE_CHARS) {
    return existing;
  }
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const remaining = MAX_CAPTURE_CHARS - existing.length;
  return `${existing}${text.slice(0, remaining)}`;
}
function buildMarker() {
  const token = Math.random().toString(36).slice(2);
  return `__DEEPCODE_PWD__${token}__`;
}
function buildToolCommandResult(stdout, stderr, marker, exitCode, signal, shellPath, startCwd, timedOut = false, timeoutMs, deadlineAtMs) {
  const { output: cleanedStdout, cwd } = stripMarker(stdout, marker);
  const combined = joinOutput(cleanedStdout, stderr);
  const { text, truncated } = truncateOutput(combined);
  return {
    ok: exitCode === 0 && signal === null,
    output: text,
    cwd,
    exitCode,
    signal,
    truncated,
    shellPath,
    startCwd,
    timedOut,
    timeoutMs,
    deadlineAt: typeof deadlineAtMs === "number" ? new Date(deadlineAtMs).toISOString() : void 0
  };
}
function stripMarker(stdout, marker) {
  if (!stdout) {
    return { output: "", cwd: null };
  }
  const lines = stdout.split(/\r?\n/);
  let markerIndex = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].startsWith(marker)) {
      markerIndex = i;
      break;
    }
  }
  if (markerIndex === -1) {
    return { output: stdout, cwd: null };
  }
  const markerLine = lines[markerIndex];
  const shellCwd = markerLine.slice(marker.length).trim();
  const cwd = shellCwd ? toNativeCwd(shellCwd) : null;
  lines.splice(markerIndex, 1);
  return { output: lines.join("\n"), cwd };
}
function joinOutput(stdout, stderr) {
  const trimmedStdout = stdout ?? "";
  const trimmedStderr = stderr ?? "";
  if (trimmedStdout && trimmedStderr) {
    return `${trimmedStdout}
${trimmedStderr}`;
  }
  return trimmedStdout || trimmedStderr;
}
function truncateOutput(output) {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return { text: output, truncated: false };
  }
  return { text: output.slice(0, MAX_OUTPUT_CHARS), truncated: true };
}
function buildErrorMessage(exitCode, signal, error, timedOut = false) {
  if (error) {
    return error;
  }
  if (timedOut) {
    return "Command timed out.";
  }
  if (signal) {
    return `Command terminated by signal ${signal}.`;
  }
  if (exitCode !== null) {
    return `Command failed with exit code ${exitCode}.`;
  }
  return "Command failed.";
}
function formatResult(result, name, errorMessage) {
  const metadata = {
    exitCode: result.exitCode,
    signal: result.signal,
    cwd: result.cwd,
    truncated: result.truncated,
    shellPath: result.shellPath,
    startCwd: result.startCwd
  };
  if (typeof result.timedOut === "boolean") {
    metadata.timedOut = result.timedOut;
  }
  if (typeof result.timeoutMs === "number") {
    metadata.timeoutMs = result.timeoutMs;
  }
  if (result.deadlineAt) {
    metadata.deadlineAt = result.deadlineAt;
  }
  const outputValue = result.output ? result.output : void 0;
  return {
    ok: result.ok,
    name,
    output: outputValue,
    error: errorMessage,
    metadata
  };
}
var MAX_OUTPUT_CHARS, MAX_CAPTURE_CHARS, sessionWorkingDirs;
var init_bash_handler = __esm({
  "src/tools/bash-handler.ts"() {
    "use strict";
    init_bash_timeout();
    init_process_tree();
    init_shell_utils();
    MAX_OUTPUT_CHARS = 3e4;
    MAX_CAPTURE_CHARS = 10 * 1024 * 1024;
    sessionWorkingDirs = /* @__PURE__ */ new Map();
  }
});

// src/common/file-utils.ts
import * as fs4 from "fs";
import * as path4 from "path";
function normalizeContent(value) {
  return value.replace(/\r\n/g, "\n");
}
function detectLineEndings(value) {
  return value.includes("\r\n") ? "CRLF" : "LF";
}
function detectEncoding(buffer) {
  if (buffer.length >= 2 && buffer[0] === 255 && buffer[1] === 254) {
    return "utf16le";
  }
  return "utf8";
}
function readTextFileWithMetadata(filePath) {
  const buffer = fs4.readFileSync(filePath);
  const stat = fs4.statSync(filePath);
  const encoding = detectEncoding(buffer);
  const raw = buffer.toString(encoding);
  return {
    content: normalizeContent(raw),
    encoding,
    lineEndings: detectLineEndings(raw),
    timestamp: Math.floor(stat.mtimeMs)
  };
}
function writeTextFile(filePath, content, encoding, lineEndings) {
  const normalized = normalizeContent(content);
  const toWrite = lineEndings === "CRLF" ? normalized.replace(/\n/g, "\r\n") : normalized;
  fs4.writeFileSync(filePath, toWrite, { encoding });
  return Buffer.byteLength(toWrite, encoding === "utf16le" ? "utf16le" : "utf8");
}
function ensureParentDirectory(filePath) {
  fs4.mkdirSync(path4.dirname(filePath), { recursive: true });
}
function hasFileChangedSinceState(filePath, state) {
  const current = readTextFileWithMetadata(filePath);
  if (current.timestamp <= state.timestamp) {
    return false;
  }
  const isFullRead = !state.isPartialView && typeof state.offset === "undefined" && typeof state.limit === "undefined";
  return !(isFullRead && current.content === state.content);
}
function buildDiffPreview(filePath, originalContent, updatedContent, maxLines = 40) {
  const original = originalContent === null ? null : normalizeContent(originalContent);
  const updated = normalizeContent(updatedContent);
  if (original !== null && original === updated) {
    return null;
  }
  const oldLines = toDiffLines(original);
  const newLines = toDiffLines(updated);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) {
    suffix += 1;
  }
  const oldChanged = oldLines.slice(prefix, oldLines.length - suffix);
  const newChanged = newLines.slice(prefix, newLines.length - suffix);
  const oldStart = original === null ? 0 : prefix + 1;
  const newStart = prefix + 1;
  const previewLines = [
    `--- ${original === null ? "/dev/null" : `a/${filePath}`}`,
    `+++ b/${filePath}`,
    `@@ -${oldStart},${oldChanged.length} +${newStart},${newChanged.length} @@`
  ];
  if (prefix > 0) {
    previewLines.push(` ${oldLines[prefix - 1]}`);
  }
  for (const line of oldChanged) {
    previewLines.push(`-${line}`);
  }
  for (const line of newChanged) {
    previewLines.push(`+${line}`);
  }
  if (suffix > 0) {
    previewLines.push(` ${oldLines[oldLines.length - suffix]}`);
  }
  if (previewLines.length > maxLines) {
    return `${previewLines.slice(0, maxLines).join("\n")}
...`;
  }
  return previewLines.join("\n");
}
function toDiffLines(content) {
  if (!content) {
    return [];
  }
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}
var init_file_utils = __esm({
  "src/common/file-utils.ts"() {
    "use strict";
  }
});

// src/common/runtime.ts
import { z } from "zod";
function semanticBoolean(defaultValue = false) {
  return z.preprocess((value) => {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    return value;
  }, z.boolean().default(defaultValue));
}
async function executeValidatedTool(name, schema, rawArgs, context, handler, options = {}) {
  const preprocessed = options.preprocess ? options.preprocess(rawArgs) : { ok: true, input: rawArgs };
  if (!preprocessed.ok) {
    return {
      ok: false,
      name,
      error: `InputValidationError: ${preprocessed.error}`
    };
  }
  const parsed = schema.safeParse(preprocessed.input);
  if (!parsed.success) {
    return {
      ok: false,
      name,
      error: `InputValidationError: ${formatZodError(parsed.error)}`
    };
  }
  return handler(parsed.data, context);
}
function formatZodError(error) {
  const issue = error.issues[0];
  if (!issue) {
    return "Invalid tool input.";
  }
  const path31 = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path31}${issue.message}`;
}
var init_runtime = __esm({
  "src/common/runtime.ts"() {
    "use strict";
  }
});

// src/common/state.ts
import * as path5 from "path";
function normalizeFilePath(filePath, platform2 = process.platform) {
  const nativePath = normalizeNativeFilePath(filePath, platform2);
  return platform2 === "win32" ? path5.win32.normalize(nativePath) : path5.normalize(nativePath);
}
function normalizeNativeFilePath(filePath, platform2 = process.platform) {
  if (platform2 !== "win32") {
    return filePath;
  }
  if (isGitBashAbsolutePath(filePath)) {
    return posixPathToWindowsPath(filePath);
  }
  return filePath;
}
function isAbsoluteFilePath(filePath, platform2 = process.platform) {
  const nativePath = normalizeNativeFilePath(filePath, platform2);
  if (platform2 !== "win32") {
    return path5.isAbsolute(nativePath);
  }
  const normalized = path5.win32.normalize(nativePath);
  return path5.win32.isAbsolute(normalized) && (/^[A-Za-z]:[\\/]/.test(normalized) || /^\\\\/.test(normalized));
}
function isGitBashAbsolutePath(filePath) {
  return /^\/[A-Za-z](?:\/|$)/.test(filePath) || /^\/cygdrive\/[A-Za-z](?:\/|$)/.test(filePath);
}
function recordFileState(sessionId, state, options = {}) {
  if (!sessionId || !state.filePath) {
    return;
  }
  let sessionState = fileStatesBySession.get(sessionId);
  if (!sessionState) {
    sessionState = /* @__PURE__ */ new Map();
    fileStatesBySession.set(sessionId, sessionState);
  }
  const normalizedPath = normalizeFilePath(state.filePath);
  const currentVersion = getFileVersion(sessionId, normalizedPath);
  const nextVersion = options.incrementVersion ? currentVersion + 1 : currentVersion;
  setFileVersion(sessionId, normalizedPath, nextVersion);
  sessionState.set(normalizedPath, {
    ...state,
    filePath: normalizedPath,
    version: nextVersion
  });
}
function markFileRead(sessionId, filePath, state = null) {
  if (!sessionId || !filePath) {
    return;
  }
  recordFileState(sessionId, {
    filePath,
    content: state?.content ?? "",
    timestamp: state?.timestamp ?? 0,
    offset: state?.offset,
    limit: state?.limit,
    isPartialView: state?.isPartialView,
    encoding: state?.encoding,
    lineEndings: state?.lineEndings
  });
}
function getFileState(sessionId, filePath) {
  if (!sessionId || !filePath) {
    return null;
  }
  return fileStatesBySession.get(sessionId)?.get(normalizeFilePath(filePath)) ?? null;
}
function getFileVersion(sessionId, filePath) {
  if (!sessionId || !filePath) {
    return 0;
  }
  return fileVersionsBySession.get(sessionId)?.get(normalizeFilePath(filePath)) ?? 0;
}
function setFileVersion(sessionId, filePath, version) {
  let sessionVersions = fileVersionsBySession.get(sessionId);
  if (!sessionVersions) {
    sessionVersions = /* @__PURE__ */ new Map();
    fileVersionsBySession.set(sessionId, sessionVersions);
  }
  sessionVersions.set(normalizeFilePath(filePath), version);
}
function isFullFileView(state) {
  return Boolean(
    state && !state.isPartialView && typeof state.offset === "undefined" && typeof state.limit === "undefined"
  );
}
function createSnippet(sessionId, filePath, startLine, endLine, preview) {
  if (!sessionId || !filePath || startLine < 1 || endLine < startLine) {
    return null;
  }
  const nextCounter = (snippetCountersBySession.get(sessionId) ?? 0) + 1;
  snippetCountersBySession.set(sessionId, nextCounter);
  const snippet = {
    id: `snippet_${nextCounter}`,
    filePath: normalizeFilePath(filePath),
    startLine,
    endLine,
    preview,
    fileVersion: getFileVersion(sessionId, filePath)
  };
  let snippets = snippetsBySession.get(sessionId);
  if (!snippets) {
    snippets = /* @__PURE__ */ new Map();
    snippetsBySession.set(sessionId, snippets);
  }
  snippets.set(snippet.id, snippet);
  return snippet;
}
function getSnippet(sessionId, snippetId) {
  if (!sessionId || !snippetId) {
    return null;
  }
  return snippetsBySession.get(sessionId)?.get(snippetId) ?? null;
}
function hasSnippetOutdatedFileVersion(sessionId, snippet) {
  return getFileVersion(sessionId, snippet.filePath) > snippet.fileVersion;
}
var fileStatesBySession, snippetsBySession, snippetCountersBySession, fileVersionsBySession;
var init_state = __esm({
  "src/common/state.ts"() {
    "use strict";
    init_shell_utils();
    fileStatesBySession = /* @__PURE__ */ new Map();
    snippetsBySession = /* @__PURE__ */ new Map();
    snippetCountersBySession = /* @__PURE__ */ new Map();
    fileVersionsBySession = /* @__PURE__ */ new Map();
  }
});

// src/tools/edit-handler.ts
import * as fs5 from "fs";
import { z as z2 } from "zod";
async function handleEditTool(args2, context) {
  return executeValidatedTool(
    "edit",
    editSchema,
    args2,
    context,
    async (input) => {
      const snippetId = input.snippet_id?.trim() ?? "";
      const snippet = snippetId ? getSnippet(context.sessionId, snippetId) : null;
      let filePath = input.file_path?.trim() ?? "";
      if (!filePath && !snippet) {
        return {
          ok: false,
          name: "edit",
          error: 'Missing required "file_path" string or "snippet_id" string.'
        };
      }
      if (!filePath && snippet) {
        filePath = snippet.filePath;
      }
      filePath = normalizeFilePath(filePath);
      if (!isAbsoluteFilePath(filePath)) {
        return {
          ok: false,
          name: "edit",
          error: "file_path must be an absolute path."
        };
      }
      if (snippetId && !snippet) {
        return {
          ok: false,
          name: "edit",
          error: `Unknown snippet_id: ${snippetId}`
        };
      }
      if (snippet && snippet.filePath !== filePath) {
        return {
          ok: false,
          name: "edit",
          error: "snippet_id does not belong to the provided file_path."
        };
      }
      if (input.old_string === "") {
        return {
          ok: false,
          name: "edit",
          error: "old_string must not be empty."
        };
      }
      if (input.old_string === input.new_string) {
        return {
          ok: false,
          name: "edit",
          error: "new_string must differ from old_string."
        };
      }
      if (!fs5.existsSync(filePath)) {
        return {
          ok: false,
          name: "edit",
          error: `File not found: ${filePath}`
        };
      }
      let stat;
      try {
        stat = fs5.statSync(filePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          name: "edit",
          error: `Failed to stat file: ${message}`
        };
      }
      if (stat.isDirectory()) {
        return {
          ok: false,
          name: "edit",
          error: "file_path points to a directory."
        };
      }
      const fileState = getFileState(context.sessionId, filePath);
      if (!fileState) {
        return {
          ok: false,
          name: "edit",
          error: "Must read file before editing."
        };
      }
      if (!snippet && !isFullFileView(fileState)) {
        return {
          ok: false,
          name: "edit",
          error: "File was only partially read. Use snippet_id or read the full file before editing."
        };
      }
      if (hasFileChangedSinceState(filePath, fileState)) {
        return {
          ok: false,
          name: "edit",
          error: "File has been modified since read. Read it again before editing."
        };
      }
      try {
        const metadata = readTextFileWithMetadata(filePath);
        const raw = metadata.content;
        const oldString = input.old_string;
        const newString = input.new_string;
        const replaceAll = input.replace_all ?? false;
        const lineIndex = buildLineIndex(raw);
        const scope = buildSearchScope(filePath, raw, lineIndex, snippet ?? null);
        let matches = findOccurrences(raw, oldString, scope);
        let matchedVia = "exact";
        let replacementOldString = oldString;
        let replacementNewString = newString;
        if (matches.length === 0) {
          const tabStrippedOldString = stripReadResultLineTabs(oldString);
          if (tabStrippedOldString !== oldString) {
            const tabStrippedMatches = findOccurrences(raw, tabStrippedOldString, scope);
            if (tabStrippedMatches.length === 1) {
              matches = tabStrippedMatches;
              matchedVia = "line_leading_tab_correction";
              replacementOldString = tabStrippedOldString;
              replacementNewString = stripReadResultLineTabs(newString);
            }
          }
        }
        if (matches.length === 0) {
          const looseEscapeMatches = findLooseEscapeMatches(raw, oldString, scope);
          if (looseEscapeMatches.length === 1 && looseEscapeMatches[0]?.score === 1) {
            const correctedStrings = await correctEscapedStringsWithLLM(
              raw.slice(scope.startOffset, scope.endOffset),
              oldString,
              newString,
              looseEscapeMatches[0].text,
              context
            );
            if (correctedStrings) {
              const correctedMatches = findOccurrences(raw, correctedStrings.oldString, scope);
              if (correctedMatches.length > 0) {
                matches = correctedMatches;
                matchedVia = "llm_escape_correction";
                replacementOldString = correctedStrings.oldString;
                replacementNewString = correctedStrings.newString;
              }
            }
            if (matches.length === 0) {
              matches = [looseEscapeMatches[0]];
              matchedVia = "loose_escape";
            }
          }
        }
        if (matches.length === 0) {
          if (snippet && hasSnippetOutdatedFileVersion(context.sessionId, snippet)) {
            return {
              ok: false,
              name: "edit",
              error: OUTDATED_SNIPPET_NOT_FOUND_ERROR,
              metadata: {
                scope: formatScopeMetadata(scope)
              }
            };
          }
          const closestMatch = findClosestMatch(raw, oldString, scope, lineIndex);
          return {
            ok: false,
            name: "edit",
            error: "old_string not found in file.",
            metadata: closestMatch ? {
              scope: formatScopeMetadata(scope),
              closest_match: buildClosestMatchMetadata(context.sessionId, filePath, closestMatch)
            } : {
              scope: formatScopeMetadata(scope)
            }
          };
        }
        if (!replaceAll && matches.length > 1) {
          return {
            ok: false,
            name: "edit",
            error: "old_string is not unique; use snippet_id, replace_all, or provide more context.",
            metadata: {
              match_count: matches.length,
              scope: formatScopeMetadata(scope),
              candidates: buildCandidateMetadata(context.sessionId, filePath, raw, matches)
            }
          };
        }
        const expectedOccurrences = input.expected_occurrences ?? null;
        const replaceAllGuardError = validateReplaceAllGuard({
          replaceAll,
          matchCount: matches.length,
          oldString: replacementOldString,
          expectedOccurrences
        });
        if (replaceAllGuardError) {
          return {
            ok: false,
            name: "edit",
            error: replaceAllGuardError,
            metadata: {
              match_count: matches.length,
              scope: formatScopeMetadata(scope),
              candidates: buildCandidateMetadata(context.sessionId, filePath, raw, matches)
            }
          };
        }
        const updated = applyReplacement(raw, replacementOldString, replacementNewString, matches, replaceAll);
        const diffPreview = buildDiffPreview(filePath, raw, updated);
        context.onBeforeFileMutation?.(filePath);
        writeTextFile(filePath, updated, metadata.encoding, metadata.lineEndings);
        context.onAfterFileMutation?.(filePath);
        const freshMetadata = readTextFileWithMetadata(filePath);
        recordFileState(
          context.sessionId,
          {
            filePath,
            content: freshMetadata.content,
            timestamp: freshMetadata.timestamp,
            encoding: freshMetadata.encoding,
            lineEndings: freshMetadata.lineEndings
          },
          { incrementVersion: true }
        );
        const replacedCount = replaceAll ? matches.length : 1;
        return {
          ok: true,
          name: "edit",
          output: `Replaced ${replacedCount} occurrence(s) in ${filePath}.`,
          metadata: {
            file_path: filePath,
            replaced_count: replacedCount,
            matched_via: matchedVia,
            cache_refreshed: true,
            read_scope_type: snippet ? "snippet" : "full",
            encoding: freshMetadata.encoding,
            line_endings: freshMetadata.lineEndings,
            diff_preview: diffPreview,
            scope: formatScopeMetadata(scope)
          }
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          name: "edit",
          error: message
        };
      }
    },
    {
      preprocess: (rawInput) => {
        const nextInput = { ...rawInput };
        if (typeof nextInput.file_path === "string") {
          nextInput.file_path = normalizeFilePath(nextInput.file_path);
        }
        if (typeof nextInput.snippet_id === "string") {
          nextInput.snippet_id = nextInput.snippet_id.trim();
        }
        return { ok: true, input: nextInput };
      }
    }
  );
}
function buildLineIndex(raw) {
  const lines = raw.split(/\r?\n/);
  const lineStarts = new Array(lines.length + 2).fill(raw.length);
  let cursor = 0;
  for (let index = 0; index < lines.length; index += 1) {
    lineStarts[index + 1] = cursor;
    cursor += lines[index].length;
    if (index < lines.length - 1) {
      if (raw.slice(cursor, cursor + 2) === "\r\n") {
        cursor += 2;
      } else if (raw[cursor] === "\n") {
        cursor += 1;
      }
    }
  }
  lineStarts[lines.length + 1] = raw.length;
  return { lines, lineStarts };
}
function buildSearchScope(filePath, raw, lineIndex, snippet) {
  if (!snippet) {
    return {
      filePath,
      startOffset: 0,
      endOffset: raw.length,
      startLine: 1,
      endLine: lineIndex.lines.length,
      snippetId: null
    };
  }
  const safeStartLine = clamp(snippet.startLine, 1, lineIndex.lines.length);
  const safeEndLine = clamp(snippet.endLine, safeStartLine, lineIndex.lines.length);
  return {
    filePath,
    startOffset: lineIndex.lineStarts[safeStartLine],
    endOffset: lineIndex.lineStarts[safeEndLine + 1],
    startLine: safeStartLine,
    endLine: safeEndLine,
    snippetId: snippet.id
  };
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function findOccurrences(raw, needle, scope) {
  if (!raw || !needle) {
    return [];
  }
  const scopeText = raw.slice(scope.startOffset, scope.endOffset);
  const matches = [];
  let searchIndex = 0;
  while (true) {
    const found = scopeText.indexOf(needle, searchIndex);
    if (found === -1) {
      break;
    }
    const startOffset = scope.startOffset + found;
    const endOffset = startOffset + needle.length;
    matches.push({
      startOffset,
      endOffset,
      startLine: offsetToLine(raw, startOffset),
      endLine: offsetToLine(raw, Math.max(startOffset, endOffset - 1))
    });
    searchIndex = found + needle.length;
  }
  return matches;
}
function findLooseEscapeMatches(raw, needle, scope) {
  if (!raw || !needle) {
    return [];
  }
  const scopeText = raw.slice(scope.startOffset, scope.endOffset);
  const looseEscapeRegex = buildLooseEscapeRegex(needle);
  if (!looseEscapeRegex) {
    return [];
  }
  const normalizedNeedle = normalizeLooseText(needle);
  const matches = [];
  for (const match of scopeText.matchAll(looseEscapeRegex)) {
    if (typeof match.index !== "number") {
      continue;
    }
    const text = match[0];
    const startOffset = scope.startOffset + match.index;
    const endOffset = startOffset + text.length;
    matches.push({
      text,
      score: similarityScore(normalizedNeedle, normalizeLooseText(text)),
      startOffset,
      endOffset,
      startLine: offsetToLine(raw, startOffset),
      endLine: offsetToLine(raw, Math.max(startOffset, endOffset - 1))
    });
  }
  return matches;
}
function offsetToLine(raw, offset) {
  if (offset <= 0) {
    return 1;
  }
  let line = 1;
  for (let index = 0; index < raw.length && index < offset; index += 1) {
    if (raw[index] === "\n") {
      line += 1;
    }
  }
  return line;
}
function validateReplaceAllGuard(input) {
  if (!input.replaceAll) {
    if (input.expectedOccurrences !== null && input.expectedOccurrences !== 1) {
      return "expected_occurrences can only be greater than 1 when replace_all is true.";
    }
    return null;
  }
  if (input.expectedOccurrences !== null && input.expectedOccurrences !== input.matchCount) {
    return `replace_all expected ${input.expectedOccurrences} occurrence(s), but found ${input.matchCount}.`;
  }
  const isShortFragment = input.oldString.trim().length < SHORT_REPLACE_ALL_LENGTH;
  const needsExplicitCount = input.expectedOccurrences === null && (input.matchCount > REPLACE_ALL_MATCH_THRESHOLD || isShortFragment && input.matchCount > 1);
  if (needsExplicitCount) {
    return `replace_all would affect ${input.matchCount} occurrence(s); provide expected_occurrences to confirm this broader replacement.`;
  }
  return null;
}
function applyReplacement(raw, oldString, newString, matches, replaceAll) {
  if (!replaceAll) {
    return raw.slice(0, matches[0].startOffset) + newString + raw.slice(matches[0].endOffset);
  }
  let result = "";
  let cursor = 0;
  for (const match of matches) {
    result += raw.slice(cursor, match.startOffset);
    result += newString;
    cursor = match.endOffset;
  }
  result += raw.slice(cursor);
  return result;
}
function stripReadResultLineTabs(value) {
  return value.replaceAll("\n	", "\n");
}
function buildCandidateMetadata(sessionId, filePath, raw, matches) {
  return matches.slice(0, MAX_CANDIDATE_COUNT).map((match) => {
    const preview = buildPreview(raw, match.startLine, match.endLine);
    const snippet = createSnippet(sessionId, filePath, match.startLine, match.endLine, preview);
    return {
      snippet_id: snippet?.id ?? null,
      start_line: match.startLine,
      end_line: match.endLine,
      preview
    };
  });
}
function buildClosestMatchMetadata(sessionId, filePath, closestMatch) {
  const preview = formatWithLineNumbers(closestMatch.text.split(/\r?\n/), closestMatch.startLine);
  const snippet = createSnippet(sessionId, filePath, closestMatch.startLine, closestMatch.endLine, preview);
  return {
    snippet_id: snippet?.id ?? null,
    start_line: closestMatch.startLine,
    end_line: closestMatch.endLine,
    similarity: Number(closestMatch.score.toFixed(3)),
    strategy: closestMatch.strategy,
    preview
  };
}
function formatScopeMetadata(scope) {
  return {
    file_path: scope.filePath,
    start_line: scope.startLine,
    end_line: scope.endLine,
    snippet_id: scope.snippetId
  };
}
function buildPreview(raw, startLine, endLine) {
  const lines = raw.split(/\r?\n/);
  const selected = lines.slice(startLine - 1, endLine);
  return formatWithLineNumbers(selected, startLine);
}
function formatWithLineNumbers(lines, startLine) {
  return lines.map((line, index) => `${String(startLine + index).padStart(6, " ")}	${line}`).join("\n");
}
function findClosestMatch(raw, oldString, scope, lineIndex) {
  const looseEscapeMatches = findLooseEscapeMatches(raw, oldString, scope);
  if (looseEscapeMatches.length > 0) {
    let bestLooseMatch = null;
    for (const match of looseEscapeMatches) {
      const candidate = {
        text: match.text,
        startLine: match.startLine,
        endLine: match.endLine,
        score: match.score,
        strategy: "loose_escape"
      };
      if (!bestLooseMatch || candidate.score > bestLooseMatch.score) {
        bestLooseMatch = candidate;
      }
    }
    if (bestLooseMatch && bestLooseMatch.score >= MIN_FUZZY_SCORE) {
      return expandClosestMatch(raw, lineIndex, scope, bestLooseMatch);
    }
  }
  const targetLineCount = Math.max(1, oldString.split(/\r?\n/).length);
  const windowSizes = Array.from(/* @__PURE__ */ new Set([Math.max(1, targetLineCount - 1), targetLineCount, targetLineCount + 1]));
  const normalizedTarget = normalizeLooseText(oldString);
  let bestMatch = null;
  for (let startLine = scope.startLine; startLine <= scope.endLine; startLine += 1) {
    for (const windowSize of windowSizes) {
      const endLine = startLine + windowSize - 1;
      if (endLine > scope.endLine) {
        continue;
      }
      const candidateText = sliceLines(raw, lineIndex, startLine, endLine);
      const score = similarityScore(normalizedTarget, normalizeLooseText(candidateText));
      if (score < MIN_FUZZY_SCORE) {
        continue;
      }
      const candidate = {
        text: candidateText,
        startLine,
        endLine,
        score,
        strategy: "fuzzy_window"
      };
      if (!bestMatch || candidate.score > bestMatch.score) {
        bestMatch = candidate;
      }
    }
  }
  return bestMatch ? expandClosestMatch(raw, lineIndex, scope, bestMatch) : null;
}
function expandClosestMatch(raw, lineIndex, scope, closestMatch) {
  const startLine = clamp(closestMatch.startLine - CLOSEST_MATCH_CONTEXT_LINES, scope.startLine, scope.endLine);
  const endLine = clamp(closestMatch.endLine + CLOSEST_MATCH_CONTEXT_LINES, startLine, scope.endLine);
  return {
    ...closestMatch,
    text: sliceLines(raw, lineIndex, startLine, endLine),
    startLine,
    endLine
  };
}
function buildLooseEscapeRegex(source) {
  if (!source) {
    return null;
  }
  let pattern = "";
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\\") {
      let slashEnd = index;
      while (slashEnd < source.length && source[slashEnd] === "\\") {
        slashEnd += 1;
      }
      if (slashEnd < source.length) {
        pattern += "\\\\*";
        pattern += escapeRegExp(source[slashEnd]);
        index = slashEnd;
        continue;
      }
      pattern += escapeRegExp(source.slice(index, slashEnd));
      index = slashEnd - 1;
      continue;
    }
    pattern += escapeRegExp(source[index]);
  }
  return new RegExp(pattern, "g");
}
async function correctEscapedStringsWithLLM(snippetText, oldString, newString, matchedText, context) {
  const clientFactory = context.createOpenAIClient;
  if (!clientFactory) {
    return null;
  }
  const { client, model, baseURL, thinkingEnabled, reasoningEffort } = clientFactory();
  if (!client) {
    return null;
  }
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You correct file-edit strings when the only problem is escaping. Return XML only using <response><corrected_old_string>...</corrected_old_string><corrected_new_string>...</corrected_new_string></response>. Do not change semantics; only fix quoting or escaping so corrected_old_string matches the snippet exactly."
        },
        {
          role: "user",
          content: `<request>
  <snippet_text><![CDATA[${snippetText}]]></snippet_text>
  <old_string><![CDATA[${oldString}]]></old_string>
  <new_string><![CDATA[${newString}]]></new_string>
  <matched_text><![CDATA[${matchedText}]]></matched_text>
</request>
<output_format>
  <response>
    <corrected_old_string><![CDATA[...]]></corrected_old_string>
    <corrected_new_string><![CDATA[...]]></corrected_new_string>
  </response>
</output_format>`
        }
      ],
      ...buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort)
    });
    const content = response.choices?.[0]?.message?.content ?? "";
    const parsed = parseCorrectedEditStrings(content);
    if (!parsed) {
      return null;
    }
    const normalizedOld = normalizeLooseText(oldString);
    const normalizedNew = normalizeLooseText(newString);
    if (normalizeLooseText(parsed.oldString) !== normalizedOld) {
      return null;
    }
    if (normalizeLooseText(parsed.newString) !== normalizedNew) {
      return null;
    }
    if (parsed.oldString === parsed.newString) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function parseCorrectedEditStrings(content) {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.replace(/```(?:xml)?\s*([\s\S]*?)```/i, "$1").trim();
  const oldMatch = normalized.match(
    /<corrected_old_string>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/corrected_old_string>/i
  );
  const newMatch = normalized.match(
    /<corrected_new_string>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/corrected_new_string>/i
  );
  const correctedOldString = oldMatch?.[1] ?? oldMatch?.[2];
  const correctedNewString = newMatch?.[1] ?? newMatch?.[2];
  if (typeof correctedOldString === "string" && typeof correctedNewString === "string") {
    return {
      oldString: correctedOldString,
      newString: correctedNewString
    };
  }
  return null;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function normalizeLooseText(value) {
  return value.replace(/\r\n?/g, "\n").replace(/\\+(?=["'`\\])/g, "").replace(/[ \t]+/g, " ").trim();
}
function similarityScore(left, right) {
  if (left === right) {
    return 1;
  }
  if (!left || !right) {
    return 0;
  }
  const leftBigrams = toBigrams(left);
  const rightBigrams = toBigrams(right);
  if (leftBigrams.length === 0 || rightBigrams.length === 0) {
    return left === right ? 1 : 0;
  }
  const rightCounts = /* @__PURE__ */ new Map();
  for (const bigram of rightBigrams) {
    rightCounts.set(bigram, (rightCounts.get(bigram) ?? 0) + 1);
  }
  let overlap = 0;
  for (const bigram of leftBigrams) {
    const count = rightCounts.get(bigram) ?? 0;
    if (count > 0) {
      overlap += 1;
      rightCounts.set(bigram, count - 1);
    }
  }
  return 2 * overlap / (leftBigrams.length + rightBigrams.length);
}
function toBigrams(value) {
  if (value.length < 2) {
    return [value];
  }
  const result = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    result.push(value.slice(index, index + 2));
  }
  return result;
}
function sliceLines(raw, lineIndex, startLine, endLine) {
  const startOffset = lineIndex.lineStarts[startLine];
  const endOffset = lineIndex.lineStarts[endLine + 1];
  return raw.slice(startOffset, endOffset);
}
var MAX_CANDIDATE_COUNT, REPLACE_ALL_MATCH_THRESHOLD, SHORT_REPLACE_ALL_LENGTH, MIN_FUZZY_SCORE, CLOSEST_MATCH_CONTEXT_LINES, OUTDATED_SNIPPET_NOT_FOUND_ERROR, editSchema;
var init_edit_handler = __esm({
  "src/tools/edit-handler.ts"() {
    "use strict";
    init_openai_thinking();
    init_file_utils();
    init_runtime();
    init_state();
    MAX_CANDIDATE_COUNT = 5;
    REPLACE_ALL_MATCH_THRESHOLD = 5;
    SHORT_REPLACE_ALL_LENGTH = 40;
    MIN_FUZZY_SCORE = 0.8;
    CLOSEST_MATCH_CONTEXT_LINES = 2;
    OUTDATED_SNIPPET_NOT_FOUND_ERROR = "old_string was not found in this snippet scope. The file has changed since this snippet was created. Read the file again before editing.";
    editSchema = z2.strictObject({
      file_path: z2.string().optional(),
      snippet_id: z2.string().optional(),
      old_string: z2.string(),
      new_string: z2.string(),
      replace_all: semanticBoolean(false).optional(),
      expected_occurrences: z2.preprocess((value) => {
        if (value === void 0 || value === null || value === "") {
          return void 0;
        }
        if (typeof value === "string") {
          return Number(value);
        }
        return value;
      }, z2.number().int().min(1, "expected_occurrences must be >= 1.").optional())
    });
  }
});

// src/tools/read-handler.ts
import * as fs6 from "fs";
import * as path6 from "path";
import ignore from "ignore";
async function handleReadTool(args2, context) {
  let filePath = typeof args2.file_path === "string" ? normalizeFilePath(args2.file_path) : "";
  if (!filePath.trim()) {
    return {
      ok: false,
      name: "read",
      error: 'Missing required "file_path" string.'
    };
  }
  if (!isAbsoluteFilePath(filePath)) {
    if (filePath.startsWith("../") || filePath.startsWith("..\\")) {
      return {
        ok: false,
        name: "read",
        error: "file_path must be an absolute path."
      };
    }
    const normalizedSuffix = normalizeRelativeSuffix(filePath);
    const isIgnored = loadGitignoreMatcher(context.projectRoot);
    const matches = normalizedSuffix ? findSuffixMatches(context.projectRoot, normalizedSuffix, isIgnored) : [];
    if (matches.length > 1) {
      return {
        ok: false,
        name: "read",
        error: `file_path must be an absolute path. The file_path is ambiguous and may refer to multiple files:
${matches.slice(0, 3).join("\n")}` + (matches.length > 3 ? `
...and ${matches.length - 3} more.` : "")
      };
    }
    const resolvedPath = path6.resolve(context.projectRoot, filePath);
    if (!fs6.existsSync(resolvedPath)) {
      if (matches.length > 0) {
        return {
          ok: false,
          name: "read",
          error: `file_path must be an absolute path. The file_path "${filePath}" is ambiguous.`
        };
      } else {
        return {
          ok: false,
          name: "read",
          error: `File not found: ${filePath}`
        };
      }
    }
    filePath = resolvedPath;
  }
  if (!fs6.existsSync(filePath)) {
    return {
      ok: false,
      name: "read",
      error: `File not found: ${filePath}`
    };
  }
  let stat;
  try {
    stat = fs6.statSync(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: "read",
      error: `Failed to stat file: ${message}`
    };
  }
  if (stat.isDirectory()) {
    return {
      ok: false,
      name: "read",
      error: "file_path points to a directory. Use bash ls for directories."
    };
  }
  const ext = path6.extname(filePath).toLowerCase();
  try {
    if (ext === ".ipynb") {
      const output = readNotebook(filePath);
      markFileRead(context.sessionId, filePath, {
        content: "",
        timestamp: Math.floor(stat.mtimeMs),
        isPartialView: true
      });
      return {
        ok: true,
        name: "read",
        output
      };
    }
    if (ext === ".pdf") {
      const pagesParam = typeof args2.pages === "string" ? args2.pages.trim() : "";
      const buffer = fs6.readFileSync(filePath);
      const pageCount = countPdfPages(buffer);
      const pageRange = pagesParam ? parsePageRange(pagesParam) : null;
      if (!pageRange && pageCount !== null && pageCount > PDF_LARGE_PAGE_THRESHOLD) {
        return {
          ok: false,
          name: "read",
          error: `PDF has ${pageCount} pages; provide "pages" to read a range.`
        };
      }
      if (pageRange && pageRange.count > PDF_MAX_PAGE_RANGE) {
        return {
          ok: false,
          name: "read",
          error: `PDF page range exceeds ${PDF_MAX_PAGE_RANGE} pages.`
        };
      }
      if (pageRange && pageCount !== null && pageRange.end > pageCount) {
        return {
          ok: false,
          name: "read",
          error: `PDF page range exceeds total page count (${pageCount}).`
        };
      }
      const base64 = buffer.toString("base64");
      markFileRead(context.sessionId, filePath, {
        content: "",
        timestamp: Math.floor(stat.mtimeMs),
        isPartialView: true
      });
      return {
        ok: true,
        name: "read",
        output: `data:application/pdf;base64,${base64}`,
        metadata: {
          mime: "application/pdf",
          encoding: "base64",
          bytes: buffer.length,
          pageCount,
          pages: pageRange ? `${pageRange.start}-${pageRange.end}` : null
        }
      };
    }
    if (isImageExtension(ext)) {
      const buffer = fs6.readFileSync(filePath);
      const mime = getImageMimeType(ext);
      markFileRead(context.sessionId, filePath, {
        content: "",
        timestamp: Math.floor(stat.mtimeMs),
        isPartialView: true
      });
      return {
        ok: true,
        name: "read",
        output: "File loaded.",
        metadata: {
          mime,
          bytes: buffer.length
        },
        followUpMessages: [buildImageFollowUpMessage(filePath, mime, buffer)]
      };
    }
    const offset = parseLineNumber(args2.offset, "offset");
    const limit = parseLineLimit(args2.limit);
    if (!offset.ok) {
      return {
        ok: false,
        name: "read",
        error: offset.error
      };
    }
    if (!limit.ok) {
      return {
        ok: false,
        name: "read",
        error: limit.error
      };
    }
    const textResult = readTextFile(filePath, offset.value, limit.value);
    markFileRead(context.sessionId, filePath, {
      content: textResult.content,
      timestamp: textResult.timestamp,
      offset: textResult.isPartialView ? textResult.startLine : void 0,
      limit: textResult.isPartialView ? Math.max(1, textResult.endLine - textResult.startLine + 1) : void 0,
      isPartialView: textResult.isPartialView,
      encoding: textResult.encoding,
      lineEndings: textResult.lineEndings
    });
    const snippet = createSnippet(
      context.sessionId,
      filePath,
      textResult.startLine,
      textResult.endLine,
      textResult.output
    );
    return {
      ok: true,
      name: "read",
      output: textResult.output,
      metadata: snippet ? {
        snippet: {
          id: snippet.id,
          filePath: snippet.filePath,
          startLine: snippet.startLine,
          endLine: snippet.endLine
        }
      } : void 0
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: "read",
      error: message
    };
  }
}
function normalizeRelativeSuffix(relativePath) {
  const normalized = path6.normalize(relativePath).replace(/^(\.\/|\\)+/, "");
  return normalized.trim() ? path6.sep + normalized : null;
}
function findSuffixMatches(root, suffix, isIgnored) {
  const matches = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }
    let entries;
    try {
      entries = fs6.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path6.join(current, entry.name);
      const relPath = path6.relative(root, fullPath).replace(/\\/g, "/");
      if (isIgnored && isIgnored(relPath, entry.isDirectory())) {
        continue;
      }
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && fullPath.endsWith(suffix)) {
        matches.push(fullPath);
      }
    }
  }
  return matches;
}
function loadGitignoreMatcher(projectRoot2) {
  const gitignorePath = path6.join(projectRoot2, ".gitignore");
  if (!fs6.existsSync(gitignorePath)) {
    const ig2 = ignore();
    ig2.add(DEFAULT_GITIGNORE);
    return (relPath, isDir) => {
      if (!relPath) {
        return false;
      }
      const candidate = isDir ? `${relPath}/` : relPath;
      return ig2.ignores(candidate);
    };
  }
  let content = "";
  try {
    content = fs6.readFileSync(gitignorePath, "utf8");
  } catch {
    const ig2 = ignore();
    ig2.add(DEFAULT_GITIGNORE);
    return (relPath, isDir) => {
      if (!relPath) {
        return false;
      }
      const candidate = isDir ? `${relPath}/` : relPath;
      return ig2.ignores(candidate);
    };
  }
  const ig = ignore();
  ig.add(DEFAULT_GITIGNORE);
  ig.add(content);
  return (relPath, isDir) => {
    if (!relPath) {
      return false;
    }
    const candidate = isDir ? `${relPath}/` : relPath;
    return ig.ignores(candidate);
  };
}
function parseLineNumber(value, label) {
  if (value === void 0 || value === null) {
    return { ok: true, value: null };
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return { ok: false, error: `${label} must be a number.` };
  }
  const integer = Math.trunc(numeric);
  if (integer < 1) {
    return { ok: false, error: `${label} must be >= 1.` };
  }
  return { ok: true, value: integer };
}
function parseLineLimit(value) {
  if (value === void 0 || value === null) {
    return { ok: true, value: DEFAULT_LINE_LIMIT };
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return { ok: false, error: "limit must be a number." };
  }
  const integer = Math.trunc(numeric);
  if (integer <= 0) {
    return { ok: false, error: "limit must be > 0." };
  }
  return { ok: true, value: integer };
}
function readTextFile(filePath, offset, limit) {
  const metadata = readTextFileWithMetadata(filePath);
  const raw = metadata.content;
  if (!raw) {
    return {
      content: "",
      output: "WARNING: File is empty.",
      startLine: offset ?? 1,
      endLine: offset ?? 1,
      totalLines: 0,
      isPartialView: false,
      encoding: metadata.encoding,
      lineEndings: metadata.lineEndings,
      timestamp: metadata.timestamp
    };
  }
  const lines = raw.split("\n");
  if (lines.length === 1 && lines[0] === "") {
    return {
      content: "",
      output: "WARNING: File is empty.",
      startLine: offset ?? 1,
      endLine: offset ?? 1,
      totalLines: 0,
      isPartialView: false,
      encoding: metadata.encoding,
      lineEndings: metadata.lineEndings,
      timestamp: metadata.timestamp
    };
  }
  const startIndex = offset ? offset - 1 : 0;
  const endIndex = startIndex + limit;
  const selected = lines.slice(startIndex, endIndex);
  const startLine = startIndex + 1;
  const endLine = selected.length > 0 ? startIndex + selected.length : startLine;
  const isPartialView = startLine !== 1 || endLine < lines.length;
  return {
    content: selected.join("\n"),
    output: formatWithLineNumbers2(selected, startLine),
    startLine,
    endLine,
    totalLines: lines.length,
    isPartialView,
    encoding: metadata.encoding,
    lineEndings: metadata.lineEndings,
    timestamp: metadata.timestamp
  };
}
function formatWithLineNumbers2(lines, startLineNumber) {
  return lines.map((line, index) => {
    const lineNumber = startLineNumber + index;
    const trimmedLine = line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) : line;
    return `${String(lineNumber).padStart(LINE_NUMBER_WIDTH, " ")}	${trimmedLine}`;
  }).join("\n");
}
function isImageExtension(ext) {
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".svg", ".ico", ".avif"].includes(ext);
}
function getImageMimeType(ext) {
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".avif":
      return "image/avif";
    case ".png":
    default:
      return "image/png";
  }
}
function buildImageFollowUpMessage(filePath, mime, buffer) {
  const fileName = path6.basename(filePath);
  return {
    role: "system",
    content: `The read tool has loaded \`${fileName}\`. Use the attached image content to answer the original request.`,
    contentParams: [
      {
        type: "image_url",
        image_url: {
          url: `data:${mime};base64,${buffer.toString("base64")}`
        }
      }
    ]
  };
}
function countPdfPages(buffer) {
  try {
    const content = buffer.toString("latin1");
    const matches = content.match(/\/Type\s*\/Page\b(?!s)/g);
    return matches ? matches.length : 0;
  } catch {
    return null;
  }
}
function parsePageRange(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("pages must be a non-empty string.");
  }
  if (trimmed.includes(",")) {
    throw new Error('pages must be a single range like "1-5" or "3".');
  }
  const parts = trimmed.split("-").map((part) => part.trim());
  if (parts.length === 1) {
    const value = parsePositiveInt(parts[0], "pages");
    return { start: value, end: value, count: 1 };
  }
  if (parts.length === 2) {
    const start = parsePositiveInt(parts[0], "pages");
    const end = parsePositiveInt(parts[1], "pages");
    if (end < start) {
      throw new Error("pages range end must be >= start.");
    }
    return { start, end, count: end - start + 1 };
  }
  throw new Error('pages must be a single range like "1-5" or "3".');
}
function parsePositiveInt(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} must be a number.`);
  }
  const integer = Math.trunc(numeric);
  if (integer < 1) {
    throw new Error(`${label} must be >= 1.`);
  }
  return integer;
}
function readNotebook(filePath) {
  const raw = fs6.readFileSync(filePath, "utf8");
  if (!raw) {
    return "WARNING: File is empty.";
  }
  const parsed = JSON.parse(raw);
  const lines = [];
  const cells = Array.isArray(parsed.cells) ? parsed.cells : [];
  cells.forEach((cell, index) => {
    const cellType = cell.cell_type ?? "unknown";
    lines.push(`# Cell ${index + 1} (${cellType})`);
    const source = normalizeNotebookField(cell.source);
    if (source.length > 0) {
      lines.push(...source);
    }
    const outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
    outputs.forEach((output, outputIndex) => {
      const outputType = typeof output.output_type === "string" ? output.output_type : "output";
      lines.push(`# Output ${outputIndex + 1} (${outputType})`);
      lines.push(...formatNotebookOutput(output));
    });
  });
  if (lines.length === 0) {
    return "WARNING: Notebook has no cells.";
  }
  return formatWithLineNumbers2(lines, 1);
}
function normalizeNotebookField(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).replace(/\r?\n$/, ""));
  }
  if (typeof value === "string") {
    return value.split(/\r?\n/);
  }
  return [];
}
function formatNotebookOutput(output) {
  const lines = [];
  const text = output.text;
  if (Array.isArray(text)) {
    lines.push(...text.map((item) => String(item).replace(/\r?\n$/, "")));
  } else if (typeof text === "string") {
    lines.push(...text.split(/\r?\n/));
  }
  const data = output.data;
  if (data && typeof data === "object") {
    const record = data;
    const textPlain = record["text/plain"];
    if (Array.isArray(textPlain)) {
      lines.push(...textPlain.map((item) => String(item).replace(/\r?\n$/, "")));
    } else if (typeof textPlain === "string") {
      lines.push(...textPlain.split(/\r?\n/));
    }
    const imagePng = record["image/png"];
    if (typeof imagePng === "string") {
      lines.push(`[image/png ${imagePng.length} chars]`);
    }
    const imageJpeg = record["image/jpeg"];
    if (typeof imageJpeg === "string") {
      lines.push(`[image/jpeg ${imageJpeg.length} chars]`);
    }
  }
  const trace = output.traceback;
  if (Array.isArray(trace)) {
    lines.push(...trace.map((item) => String(item).replace(/\r?\n$/, "")));
  }
  if (lines.length === 0) {
    lines.push("[output omitted]");
  }
  return lines;
}
var DEFAULT_LINE_LIMIT, MAX_LINE_LENGTH, PDF_LARGE_PAGE_THRESHOLD, PDF_MAX_PAGE_RANGE, LINE_NUMBER_WIDTH, DEFAULT_GITIGNORE;
var init_read_handler = __esm({
  "src/tools/read-handler.ts"() {
    "use strict";
    init_file_utils();
    init_state();
    DEFAULT_LINE_LIMIT = 2e3;
    MAX_LINE_LENGTH = 2e3;
    PDF_LARGE_PAGE_THRESHOLD = 10;
    PDF_MAX_PAGE_RANGE = 20;
    LINE_NUMBER_WIDTH = 6;
    DEFAULT_GITIGNORE = [
      "node_modules/",
      ".git/",
      "dist/",
      "build/",
      "out/",
      ".next/",
      ".nuxt/",
      ".venv/",
      "venv/",
      "__pycache__/",
      "*.pyc",
      "*.pyo",
      ".pytest_cache/",
      ".mypy_cache/",
      ".ruff_cache/",
      ".gradle/",
      ".idea/",
      ".vscode/",
      "*.class",
      "*.jar",
      "*.war",
      "target/"
    ];
  }
});

// src/tools/update-plan-handler.ts
import { z as z3 } from "zod";
async function handleUpdatePlanTool(args2, _context) {
  return executeValidatedTool("UpdatePlan", updatePlanSchema, args2, _context, async (input) => ({
    ok: true,
    name: "UpdatePlan",
    output: "Plan updated.",
    metadata: {
      plan: input.plan,
      ...input.explanation ? { explanation: input.explanation } : {}
    }
  }));
}
var updatePlanSchema;
var init_update_plan_handler = __esm({
  "src/tools/update-plan-handler.ts"() {
    "use strict";
    init_runtime();
    updatePlanSchema = z3.strictObject({
      plan: z3.string().trim().min(1, "plan must not be empty."),
      explanation: z3.string().trim().optional()
    });
  }
});

// src/tools/web-search-handler.ts
import { randomUUID } from "crypto";
import { spawn as spawn3 } from "child_process";
async function handleWebSearchTool(args2, context) {
  const query = typeof args2.query === "string" ? args2.query : "";
  if (!query.trim()) {
    return {
      ok: false,
      name: "WebSearch",
      error: 'Missing required "query" string.'
    };
  }
  const llmContext = context.createOpenAIClient?.();
  const scriptPath = llmContext?.webSearchTool?.trim();
  if (scriptPath) {
    return executeConfiguredWebSearch(query, scriptPath, context, llmContext?.env ?? {});
  }
  if (!hasUsableClient(llmContext)) {
    return {
      ok: false,
      name: "WebSearch",
      error: "WebSearch default mode requires a valid LLM configuration in ~/.lima-code/settings.json or ./.lima-code/settings.json. Legacy .deepcode settings are still read as a fallback."
    };
  }
  return executeDefaultWebSearch(query, llmContext, context);
}
function hasUsableClient(value) {
  return Boolean(value?.client);
}
async function executeConfiguredWebSearch(query, scriptPath, context, configuredEnv) {
  const execution = await runWebSearchScript(scriptPath, query, context, configuredEnv);
  const output = execution.stdout.slice(0, MAX_OUTPUT_CHARS2);
  const truncated = execution.stdout.length > MAX_OUTPUT_CHARS2;
  if (execution.error) {
    return {
      ok: false,
      name: "WebSearch",
      error: execution.error,
      output: output || void 0,
      metadata: {
        exitCode: execution.exitCode,
        signal: execution.signal,
        stderr: execution.stderr || void 0,
        truncated
      }
    };
  }
  if (execution.exitCode !== 0 || execution.signal !== null) {
    return {
      ok: false,
      name: "WebSearch",
      error: buildCommandError(execution.exitCode, execution.signal),
      output: output || void 0,
      metadata: {
        exitCode: execution.exitCode,
        signal: execution.signal,
        stderr: execution.stderr || void 0,
        truncated
      }
    };
  }
  return {
    ok: true,
    name: "WebSearch",
    output: output || void 0,
    metadata: {
      exitCode: execution.exitCode,
      signal: execution.signal,
      truncated,
      stderr: execution.stderr || void 0
    }
  };
}
async function executeDefaultWebSearch(query, llmContext, context) {
  try {
    const prepared = await prepareSearchQuery(query, llmContext);
    const output = await runDefaultWebSearchRequest(prepared.resolvedQuery, llmContext.machineId, context);
    return {
      ok: true,
      name: "WebSearch",
      output,
      metadata: {
        originalQuery: query,
        resolvedQuery: prepared.resolvedQuery,
        translated: prepared.translated,
        dominantLanguage: prepared.decision.dominantLanguage,
        languageReason: prepared.decision.reason
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: "WebSearch",
      error: `WebSearch default mode failed: ${message}`
    };
  }
}
async function runWebSearchScript(scriptPath, query, context, configuredEnv) {
  return new Promise((resolve13) => {
    const child = spawn3(scriptPath, [query], {
      cwd: context.projectRoot,
      env: { ...process.env, ...configuredEnv },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const pid = child.pid;
    if (typeof pid === "number") {
      context.onProcessStart?.(pid, formatWebSearchActivityLabel(query));
    }
    let stdout = "";
    let stderr = "";
    let error;
    child.stdout?.on("data", (chunk) => {
      stdout = appendChunk2(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendChunk2(stderr, chunk);
    });
    child.on("error", (spawnError) => {
      error = spawnError.message;
    });
    child.on("close", (code, signal) => {
      if (typeof pid === "number") {
        context.onProcessExit?.(pid);
      }
      resolve13({
        stdout,
        stderr,
        exitCode: typeof code === "number" ? code : null,
        signal: signal ?? null,
        error
      });
    });
  });
}
async function prepareSearchQuery(query, llmContext) {
  const decision = await decideSearchLanguage(query, llmContext);
  const containsChinese = containsChineseChar(query);
  if (decision.dominantLanguage === "en" && containsChinese) {
    const translatedQuery = await translateQuery(query, "English", llmContext);
    if (translatedQuery) {
      return {
        resolvedQuery: translatedQuery,
        decision,
        translated: true
      };
    }
  }
  if (decision.dominantLanguage === "zh" && !containsChinese) {
    const translatedQuery = await translateQuery(query, "Chinese", llmContext);
    if (translatedQuery) {
      return {
        resolvedQuery: translatedQuery,
        decision,
        translated: true
      };
    }
  }
  return {
    resolvedQuery: query,
    decision,
    translated: false
  };
}
function containsChineseChar(text) {
  return /[\u4e00-\u9fff]/.test(text);
}
async function decideSearchLanguage(query, llmContext) {
  const prompt = `Decide whether the topic below has more useful online material in English or Chinese.

Topic:
\`\`\`text
${query}
\`\`\`

Return strict JSON:
{"dominant_language":"en"|"zh","reason":"one short sentence"}
Do not include markdown or any extra text.`;
  const result = parseJsonResponse(await chat(llmContext, prompt));
  const dominantLanguage = result.dominant_language;
  if (dominantLanguage !== "en" && dominantLanguage !== "zh") {
    throw new Error(`Unexpected dominant language: ${String(dominantLanguage)}`);
  }
  return {
    dominantLanguage,
    reason: typeof result.reason === "string" ? result.reason : ""
  };
}
async function translateQuery(query, targetLanguage, llmContext) {
  const prompt = `Translate the query text below into ${targetLanguage}.

Requirements:
- Preserve product names, library names, API names, versions, and abbreviations when appropriate.
- Return only the translated query, without quotes or explanation.

Query:
\`\`\`text
${query}
\`\`\``;
  return stripCodeFence(await chat(llmContext, prompt)).trim().replace(/^['"]|['"]$/g, "");
}
async function chat(llmContext, prompt) {
  const response = await llmContext.client.chat.completions.create({
    model: llmContext.model,
    messages: [{ role: "user", content: prompt }]
  });
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content.map((part) => typeof part.text === "string" ? part.text : "").join("\n").trim();
  }
  return "";
}
function parseJsonResponse(text) {
  const cleaned = stripCodeFence(text).trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error(`Failed to parse JSON response: ${cleaned || "<empty>"}`);
  }
}
function stripCodeFence(text) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:[\w-]+)?\n([\s\S]*?)\n```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}
async function runDefaultWebSearchRequest(query, machineId, context) {
  if (!machineId) {
    throw new Error("Missing vscode.env.machineId for the default WebSearch request.");
  }
  const activityId = `web-search-${randomUUID()}`;
  context.onProcessStart?.(activityId, formatWebSearchActivityLabel(query));
  try {
    const response = await fetch(DEFAULT_WEB_SEARCH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Token: machineId
      },
      body: JSON.stringify({ query })
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`WebSearch API request failed with status ${response.status}${body ? `: ${body}` : ""}`);
    }
    const payload = await response.json();
    if (typeof payload.result === "string" && payload.result.trim()) {
      return payload.result.trim();
    }
  } finally {
    context.onProcessExit?.(activityId);
  }
  throw new Error("The web search response was empty.");
}
function appendChunk2(existing, chunk) {
  if (existing.length >= MAX_CAPTURE_CHARS2) {
    return existing;
  }
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const remaining = MAX_CAPTURE_CHARS2 - existing.length;
  return `${existing}${text.slice(0, remaining)}`;
}
function formatWebSearchActivityLabel(query) {
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  const maxQueryLength = 180;
  const clippedQuery = normalizedQuery.length > maxQueryLength ? `${normalizedQuery.slice(0, maxQueryLength - 3)}...` : normalizedQuery;
  return `${WEB_SEARCH_TOOL_ACTIVITY_PREFIX} ${clippedQuery}`;
}
function buildCommandError(exitCode, signal) {
  if (signal) {
    return `WebSearch command terminated by signal ${signal}.`;
  }
  if (exitCode !== null) {
    return `WebSearch command failed with exit code ${exitCode}.`;
  }
  return "WebSearch command failed.";
}
var MAX_OUTPUT_CHARS2, MAX_CAPTURE_CHARS2, WEB_SEARCH_TOOL_ACTIVITY_PREFIX, DEFAULT_WEB_SEARCH_API_URL;
var init_web_search_handler = __esm({
  "src/tools/web-search-handler.ts"() {
    "use strict";
    MAX_OUTPUT_CHARS2 = 3e4;
    MAX_CAPTURE_CHARS2 = 10 * 1024 * 1024;
    WEB_SEARCH_TOOL_ACTIVITY_PREFIX = "WebSearch:";
    DEFAULT_WEB_SEARCH_API_URL = "https://deepcode.vegamo.cn/api/plugin/web-search";
  }
});

// src/tools/write-handler.ts
import * as fs7 from "fs";
import { z as z4 } from "zod";
async function handleWriteTool(args2, context) {
  let repairMetadata = null;
  return executeValidatedTool(
    "write",
    writeSchema,
    args2,
    context,
    async (input) => {
      const filePath = normalizeFilePath(input.file_path);
      if (!isAbsoluteFilePath(filePath)) {
        return {
          ok: false,
          name: "write",
          error: "file_path must be an absolute path."
        };
      }
      const existingFile = fs7.existsSync(filePath);
      if (existingFile) {
        let stat;
        try {
          stat = fs7.statSync(filePath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            ok: false,
            name: "write",
            error: `Failed to stat file: ${message}`
          };
        }
        if (stat.isDirectory()) {
          return {
            ok: false,
            name: "write",
            error: "file_path points to a directory."
          };
        }
        if (stat.size > 0) {
          const fileState = getFileState(context.sessionId, filePath);
          if (!fileState || !isFullFileView(fileState)) {
            return {
              ok: false,
              name: "write",
              error: "Must read the full existing file before writing."
            };
          }
          if (hasFileChangedSinceState(filePath, fileState)) {
            return {
              ok: false,
              name: "write",
              error: "File has been modified since read. Read it again before writing."
            };
          }
        }
      }
      const normalizedContent = normalizeContent(input.content);
      try {
        ensureParentDirectory(filePath);
        const existingMetadata = existingFile ? readTextFileWithMetadata(filePath) : null;
        const encoding = existingMetadata?.encoding ?? "utf8";
        const lineEndings = existingMetadata?.lineEndings ?? (input.content.includes("\r\n") ? "CRLF" : "LF");
        const diffPreview = buildDiffPreview(filePath, existingMetadata?.content ?? null, normalizedContent);
        context.onBeforeFileMutation?.(filePath);
        const bytes = writeTextFile(filePath, normalizedContent, encoding, lineEndings);
        context.onAfterFileMutation?.(filePath);
        const freshMetadata = readTextFileWithMetadata(filePath);
        recordFileState(
          context.sessionId,
          {
            filePath,
            content: freshMetadata.content,
            timestamp: freshMetadata.timestamp,
            encoding: freshMetadata.encoding,
            lineEndings: freshMetadata.lineEndings
          },
          { incrementVersion: true }
        );
        return {
          ok: true,
          name: "write",
          output: existingMetadata ? "Updated file." : "Created file.",
          metadata: {
            type: existingMetadata ? "update" : "create",
            file_path: filePath,
            bytes,
            encoding: freshMetadata.encoding,
            line_endings: freshMetadata.lineEndings,
            cache_refreshed: true,
            diff_preview: diffPreview,
            ...repairMetadata
          }
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          name: "write",
          error: message
        };
      }
    },
    {
      preprocess: (rawInput) => {
        const filePath = typeof rawInput.file_path === "string" ? normalizeFilePath(rawInput.file_path) : "";
        const content = rawInput.content;
        if (filePath.toLowerCase().endsWith(".json") && content !== null && typeof content === "object" && !Buffer.isBuffer(content)) {
          repairMetadata = {
            input_repaired: true,
            repair_kind: "json-stringify-content"
          };
          return {
            ok: true,
            input: {
              ...rawInput,
              file_path: filePath,
              content: JSON.stringify(content, null, 2)
            }
          };
        }
        repairMetadata = null;
        return {
          ok: true,
          input: typeof rawInput.file_path === "string" ? { ...rawInput, file_path: filePath } : rawInput
        };
      }
    }
  );
}
var writeSchema;
var init_write_handler = __esm({
  "src/tools/write-handler.ts"() {
    "use strict";
    init_file_utils();
    init_runtime();
    init_state();
    writeSchema = z4.strictObject({
      file_path: z4.string().min(1, "file_path is required."),
      content: z4.string({
        error: "content must be a string. If you are writing JSON, serialize the full document to text before calling write."
      })
    });
  }
});

// src/tools/executor.ts
var BUILT_IN_TOOL_NAME_ALIASES, ToolExecutor;
var init_executor = __esm({
  "src/tools/executor.ts"() {
    "use strict";
    init_ask_user_question_handler();
    init_bash_handler();
    init_edit_handler();
    init_read_handler();
    init_update_plan_handler();
    init_web_search_handler();
    init_write_handler();
    BUILT_IN_TOOL_NAME_ALIASES = /* @__PURE__ */ new Map([
      ["Bash", "bash"],
      ["Read", "read"],
      ["Write", "write"],
      ["Edit", "edit"]
    ]);
    ToolExecutor = class {
      projectRoot;
      createOpenAIClient;
      mcpManager;
      toolHandlers = /* @__PURE__ */ new Map();
      constructor(projectRoot2, createOpenAIClient2, mcpManager) {
        this.projectRoot = projectRoot2;
        this.createOpenAIClient = createOpenAIClient2;
        this.mcpManager = mcpManager;
        this.registerToolHandlers();
      }
      async executeToolCalls(sessionId, toolCalls, hooks) {
        const parsedCalls = toolCalls.map((toolCall) => this.parseToolCall(toolCall)).filter((toolCall) => Boolean(toolCall));
        const executions = [];
        for (const toolCall of parsedCalls) {
          if (hooks?.shouldStop?.()) {
            break;
          }
          const result = await this.executeToolCall(sessionId, toolCall, hooks);
          executions.push({
            toolCallId: toolCall.id,
            content: this.formatToolResult(result),
            result
          });
          if (hooks?.shouldStop?.()) {
            break;
          }
        }
        return executions;
      }
      registerToolHandlers() {
        this.toolHandlers.set("bash", handleBashTool);
        this.toolHandlers.set("read", handleReadTool);
        this.toolHandlers.set("write", handleWriteTool);
        this.toolHandlers.set("edit", handleEditTool);
        this.toolHandlers.set("AskUserQuestion", handleAskUserQuestionTool);
        this.toolHandlers.set("UpdatePlan", handleUpdatePlanTool);
        this.toolHandlers.set("WebSearch", handleWebSearchTool);
      }
      parseToolCall(toolCall) {
        if (!toolCall || typeof toolCall !== "object") {
          return null;
        }
        const record = toolCall;
        if (typeof record.id !== "string") {
          return null;
        }
        const functionRecord = record.function;
        if (!functionRecord || typeof functionRecord !== "object") {
          return null;
        }
        if (typeof functionRecord.name !== "string") {
          return null;
        }
        const rawArguments = typeof functionRecord.arguments === "string" ? functionRecord.arguments : "";
        return {
          id: record.id,
          type: "function",
          function: {
            name: functionRecord.name,
            arguments: rawArguments
          }
        };
      }
      async executeToolCall(sessionId, toolCall, hooks) {
        const toolName = toolCall.function.name;
        const handlerName = BUILT_IN_TOOL_NAME_ALIASES.get(toolName) ?? toolName;
        const handler = this.toolHandlers.get(handlerName);
        if (!handler) {
          if (this.mcpManager?.isMcpTool(toolName)) {
            const parsedArgs2 = this.parseToolArguments(toolCall.function.arguments);
            const args2 = parsedArgs2.ok ? parsedArgs2.args : {};
            return this.mcpManager.executeMcpTool(toolName, args2);
          }
          return {
            ok: false,
            name: toolName,
            error: `Unknown tool: ${toolName}`
          };
        }
        const parsedArgs = this.parseToolArguments(toolCall.function.arguments);
        if (!parsedArgs.ok) {
          return {
            ok: false,
            name: toolName,
            error: parsedArgs.error
          };
        }
        try {
          return await handler(parsedArgs.args, {
            sessionId,
            projectRoot: this.projectRoot,
            toolCall,
            createOpenAIClient: this.createOpenAIClient,
            onProcessStart: hooks?.onProcessStart,
            onProcessExit: hooks?.onProcessExit,
            onProcessStdout: hooks?.onProcessStdout,
            onProcessTimeoutControl: hooks?.onProcessTimeoutControl,
            onBeforeFileMutation: hooks?.onBeforeFileMutation,
            onAfterFileMutation: hooks?.onAfterFileMutation
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            ok: false,
            name: toolName,
            error: message
          };
        }
      }
      parseToolArguments(rawArguments) {
        if (!rawArguments) {
          return { ok: true, args: {} };
        }
        try {
          const parsed = JSON.parse(rawArguments);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return { ok: false, error: "InputParseError: Tool arguments must be a JSON object." };
          }
          return { ok: true, args: parsed };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            ok: false,
            error: `InputParseError: Failed to parse tool arguments: ${message}. Ensure the tool call arguments are valid JSON. Prefer Edit over Write for large existing-file changes.`
          };
        }
      }
      formatToolResult(result) {
        const payload = {
          ok: result.ok,
          name: result.name
        };
        if (typeof result.output !== "undefined") {
          payload.output = result.output;
        }
        if (result.error) {
          payload.error = result.error;
        }
        if (result.metadata && Object.keys(result.metadata).length > 0) {
          payload.metadata = result.metadata;
        }
        if (result.awaitUserResponse === true) {
          payload.awaitUserResponse = true;
        }
        return JSON.stringify(payload, null, 2);
      }
    };
  }
});

// src/mcp/mcp-client.ts
import { spawn as spawn4 } from "child_process";
import { createInterface } from "readline";
import * as os4 from "os";
import * as path7 from "path";
function resolveWindowsCommand(command) {
  const normalized = command.trim();
  if (!normalized) {
    return command;
  }
  if (path7.isAbsolute(normalized) || normalized.includes("\\") || normalized.includes("/")) {
    return normalized;
  }
  if (path7.extname(normalized)) {
    return normalized;
  }
  const cmdShims = /* @__PURE__ */ new Set(["npm", "npx", "pnpm", "yarn"]);
  if (cmdShims.has(normalized.toLowerCase())) {
    return `${normalized}.cmd`;
  }
  return normalized;
}
var McpClient;
var init_mcp_client = __esm({
  "src/mcp/mcp-client.ts"() {
    "use strict";
    init_process_tree();
    McpClient = class {
      constructor(serverName, command, args2 = [], env, onNotification, onDisconnect) {
        this.serverName = serverName;
        this.command = command;
        this.args = args2;
        this.env = env;
        this.notificationHandler = onNotification ?? null;
        this.disconnectHandler = onDisconnect ?? null;
      }
      serverName;
      command;
      args;
      env;
      process = null;
      reader = null;
      nextId = 1;
      pendingRequests = /* @__PURE__ */ new Map();
      stderrBuffer = "";
      notificationHandler = null;
      disconnectHandler = null;
      intentionallyDisconnected = false;
      async connect(timeoutMs) {
        return new Promise((resolve13, reject) => {
          this.intentionallyDisconnected = false;
          const childEnv = {
            ...process.env,
            ...this.env
          };
          const args2 = this.withNpxYesArg(this.command, this.args);
          const isWindows = os4.platform() === "win32";
          if (isWindows) {
            const command = resolveWindowsCommand(this.command);
            this.process = spawn4(command, args2, {
              stdio: ["pipe", "pipe", "pipe"],
              env: childEnv,
              windowsHide: true
            });
          } else {
            this.process = spawn4(this.command, args2, {
              stdio: ["pipe", "pipe", "pipe"],
              env: childEnv
            });
          }
          let resolved = false;
          const safeReject = (err) => {
            if (!resolved) {
              resolved = true;
              reject(err);
            }
          };
          this.process.on("error", (err) => {
            safeReject(
              this.withStderr(`Failed to start MCP server "${this.serverName}" (${this.command}): ${err.message}`)
            );
          });
          this.process.on("close", (code) => {
            const reason = `MCP server "${this.serverName}" exited with code ${code}`;
            const error = this.withStderr(reason);
            for (const [, pending] of this.pendingRequests) {
              clearTimeout(pending.timer);
              pending.reject(error);
            }
            this.pendingRequests.clear();
            this.reader?.close();
            this.reader = null;
            this.process = null;
            if (!this.intentionallyDisconnected && this.disconnectHandler) {
              this.disconnectHandler(reason);
            }
            safeReject(error);
          });
          if (this.process.stderr) {
            this.process.stderr.on("data", (data) => {
              this.appendStderr(data.toString("utf8"));
            });
          }
          this.reader = createInterface({ input: this.process.stdout });
          this.reader.on("line", (line) => {
            this.handleLine(line);
          });
          this.sendRequest(
            "initialize",
            {
              protocolVersion: "2025-03-26",
              capabilities: {},
              clientInfo: { name: "lima-code", version: "0.1.0" }
            },
            timeoutMs
          ).then((result) => {
            const initResult = result;
            const serverVersion = initResult?.protocolVersion;
            if (serverVersion && serverVersion !== "2025-03-26" && serverVersion !== "2024-11-05") {
              reject(
                new Error(
                  `Unsupported MCP protocol version "${serverVersion}" from server "${this.serverName}". Client supports 2025-03-26 and 2024-11-05.`
                )
              );
              return;
            }
            this.sendNotification("notifications/initialized");
            resolve13();
          }).catch(reject);
        });
      }
      async listTools(timeoutMs) {
        const tools = [];
        let cursor;
        for (let page = 0; page < 100; page++) {
          const params = cursor ? { cursor } : {};
          const result = await this.sendRequest("tools/list", params, timeoutMs);
          tools.push(...result.tools ?? []);
          cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : void 0;
          if (!cursor) {
            return tools;
          }
        }
        throw this.withStderr(`MCP server "${this.serverName}" returned too many tools/list pages`);
      }
      async callTool(name, args2, timeoutMs = 6e4) {
        return await this.sendRequest("tools/call", { name, arguments: args2 }, timeoutMs);
      }
      async listPrompts(timeoutMs) {
        const prompts = [];
        let cursor;
        for (let page = 0; page < 100; page++) {
          const params = cursor ? { cursor } : {};
          const result = await this.sendRequest("prompts/list", params, timeoutMs);
          prompts.push(...result.prompts ?? []);
          cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : void 0;
          if (!cursor) {
            return prompts;
          }
        }
        throw this.withStderr(`MCP server "${this.serverName}" returned too many prompts/list pages`);
      }
      async getPrompt(name, args2, timeoutMs = 3e4) {
        return await this.sendRequest("prompts/get", { name, arguments: args2 }, timeoutMs);
      }
      async listResources(timeoutMs) {
        const resources = [];
        let cursor;
        for (let page = 0; page < 100; page++) {
          const params = cursor ? { cursor } : {};
          const result = await this.sendRequest("resources/list", params, timeoutMs);
          resources.push(...result.resources ?? []);
          cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : void 0;
          if (!cursor) {
            return resources;
          }
        }
        throw this.withStderr(`MCP server "${this.serverName}" returned too many resources/list pages`);
      }
      async readResource(uri, timeoutMs = 3e4) {
        return await this.sendRequest("resources/read", { uri }, timeoutMs);
      }
      disconnect() {
        this.intentionallyDisconnected = true;
        if (this.reader) {
          this.reader.close();
          this.reader = null;
        }
        if (this.process) {
          if (typeof this.process.pid === "number") {
            killProcessTree(this.process.pid, "SIGTERM", { killGroupOnNonWindows: false });
          } else {
            this.process.kill();
          }
          this.process = null;
        }
      }
      isConnected() {
        return this.process !== null && this.process.exitCode === null;
      }
      sendRequest(method, params, timeoutMs = 3e4) {
        return new Promise((resolve13, reject) => {
          const id = this.nextId++;
          const request = {
            jsonrpc: "2.0",
            id,
            method,
            params
          };
          const timer = setTimeout(() => {
            this.pendingRequests.delete(id);
            reject(
              this.withStderr(
                `Timed out after ${timeoutMs}ms waiting for MCP server "${this.serverName}" to respond to ${method}`
              )
            );
          }, timeoutMs);
          this.pendingRequests.set(id, { resolve: resolve13, reject, timer });
          this.writeLine(JSON.stringify(request));
        });
      }
      sendNotification(method, params) {
        const notification = {
          jsonrpc: "2.0",
          method,
          params
        };
        this.writeLine(JSON.stringify(notification));
      }
      writeLine(data) {
        if (this.process?.stdin) {
          this.process.stdin.write(data + "\n");
        }
      }
      handleLine(line) {
        try {
          const parsed = JSON.parse(line);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && typeof item === "object") {
                this.handleSingleMessage(item);
              }
            }
            return;
          }
          if (parsed && typeof parsed === "object") {
            this.handleSingleMessage(parsed);
          }
        } catch {
        }
      }
      handleSingleMessage(msg) {
        if (!("id" in msg)) {
          const notification = msg;
          if (this.notificationHandler && typeof notification.method === "string") {
            try {
              this.notificationHandler(notification.method, notification.params);
            } catch {
            }
          }
          return;
        }
        const message = msg;
        if (message.id !== void 0 && this.pendingRequests.has(message.id)) {
          const pending = this.pendingRequests.get(message.id);
          this.pendingRequests.delete(message.id);
          clearTimeout(pending.timer);
          if (message.error) {
            pending.reject(this.withStderr(`MCP error: ${message.error.message}`));
          } else {
            pending.resolve(message.result);
          }
        }
      }
      withNpxYesArg(command, args2) {
        const executable = path7.basename(command).toLowerCase().replace(/\.cmd$/, "");
        if (executable !== "npx") {
          return args2;
        }
        if (args2.includes("-y") || args2.includes("--yes")) {
          return args2;
        }
        return ["-y", ...args2];
      }
      appendStderr(text) {
        this.stderrBuffer = `${this.stderrBuffer}${text}`;
        if (this.stderrBuffer.length > 4e3) {
          this.stderrBuffer = this.stderrBuffer.slice(-4e3);
        }
      }
      withStderr(message) {
        const stderr = this.stderrBuffer.trim();
        return new Error(stderr ? `${message}. stderr: ${stderr}` : message);
      }
    };
  }
});

// src/mcp/mcp-manager.ts
var configuredMcpStartupTimeout, MCP_STARTUP_TIMEOUT_MS, MCP_CALL_TOOL_TIMEOUT_MS, McpManager;
var init_mcp_manager = __esm({
  "src/mcp/mcp-manager.ts"() {
    "use strict";
    init_mcp_client();
    configuredMcpStartupTimeout = process.env.LIMA_CODE_MCP_TIMEOUT ?? process.env.DEEPCODE_MCP_TIMEOUT;
    MCP_STARTUP_TIMEOUT_MS = configuredMcpStartupTimeout ? parseInt(configuredMcpStartupTimeout, 10) : 3e4;
    MCP_CALL_TOOL_TIMEOUT_MS = 6e4;
    McpManager = class {
      clients = [];
      tools = [];
      prompts = [];
      resources = [];
      initialized = false;
      disposed = false;
      configuredServerNames = [];
      serverStatuses = [];
      onToolsListChanged = null;
      onStatusChanged = null;
      serverConfigs = {};
      prepare(servers) {
        if (!servers || Object.keys(servers).length === 0) return;
        this.disposed = false;
        for (const name of Object.keys(servers)) {
          if (!this.configuredServerNames.includes(name)) {
            this.configuredServerNames.push(name);
          }
          if (this.serverStatuses.some((status) => status.name === name)) {
            continue;
          }
          this.setStatus({
            name,
            status: "starting",
            connected: false,
            toolCount: 0,
            tools: [],
            promptCount: 0,
            prompts: [],
            resourceCount: 0,
            resources: []
          });
        }
      }
      async initialize(servers) {
        if (this.initialized || this.disposed) return;
        this.initialized = true;
        if (!servers || Object.keys(servers).length === 0) return;
        this.serverConfigs = servers;
        this.prepare(servers);
        for (const [name, config] of Object.entries(servers)) {
          if (this.disposed) break;
          await this.connectServer(name, config);
        }
      }
      async reconnect(name, config) {
        if (this.disposed) return;
        const effectiveConfig = config ?? this.serverConfigs[name];
        if (!effectiveConfig) return;
        if (config) {
          this.serverConfigs[name] = config;
        }
        this.setStatus({
          name,
          status: "reconnecting",
          connected: false,
          error: "Reconnecting...",
          toolCount: 0,
          tools: [],
          promptCount: 0,
          prompts: [],
          resourceCount: 0,
          resources: []
        });
        await this.connectServer(name, effectiveConfig);
      }
      async connectServer(name, config) {
        if (this.disposed) return;
        this.clients = this.clients.filter((c) => c.isConnected());
        this.tools = this.tools.filter((t) => t.serverName !== name);
        this.prompts = this.prompts.filter((p) => p.serverName !== name);
        this.resources = this.resources.filter((r) => r.serverName !== name);
        let client = null;
        try {
          client = new McpClient(
            name,
            config.command,
            config.args ?? [],
            config.env,
            (method) => {
              if (method === "notifications/tools/list_changed") {
                this.refreshServerTools(name, client).catch(() => {
                });
              }
            },
            (reason) => {
              if (!this.disposed && this.serverConfigs[name]) {
                this.onServerCrash(name, reason);
              }
            }
          );
          await client.connect(MCP_STARTUP_TIMEOUT_MS);
          if (this.disposed) {
            client.disconnect();
            return;
          }
          this.clients.push(client);
          const serverTools = await client.listTools(MCP_STARTUP_TIMEOUT_MS);
          if (this.disposed) return;
          const toolNamespacedNames = [];
          for (const tool of serverTools) {
            const namespacedName = `mcp__${name}__${tool.name}`;
            this.tools.push({
              serverName: name,
              originalName: tool.name,
              namespacedName,
              definition: tool,
              client
            });
            toolNamespacedNames.push(namespacedName);
          }
          let serverPrompts = [];
          try {
            serverPrompts = await client.listPrompts(MCP_STARTUP_TIMEOUT_MS);
          } catch {
          }
          if (this.disposed) return;
          const promptNamespacedNames = [];
          for (const prompt of serverPrompts) {
            const namespacedName = `mcp__${name}__${prompt.name}`;
            this.prompts.push({
              serverName: name,
              namespacedName,
              definition: prompt,
              client
            });
            promptNamespacedNames.push(namespacedName);
          }
          let serverResources = [];
          try {
            serverResources = await client.listResources(MCP_STARTUP_TIMEOUT_MS);
          } catch {
          }
          if (this.disposed) return;
          const resourceNamespacedNames = [];
          for (const resource of serverResources) {
            const namespacedName = `mcp__${name}__${resource.name}`;
            this.resources.push({
              serverName: name,
              namespacedName,
              definition: resource,
              client
            });
            resourceNamespacedNames.push(namespacedName);
          }
          this.setStatus({
            name,
            status: "ready",
            connected: true,
            toolCount: serverTools.length,
            tools: toolNamespacedNames,
            promptCount: serverPrompts.length,
            prompts: promptNamespacedNames,
            resourceCount: serverResources.length,
            resources: resourceNamespacedNames
          });
        } catch (err) {
          client?.disconnect();
          const message = err instanceof Error ? err.message : String(err);
          this.setStatus({
            name,
            status: "failed",
            connected: false,
            error: message,
            toolCount: 0,
            tools: [],
            promptCount: 0,
            prompts: [],
            resourceCount: 0,
            resources: []
          });
        }
      }
      onServerCrash(name, reason) {
        if (this.disposed) return;
        this.clients = this.clients.filter((c) => c.isConnected());
        this.tools = this.tools.filter((t) => t.serverName !== name);
        this.prompts = this.prompts.filter((p) => p.serverName !== name);
        this.resources = this.resources.filter((r) => r.serverName !== name);
        this.onToolsListChanged?.();
        this.setStatus({
          name,
          status: "failed",
          connected: false,
          error: reason,
          toolCount: 0,
          tools: [],
          promptCount: 0,
          prompts: [],
          resourceCount: 0,
          resources: []
        });
      }
      getStatus() {
        const result = [...this.serverStatuses];
        const knownNames = new Set(result.map((s) => s.name));
        for (const name of this.configuredServerNames) {
          if (!knownNames.has(name)) {
            result.push({
              name,
              status: "starting",
              connected: false,
              toolCount: 0,
              tools: [],
              promptCount: 0,
              prompts: [],
              resourceCount: 0,
              resources: []
            });
          }
        }
        return result;
      }
      getMcpToolDefinitions() {
        return this.tools.map((t) => ({
          type: "function",
          function: {
            name: t.namespacedName,
            description: t.definition.description ?? `${t.serverName}: ${t.originalName}`,
            parameters: {
              type: "object",
              properties: t.definition.inputSchema.properties,
              required: t.definition.inputSchema.required,
              ...t.definition.inputSchema.additionalProperties !== void 0 ? { additionalProperties: t.definition.inputSchema.additionalProperties } : {}
            }
          }
        }));
      }
      isMcpTool(name) {
        return name.startsWith("mcp__");
      }
      async executeMcpTool(name, args2, timeoutMs = MCP_CALL_TOOL_TIMEOUT_MS) {
        const tool = this.tools.find((t) => t.namespacedName === name);
        if (!tool) {
          return { ok: false, name, error: `Unknown MCP tool: ${name}` };
        }
        try {
          const result = await tool.client.callTool(tool.originalName, args2, timeoutMs);
          const text = result.content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n");
          return {
            ok: !result.isError,
            name,
            output: text || JSON.stringify(result.content)
          };
        } catch (err) {
          return {
            ok: false,
            name,
            error: err instanceof Error ? err.message : String(err)
          };
        }
      }
      async getMcpPrompt(name, args2) {
        const prompt = this.prompts.find((p) => p.namespacedName === name);
        if (!prompt) {
          return { ok: false, name, error: `Unknown MCP prompt: ${name}` };
        }
        try {
          const result = await prompt.client.getPrompt(prompt.definition.name, args2);
          const text = result.messages.filter((m) => m.content.type === "text" && m.content.text).map((m) => `[${m.role}] ${m.content.text}`).join("\n");
          return {
            ok: true,
            name,
            output: text || JSON.stringify(result)
          };
        } catch (err) {
          return {
            ok: false,
            name,
            error: err instanceof Error ? err.message : String(err)
          };
        }
      }
      async readMcpResource(name, uri) {
        const resource = this.resources.find((r) => r.namespacedName === name);
        if (!resource) {
          return { ok: false, name, error: `Unknown MCP resource: ${name}` };
        }
        try {
          const result = await resource.client.readResource(uri);
          const text = result.contents.filter((c) => c.text).map((c) => c.text).join("\n");
          return {
            ok: true,
            name,
            output: text || JSON.stringify(result.contents)
          };
        } catch (err) {
          return {
            ok: false,
            name,
            error: err instanceof Error ? err.message : String(err)
          };
        }
      }
      disconnect() {
        this.disposed = true;
        for (const client of this.clients) {
          client.disconnect();
        }
        this.clients = [];
        this.tools = [];
        this.prompts = [];
        this.resources = [];
        this.serverStatuses = [];
        this.configuredServerNames = [];
        this.serverConfigs = {};
        this.initialized = false;
      }
      async refreshServerTools(serverName, client) {
        const serverTools = await client.listTools(MCP_STARTUP_TIMEOUT_MS);
        this.tools = this.tools.filter((t) => t.serverName !== serverName);
        const toolNamespacedNames = [];
        for (const tool of serverTools) {
          const namespacedName = `mcp__${serverName}__${tool.name}`;
          this.tools.push({
            serverName,
            originalName: tool.name,
            namespacedName,
            definition: tool,
            client
          });
          toolNamespacedNames.push(namespacedName);
        }
        const existing = this.serverStatuses.find((s) => s.name === serverName);
        if (existing) {
          existing.toolCount = serverTools.length;
          existing.tools = toolNamespacedNames;
        }
        this.onToolsListChanged?.();
      }
      setOnToolsListChanged(handler) {
        this.onToolsListChanged = handler;
      }
      setOnStatusChanged(handler) {
        this.onStatusChanged = handler;
      }
      setStatus(status) {
        if (this.disposed) return;
        const index = this.serverStatuses.findIndex((s) => s.name === status.name);
        if (index === -1) {
          this.serverStatuses.push(status);
        } else {
          this.serverStatuses[index] = status;
        }
        this.onStatusChanged?.();
      }
    };
  }
});

// src/common/error-logger.ts
import * as fs8 from "fs";
import * as path8 from "path";
import * as os5 from "os";
function ensureLogDir() {
  if (!fs8.existsSync(LOG_DIR)) {
    fs8.mkdirSync(LOG_DIR, { recursive: true });
  }
}
function maskSensitive(text) {
  return text.replace(/(Authorization:\s*Bearer\s+)[^\s\r\n]+/gi, "$1***MASKED***").replace(/((?:api[Kk]ey|api_key|secret)\s*[:=]\s*"?)[^",}\s]+/gi, "$1***MASKED***");
}
function truncateContent(value) {
  if (value.length <= CONTENT_TRUNCATE_PREVIEW) {
    return value;
  }
  return `${value.slice(0, CONTENT_TRUNCATE_PREVIEW)}...(total ${value.length} chars)`;
}
function sanitizeRequestPayload(request) {
  function walk(value) {
    if (!value || typeof value !== "object") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    const record = value;
    const result = {};
    for (const [key, val] of Object.entries(record)) {
      if (key === "content" && typeof val === "string") {
        result[key] = truncateContent(val);
      } else {
        result[key] = walk(val);
      }
    }
    return result;
  }
  return walk(request);
}
function logApiError(entry) {
  try {
    ensureLogDir();
    const logLine = {
      timestamp: entry.timestamp,
      location: entry.location,
      requestId: entry.requestId,
      sessionId: entry.sessionId,
      model: entry.model,
      baseURL: entry.baseURL,
      error: {
        name: entry.error.name,
        message: maskSensitive(entry.error.message),
        stack: entry.error.stack ? maskSensitive(entry.error.stack) : void 0
      },
      request: sanitizeRequestPayload(entry.request)
    };
    if (entry.response !== void 0) {
      logLine.response = typeof entry.response === "string" ? maskSensitive(entry.response) : entry.response;
    }
    const newLine = JSON.stringify(logLine) + "\n";
    fs8.appendFileSync(ERROR_LOG_PATH, newLine, "utf8");
    const MAX_ENTRIES = 20;
    const raw = fs8.readFileSync(ERROR_LOG_PATH, "utf8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length > MAX_ENTRIES) {
      fs8.writeFileSync(ERROR_LOG_PATH, lines.slice(-MAX_ENTRIES).join("\n") + "\n", "utf8");
    }
  } catch {
  }
}
var LOG_DIR, ERROR_LOG_PATH, CONTENT_TRUNCATE_PREVIEW;
var init_error_logger = __esm({
  "src/common/error-logger.ts"() {
    "use strict";
    LOG_DIR = path8.join(os5.homedir(), ".deepcode", "logs");
    ERROR_LOG_PATH = path8.join(LOG_DIR, "error.log");
    CONTENT_TRUNCATE_PREVIEW = 100;
  }
});

// src/common/debug-logger.ts
import * as fs9 from "fs";
import * as os6 from "os";
import * as path9 from "path";
function logOpenAIChatCompletionDebug(entry) {
  try {
    const logPath = getDebugLogPath();
    fs9.mkdirSync(path9.dirname(logPath), { recursive: true });
    fs9.appendFileSync(logPath, `${JSON.stringify(toSerializable(entry))}
`, "utf8");
  } catch {
  }
}
function getDebugLogPath() {
  return path9.join(getHomeDirectory(), ".lima-code", "logs", DEBUG_LOG_FILE);
}
function normalizeDebugError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  return {
    name: "UnknownError",
    message: String(error)
  };
}
function toSerializable(value) {
  const seen = /* @__PURE__ */ new WeakSet();
  function walk(current) {
    if (typeof current === "bigint") {
      return current.toString();
    }
    if (current instanceof Error) {
      return normalizeDebugError(current);
    }
    if (!current || typeof current !== "object") {
      return current;
    }
    if (seen.has(current)) {
      return "[Circular]";
    }
    seen.add(current);
    if (Array.isArray(current)) {
      return current.map(walk);
    }
    const result = {};
    for (const [key, val] of Object.entries(current)) {
      result[key] = walk(val);
    }
    return result;
  }
  return walk(value);
}
function getHomeDirectory() {
  const configured = process.env.LIMA_CODE_HOME?.trim();
  if (configured) {
    return configured;
  }
  return process.env.HOME?.trim() || os6.homedir();
}
var DEBUG_LOG_FILE;
var init_debug_logger = __esm({
  "src/common/debug-logger.ts"() {
    "use strict";
    DEBUG_LOG_FILE = "debug.log";
  }
});

// src/common/file-history.ts
import * as childProcess from "child_process";
import * as crypto2 from "crypto";
import * as fs10 from "fs";
import * as path10 from "path";
function emptyManifest() {
  return { version: 1, files: {} };
}
function normalizeManifest(manifest) {
  const files = {};
  for (const [key, entry] of Object.entries(manifest.files).sort(([left], [right]) => left.localeCompare(right))) {
    if (!isValidStoredPath(key) || !entry || entry.mode !== "100644" || !isCommitHash(entry.blob)) {
      throw new Error("Invalid file history manifest.");
    }
    files[key] = {
      path: path10.resolve(entry.path),
      blob: entry.blob,
      mode: "100644"
    };
  }
  return { version: 1, files };
}
function uniqueAbsolutePaths(filePaths) {
  return Array.from(new Set(filePaths.map((filePath) => path10.resolve(filePath))));
}
function isValidStoredPath(value) {
  return /^files-[0-9a-f]{64}$/.test(value);
}
function removeTrackedFile(filePath) {
  if (!fs10.existsSync(filePath)) {
    return;
  }
  const stat = fs10.lstatSync(filePath);
  if (stat.isDirectory()) {
    return;
  }
  fs10.unlinkSync(filePath);
}
function getFileHistoryGitEnv() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || FILE_HISTORY_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || FILE_HISTORY_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || FILE_HISTORY_AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || FILE_HISTORY_AUTHOR_EMAIL
  };
}
function isCommitHash(value) {
  return /^[0-9a-f]{40}$/i.test(value);
}
var FILE_HISTORY_AUTHOR_NAME, FILE_HISTORY_AUTHOR_EMAIL, MANIFEST_PATH, GitFileHistory;
var init_file_history = __esm({
  "src/common/file-history.ts"() {
    "use strict";
    FILE_HISTORY_AUTHOR_NAME = "LiMa Code Checkpoint";
    FILE_HISTORY_AUTHOR_EMAIL = "lima-code-checkpoint@localhost";
    MANIFEST_PATH = ".deepcode-file-history.json";
    GitFileHistory = class {
      constructor(_projectRoot, gitDir) {
        this.gitDir = gitDir;
      }
      gitDir;
      ensureSession(sessionId) {
        const branchRef = this.getSessionBranchRef(sessionId);
        if (!branchRef) {
          return void 0;
        }
        try {
          if (!fs10.existsSync(this.gitDir)) {
            fs10.mkdirSync(path10.dirname(this.gitDir), { recursive: true });
            this.runGit(["init"]);
          }
          const current = this.getCurrentCheckpointHash(sessionId);
          if (current) {
            return current;
          }
          const treeHash = this.createTree(emptyManifest());
          const commitHash = this.createCommit(treeHash, null, "Initial checkpoint");
          this.runGit(["update-ref", branchRef, commitHash]);
          return commitHash;
        } catch {
          return void 0;
        }
      }
      getCurrentCheckpointHash(sessionId) {
        const branchRef = this.getSessionBranchRef(sessionId);
        if (!branchRef || !fs10.existsSync(this.gitDir)) {
          return void 0;
        }
        try {
          const hash = this.runGit(["rev-parse", "--verify", `${branchRef}^{commit}`]).trim();
          return isCommitHash(hash) ? hash : void 0;
        } catch {
          return void 0;
        }
      }
      recordCheckpoint(sessionId, filePaths, message) {
        const branchRef = this.getSessionBranchRef(sessionId);
        if (!branchRef) {
          return void 0;
        }
        const absolutePaths = uniqueAbsolutePaths(filePaths);
        if (absolutePaths.length === 0) {
          return this.getCurrentCheckpointHash(sessionId);
        }
        try {
          const parentHash = this.ensureSession(sessionId);
          if (!parentHash) {
            return void 0;
          }
          const manifest = this.readManifest(parentHash);
          for (const filePath of absolutePaths) {
            const key = this.getFileKey(filePath);
            if (!fs10.existsSync(filePath) || !fs10.statSync(filePath).isFile()) {
              delete manifest.files[key];
              continue;
            }
            manifest.files[key] = {
              path: filePath,
              blob: this.hashFile(filePath),
              mode: "100644"
            };
          }
          const treeHash = this.createTree(manifest);
          const parentTreeHash = this.runGit(["rev-parse", `${parentHash}^{tree}`]).trim();
          if (treeHash === parentTreeHash) {
            return parentHash;
          }
          const commitHash = this.createCommit(treeHash, parentHash, message);
          this.runGit(["update-ref", branchRef, commitHash, parentHash]);
          return commitHash;
        } catch {
          return void 0;
        }
      }
      canRestore(sessionId, checkpointHash) {
        if (!isCommitHash(checkpointHash)) {
          return false;
        }
        if (!this.getSessionBranchRef(sessionId)) {
          return false;
        }
        if (!fs10.existsSync(this.gitDir)) {
          return false;
        }
        try {
          this.runGit(["cat-file", "-e", `${checkpointHash}^{commit}`]);
          this.readManifest(checkpointHash);
          return true;
        } catch {
          return false;
        }
      }
      restore(sessionId, checkpointHash) {
        if (!isCommitHash(checkpointHash)) {
          throw new Error("Invalid checkpoint hash.");
        }
        const branchRef = this.getSessionBranchRef(sessionId);
        if (!branchRef || !fs10.existsSync(this.gitDir)) {
          throw new Error("File history Git repository was not found for this project.");
        }
        this.runGit(["cat-file", "-e", `${checkpointHash}^{commit}`]);
        const currentHash = this.getCurrentCheckpointHash(sessionId);
        const currentManifest = currentHash ? this.readManifest(currentHash) : emptyManifest();
        const targetManifest = this.readManifest(checkpointHash);
        for (const [key, entry] of Object.entries(currentManifest.files)) {
          if (!targetManifest.files[key]) {
            removeTrackedFile(entry.path);
          }
        }
        for (const entry of Object.values(targetManifest.files)) {
          fs10.mkdirSync(path10.dirname(entry.path), { recursive: true });
          fs10.writeFileSync(entry.path, this.readBlob(entry.blob));
        }
        this.runGit(["update-ref", branchRef, checkpointHash]);
      }
      getSessionBranchRef(sessionId) {
        if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) {
          return null;
        }
        return `refs/heads/${sessionId}`;
      }
      createCommit(treeHash, parentHash, message) {
        const args2 = ["commit-tree", treeHash];
        if (parentHash) {
          args2.push("-p", parentHash);
        }
        args2.push("-m", message);
        return this.runGit(args2, {
          env: getFileHistoryGitEnv()
        }).trim();
      }
      createTree(manifest) {
        const normalizedManifest = normalizeManifest(manifest);
        const manifestBlob = this.hashContent(`${JSON.stringify(normalizedManifest, null, 2)}
`);
        const entries = [`100644 blob ${manifestBlob}	${MANIFEST_PATH}\0`];
        for (const [key, entry] of Object.entries(normalizedManifest.files)) {
          entries.push(`${entry.mode} blob ${entry.blob}	${key}\0`);
        }
        return this.runGit(["mktree", "-z"], { input: entries.join("") }).trim();
      }
      readManifest(commitHash) {
        const buffer = this.runGitBuffer(["cat-file", "blob", `${commitHash}:${MANIFEST_PATH}`]);
        const parsed = JSON.parse(buffer.toString("utf8"));
        if (!parsed || parsed.version !== 1 || !parsed.files || typeof parsed.files !== "object") {
          throw new Error("Invalid file history manifest.");
        }
        return normalizeManifest(parsed);
      }
      readBlob(blobHash) {
        if (!isCommitHash(blobHash)) {
          throw new Error("Invalid file history blob hash.");
        }
        return this.runGitBuffer(["cat-file", "blob", blobHash]);
      }
      hashFile(filePath) {
        const blobHash = this.runGit(["hash-object", "-w", "--", filePath]).trim();
        if (!isCommitHash(blobHash)) {
          throw new Error("Invalid file history blob hash.");
        }
        return blobHash;
      }
      hashContent(content) {
        const blobHash = this.runGit(["hash-object", "-w", "--stdin"], { input: content }).trim();
        if (!isCommitHash(blobHash)) {
          throw new Error("Invalid file history blob hash.");
        }
        return blobHash;
      }
      getFileKey(filePath) {
        const hash = crypto2.createHash("sha256").update(filePath).digest("hex");
        return `files-${hash}`;
      }
      runGit(args2, options = {}) {
        return this.spawnGit(args2, options, "utf8");
      }
      runGitBuffer(args2, options = {}) {
        return this.spawnGit(args2, options, "buffer");
      }
      spawnGit(args2, options, encoding) {
        const gitArgs = ["-c", "core.autocrlf=false", "-c", "core.eol=lf", `--git-dir=${this.gitDir}`, ...args2];
        const result = childProcess.spawnSync("git", gitArgs, {
          encoding,
          input: options.input,
          env: options.env,
          stdio: ["pipe", "pipe", "pipe"]
        });
        if (result.status !== 0) {
          const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr;
          const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : result.stdout;
          const detail = (stderr || stdout || "").trim();
          throw new Error(detail || `git ${args2.join(" ")} failed`);
        }
        return result.stdout ?? (encoding === "buffer" ? Buffer.alloc(0) : "");
      }
    };
  }
});

// src/session.ts
import * as fs11 from "fs";
import * as path11 from "path";
import * as os7 from "os";
import * as crypto3 from "crypto";
import { fileURLToPath as fileURLToPath2 } from "url";
import matter from "gray-matter";
import ejs2 from "ejs";
function getCompactPromptTokenThreshold(model) {
  return DEEPSEEK_V4_MODELS.has(model) ? DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD : DEFAULT_COMPACT_PROMPT_TOKEN_THRESHOLD;
}
function extractPinnedConstraints(systemPrompt) {
  const pattern = /# (?:HIGH PRIORITY constraints|User memory|Project memory)[\s\S]*?(?=\n# |\n---|$)/g;
  return Array.from(systemPrompt.matchAll(pattern), (m) => m[0]).join("\n\n");
}
function anySignal(a, b) {
  const controller = new AbortController();
  if (a.aborted || b.aborted) {
    controller.abort();
    return controller.signal;
  }
  const abort = () => controller.abort();
  a.addEventListener("abort", abort, { once: true });
  b.addEventListener("abort", abort, { once: true });
  return controller.signal;
}
function isUsageRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function summarizeCompletionOptions(options) {
  if (!options) {
    return void 0;
  }
  return {
    ...options,
    signal: options.signal instanceof AbortSignal ? { aborted: options.signal.aborted } : options.signal
  };
}
function addUsageValue(current, next) {
  if (typeof next === "number") {
    return (typeof current === "number" ? current : 0) + next;
  }
  if (isUsageRecord(next)) {
    const currentRecord = isUsageRecord(current) ? current : {};
    const result = { ...currentRecord };
    for (const [key, value] of Object.entries(next)) {
      result[key] = addUsageValue(currentRecord[key], value);
    }
    return result;
  }
  return next;
}
function accumulateUsage(current, next) {
  if (next == null) {
    return current ?? null;
  }
  return addUsageValue(current, next);
}
function usageWithRequestCount(usage) {
  const totalReqs = typeof usage.total_reqs === "number" ? usage.total_reqs + 1 : 1;
  return {
    ...usage,
    total_reqs: totalReqs
  };
}
function accumulateUsagePerModel(current, model, next) {
  if (next == null) {
    return current ?? null;
  }
  const usagePerModel = { ...current ?? {} };
  const modelName = model.trim() || "unknown";
  usagePerModel[modelName] = accumulateUsage(usagePerModel[modelName] ?? null, usageWithRequestCount(next));
  return usagePerModel;
}
function getExtensionRoot2() {
  if (typeof __dirname !== "undefined") {
    return path11.resolve(__dirname, "..");
  }
  const currentFilePath = fileURLToPath2(import.meta.url);
  return path11.resolve(path11.dirname(currentFilePath), "..");
}
function getTotalTokens(usage) {
  if (!isUsageRecord(usage)) {
    return 0;
  }
  const totalTokens = usage.total_tokens;
  return typeof totalTokens === "number" ? totalTokens : 0;
}
function readPositiveIntegerEnv(name, defaultValue) {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}
function getLiMaRouterRequestTimeoutMs() {
  return readPositiveIntegerEnv("LIMA_CODE_TUI_TIMEOUT_MS", DEFAULT_LIMA_ROUTER_REQUEST_TIMEOUT_MS);
}
function getLiMaRouterMaxRetries() {
  return Math.min(5, readPositiveIntegerEnv("LIMA_CODE_TUI_MAX_RETRIES", DEFAULT_LIMA_ROUTER_MAX_RETRIES));
}
var MAX_SESSION_ENTRIES, DEFAULT_COMPACT_PROMPT_TOKEN_THRESHOLD, DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD, DEFAULT_MAX_MODEL_ITERATIONS, DEFAULT_LIMA_ROUTER_REQUEST_TIMEOUT_MS, DEFAULT_LIMA_ROUTER_MAX_RETRIES, LIMA_ROUTER_PROJECT_INSTRUCTION_MIN_CHARS, LIMA_ROUTER_SAFE_SYSTEM_PROMPT, LIMA_ROUTER_SAFE_DEFAULT_SKILL_PROMPT, LIMA_ROUTER_PROJECT_INSTRUCTION_SUMMARY, EMPTY_ASSISTANT_RESPONSE_MESSAGE, SessionManager;
var init_session = __esm({
  "src/session.ts"() {
    "use strict";
    init_notify();
    init_openai_thinking();
    init_model_capabilities();
    init_prompt();
    init_executor();
    init_mcp_manager();
    init_error_logger();
    init_debug_logger();
    init_process_tree();
    init_file_history();
    MAX_SESSION_ENTRIES = 50;
    DEFAULT_COMPACT_PROMPT_TOKEN_THRESHOLD = 128 * 1024;
    DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD = 512 * 1024;
    DEFAULT_MAX_MODEL_ITERATIONS = 20;
    DEFAULT_LIMA_ROUTER_REQUEST_TIMEOUT_MS = 9e4;
    DEFAULT_LIMA_ROUTER_MAX_RETRIES = 1;
    LIMA_ROUTER_PROJECT_INSTRUCTION_MIN_CHARS = 3e3;
    LIMA_ROUTER_SAFE_SYSTEM_PROMPT = `\u4F60\u662F LiMa Code\uFF0C\u4E00\u4E2A\u4EA4\u4E92\u5F0F\u7F16\u7801 CLI\u3002

\u5E2E\u52A9\u7528\u6237\u5728\u5F53\u524D\u9879\u76EE\u4E2D\u5B8C\u6210\u8F6F\u4EF6\u5DE5\u7A0B\u4EFB\u52A1\u3002
\u9700\u8981\u672C\u5730\u68C0\u67E5\u6216\u7F16\u8F91\u65F6\uFF0C\u4F7F\u7528\u63D0\u4F9B\u7684\u5DE5\u5177 schema\u3002
\u56DE\u7B54\u4FDD\u6301\u7B80\u6D01\uFF0C\u5E76\u7ED9\u51FA\u53EF\u9A8C\u8BC1\u8BC1\u636E\u3002
\u4E0D\u8981\u66B4\u9732\u9690\u85CF\u63A8\u7406\u3002
\u4E0D\u8981\u7F16\u9020\u975E\u7F16\u7A0B URL\u3002
\u4E0D\u8981\u6CC4\u9732\u672C\u5730\u654F\u611F\u914D\u7F6E\u503C\u3002`;
    LIMA_ROUTER_SAFE_DEFAULT_SKILL_PROMPT = `\u9ED8\u8BA4\u64CD\u4F5C\u89C4\u5219\uFF1A
- \u59CB\u7EC8\u8D34\u5408\u7528\u6237\u5F53\u524D\u8BF7\u6C42\u3002
- \u53EA\u6709\u591A\u6B65\u9AA4\u4EFB\u52A1\u624D\u9700\u8981\u8BA1\u5212\u3002
- \u4F18\u5148\u505A\u805A\u7126\u7684\u9879\u76EE\u68C0\u67E5\uFF0C\u518D\u8FDB\u884C\u53D8\u66F4\u3002
- \u53EA\u6709\u6B67\u4E49\u4F1A\u5F71\u54CD\u5B9E\u73B0\u6216\u9A8C\u8BC1\u8DEF\u5F84\u65F6\uFF0C\u624D\u505C\u4E0B\u6765\u8BE2\u95EE\u3002`;
    LIMA_ROUTER_PROJECT_INSTRUCTION_SUMMARY = `\u9879\u76EE\u6307\u4EE4\u4F4D\u4E8E\u672C\u5730 AGENTS.md\uFF0C\u5DF2\u4E3A LiMa Router \u517C\u5BB9\u6027\u538B\u7F29\u4E3A\u6458\u8981\u3002

\u9075\u5FAA\u8FD9\u4E9B\u9879\u76EE\u89C4\u5219\uFF1A
- \u53D8\u66F4\u8303\u56F4\u5FC5\u987B\u8D34\u5408\u7528\u6237\u5F53\u524D\u8BF7\u6C42\uFF0C\u5E76\u4FDD\u7559\u65E0\u5173\u810F\u5DE5\u4F5C\u533A\u5185\u5BB9\u3002
- \u4F18\u5148\u6CBF\u7528\u9879\u76EE\u65E2\u6709\u6A21\u5F0F\u548C\u805A\u7126\u7F16\u8F91\uFF0C\u907F\u514D\u5BBD\u6CDB\u91CD\u6784\u3002
- \u58F0\u79F0\u5B8C\u6210\u524D\u5FC5\u987B\u8FD0\u884C\u76F8\u5173\u672C\u5730\u9A8C\u8BC1\u3002
- \u4E0D\u8981\u66B4\u9732\u654F\u611F\u914D\u7F6E\u503C\uFF0C\u4E5F\u4E0D\u8981\u63D0\u4EA4\u672C\u5730\u8FD0\u884C\u6570\u636E\u3001\u7F13\u5B58\u3001\u751F\u6210\u53D1\u5E03\u4EA7\u7269\u6216\u8C03\u8BD5\u65E5\u5FD7\u3002
- LiMa Code \u76F8\u5173\u5DE5\u4F5C\u5C3D\u91CF\u9A8C\u8BC1\u771F\u5B9E CLI/TUI \u8DEF\u5F84\uFF0C\u5E76\u62A5\u544A\u660E\u786E\u8BC1\u636E\u3002
- \u9700\u8981\u9879\u76EE\u89C4\u5219\u539F\u6587\u65F6\uFF0C\u53EA\u8BFB\u53D6 AGENTS.md \u4E2D\u76F8\u5173\u7684\u5C0F\u6BB5\u843D\uFF0C\u4E0D\u8981\u628A\u6574\u4EFD\u6587\u4EF6\u585E\u8FDB\u4E0A\u4E0B\u6587\u3002`;
    EMPTY_ASSISTANT_RESPONSE_MESSAGE = "LiMa Server \u8FD4\u56DE\u7A7A\u54CD\u5E94\u3002\u8BF7\u91CD\u8BD5\u6216\u8FD0\u884C /lima doctor\uFF1B\u8FD9\u901A\u5E38\u8868\u793A\u6240\u9009\u540E\u7AEF\u8D85\u65F6\u6216\u6CA1\u6709\u4EA7\u51FA\u5185\u5BB9\u3002";
    SessionManager = class {
      projectRoot;
      createOpenAIClient;
      getResolvedSettings;
      onAssistantMessage;
      onSessionEntryUpdated;
      onLlmStreamProgress;
      onMcpStatusChanged;
      onProcessStdout;
      activeSessionId = null;
      activePromptController = null;
      sessionControllers = /* @__PURE__ */ new Map();
      processTimeoutControls = /* @__PURE__ */ new Map();
      toolExecutor;
      mcpManager = new McpManager();
      mcpToolDefinitions = [];
      constructor(options) {
        this.projectRoot = options.projectRoot;
        this.createOpenAIClient = options.createOpenAIClient;
        this.getResolvedSettings = options.getResolvedSettings;
        this.onAssistantMessage = options.onAssistantMessage;
        this.onSessionEntryUpdated = options.onSessionEntryUpdated;
        this.onLlmStreamProgress = options.onLlmStreamProgress;
        this.onMcpStatusChanged = options.onMcpStatusChanged;
        this.onProcessStdout = options.onProcessStdout;
        this.toolExecutor = new ToolExecutor(this.projectRoot, this.createOpenAIClient, this.mcpManager);
        this.mcpManager.prepare(this.getResolvedSettings().mcpServers);
      }
      async initMcpServers(servers) {
        this.mcpManager.setOnToolsListChanged(() => {
          this.mcpToolDefinitions = this.mcpManager.getMcpToolDefinitions();
        });
        this.mcpManager.setOnStatusChanged(() => {
          this.onMcpStatusChanged?.();
        });
        await this.mcpManager.initialize(servers);
        this.mcpToolDefinitions = this.mcpManager.getMcpToolDefinitions();
      }
      getMcpStatus() {
        return this.mcpManager.getStatus();
      }
      async reconnectMcpServer(name, config) {
        await this.mcpManager.reconnect(name, config);
        this.mcpToolDefinitions = this.mcpManager.getMcpToolDefinitions();
      }
      dispose() {
        this.mcpManager.disconnect();
      }
      estimateStreamTokens(text) {
        let tokens = 0;
        for (const char of text) {
          tokens += /[\u3400-\u9fff\uf900-\ufaff]/u.test(char) ? 0.6 : 0.3;
        }
        return tokens;
      }
      formatEstimatedTokens(tokens) {
        if (tokens <= 0) {
          return "0";
        }
        const roundedTokens = Math.round(tokens);
        if (roundedTokens <= 0) {
          return "0";
        }
        if (roundedTokens < 100) {
          return String(roundedTokens);
        }
        if (roundedTokens < 1e4) {
          return `${Number((roundedTokens / 1e3).toFixed(1))}k`;
        }
        return `${Math.round(roundedTokens / 1e3)}k`;
      }
      emitLlmStreamProgress(requestId, startedAt, estimatedTokens, phase, sessionId, transport, telemetry) {
        this.onLlmStreamProgress?.({
          requestId,
          sessionId,
          startedAt,
          estimatedTokens: Math.round(estimatedTokens),
          formattedTokens: this.formatEstimatedTokens(estimatedTokens),
          phase,
          transport,
          ...telemetry
        });
      }
      isAbortLikeError(error) {
        if (!(error instanceof Error)) {
          return false;
        }
        return error.name === "AbortError" || error.constructor.name === "APIUserAbortError";
      }
      throwIfAborted(signal) {
        if (!signal?.aborted) {
          return;
        }
        const error = new Error("Request was aborted.");
        error.name = "AbortError";
        throw error;
      }
      async createChatCompletionStream(client, request, options, sessionId, debug) {
        const requestId = crypto3.randomUUID();
        const startedAt = (/* @__PURE__ */ new Date()).toISOString();
        const startedAtMs = Date.now();
        let estimatedTokens = 0;
        const transport = isLiMaRouterBaseURL(debug?.baseURL) ? "non_stream" : "stream";
        const progressModel = typeof request.model === "string" ? request.model : void 0;
        this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "start", sessionId, transport, {
          model: progressModel
        });
        const streamRequest = {
          ...request,
          stream: true,
          stream_options: {
            ...isUsageRecord(request.stream_options) ? request.stream_options : {},
            include_usage: true
          }
        };
        if (transport === "non_stream") {
          const nonStreamRequest = {
            ...request,
            stream: false
          };
          delete nonStreamRequest.stream_options;
          const timeoutMs = getLiMaRouterRequestTimeoutMs();
          const maxRetries = getLiMaRouterMaxRetries();
          const requestOptions = { ...options, timeout: timeoutMs, maxRetries };
          this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "update", sessionId, transport, {
            attempt: 1,
            maxAttempts: maxRetries + 1,
            timeoutMs,
            model: progressModel
          });
          try {
            const response2 = await client.chat.completions.create(nonStreamRequest, requestOptions);
            this.logChatCompletionDebug(debug, {
              timestamp: (/* @__PURE__ */ new Date()).toISOString(),
              location: debug?.location ?? "SessionManager.createChatCompletionStream:lima-non-stream",
              requestId,
              sessionId,
              model: typeof request.model === "string" ? request.model : void 0,
              baseURL: debug?.baseURL,
              durationMs: Date.now() - startedAtMs,
              params: { ...debug?.params, options: summarizeCompletionOptions(requestOptions), transport: "non_stream" },
              request: nonStreamRequest,
              response: response2
            });
            return response2;
          } catch (error) {
            if (this.isLiMaRouterBlockedError(error)) {
              const fallbackRequest = this.buildLiMaRouterBlockedFallbackRequest(nonStreamRequest);
              try {
                const response2 = await client.chat.completions.create(fallbackRequest, requestOptions);
                this.logChatCompletionDebug(debug, {
                  timestamp: (/* @__PURE__ */ new Date()).toISOString(),
                  location: "SessionManager.createChatCompletionStream:lima-non-stream-blocked-fallback",
                  requestId,
                  sessionId,
                  model: typeof request.model === "string" ? request.model : void 0,
                  baseURL: debug?.baseURL,
                  durationMs: Date.now() - startedAtMs,
                  params: {
                    ...debug?.params,
                    options: summarizeCompletionOptions(requestOptions),
                    transport: "non_stream",
                    fallback: "blocked_request"
                  },
                  request: fallbackRequest,
                  response: response2
                });
                return response2;
              } catch (fallbackError) {
                const localResponse = this.buildLiMaRouterBlockedLocalResponse(error, fallbackError);
                this.logChatCompletionDebug(debug, {
                  timestamp: (/* @__PURE__ */ new Date()).toISOString(),
                  location: "SessionManager.createChatCompletionStream:lima-non-stream-blocked-local",
                  requestId,
                  sessionId,
                  model: typeof request.model === "string" ? request.model : void 0,
                  baseURL: debug?.baseURL,
                  durationMs: Date.now() - startedAtMs,
                  params: {
                    ...debug?.params,
                    options: summarizeCompletionOptions(requestOptions),
                    transport: "non_stream",
                    fallback: "local_blocked_report"
                  },
                  request: fallbackRequest,
                  error: {
                    name: "LiMaRouterBlockedFallbackError",
                    message: `initial: ${error instanceof Error ? error.message : String(error)}; fallback: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
                    stack: JSON.stringify({
                      initial: normalizeDebugError(error),
                      fallback: normalizeDebugError(fallbackError)
                    })
                  },
                  response: localResponse
                });
                return localResponse;
              }
            }
            this.logChatCompletionDebug(debug, {
              timestamp: (/* @__PURE__ */ new Date()).toISOString(),
              location: debug?.location ?? "SessionManager.createChatCompletionStream:lima-non-stream",
              requestId,
              sessionId,
              model: typeof request.model === "string" ? request.model : void 0,
              baseURL: debug?.baseURL,
              durationMs: Date.now() - startedAtMs,
              params: { ...debug?.params, options: summarizeCompletionOptions(requestOptions), transport: "non_stream" },
              request: nonStreamRequest,
              error: normalizeDebugError(error)
            });
            logApiError({
              timestamp: (/* @__PURE__ */ new Date()).toISOString(),
              location: "SessionManager.createChatCompletionStream:lima-non-stream",
              requestId,
              sessionId,
              model: typeof request.model === "string" ? request.model : void 0,
              error: {
                name: error instanceof Error ? error.name : "UnknownError",
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : void 0
              },
              request: nonStreamRequest
            });
            throw error;
          } finally {
            this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "end", sessionId, transport);
          }
        }
        let response;
        try {
          response = await client.chat.completions.create(streamRequest, options);
        } catch (error) {
          this.logChatCompletionDebug(debug, {
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            location: debug?.location ?? "SessionManager.createChatCompletionStream:create",
            requestId,
            sessionId,
            model: typeof request.model === "string" ? request.model : void 0,
            baseURL: debug?.baseURL,
            durationMs: Date.now() - startedAtMs,
            params: { ...debug?.params, options: summarizeCompletionOptions(options) },
            request: streamRequest,
            error: normalizeDebugError(error)
          });
          logApiError({
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            location: "SessionManager.createChatCompletionStream:create",
            requestId,
            sessionId,
            model: typeof request.model === "string" ? request.model : void 0,
            error: {
              name: error instanceof Error ? error.name : "UnknownError",
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : void 0
            },
            request: streamRequest
          });
          this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "end", sessionId, transport);
          throw error;
        }
        if (!response || typeof response[Symbol.asyncIterator] !== "function") {
          this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "end", sessionId, transport);
          this.logChatCompletionDebug(debug, {
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            location: debug?.location ?? "SessionManager.createChatCompletionStream",
            requestId,
            sessionId,
            model: typeof request.model === "string" ? request.model : void 0,
            baseURL: debug?.baseURL,
            durationMs: Date.now() - startedAtMs,
            params: { ...debug?.params, options: summarizeCompletionOptions(options) },
            request: streamRequest,
            response
          });
          return response;
        }
        let content = "";
        let reasoningContent = "";
        let refusal = null;
        let usage = null;
        const responseChunks = [];
        const toolCallsByIndex = /* @__PURE__ */ new Map();
        const trackText = (value) => {
          if (typeof value !== "string" || value.length === 0) {
            return;
          }
          estimatedTokens += this.estimateStreamTokens(value);
          this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "update", sessionId, transport);
        };
        try {
          for await (const chunk of response) {
            if (debug?.enabled) {
              responseChunks.push(chunk);
            }
            if ("usage" in chunk && chunk.usage != null) {
              usage = chunk.usage;
            }
            const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
            for (const choice of choices) {
              const delta = isUsageRecord(choice) && isUsageRecord(choice.delta) ? choice.delta : null;
              if (!delta) {
                continue;
              }
              const contentDelta = delta.content;
              if (typeof contentDelta === "string") {
                content += contentDelta;
                trackText(contentDelta);
              }
              const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
              if (typeof reasoningDelta === "string") {
                reasoningContent += reasoningDelta;
                trackText(reasoningDelta);
              }
              if (typeof delta.refusal === "string") {
                refusal = `${refusal ?? ""}${delta.refusal}`;
                trackText(delta.refusal);
              }
              const rawToolCalls = delta.tool_calls;
              if (Array.isArray(rawToolCalls)) {
                for (const rawToolCall of rawToolCalls) {
                  if (!isUsageRecord(rawToolCall)) {
                    continue;
                  }
                  const index = typeof rawToolCall.index === "number" ? rawToolCall.index : toolCallsByIndex.size;
                  const current = toolCallsByIndex.get(index) ?? {};
                  if (typeof rawToolCall.id === "string") {
                    current.id = rawToolCall.id;
                  }
                  if (typeof rawToolCall.type === "string") {
                    current.type = rawToolCall.type;
                  }
                  const rawFunction = isUsageRecord(rawToolCall.function) ? rawToolCall.function : null;
                  if (rawFunction) {
                    current.function = current.function ?? {};
                    if (typeof rawFunction.name === "string") {
                      current.function.name = `${current.function.name ?? ""}${rawFunction.name}`;
                      trackText(rawFunction.name);
                    }
                    if (typeof rawFunction.arguments === "string") {
                      current.function.arguments = `${current.function.arguments ?? ""}${rawFunction.arguments}`;
                      trackText(rawFunction.arguments);
                    }
                  }
                  toolCallsByIndex.set(index, current);
                }
              }
            }
          }
        } catch (error) {
          this.logChatCompletionDebug(debug, {
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            location: debug?.location ?? "SessionManager.createChatCompletionStream:stream",
            requestId,
            sessionId,
            model: typeof request.model === "string" ? request.model : void 0,
            baseURL: debug?.baseURL,
            durationMs: Date.now() - startedAtMs,
            params: { ...debug?.params, options: summarizeCompletionOptions(options) },
            request: streamRequest,
            responseChunks,
            error: normalizeDebugError(error)
          });
          logApiError({
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            location: "SessionManager.createChatCompletionStream:stream",
            requestId,
            sessionId,
            model: typeof request.model === "string" ? request.model : void 0,
            error: {
              name: error instanceof Error ? error.name : "UnknownError",
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : void 0
            },
            request: streamRequest
          });
          throw error;
        } finally {
          this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "end", sessionId, transport);
        }
        const toolCalls = Array.from(toolCallsByIndex.entries()).sort(([left], [right]) => left - right).map(([, toolCall]) => toolCall);
        const normalizedToolCalls = this.normalizeLlmToolCalls(toolCalls);
        const message = { content };
        if (normalizedToolCalls) {
          message.tool_calls = normalizedToolCalls;
        }
        if (reasoningContent.length > 0) {
          message.reasoning_content = reasoningContent;
        }
        if (refusal != null) {
          message.refusal = refusal;
        }
        const finalResponse = {
          choices: [{ message }],
          usage
        };
        this.logChatCompletionDebug(debug, {
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          location: debug?.location ?? "SessionManager.createChatCompletionStream",
          requestId,
          sessionId,
          model: typeof request.model === "string" ? request.model : void 0,
          baseURL: debug?.baseURL,
          durationMs: Date.now() - startedAtMs,
          params: { ...debug?.params, options: summarizeCompletionOptions(options) },
          request: streamRequest,
          responseChunks,
          response: finalResponse
        });
        return finalResponse;
      }
      isLiMaRouterBlockedError(error) {
        if (!error || typeof error !== "object") {
          return false;
        }
        const record = error;
        const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
        return record.status === 403 || message.includes("403") || message.includes("blocked");
      }
      buildLiMaRouterBlockedFallbackRequest(request) {
        const lastUserContent = this.getLastTextMessageContent(request.messages, "user");
        const fallbackNote = "\u4E0A\u4E00\u6B21\u5E26\u672C\u5730\u5DE5\u5177\u7684 LiMa Router \u8BF7\u6C42\u5728\u6267\u884C\u524D\u88AB\u62E6\u622A\u3002\u8BF7\u4E0D\u8981\u8C03\u7528\u672C\u5730\u5DE5\u5177\uFF0C\u660E\u786E\u8BF4\u660E\u5B9E\u65F6\u9879\u76EE\u68C0\u67E5\u88AB\u62E6\u622A\u3002";
        return {
          model: request.model,
          messages: [
            {
              role: "system",
              content: "\u4F60\u662F LiMa Code\u3002\u4E0A\u4E00\u6B21\u5E26\u5DE5\u5177\u8BF7\u6C42\u88AB\u4E0A\u6E38\u8DEF\u7531\u62E6\u622A\u3002\u8BF7\u7ED9\u51FA\u4E0D\u4F7F\u7528\u5DE5\u5177\u7684\u7B80\u6D01\u515C\u5E95\u56DE\u7B54\uFF0C\u8BF4\u660E\u88AB\u62E6\u622A\u7684\u5C42\u7EA7\uFF0C\u4E0D\u8981\u5047\u88C5\u672C\u5730\u68C0\u67E5\u5DF2\u7ECF\u6210\u529F\u3002"
            },
            {
              role: "user",
              content: lastUserContent ? `${lastUserContent}

${fallbackNote}` : fallbackNote
            }
          ],
          stream: false
        };
      }
      buildLiMaRouterBlockedLocalResponse(initialError, fallbackError) {
        const initialMessage = initialError instanceof Error ? initialError.message : String(initialError);
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        return {
          choices: [
            {
              message: {
                content: [
                  "LiMa Router \u5728\u53EF\u7528\u54CD\u5E94\u4EA7\u51FA\u524D\u62E6\u622A\u4E86\u6A21\u578B\u8BF7\u6C42\u3002",
                  "",
                  "\u5C42\u7EA7: \u4E0A\u6E38\u6A21\u578B\u6216\u4F9B\u5E94\u5546\u51C6\u5165\u5C42",
                  `\u521D\u59CB\u8BF7\u6C42: ${initialMessage}`,
                  `\u515C\u5E95\u8BF7\u6C42: ${fallbackMessage}`,
                  "",
                  "\u4E0D\u8981\u5047\u8BBE\u672C\u8F6E\u5DF2\u6709\u4EFB\u4F55\u672C\u5730\u5DE5\u5177\u6267\u884C\u7ED3\u679C\u3002\u5982\u679C\u6301\u7EED\u51FA\u73B0\uFF0C\u8BF7\u8FD0\u884C /lima doctor\uFF0C\u6216\u5207\u6362\u4F9B\u5E94\u5546/\u6A21\u578B\u8DEF\u7531\u540E\u91CD\u8BD5\u3002"
                ].join("\n")
              }
            }
          ],
          usage: null
        };
      }
      getLastTextMessageContent(messages, role) {
        if (!Array.isArray(messages)) {
          return "";
        }
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const message = messages[index];
          if (message?.role !== role) {
            continue;
          }
          if (typeof message.content === "string") {
            return message.content;
          }
          if (!Array.isArray(message.content)) {
            continue;
          }
          const textParts = message.content.map(
            (part) => part.type === "text" ? part.text : ""
          ).filter((text) => typeof text === "string" && text.length > 0);
          return textParts.join("\n");
        }
        return "";
      }
      logChatCompletionDebug(debug, entry) {
        if (!debug?.enabled) {
          return;
        }
        logOpenAIChatCompletionDebug(entry);
      }
      async identifyMatchingSkillNames(skills, userPrompt, options) {
        this.throwIfAborted(options?.signal);
        let systemPrompt = `When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

Response in JSON format:
\`\`\`
{
  "skillNames": ["", ...]
}
\`\`\`

If none of the available skills match, respond with an empty array, i.e. \`{"skillNames": []}\`.

The candidate skills are as follows:

`;
        const simpleSkills = skills.filter((x) => !x.isLoaded).map((x) => {
          return { name: x.name, description: x.description };
        });
        if (simpleSkills.length === 0) {
          return [];
        }
        systemPrompt += "```\n" + JSON.stringify(simpleSkills, null, 2) + "\n```";
        const { client, model, baseURL, debugLogEnabled } = this.createOpenAIClient();
        if (isLiMaRouterBaseURL(baseURL)) {
          return this.identifyMatchingSkillNamesLocally(skills, userPrompt);
        }
        if (!client) {
          return [];
        }
        try {
          const response = await this.createChatCompletionStream(
            client,
            {
              model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
              ],
              response_format: { type: "json_object" }
            },
            options?.signal ? { signal: options.signal } : void 0,
            options?.sessionId,
            {
              enabled: debugLogEnabled,
              location: "SessionManager.identifyMatchingSkillNames",
              baseURL,
              params: { purpose: "skill-matching" }
            }
          );
          this.throwIfAborted(options?.signal);
          const rawContent = response.choices?.[0]?.message?.content;
          const content = typeof rawContent === "string" ? rawContent : "";
          if (!content) {
            return [];
          }
          const parsed = JSON.parse(content);
          if (parsed && Array.isArray(parsed.skillNames)) {
            return parsed.skillNames;
          }
          return [];
        } catch (error) {
          if (this.isAbortLikeError(error) || options?.signal?.aborted) {
            throw error;
          }
          return [];
        }
      }
      identifyMatchingSkillNamesLocally(skills, userPrompt) {
        const prompt = userPrompt.trim().toLowerCase();
        if (!prompt) {
          return [];
        }
        const unloaded = skills.filter((skill) => !skill.isLoaded);
        const selected = [];
        for (const skill of unloaded) {
          if (prompt.includes(skill.name.toLowerCase())) {
            selected.push(skill);
          }
        }
        return selected.slice(0, 3).map((skill) => skill.name);
      }
      async listSkills(sessionId) {
        const homeDir = os7.homedir();
        const agentsRoot = path11.join(homeDir, ".agents", "skills");
        const legacyProjectSkillsRoot = path11.join(this.projectRoot, ".deepcode", "skills");
        const projectAgentsSkillsRoot = path11.join(this.projectRoot, ".agents", "skills");
        const skillsByName = /* @__PURE__ */ new Map();
        const collectSkills = (root, displayRoot) => {
          if (!fs11.existsSync(root)) {
            return [];
          }
          let entries;
          try {
            entries = fs11.readdirSync(root, { withFileTypes: true });
          } catch {
            return [];
          }
          const results = [];
          for (const entry of entries) {
            if (!entry.isDirectory() && !entry.isSymbolicLink()) {
              continue;
            }
            const skillName = entry.name;
            const skillPath = path11.join(root, skillName, "SKILL.md");
            try {
              if (!fs11.existsSync(skillPath)) {
                continue;
              }
              const stat = fs11.statSync(skillPath);
              if (!stat.isFile()) {
                continue;
              }
            } catch {
              continue;
            }
            results.push(this.readSkillInfo(skillPath, `${displayRoot}/${skillName}/SKILL.md`, skillName));
          }
          return results;
        };
        for (const skill of collectSkills(agentsRoot, "~/.agents/skills")) {
          skillsByName.set(skill.name, skill);
        }
        for (const skill of collectSkills(legacyProjectSkillsRoot, "./.deepcode/skills")) {
          skillsByName.set(skill.name, skill);
        }
        for (const skill of collectSkills(projectAgentsSkillsRoot, "./.agents/skills")) {
          skillsByName.set(skill.name, skill);
        }
        if (sessionId) {
          const loadedSkillKeys = this.getLoadedSkillKeys(sessionId);
          for (const skill of skillsByName.values()) {
            if (loadedSkillKeys.has(this.getSkillKey(skill)) || loadedSkillKeys.has(this.getSkillKeyByName(skill.name))) {
              skill.isLoaded = true;
            }
          }
        }
        return Array.from(skillsByName.values()).sort((a, b) => a.name.localeCompare(b.name));
      }
      resolveSkillPath(skillPath) {
        if (skillPath.startsWith("~/")) {
          return path11.join(os7.homedir(), skillPath.slice(2));
        }
        if (skillPath.startsWith("~\\")) {
          return path11.join(os7.homedir(), skillPath.slice(2));
        }
        if (skillPath.startsWith("./")) {
          return path11.join(this.projectRoot, skillPath.slice(2));
        }
        if (skillPath.startsWith(".\\")) {
          return path11.join(this.projectRoot, skillPath.slice(2));
        }
        if (path11.isAbsolute(skillPath)) {
          return skillPath;
        }
        return path11.join(os7.homedir(), skillPath);
      }
      readSkillInfo(skillPath, displayPath, fallbackName) {
        const fallbackSkill = {
          name: fallbackName.replace(/_/g, "-"),
          path: displayPath,
          description: ""
        };
        try {
          const skillMd = fs11.readFileSync(skillPath, "utf8");
          const parsed = matter(skillMd);
          return {
            name: typeof parsed.data.name === "string" && parsed.data.name.trim() ? parsed.data.name.trim() : fallbackSkill.name,
            path: displayPath,
            description: typeof parsed.data.description === "string" ? parsed.data.description.trim() : ""
          };
        } catch {
          return fallbackSkill;
        }
      }
      getSkillKey(skill) {
        return `path:${skill.path}`;
      }
      getSkillKeyByName(name) {
        return `name:${name}`;
      }
      getLoadedSkillKeys(sessionId) {
        const loadedSkillKeys = /* @__PURE__ */ new Set();
        for (const message of this.listSessionMessages(sessionId)) {
          if (message.role !== "system" || !message.meta?.skill) {
            continue;
          }
          loadedSkillKeys.add(this.getSkillKey(message.meta.skill));
          loadedSkillKeys.add(this.getSkillKeyByName(message.meta.skill.name));
        }
        return loadedSkillKeys;
      }
      dedupeSkills(skills) {
        if (!skills || skills.length === 0) {
          return void 0;
        }
        const dedupedSkills = /* @__PURE__ */ new Map();
        for (const skill of skills) {
          if (!skill?.name || !skill?.path) {
            continue;
          }
          const key = this.getSkillKey(skill);
          const existingSkill = dedupedSkills.get(key);
          dedupedSkills.set(key, {
            ...existingSkill,
            ...skill,
            description: skill.description ?? existingSkill?.description ?? "",
            isLoaded: Boolean(existingSkill?.isLoaded || skill.isLoaded)
          });
        }
        return Array.from(dedupedSkills.values());
      }
      async normalizeSkills(skills, sessionId) {
        const dedupedSkills = this.dedupeSkills(skills);
        if (!dedupedSkills || dedupedSkills.length === 0) {
          return void 0;
        }
        const availableSkills = await this.listSkills(sessionId);
        const availableSkillsByKey = /* @__PURE__ */ new Map();
        for (const skill of availableSkills) {
          availableSkillsByKey.set(this.getSkillKey(skill), skill);
          availableSkillsByKey.set(this.getSkillKeyByName(skill.name), skill);
        }
        return dedupedSkills.map((skill) => {
          const matchedSkill = availableSkillsByKey.get(this.getSkillKey(skill)) ?? availableSkillsByKey.get(this.getSkillKeyByName(skill.name));
          if (!matchedSkill) {
            return skill;
          }
          return {
            ...matchedSkill,
            ...skill,
            description: matchedSkill.description || skill.description,
            isLoaded: Boolean(matchedSkill.isLoaded || skill.isLoaded)
          };
        });
      }
      getActiveSessionId() {
        return this.activeSessionId;
      }
      setActiveSessionId(sessionId) {
        this.activeSessionId = sessionId;
      }
      addSessionSystemMessage(sessionId, content, visible, meta) {
        const message = this.buildSystemMessage(sessionId, content, null, visible, meta);
        if (sessionId) this.appendSessionMessage(sessionId, message);
        this.onAssistantMessage(message, false);
      }
      async handleUserPrompt(userPrompt) {
        const controller = new AbortController();
        this.activePromptController = controller;
        try {
          if (!this.activeSessionId || !this.getSession(this.activeSessionId)) {
            await this.createSession(userPrompt, controller);
          } else {
            await this.replySession(this.activeSessionId, userPrompt, controller);
          }
        } catch (error) {
          if (!this.isAbortLikeError(error) && !controller.signal.aborted) {
            throw error;
          }
        } finally {
          if (this.activePromptController === controller) {
            this.activePromptController = null;
          }
        }
      }
      async createSession(userPrompt, controller) {
        const signal = controller?.signal;
        this.throwIfAborted(signal);
        const sessionId = crypto3.randomUUID();
        this.ensureFileHistorySession(sessionId);
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const index = this.loadSessionsIndex();
        const entry = {
          id: sessionId,
          summary: userPrompt.text ? userPrompt.text.slice(0, 100) : "[Image Prompt]",
          assistantReply: null,
          assistantThinking: null,
          assistantRefusal: null,
          toolCalls: null,
          status: "pending",
          failReason: null,
          usage: null,
          usagePerModel: null,
          activeTokens: 0,
          createTime: now,
          updateTime: now,
          processes: null
        };
        index.entries.push(entry);
        const sortedEntries = index.entries.slice().sort((a, b) => {
          const aTime = Date.parse(a.updateTime);
          const bTime = Date.parse(b.updateTime);
          if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
            return b.updateTime.localeCompare(a.updateTime);
          }
          return bTime - aTime;
        });
        const keptEntries = sortedEntries.slice(0, MAX_SESSION_ENTRIES);
        const keptIds = new Set(keptEntries.map((item) => item.id));
        const droppedEntries = sortedEntries.filter((item) => !keptIds.has(item.id));
        index.entries = keptEntries;
        this.saveSessionsIndex(index);
        this.removeSessionMessages(droppedEntries.map((item) => item.id));
        const promptToolOptions = this.getPromptToolOptions();
        const systemPrompt = getSystemPrompt(this.projectRoot, promptToolOptions);
        const systemMessage = this.buildSystemMessage(sessionId, systemPrompt);
        this.appendSessionMessage(sessionId, systemMessage);
        const defaultSkillPrompt = getDefaultSkillPrompt();
        if (defaultSkillPrompt) {
          const defaultSkillMessage = this.buildSystemMessage(sessionId, defaultSkillPrompt);
          this.appendSessionMessage(sessionId, defaultSkillMessage);
        }
        const runtimeContextMessage = this.buildSystemMessage(
          sessionId,
          getRuntimeContext(this.projectRoot, promptToolOptions.model)
        );
        this.appendSessionMessage(sessionId, runtimeContextMessage);
        const agentInstructions = this.loadAgentInstructions();
        if (agentInstructions) {
          const instructionsMessage = this.buildSystemMessage(sessionId, agentInstructions);
          this.appendSessionMessage(sessionId, instructionsMessage);
        }
        const userMessage = this.buildUserMessage(sessionId, userPrompt);
        this.appendSessionMessage(sessionId, userMessage);
        if (userPrompt.text) {
          const skills = await this.listSkills();
          const skillNames = await this.identifyMatchingSkillNames(skills, userPrompt.text, { signal });
          this.throwIfAborted(signal);
          const skillSet = new Set(skillNames);
          const matchedSkill = skills.filter((skill) => skillSet.has(skill.name));
          if (Array.isArray(userPrompt.skills)) {
            userPrompt.skills.push(...matchedSkill);
          } else if (matchedSkill.length > 0) {
            userPrompt.skills = matchedSkill;
          }
        }
        userPrompt.skills = await this.normalizeSkills(userPrompt.skills);
        this.throwIfAborted(signal);
        if (userPrompt.skills && userPrompt.skills.length > 0) {
          for (const skill of userPrompt.skills) {
            if (skill.isLoaded) {
              continue;
            }
            const skillMd = fs11.readFileSync(this.resolveSkillPath(skill.path), "utf8");
            const skillPrompt = `\u4EE5\u4E0B\u6280\u80FD\u6587\u6863\u7528\u4E8E\u8F85\u52A9\u5B8C\u6210\u5F53\u524D\u4EFB\u52A1\uFF1A

<${skill.name}-skill path="${this.resolveSkillPath(skill.path)}">
${skillMd}
</${skill.name}-skill>`;
            const skillMessage = this.buildSkillMessage(sessionId, skillPrompt, skill);
            this.appendSessionMessage(sessionId, skillMessage);
            this.onAssistantMessage(skillMessage, true);
          }
        }
        this.activeSessionId = sessionId;
        await this.activateSession(sessionId, controller);
        return sessionId;
      }
      async replySession(sessionId, userPrompt, controller) {
        const signal = controller?.signal;
        this.throwIfAborted(signal);
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const updated = this.updateSessionEntry(sessionId, (entry) => ({
          ...entry,
          status: "pending",
          failReason: null,
          updateTime: now
        }));
        if (!updated) {
          await this.createSession(userPrompt, controller);
          return;
        }
        if (this.isContinuePrompt(userPrompt)) {
          this.activeSessionId = sessionId;
          await this.activateSession(sessionId, controller);
          return;
        }
        this.ensureFileHistorySession(sessionId);
        const userMessage = this.buildUserMessage(sessionId, userPrompt);
        this.appendSessionMessage(sessionId, userMessage);
        if (userPrompt.text) {
          const skills = await this.listSkills(sessionId);
          const skillNames = await this.identifyMatchingSkillNames(skills, userPrompt.text, { signal, sessionId });
          this.throwIfAborted(signal);
          const skillSet = new Set(skillNames);
          const matchedSkill = skills.filter((skill) => skillSet.has(skill.name));
          if (Array.isArray(userPrompt.skills)) {
            userPrompt.skills.push(...matchedSkill);
          } else if (matchedSkill.length > 0) {
            userPrompt.skills = matchedSkill;
          }
        }
        userPrompt.skills = await this.normalizeSkills(userPrompt.skills, sessionId);
        this.throwIfAborted(signal);
        if (userPrompt.skills && userPrompt.skills.length > 0) {
          for (const skill of userPrompt.skills) {
            if (skill.isLoaded) {
              continue;
            }
            const skillMd = fs11.readFileSync(this.resolveSkillPath(skill.path), "utf8");
            const skillPrompt = `\u4EE5\u4E0B\u6280\u80FD\u6587\u6863\u7528\u4E8E\u8F85\u52A9\u5B8C\u6210\u5F53\u524D\u4EFB\u52A1\uFF1A

<${skill.name}-skill path="${this.resolveSkillPath(skill.path)}">
${skillMd}
</${skill.name}-skill>`;
            const skillMessage = this.buildSkillMessage(sessionId, skillPrompt, skill);
            this.appendSessionMessage(sessionId, skillMessage);
            this.onAssistantMessage(skillMessage, true);
          }
        }
        this.activeSessionId = sessionId;
        await this.activateSession(sessionId, controller);
      }
      isContinuePrompt(userPrompt) {
        return typeof userPrompt.text === "string" && userPrompt.text.trim() === "/continue" && (!userPrompt.imageUrls || userPrompt.imageUrls.length === 0) && (!userPrompt.skills || userPrompt.skills.length === 0);
      }
      async activateSession(sessionId, controller) {
        const startedAt = Date.now();
        const { client, model, baseURL, thinkingEnabled, reasoningEffort, debugLogEnabled, notify, env } = this.createOpenAIClient();
        const now = (/* @__PURE__ */ new Date()).toISOString();
        if (!client) {
          this.updateSessionEntry(sessionId, (entry) => ({
            ...entry,
            status: "failed",
            failReason: "OpenAI API key not found",
            updateTime: now
          }));
          this.onAssistantMessage(
            this.buildAssistantMessage(
              sessionId,
              "OpenAI API key not found. Please configure ~/.lima-code/settings.json or ./.lima-code/settings.json. Legacy .deepcode settings are still read as a fallback.",
              null
            ),
            false
          );
          this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
          return;
        }
        const sessionController = controller ?? new AbortController();
        if (sessionController.signal.aborted) {
          this.updateSessionEntry(sessionId, (entry) => ({
            ...entry,
            status: "interrupted",
            failReason: "interrupted",
            updateTime: now
          }));
          this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
          return;
        }
        this.updateSessionEntry(sessionId, (entry) => ({
          ...entry,
          status: "processing",
          updateTime: now
        }));
        this.sessionControllers.set(sessionId, sessionController);
        try {
          const maxIterations = DEFAULT_MAX_MODEL_ITERATIONS;
          let toolCalls = null;
          for (let iteration = 0; iteration < maxIterations; iteration++) {
            if (this.isInterrupted(sessionId)) {
              return;
            }
            const session = this.getSession(sessionId);
            if (session == null || session.status === "interrupted" || session.status === "failed") {
              return;
            }
            const pendingToolCalls = this.getTrailingPendingToolCalls(this.listSessionMessages(sessionId));
            if (pendingToolCalls.length > 0) {
              const toolAppendResult = await this.appendToolMessages(sessionId, pendingToolCalls);
              if (this.isInterrupted(sessionId)) {
                return;
              }
              if (toolAppendResult.waitingForUser) {
                this.updateSessionEntry(sessionId, (entry) => ({
                  ...entry,
                  toolCalls: pendingToolCalls,
                  status: "waiting_for_user",
                  updateTime: (/* @__PURE__ */ new Date()).toISOString()
                }));
                return;
              }
            }
            const compactPromptTokenThreshold = getCompactPromptTokenThreshold(model);
            if (session.activeTokens > compactPromptTokenThreshold) {
              const message2 = this.buildAssistantMessage(
                sessionId,
                "The conversation is getting long, compacting...",
                null
              );
              message2.meta = { asThinking: true };
              this.onAssistantMessage(message2, false);
              await this.compactSession(sessionId, sessionController.signal);
            }
            const messages = this.buildProviderOpenAIMessages(
              this.listSessionMessages(sessionId),
              thinkingEnabled,
              model,
              baseURL
            );
            const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort);
            const response = await this.createChatCompletionStream(
              client,
              {
                model,
                messages,
                tools: getTools(this.getPromptToolOptions(), this.mcpToolDefinitions),
                ...thinkingOptions
              },
              { signal: sessionController.signal },
              sessionId,
              {
                enabled: debugLogEnabled,
                location: "SessionManager.activateSession",
                baseURL,
                params: { iteration, thinkingEnabled, reasoningEffort }
              }
            );
            const message = response.choices?.[0]?.message;
            const rawContent = message?.content;
            let content = typeof rawContent === "string" ? rawContent : "";
            const rawToolCalls = message?.tool_calls ?? null;
            toolCalls = this.normalizeLlmToolCalls(rawToolCalls);
            const rawThinking = message?.reasoning_content;
            const thinking = typeof rawThinking === "string" ? rawThinking : null;
            const refusal = message?.refusal ?? null;
            const repeatedToolCallLoopMessage = this.getRepeatedToolCallLoopMessage(
              this.listSessionMessages(sessionId),
              toolCalls
            );
            if (content && !thinking) {
              content = this.stripThinkingContent(content);
            }
            if (repeatedToolCallLoopMessage) {
              content = repeatedToolCallLoopMessage;
              toolCalls = null;
            }
            const emptyAssistantResponse = !content.trim() && !thinking?.trim() && !toolCalls && !refusal;
            if (emptyAssistantResponse) {
              content = EMPTY_ASSISTANT_RESPONSE_MESSAGE;
            }
            if (this.isInterrupted(sessionId)) {
              return;
            }
            const assistantMessage = this.buildAssistantMessage(sessionId, content, toolCalls, thinking);
            this.appendSessionMessage(sessionId, assistantMessage);
            this.onAssistantMessage(assistantMessage, true);
            let waitingForUser = false;
            if (toolCalls) {
              const toolAppendResult = await this.appendToolMessages(sessionId, toolCalls);
              waitingForUser = toolAppendResult.waitingForUser;
            }
            if (this.isInterrupted(sessionId)) {
              return;
            }
            const responseUsage = response.usage ?? null;
            this.updateSessionEntry(sessionId, (entry) => ({
              ...entry,
              assistantReply: content,
              assistantThinking: thinking,
              assistantRefusal: refusal,
              toolCalls,
              usage: accumulateUsage(entry.usage, responseUsage),
              usagePerModel: accumulateUsagePerModel(entry.usagePerModel, model, responseUsage),
              activeTokens: getTotalTokens(responseUsage),
              status: refusal || emptyAssistantResponse ? "failed" : waitingForUser ? "waiting_for_user" : toolCalls ? "processing" : "completed",
              failReason: refusal ? refusal : emptyAssistantResponse ? EMPTY_ASSISTANT_RESPONSE_MESSAGE : entry.failReason,
              updateTime: (/* @__PURE__ */ new Date()).toISOString()
            }));
            if (refusal) {
              return;
            }
            if (waitingForUser) {
              return;
            }
            if (!toolCalls) {
              return;
            }
          }
          this.updateSessionEntry(sessionId, (entry) => ({
            ...entry,
            status: "completed",
            updateTime: (/* @__PURE__ */ new Date()).toISOString()
          }));
          this.onAssistantMessage(
            this.buildAssistantMessage(
              sessionId,
              "The AI agent has taken several steps but hasn't reached a conclusion yet. Do you want to continue?",
              null
            ),
            false
          );
        } catch (error) {
          const errMessage = error instanceof Error ? error.message : String(error);
          const aborted = this.isAbortLikeError(error) || sessionController.signal.aborted;
          this.updateSessionEntry(sessionId, (entry) => ({
            ...entry,
            status: aborted ? "interrupted" : "failed",
            failReason: aborted ? "interrupted" : errMessage,
            updateTime: (/* @__PURE__ */ new Date()).toISOString()
          }));
          if (!aborted) {
            this.onAssistantMessage(this.buildAssistantMessage(sessionId, `\u8BF7\u6C42\u5931\u8D25: ${errMessage}`, null), false);
          }
        } finally {
          if (this.sessionControllers.get(sessionId) === sessionController) {
            this.sessionControllers.delete(sessionId);
          }
          this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
        }
      }
      /**
       * Context-aware compaction with token boundary finding, skill pin preservation,
       * and pinned constraint extraction (ported from MiMo-Reasonix ContextManager).
       */
      async compactSession(sessionId, signal) {
        this.throwIfAborted(signal);
        const { client, model, baseURL, thinkingEnabled, reasoningEffort, debugLogEnabled } = this.createOpenAIClient();
        if (!client) {
          return;
        }
        const sessionMessages = this.listSessionMessages(sessionId).filter((message) => !message.compacted);
        if (sessionMessages.length === 0) {
          return;
        }
        const startIndex = sessionMessages.findIndex((message) => message.role !== "system");
        if (startIndex === -1) {
          return;
        }
        const ctxMax = DEEPSEEK_V4_MODELS.has(model) ? 512 * 1024 : 128 * 1024;
        const tailBudget = Math.floor(ctxMax * 0.2);
        const tokenEstimates = sessionMessages.map((m) => {
          let n = this.estimateStreamTokens(typeof m.content === "string" ? m.content : "");
          const messageParams = m.messageParams;
          if (m.role === "assistant" && Array.isArray(messageParams?.tool_calls) && messageParams.tool_calls.length > 0) {
            n += this.estimateStreamTokens(JSON.stringify(messageParams.tool_calls));
          }
          return n;
        });
        const totalEstimate = tokenEstimates.reduce((a, b) => a + b, 0);
        let cumTokens = 0;
        let endIndex = sessionMessages.length;
        for (let i = sessionMessages.length - 1; i >= startIndex; i--) {
          if (cumTokens + tokenEstimates[i] > tailBudget) break;
          cumTokens += tokenEstimates[i];
          if (sessionMessages[i].role === "user") endIndex = i;
        }
        if (endIndex <= startIndex || endIndex >= sessionMessages.length) {
          const searchStart = Math.floor(startIndex + (sessionMessages.length - startIndex) * 2 / 3);
          endIndex = sessionMessages.length;
          for (let i = Math.max(searchStart, startIndex); i < sessionMessages.length; i += 1) {
            if (sessionMessages[i].role !== "tool") {
              endIndex = i;
              break;
            }
          }
        }
        if (endIndex <= startIndex || endIndex >= sessionMessages.length) {
          return;
        }
        const headTokens = totalEstimate - cumTokens;
        if (headTokens < totalEstimate * 0.3) return;
        const compactPrompt = getCompactPrompt(sessionMessages.slice(startIndex, endIndex));
        const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort);
        const foldCtrl = new AbortController();
        const timeout = setTimeout(() => foldCtrl.abort(), 15e3);
        const summaryPromise = this.createChatCompletionStream(
          client,
          {
            model,
            messages: [{ role: "user", content: compactPrompt }],
            ...thinkingOptions
          },
          signal ? { signal: anySignal(signal, foldCtrl.signal) } : { signal: foldCtrl.signal },
          sessionId,
          {
            enabled: debugLogEnabled,
            location: "SessionManager.compactSession",
            baseURL,
            params: { thinkingEnabled, reasoningEffort }
          }
        );
        let response;
        try {
          response = await summaryPromise;
        } catch {
          return;
        } finally {
          if (timeout) clearTimeout(timeout);
        }
        this.throwIfAborted(signal);
        const rawLlmResponse = response.choices?.[0]?.message?.content;
        const llmResponse = typeof rawLlmResponse === "string" ? rawLlmResponse : "";
        const compactedSummary = llmResponse.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "").trim();
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const responseUsage = response.usage ?? null;
        this.updateSessionEntry(sessionId, (entry) => ({
          ...entry,
          usage: accumulateUsage(entry.usage, responseUsage),
          usagePerModel: accumulateUsagePerModel(entry.usagePerModel, model, responseUsage),
          activeTokens: getTotalTokens(responseUsage),
          updateTime: now
        }));
        for (let i = startIndex; i < endIndex; i += 1) {
          sessionMessages[i] = { ...sessionMessages[i], compacted: true, updateTime: now };
        }
        const pinned = extractPinnedConstraints(this.getSystemPromptText());
        const pinnedTail = pinned ? `

[PINNED CONSTRAINTS \u2014 preserved across compaction]

${pinned}` : "";
        const summaryContent = `Earlier conversation summary:

${compactedSummary}${pinnedTail}`;
        const summaryMessage = {
          id: crypto3.randomUUID(),
          sessionId,
          role: "assistant",
          content: summaryContent,
          contentParams: null,
          messageParams: null,
          compacted: false,
          visible: true,
          createTime: now,
          updateTime: now,
          meta: {
            isSummary: true
          }
        };
        sessionMessages.splice(endIndex, 0, summaryMessage);
        this.saveSessionMessages(sessionId, sessionMessages);
      }
      getPromptToolOptions() {
        return {
          model: this.getResolvedSettings().model,
          webSearchEnabled: true
        };
      }
      /**
       * Get the current system prompt text for pinned constraint extraction.
       * Used by compactSession to preserve critical instructions across folds.
       * Ported from MiMo-Reasonix cache-first pattern.
       */
      getSystemPromptText() {
        return getSystemPrompt(this.projectRoot, this.getPromptToolOptions());
      }
      interruptActiveSession() {
        const controller = this.activePromptController;
        if (controller && !controller.signal.aborted) {
          controller.abort();
        }
        const sessionId = this.activeSessionId;
        if (sessionId) {
          this.interruptSession(sessionId);
        }
      }
      interruptSession(sessionId) {
        const session = this.getSession(sessionId);
        const processIds = this.getProcessIds(session?.processes ?? null);
        const killedPids = [];
        const failedPids = [];
        for (const pid of processIds) {
          this.processTimeoutControls.delete(this.getProcessControlKey(sessionId, pid));
          if (killProcessTree(pid, "SIGKILL")) {
            killedPids.push(pid);
            continue;
          }
          failedPids.push(pid);
        }
        const controller = this.sessionControllers.get(sessionId);
        if (controller) {
          controller.abort();
          this.sessionControllers.delete(sessionId);
        }
        const now = (/* @__PURE__ */ new Date()).toISOString();
        this.updateSessionEntry(sessionId, (entry) => ({
          ...entry,
          status: "interrupted",
          failReason: "interrupted",
          processes: null,
          updateTime: now
        }));
        const contentParts = ["Interrupted."];
        if (killedPids.length > 0) {
          contentParts.push(`Killed processes: ${killedPids.join(", ")}.`);
        }
        if (failedPids.length > 0) {
          contentParts.push(`Failed to kill processes: ${failedPids.join(", ")}.`);
        }
        this.onAssistantMessage(this.buildUserMessage(sessionId, { text: contentParts.join(" ") }), false);
      }
      isInterrupted(sessionId) {
        return !this.sessionControllers.has(sessionId);
      }
      adjustActiveBashTimeout(deltaMs) {
        const sessionId = this.activeSessionId;
        if (!sessionId || !Number.isFinite(deltaMs)) {
          return null;
        }
        const session = this.getSession(sessionId);
        if (!session?.processes) {
          return null;
        }
        let selectedPid = null;
        for (const pid of session.processes.keys()) {
          if (this.processTimeoutControls.has(this.getProcessControlKey(sessionId, pid))) {
            selectedPid = pid;
          }
        }
        if (!selectedPid) {
          return null;
        }
        const control = this.processTimeoutControls.get(this.getProcessControlKey(sessionId, selectedPid));
        if (!control) {
          return null;
        }
        const current = control.getInfo();
        const next = control.setTimeoutMs(current.timeoutMs + deltaMs);
        this.updateSessionProcessTimeout(sessionId, selectedPid, next);
        return this.buildBashTimeoutAdjustment(selectedPid, next);
      }
      listSessions() {
        const index = this.loadSessionsIndex();
        return index.entries;
      }
      getSession(sessionId) {
        const index = this.loadSessionsIndex();
        return index.entries.find((entry) => entry.id === sessionId) ?? null;
      }
      listSessionMessages(sessionId) {
        const messagePath = this.getSessionMessagesPath(sessionId);
        if (!fs11.existsSync(messagePath)) {
          return [];
        }
        const raw = fs11.readFileSync(messagePath, "utf8");
        const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
        const messages = [];
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            messages.push(this.normalizeSessionMessage(parsed));
          } catch {
          }
        }
        return messages;
      }
      listUndoTargets(sessionId) {
        return this.listSessionMessages(sessionId).map((message, index) => ({ message, index })).filter(({ message }) => this.isUndoTargetMessage(message)).map(({ message, index }) => ({
          message,
          index,
          canRestoreCode: Boolean(
            message.checkpointHash && this.canRestoreCheckpointHash(sessionId, message.checkpointHash)
          )
        }));
      }
      restoreSessionConversation(sessionId, messageId) {
        const messages = this.listSessionMessages(sessionId);
        const targetIndex = messages.findIndex((message) => message.id === messageId);
        if (targetIndex === -1) {
          throw new Error("Selected message was not found in this session.");
        }
        const keptMessages = messages.slice(0, targetIndex);
        this.saveSessionMessages(sessionId, keptMessages);
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const latestAssistant = [...keptMessages].reverse().find((message) => message.role === "assistant");
        const latestAssistantParams = latestAssistant?.messageParams;
        this.updateSessionEntry(sessionId, (entry) => ({
          ...entry,
          assistantReply: latestAssistant?.content ?? null,
          assistantThinking: typeof latestAssistantParams?.reasoning_content === "string" ? latestAssistantParams.reasoning_content : null,
          assistantRefusal: null,
          toolCalls: null,
          status: "completed",
          failReason: null,
          processes: null,
          updateTime: now
        }));
        return keptMessages;
      }
      restoreSessionCode(sessionId, messageId) {
        const message = this.listSessionMessages(sessionId).find((item) => item.id === messageId);
        if (!message) {
          throw new Error("Selected message was not found in this session.");
        }
        if (!message.checkpointHash) {
          throw new Error("Selected message has no code checkpoint.");
        }
        this.restoreCheckpointHash(sessionId, message.checkpointHash);
      }
      normalizeSessionMessage(message) {
        if (message.role !== "tool") {
          return message;
        }
        const nextMeta = message.meta ? { ...message.meta } : void 0;
        const normalizedParamsMd = this.buildToolParamsSnippet(nextMeta?.function ?? null);
        if (nextMeta && normalizedParamsMd) {
          nextMeta.paramsMd = normalizedParamsMd;
        }
        const normalizedResultMd = typeof message.content === "string" ? this.buildToolResultSnippet(message.content) : "";
        if (nextMeta && normalizedResultMd) {
          nextMeta.resultMd = normalizedResultMd;
        }
        return {
          ...message,
          visible: typeof message.content === "string" ? !this.isInvisibleExecution(message.content) : message.visible,
          meta: nextMeta
        };
      }
      getProjectCode(projectRoot2) {
        return projectRoot2.replace(/[\\/]/g, "-").replace(/:/g, "");
      }
      getProjectStorage() {
        const projectCode = this.getProjectCode(this.projectRoot);
        const projectDir = path11.join(os7.homedir(), ".deepcode", "projects", projectCode);
        const sessionsIndexPath = path11.join(projectDir, "sessions-index.json");
        return { projectCode, projectDir, sessionsIndexPath };
      }
      getFileHistory() {
        return new GitFileHistory(this.projectRoot, this.getFileHistoryGitDir());
      }
      getFileHistoryGitDir() {
        const { projectDir } = this.getProjectStorage();
        return path11.join(projectDir, "file-history", ".git");
      }
      ensureFileHistorySession(sessionId) {
        return this.getFileHistory().ensureSession(sessionId);
      }
      getCurrentCheckpointHash(sessionId) {
        return this.getFileHistory().getCurrentCheckpointHash(sessionId);
      }
      prepareFileMutationCheckpoint(sessionId, filePath) {
        const fileHistory = this.getFileHistory();
        const previousHash = fileHistory.ensureSession(sessionId);
        if (!previousHash) {
          return;
        }
        this.updateLatestUserCheckpointHash(sessionId, void 0, previousHash);
        const nextHash = fileHistory.recordCheckpoint(sessionId, [filePath], "Pre-mutation checkpoint");
        if (nextHash && nextHash !== previousHash) {
          this.updateLatestUserCheckpointHash(sessionId, previousHash, nextHash);
        }
      }
      recordFileMutationCheckpoint(sessionId, filePath) {
        const fileHistory = this.getFileHistory();
        fileHistory.ensureSession(sessionId);
        fileHistory.recordCheckpoint(sessionId, [filePath], "File mutation checkpoint");
      }
      updateLatestUserCheckpointHash(sessionId, previousHash, nextHash) {
        const messages = this.listSessionMessages(sessionId);
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const message = messages[index];
          if (!message || !this.isUndoTargetMessage(message)) {
            continue;
          }
          if (message.checkpointHash && message.checkpointHash !== previousHash) {
            return;
          }
          messages[index] = {
            ...message,
            checkpointHash: nextHash,
            updateTime: (/* @__PURE__ */ new Date()).toISOString()
          };
          this.saveSessionMessages(sessionId, messages);
          return;
        }
      }
      canRestoreCheckpointHash(sessionId, checkpointHash) {
        return this.getFileHistory().canRestore(sessionId, checkpointHash);
      }
      restoreCheckpointHash(sessionId, checkpointHash) {
        this.getFileHistory().restore(sessionId, checkpointHash);
      }
      isUndoTargetMessage(message) {
        return message.role === "user" && message.visible && !message.compacted;
      }
      ensureProjectDir() {
        const { projectDir } = this.getProjectStorage();
        fs11.mkdirSync(projectDir, { recursive: true });
        return projectDir;
      }
      loadSessionsIndex() {
        const { sessionsIndexPath } = this.getProjectStorage();
        this.ensureProjectDir();
        if (!fs11.existsSync(sessionsIndexPath)) {
          return { version: 1, entries: [], originalPath: this.projectRoot };
        }
        try {
          const raw = fs11.readFileSync(sessionsIndexPath, "utf8");
          const parsed = JSON.parse(raw);
          const entries = Array.isArray(parsed.entries) ? parsed.entries.map((entry) => this.normalizeSessionEntry(entry)) : [];
          return {
            version: 1,
            entries,
            originalPath: parsed.originalPath || this.projectRoot
          };
        } catch {
          return { version: 1, entries: [], originalPath: this.projectRoot };
        }
      }
      saveSessionsIndex(index) {
        const { sessionsIndexPath } = this.getProjectStorage();
        this.ensureProjectDir();
        const normalized = {
          version: 1,
          entries: index.entries.map((entry) => ({
            ...entry,
            processes: this.serializeProcesses(entry.processes)
          })),
          originalPath: this.projectRoot
        };
        fs11.writeFileSync(sessionsIndexPath, JSON.stringify(normalized, null, 2), "utf8");
      }
      getSessionMessagesPath(sessionId) {
        const { projectDir } = this.getProjectStorage();
        return path11.join(projectDir, `${sessionId}.jsonl`);
      }
      removeSessionMessages(sessionIds) {
        for (const sessionId of sessionIds) {
          const messagePath = this.getSessionMessagesPath(sessionId);
          try {
            if (fs11.existsSync(messagePath)) {
              fs11.unlinkSync(messagePath);
            }
          } catch {
          }
        }
      }
      appendSessionMessage(sessionId, message) {
        this.ensureProjectDir();
        const messagePath = this.getSessionMessagesPath(sessionId);
        fs11.appendFileSync(messagePath, `${JSON.stringify(message)}
`, "utf8");
      }
      saveSessionMessages(sessionId, messages) {
        this.ensureProjectDir();
        const messagePath = this.getSessionMessagesPath(sessionId);
        const payload = messages.map((message) => JSON.stringify(message)).join("\n");
        fs11.writeFileSync(messagePath, payload ? `${payload}
` : "", "utf8");
      }
      updateSessionEntry(sessionId, updater) {
        const index = this.loadSessionsIndex();
        const entryIndex = index.entries.findIndex((entry) => entry.id === sessionId);
        if (entryIndex === -1) {
          return null;
        }
        const updated = updater({ ...index.entries[entryIndex] });
        index.entries[entryIndex] = updated;
        this.saveSessionsIndex(index);
        this.onSessionEntryUpdated?.(updated);
        return updated;
      }
      buildUserMessage(sessionId, prompt) {
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const imageParams = prompt.imageUrls?.filter((url) => Boolean(url)).map((url) => ({
          type: "image_url",
          image_url: { url }
        })) ?? [];
        return {
          id: crypto3.randomUUID(),
          sessionId,
          role: "user",
          content: prompt.text ?? "",
          contentParams: imageParams.length > 0 ? imageParams : null,
          messageParams: null,
          compacted: false,
          visible: true,
          createTime: now,
          updateTime: now,
          checkpointHash: this.getCurrentCheckpointHash(sessionId)
        };
      }
      renderInitCommandPrompt() {
        const templatePath = path11.join(getExtensionRoot2(), "templates", "prompts", "init_command.md.ejs");
        const template = fs11.readFileSync(templatePath, "utf8");
        return ejs2.render(template, {
          agentsMdFile: this.getEffectiveProjectAgentsMdFile()
        });
      }
      getEffectiveProjectAgentsMdFile() {
        return this.loadProjectAgentInstructions()?.displayPath ?? null;
      }
      loadProjectAgentInstructions() {
        const candidatePaths = [
          {
            absolutePath: path11.join(this.projectRoot, ".deepcode", "AGENTS.md"),
            displayPath: "./.deepcode/AGENTS.md"
          },
          {
            absolutePath: path11.join(this.projectRoot, "AGENTS.md"),
            displayPath: "./AGENTS.md"
          }
        ];
        for (const candidatePath of candidatePaths) {
          const content = this.readNonEmptyFile(candidatePath.absolutePath);
          if (content) {
            return {
              content,
              displayPath: candidatePath.displayPath
            };
          }
        }
        return null;
      }
      readNonEmptyFile(filePath) {
        try {
          if (!fs11.existsSync(filePath)) {
            return null;
          }
          const content = fs11.readFileSync(filePath, "utf8").trim();
          return content || null;
        } catch {
          return null;
        }
      }
      loadAgentInstructions() {
        const projectInstructions = this.loadProjectAgentInstructions();
        if (projectInstructions) {
          return projectInstructions.content;
        }
        return this.readNonEmptyFile(path11.join(os7.homedir(), ".deepcode", "AGENTS.md"));
      }
      buildSystemMessage(sessionId, content, contentParams = null, visible = false, meta) {
        const now = (/* @__PURE__ */ new Date()).toISOString();
        return {
          id: crypto3.randomUUID(),
          sessionId,
          role: "system",
          content,
          contentParams,
          messageParams: null,
          compacted: false,
          visible,
          createTime: now,
          updateTime: now,
          meta
        };
      }
      buildSkillMessage(sessionId, content, skill) {
        const now = (/* @__PURE__ */ new Date()).toISOString();
        return {
          id: crypto3.randomUUID(),
          sessionId,
          role: "system",
          content,
          contentParams: null,
          messageParams: null,
          compacted: false,
          visible: true,
          createTime: now,
          updateTime: now,
          meta: { skill: { ...skill, isLoaded: true } }
        };
      }
      buildAssistantMessage(sessionId, content, toolCalls, reasoningContent) {
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const hasReasoningContent = reasoningContent != null;
        const messageParams = toolCalls || hasReasoningContent ? {} : null;
        if (toolCalls) {
          messageParams.tool_calls = toolCalls;
        }
        if (hasReasoningContent) {
          messageParams.reasoning_content = reasoningContent;
        }
        return {
          id: crypto3.randomUUID(),
          sessionId,
          role: "assistant",
          content,
          contentParams: null,
          messageParams,
          compacted: false,
          visible: (content || reasoningContent || "").trim() ? true : false,
          createTime: now,
          updateTime: now,
          meta: toolCalls ? { asThinking: true } : void 0
        };
      }
      generateToolCallId() {
        return crypto3.randomBytes(16).toString("hex");
      }
      /**
       * Strip verbose thinking content that some backends return as the main content.
       * Detects Chinese/English thinking patterns and extracts the actual answer.
       */
      stripThinkingContent(content) {
        const thinkTagRe = new RegExp("<think>[\\s\\S]*?<\\/think>\\s*", "g");
        const cleaned = content.replace(thinkTagRe, "").trim();
        const text = cleaned || content.trim();
        const codeBlocks = text.match(/```[\s\S]*?```/g);
        if (codeBlocks && codeBlocks.length > 0) {
          const afterCode = text.substring(text.lastIndexOf("```") + 3).trim();
          return codeBlocks.join("\n\n") + (afterCode.length > 5 ? "\n\n" + afterCode : "");
        }
        const answerMatch = text.match(/[答结][案果][是为：:]\s*[「"']?([^。\n"']+)/) || text.match(/[Aa]nswer[:\s]+([^.\n]+)/) || text.match(/F\(\d+\)\s*=\s*(\d[\d,. ]*)/);
        if (answerMatch && answerMatch[1] && answerMatch[1].trim().length > 0) {
          return answerMatch[1].trim();
        }
        const lines = text.split("\n").filter((l) => l.trim().length > 0);
        const thinkingRe = /^(?:用户[问要需想]|根据[我我的指约]|我[需应可]该|让我[来写提分]|这是一个|简单[来分]析|根据约束|根据指令|作为[一]|首先[我需]|我们需要|值得注意|The user|I need to|Let me|I should|Based on|I can|For this|This is|I will|In this|To solve|We need|It is|There are|My approach|The answer|I think|Let's|Here is|For this)/;
        let thinkingLines = 0;
        for (const line of lines) {
          if (thinkingRe.test(line.trim())) {
            thinkingLines++;
          }
        }
        const numberedThinking = text.match(/^[\d]+\.\s+\S+/gm);
        if (numberedThinking && numberedThinking.length >= 3 && !text.includes("```")) {
          thinkingLines = Math.max(thinkingLines, numberedThinking.length);
        }
        if (thinkingLines >= 1 && thinkingLines >= lines.length * 0.15) {
          for (let i = lines.length - 1; i >= 0; i--) {
            if (!thinkingRe.test(lines[i].trim()) && lines[i].trim().length > 3) {
              return lines.slice(i).join("\n").trim();
            }
          }
          return content;
        }
        return content;
      }
      normalizeLlmToolCalls(rawToolCalls) {
        if (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0) {
          return null;
        }
        return rawToolCalls.map((toolCall) => {
          if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
            return toolCall;
          }
          const record = toolCall;
          const id = typeof record.id === "string" ? record.id.trim() : "";
          if (id) {
            return toolCall;
          }
          return {
            ...record,
            id: this.generateToolCallId()
          };
        });
      }
      getRepeatedToolCallLoopMessage(messages, toolCalls) {
        if (!toolCalls || toolCalls.length === 0) {
          return null;
        }
        const previousCounts = /* @__PURE__ */ new Map();
        for (const message of messages) {
          for (const previousToolCall of this.getAssistantToolCalls(message)) {
            const signature = this.getToolCallSignature(previousToolCall);
            if (!signature) {
              continue;
            }
            previousCounts.set(signature, (previousCounts.get(signature) ?? 0) + 1);
          }
        }
        for (const toolCall of toolCalls) {
          const signature = this.getToolCallSignature(toolCall);
          if (!signature) {
            continue;
          }
          if ((previousCounts.get(signature) ?? 0) >= 2) {
            return `The model repeated the same tool call several times, so LiMa Code stopped the loop before running it again: ${this.formatToolCallSignatureForDisplay(signature)}. Refine the prompt or use /continue if you want another pass.`;
          }
        }
        return null;
      }
      getToolCallSignature(toolCall) {
        if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
          return null;
        }
        const toolFunction = toolCall.function;
        if (!toolFunction || typeof toolFunction !== "object" || Array.isArray(toolFunction)) {
          return null;
        }
        const name = toolFunction.name;
        const args2 = toolFunction.arguments;
        if (typeof name !== "string" || !name.trim()) {
          return null;
        }
        const normalizedArgs = this.normalizeToolCallArguments(typeof args2 === "string" ? args2 : "");
        return `${name.trim()}:${normalizedArgs}`;
      }
      normalizeToolCallArguments(args2) {
        const trimmed = args2.trim();
        if (!trimmed) {
          return "";
        }
        try {
          return JSON.stringify(JSON.parse(trimmed));
        } catch {
          return trimmed;
        }
      }
      formatToolCallSignatureForDisplay(signature) {
        return signature.length > 160 ? `${signature.slice(0, 157)}...` : signature;
      }
      buildToolMessage(sessionId, toolCallId, content, toolFunction) {
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const paramsMd = this.buildToolParamsSnippet(toolFunction);
        const resultMd = this.buildToolResultSnippet(content);
        const isInvisibleExecution = this.isInvisibleExecution(content);
        return {
          id: crypto3.randomUUID(),
          sessionId,
          role: "tool",
          content,
          contentParams: null,
          messageParams: { tool_call_id: toolCallId },
          compacted: false,
          visible: !isInvisibleExecution,
          createTime: now,
          updateTime: now,
          meta: {
            function: toolFunction ?? void 0,
            paramsMd,
            resultMd
          }
        };
      }
      async appendToolMessages(sessionId, toolCalls) {
        const toolExecutions = await this.toolExecutor.executeToolCalls(sessionId, toolCalls, {
          onProcessStart: (pid, command) => this.addSessionProcess(sessionId, pid, command),
          onProcessExit: (pid) => this.removeSessionProcess(sessionId, pid),
          onProcessStdout: (pid, chunk) => this.onProcessStdout?.(Number(pid), chunk),
          onProcessTimeoutControl: (pid, control) => this.setSessionProcessTimeoutControl(sessionId, pid, control),
          onBeforeFileMutation: (filePath) => this.prepareFileMutationCheckpoint(sessionId, filePath),
          onAfterFileMutation: (filePath) => this.recordFileMutationCheckpoint(sessionId, filePath),
          shouldStop: () => this.isInterrupted(sessionId)
        });
        if (this.isInterrupted(sessionId)) {
          return { waitingForUser: false };
        }
        let waitingForUser = false;
        const followUpMessages = [];
        for (const execution of toolExecutions) {
          if (execution.result.awaitUserResponse === true) {
            waitingForUser = true;
          }
          const toolFunction = this.findToolFunction(toolCalls, execution.toolCallId);
          const toolMessage = this.buildToolMessage(sessionId, execution.toolCallId, execution.content, toolFunction);
          this.appendSessionMessage(sessionId, toolMessage);
          this.onAssistantMessage(toolMessage, true);
          for (const followUpMessage of execution.result.followUpMessages ?? []) {
            if (followUpMessage.role !== "system") {
              continue;
            }
            followUpMessages.push(
              this.buildSystemMessage(sessionId, followUpMessage.content, followUpMessage.contentParams ?? null)
            );
          }
        }
        for (const followUpMessage of followUpMessages) {
          this.appendSessionMessage(sessionId, followUpMessage);
        }
        return { waitingForUser };
      }
      buildOpenAIMessages(messages, thinkingEnabled, model) {
        const activeMessages = messages.filter((message) => !message.compacted);
        const toolPairings = this.pairToolMessages(activeMessages);
        const openAIMessages = [];
        for (let index = 0; index < activeMessages.length; index += 1) {
          const message = activeMessages[index];
          if (message.role === "tool") {
            continue;
          }
          openAIMessages.push(this.sessionMessageToOpenAIMessage(message, thinkingEnabled, model));
          const toolCalls = this.getAssistantToolCalls(message);
          if (toolCalls.length === 0) {
            continue;
          }
          for (let toolCallIndex = 0; toolCallIndex < toolCalls.length; toolCallIndex += 1) {
            const toolCallId = this.getToolCallId(toolCalls[toolCallIndex]);
            if (!toolCallId) {
              continue;
            }
            const pairedToolIndex = toolPairings.get(this.buildToolPairingKey(index, toolCallIndex));
            if (pairedToolIndex != null) {
              openAIMessages.push(
                this.sessionMessageToOpenAIMessage(activeMessages[pairedToolIndex], thinkingEnabled, model)
              );
              continue;
            }
            openAIMessages.push(this.buildInterruptedOpenAIToolMessage(toolCalls, toolCallId));
          }
        }
        return openAIMessages;
      }
      buildProviderOpenAIMessages(messages, thinkingEnabled, model, baseURL) {
        const openAIMessages = this.buildOpenAIMessages(messages, thinkingEnabled, model);
        if (!isLiMaRouterBaseURL(baseURL)) {
          return openAIMessages;
        }
        return openAIMessages.map((message) => this.toLiMaRouterSafeMessage(message));
      }
      toLiMaRouterSafeMessage(message) {
        const content = message.content;
        if (typeof content !== "string") {
          return message;
        }
        const safeContent = this.toLiMaRouterSafeText(content);
        if (safeContent === content) {
          return message;
        }
        return {
          ...message,
          content: safeContent
        };
      }
      toLiMaRouterSafeText(content) {
        if (content.includes("# Available Tools")) {
          return LIMA_ROUTER_SAFE_SYSTEM_PROMPT;
        }
        if (content.includes("<agent-drift-guard-skill>") && content.includes("<plan-and-execute-skill>")) {
          return LIMA_ROUTER_SAFE_DEFAULT_SKILL_PROMPT;
        }
        if (!this.isLikelyProjectInstructionBlob(content)) {
          return content;
        }
        return `${LIMA_ROUTER_PROJECT_INSTRUCTION_SUMMARY}

Original project instruction length: ${content.length} characters.`;
      }
      isLikelyProjectInstructionBlob(content) {
        if (content.length < LIMA_ROUTER_PROJECT_INSTRUCTION_MIN_CHARS) {
          return false;
        }
        const normalized = content.toLowerCase();
        const projectMarkers = [
          "milestone collaboration protocol",
          "codegraph_start",
          "codegraph_end",
          "project-doc",
          "agents.md",
          "agent automatic closeout",
          "vps"
        ];
        return projectMarkers.some((marker) => normalized.includes(marker));
      }
      sessionMessageToOpenAIMessage(message, thinkingEnabled, model) {
        const content = this.renderOpenAIMessageContent(message);
        const base = {
          role: message.role,
          content
        };
        const messageParams = message.messageParams;
        if (messageParams?.tool_calls) {
          base.tool_calls = messageParams.tool_calls;
        }
        if (messageParams?.tool_call_id) {
          base.tool_call_id = messageParams.tool_call_id;
        }
        if (typeof messageParams?.reasoning_content === "string") {
          base.reasoning_content = messageParams.reasoning_content;
        } else if (thinkingEnabled && message.role === "assistant") {
          base.reasoning_content = "";
        }
        if ((message.role === "user" || message.role === "system") && message.contentParams) {
          const contentParts = [];
          if (content) {
            contentParts.push({ type: "text", text: content });
          }
          const params = Array.isArray(message.contentParams) ? message.contentParams : [message.contentParams];
          for (const param of params) {
            const part = param;
            if (part && (part.type !== "image_url" || supportsMultimodal(model))) {
              contentParts.push(part);
            }
          }
          const contentValue = contentParts.length > 0 ? contentParts : content;
          base.content = contentValue;
        }
        return base;
      }
      renderOpenAIMessageContent(message) {
        if (message.role === "user" && message.content === "/init") {
          return this.renderInitCommandPrompt();
        }
        return message.content ?? "";
      }
      pairToolMessages(messages) {
        const pairings = /* @__PURE__ */ new Map();
        const usedToolMessageIndexes = /* @__PURE__ */ new Set();
        for (let assistantIndex = 0; assistantIndex < messages.length; assistantIndex += 1) {
          const toolCalls = this.getAssistantToolCalls(messages[assistantIndex]);
          for (let toolCallIndex = 0; toolCallIndex < toolCalls.length; toolCallIndex += 1) {
            const toolCallId = this.getToolCallId(toolCalls[toolCallIndex]);
            if (!toolCallId) {
              continue;
            }
            const toolIndex = this.findPairableToolMessageIndex(
              messages,
              assistantIndex,
              toolCallId,
              usedToolMessageIndexes
            );
            if (toolIndex == null) {
              continue;
            }
            usedToolMessageIndexes.add(toolIndex);
            pairings.set(this.buildToolPairingKey(assistantIndex, toolCallIndex), toolIndex);
          }
        }
        return pairings;
      }
      getTrailingPendingToolCalls(messages) {
        const activeMessages = messages.filter((message) => !message.compacted);
        const latestMessage = activeMessages[activeMessages.length - 1];
        if (!latestMessage || latestMessage.role !== "assistant") {
          return [];
        }
        const toolCalls = this.getAssistantToolCalls(latestMessage);
        if (toolCalls.length === 0) {
          return [];
        }
        return toolCalls.filter((toolCall) => Boolean(this.getToolCallId(toolCall)));
      }
      findPairableToolMessageIndex(messages, assistantIndex, toolCallId, usedToolMessageIndexes) {
        let firstMatchingIndex = null;
        for (let index = assistantIndex + 1; index < messages.length; index += 1) {
          const message = messages[index];
          if (message.role !== "tool" || usedToolMessageIndexes.has(index)) {
            continue;
          }
          const candidateToolCallId = this.getToolMessageCallId(message);
          if (candidateToolCallId !== toolCallId) {
            continue;
          }
          if (firstMatchingIndex == null) {
            firstMatchingIndex = index;
          }
          if (!this.isInterruptedToolMessage(message)) {
            return index;
          }
        }
        return firstMatchingIndex;
      }
      getAssistantToolCalls(message) {
        if (message.role !== "assistant") {
          return [];
        }
        const messageParams = message.messageParams;
        return Array.isArray(messageParams?.tool_calls) ? messageParams.tool_calls : [];
      }
      getToolCallId(toolCall) {
        if (!toolCall || typeof toolCall !== "object") {
          return null;
        }
        const id = toolCall.id;
        return typeof id === "string" && id ? id : null;
      }
      getToolMessageCallId(message) {
        const messageParams = message.messageParams;
        const toolCallId = messageParams?.tool_call_id;
        return typeof toolCallId === "string" && toolCallId ? toolCallId : null;
      }
      buildToolPairingKey(assistantIndex, toolCallIndex) {
        return `${assistantIndex}:${toolCallIndex}`;
      }
      isInterruptedToolMessage(message) {
        if (typeof message.content !== "string" || !message.content.trim()) {
          return false;
        }
        try {
          const parsed = JSON.parse(message.content);
          return parsed.metadata?.interrupted === true;
        } catch {
          return false;
        }
      }
      buildInterruptedOpenAIToolMessage(toolCalls, toolCallId) {
        const toolFunction = this.findToolFunction(toolCalls, toolCallId);
        return {
          role: "tool",
          content: this.buildInterruptedToolResult(toolFunction, "Previous tool call did not complete."),
          tool_call_id: toolCallId
        };
      }
      findToolFunction(toolCalls, toolCallId) {
        for (const toolCall of toolCalls) {
          if (!toolCall || typeof toolCall !== "object") {
            continue;
          }
          const record = toolCall;
          if (record.id === toolCallId) {
            return record.function ?? null;
          }
        }
        return null;
      }
      buildToolParamsSnippet(toolFunction) {
        if (!toolFunction || typeof toolFunction !== "object") {
          return "";
        }
        const args2 = toolFunction.arguments;
        const toolName = toolFunction.name;
        if (typeof args2 !== "string") {
          return "";
        }
        const trimmed = args2.trim();
        if (!trimmed) {
          return "";
        }
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return this.formatToolParamsSnippet(
              typeof toolName === "string" ? toolName : null,
              parsed
            );
          }
        } catch {
        }
        return trimmed;
      }
      formatToolParamsSnippet(toolName, args2) {
        if (toolName === "bash") {
          const command = typeof args2.command === "string" ? args2.command.trim() : "";
          const description = typeof args2.description === "string" ? args2.description.trim() : "";
          if (command && description) {
            return `${command}  # ${description}`;
          }
          if (command) {
            return command;
          }
          if (description) {
            return description;
          }
        } else if (toolName === "UpdatePlan") {
          return typeof args2.explanation === "string" ? args2.explanation.trim() : "";
        } else if (toolName === "write") {
          return typeof args2.file_path === "string" ? args2.file_path.trim() : "";
        }
        const firstKey = Object.keys(args2)[0];
        if (!firstKey) {
          return "";
        }
        const value = args2[firstKey];
        const text = typeof value === "string" ? value : JSON.stringify(value);
        if (toolName === "read" && text.startsWith(this.projectRoot)) {
          return text.slice(this.projectRoot.length).replace(/^[\\/]/, "");
        }
        return text;
      }
      buildToolResultSnippet(content) {
        const trimmed = content.trim();
        if (!trimmed) {
          return "";
        }
        const maxLength = 2e3;
        try {
          const parsed = JSON.parse(content);
          if (parsed.output !== void 0) {
            if (typeof parsed.output === "string") {
              return this.formatToolResultSnippet(parsed.output, maxLength);
            }
            return this.formatToolResultSnippet(JSON.stringify(parsed.output), maxLength);
          }
        } catch {
        }
        return this.formatToolResultSnippet(content, maxLength);
      }
      formatToolResultSnippet(value, maxLength) {
        if (value.length <= maxLength) {
          return value;
        }
        return `${value.slice(0, maxLength)}... (total ${value.length} chars)`;
      }
      isInvisibleExecution(content) {
        if (!content.trim()) {
          return false;
        }
        try {
          const parsed = JSON.parse(content);
          return parsed.name === "bash" && parsed.ok !== true;
        } catch {
          return false;
        }
      }
      maybeNotifyTaskCompletion(sessionId, notifyCommand, startedAt, configuredEnv = {}) {
        if (!notifyCommand) {
          return;
        }
        const session = this.getSession(sessionId);
        if (!session || session.status !== "completed" && session.status !== "failed") {
          return;
        }
        let body;
        const messages = this.listSessionMessages(sessionId);
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg && msg.role === "assistant" && msg.content) {
            body = msg.content;
            break;
          }
        }
        launchNotifyScript(notifyCommand, Date.now() - startedAt, this.projectRoot, void 0, configuredEnv, {
          status: session.status,
          failReason: session.failReason ?? void 0,
          body,
          title: session.summary ?? void 0
        });
      }
      addSessionProcess(sessionId, processId, command) {
        const now = (/* @__PURE__ */ new Date()).toISOString();
        this.updateSessionEntry(sessionId, (entry) => {
          const processes = new Map(entry.processes ?? []);
          processes.set(String(processId), { startTime: now, command });
          return {
            ...entry,
            processes,
            updateTime: now
          };
        });
      }
      removeSessionProcess(sessionId, processId) {
        const now = (/* @__PURE__ */ new Date()).toISOString();
        this.processTimeoutControls.delete(this.getProcessControlKey(sessionId, processId));
        this.updateSessionEntry(sessionId, (entry) => {
          const processes = new Map(entry.processes ?? []);
          processes.delete(String(processId));
          return {
            ...entry,
            processes: processes.size > 0 ? processes : null,
            updateTime: now
          };
        });
      }
      setSessionProcessTimeoutControl(sessionId, processId, control) {
        const key = this.getProcessControlKey(sessionId, processId);
        if (!control) {
          this.processTimeoutControls.delete(key);
          return;
        }
        this.processTimeoutControls.set(key, control);
        this.updateSessionProcessTimeout(sessionId, processId, control.getInfo());
      }
      updateSessionProcessTimeout(sessionId, processId, info) {
        const now = (/* @__PURE__ */ new Date()).toISOString();
        this.updateSessionEntry(sessionId, (entry) => {
          const processes = new Map(entry.processes ?? []);
          const pid = String(processId);
          const processInfo = processes.get(pid);
          if (!processInfo) {
            return entry;
          }
          processes.set(pid, {
            ...processInfo,
            timeoutMs: info.timeoutMs,
            deadlineAt: new Date(info.deadlineAtMs).toISOString(),
            timedOut: info.timedOut
          });
          return {
            ...entry,
            processes,
            updateTime: now
          };
        });
      }
      buildBashTimeoutAdjustment(processId, info) {
        return {
          processId,
          timeoutMs: info.timeoutMs,
          deadlineAt: new Date(info.deadlineAtMs).toISOString(),
          timedOut: info.timedOut
        };
      }
      getProcessControlKey(sessionId, processId) {
        return `${sessionId}:${String(processId)}`;
      }
      getProcessIds(processes) {
        if (!processes) {
          return [];
        }
        const ids = [];
        for (const pid of processes.keys()) {
          const parsed = Number(pid);
          if (Number.isInteger(parsed) && parsed > 0) {
            ids.push(parsed);
          }
        }
        return ids;
      }
      buildInterruptedToolResult(toolFunction, reason) {
        const toolName = toolFunction && typeof toolFunction === "object" && typeof toolFunction.name === "string" ? toolFunction.name : "tool";
        return JSON.stringify(
          {
            ok: false,
            name: toolName,
            error: reason,
            metadata: {
              interrupted: true
            }
          },
          null,
          2
        );
      }
      normalizeSessionEntry(entry) {
        const value = entry && typeof entry === "object" ? entry : {};
        return {
          id: typeof value.id === "string" ? value.id : crypto3.randomUUID(),
          summary: typeof value.summary === "string" ? value.summary : null,
          assistantReply: typeof value.assistantReply === "string" ? value.assistantReply : null,
          assistantThinking: typeof value.assistantThinking === "string" ? value.assistantThinking : null,
          assistantRefusal: typeof value.assistantRefusal === "string" ? value.assistantRefusal : null,
          toolCalls: Array.isArray(value.toolCalls) ? value.toolCalls : null,
          status: this.normalizeSessionStatus(value.status),
          failReason: typeof value.failReason === "string" ? value.failReason : null,
          usage: value.usage ?? null,
          usagePerModel: this.normalizeUsagePerModel(value),
          activeTokens: typeof value.activeTokens === "number" ? value.activeTokens : 0,
          createTime: typeof value.createTime === "string" ? value.createTime : (/* @__PURE__ */ new Date()).toISOString(),
          updateTime: typeof value.updateTime === "string" ? value.updateTime : (/* @__PURE__ */ new Date()).toISOString(),
          processes: this.deserializeProcesses(value.processes)
        };
      }
      normalizeSessionStatus(status) {
        if (status === "failed" || status === "pending" || status === "processing" || status === "waiting_for_user" || status === "completed" || status === "interrupted") {
          return status;
        }
        return "pending";
      }
      normalizeUsagePerModel(entry) {
        if (!Object.prototype.hasOwnProperty.call(entry, "usagePerModel")) {
          return null;
        }
        if (!isUsageRecord(entry.usagePerModel)) {
          return null;
        }
        const usagePerModel = {};
        for (const [model, usage] of Object.entries(entry.usagePerModel)) {
          if (!model || !isUsageRecord(usage)) {
            continue;
          }
          usagePerModel[model] = usage;
        }
        return usagePerModel;
      }
      deserializeProcesses(value) {
        if (!value || typeof value !== "object") {
          return null;
        }
        const processes = /* @__PURE__ */ new Map();
        for (const [pid, entry] of Object.entries(value)) {
          if (!pid) {
            continue;
          }
          if (typeof entry === "string") {
            processes.set(pid, { startTime: entry, command: "Running process..." });
          } else if (typeof entry === "object" && entry !== null) {
            const obj = entry;
            const startTime = typeof obj.startTime === "string" ? obj.startTime : (/* @__PURE__ */ new Date()).toISOString();
            const command = typeof obj.command === "string" ? obj.command : "Running process...";
            processes.set(pid, {
              startTime,
              command,
              timeoutMs: typeof obj.timeoutMs === "number" ? obj.timeoutMs : void 0,
              deadlineAt: typeof obj.deadlineAt === "string" ? obj.deadlineAt : void 0,
              timedOut: typeof obj.timedOut === "boolean" ? obj.timedOut : void 0
            });
          }
        }
        return processes.size > 0 ? processes : null;
      }
      serializeProcesses(processes) {
        if (!processes || processes.size === 0) {
          return null;
        }
        const serialized = {};
        for (const [pid, entry] of processes.entries()) {
          serialized[pid] = entry;
        }
        return serialized;
      }
    };
  }
});

// src/settings.ts
function resolveReasoningEffort(value) {
  return value === "high" || value === "max" ? value : void 0;
}
function parseBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return void 0;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "enabled", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "disabled", "no", "off"].includes(normalized)) {
    return false;
  }
  return void 0;
}
function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}
function normalizeEnv(env) {
  const result = {};
  if (!env) {
    return result;
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}
function collectPrefixedEnv(processEnv, prefix) {
  const result = {};
  for (const [key, value] of Object.entries(processEnv)) {
    if (!key.startsWith(prefix) || typeof value !== "string") {
      continue;
    }
    const strippedKey = key.slice(prefix.length);
    if (strippedKey) {
      result[strippedKey] = value;
    }
  }
  return result;
}
function collectLiMaCodeEnv(processEnv = process.env) {
  return {
    ...collectPrefixedEnv(processEnv, LEGACY_DEEPCODE_ENV_PREFIX),
    ...collectPrefixedEnv(processEnv, LIMA_CODE_ENV_PREFIX)
  };
}
function extractMcpEnv(env) {
  const result = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("MCP_")) {
      continue;
    }
    const strippedKey = key.slice("MCP_".length);
    if (strippedKey) {
      result[strippedKey] = value;
    }
  }
  return result;
}
function mergeMcpServers(userSettings, projectSettings, userEnv, projectEnv, systemEnv) {
  const userServers = userSettings?.mcpServers ?? {};
  const projectServers = projectSettings?.mcpServers ?? {};
  const serverNames = /* @__PURE__ */ new Set([...Object.keys(userServers), ...Object.keys(projectServers)]);
  if (serverNames.size === 0) {
    return void 0;
  }
  const userMcpEnv = extractMcpEnv(userEnv);
  const projectMcpEnv = extractMcpEnv(projectEnv);
  const systemMcpEnv = extractMcpEnv(systemEnv);
  const merged = {};
  for (const name of serverNames) {
    const userConfig = userServers[name];
    const projectConfig = projectServers[name];
    const command = projectConfig?.command ?? userConfig?.command;
    if (!command) {
      continue;
    }
    const env = {
      ...userEnv,
      ...userConfig?.env ?? {},
      ...userMcpEnv,
      ...projectEnv,
      ...projectConfig?.env ?? {},
      ...projectMcpEnv,
      ...systemEnv,
      ...systemMcpEnv
    };
    const config = {
      command,
      args: projectConfig?.args ?? userConfig?.args
    };
    if (Object.keys(env).length > 0) {
      config.env = env;
    }
    merged[name] = config;
  }
  return Object.keys(merged).length > 0 ? merged : void 0;
}
function resolveSettingsSources(userSettings, projectSettings, defaults, processEnv = process.env) {
  const userEnv = normalizeEnv(userSettings?.env);
  const projectEnv = normalizeEnv(projectSettings?.env);
  const systemEnv = collectLiMaCodeEnv(processEnv);
  const env = {
    ...userEnv,
    ...projectEnv,
    ...systemEnv
  };
  const model = trimString(systemEnv.MODEL) || trimString(projectSettings?.model) || trimString(projectEnv.MODEL) || trimString(userSettings?.model) || trimString(userEnv.MODEL) || defaults.model;
  const configuredThinkingEnabled = parseBoolean(systemEnv.THINKING_ENABLED) ?? parseBoolean(projectSettings?.thinkingEnabled) ?? parseBoolean(projectEnv.THINKING_ENABLED) ?? parseBoolean(userSettings?.thinkingEnabled) ?? parseBoolean(userEnv.THINKING_ENABLED);
  const thinkingEnabled = supportsThinkingMode(model) ? configuredThinkingEnabled ?? defaultsToThinkingMode(model) : false;
  const reasoningEffort = resolveReasoningEffort(systemEnv.REASONING_EFFORT) ?? resolveReasoningEffort(projectSettings?.reasoningEffort) ?? resolveReasoningEffort(projectEnv.REASONING_EFFORT) ?? resolveReasoningEffort(userSettings?.reasoningEffort) ?? resolveReasoningEffort(userEnv.REASONING_EFFORT) ?? "max";
  const debugLogEnabled = parseBoolean(systemEnv.DEBUG_LOG_ENABLED) ?? parseBoolean(projectSettings?.debugLogEnabled) ?? parseBoolean(projectEnv.DEBUG_LOG_ENABLED) ?? parseBoolean(userSettings?.debugLogEnabled) ?? parseBoolean(userEnv.DEBUG_LOG_ENABLED) ?? false;
  const notify = trimString(systemEnv.NOTIFY) || trimString(projectSettings?.notify) || trimString(userSettings?.notify) || "";
  const webSearchTool = trimString(systemEnv.WEB_SEARCH_TOOL) || trimString(projectSettings?.webSearchTool) || trimString(userSettings?.webSearchTool) || "";
  return {
    env,
    apiKey: trimString(env.API_KEY) || void 0,
    baseURL: trimString(env.BASE_URL) || defaults.baseURL,
    model,
    thinkingEnabled,
    reasoningEffort,
    debugLogEnabled,
    notify: notify || void 0,
    webSearchTool: webSearchTool || void 0,
    mcpServers: mergeMcpServers(userSettings, projectSettings, userEnv, projectEnv, systemEnv)
  };
}
function modelConfigKey(config) {
  return config.thinkingEnabled ? `thinking:${config.reasoningEffort}` : "thinking:none";
}
function applyModelConfigSelection(settings, current, selected) {
  const changed = selected.model !== current.model || modelConfigKey(selected) !== modelConfigKey(current);
  const next = { ...settings ?? {} };
  if (!changed) {
    return { settings: next, changed: false };
  }
  if (selected.model !== current.model || Object.prototype.hasOwnProperty.call(next, "model")) {
    next.model = selected.model;
  } else {
    delete next.model;
  }
  next.thinkingEnabled = selected.thinkingEnabled;
  if (selected.thinkingEnabled) {
    next.reasoningEffort = selected.reasoningEffort;
  }
  return { settings: next, changed: true };
}
var LIMA_CODE_ENV_PREFIX, LEGACY_DEEPCODE_ENV_PREFIX;
var init_settings = __esm({
  "src/settings.ts"() {
    "use strict";
    init_model_capabilities();
    LIMA_CODE_ENV_PREFIX = "LIMA_CODE_";
    LEGACY_DEEPCODE_ENV_PREFIX = "DEEPCODE_";
  }
});

// src/ui/constants.ts
var ARGS_SEPARATOR;
var init_constants = __esm({
  "src/ui/constants.ts"() {
    "use strict";
    ARGS_SEPARATOR = " | ";
  }
});

// src/ui/promptBuffer.ts
function insertText(state, value) {
  if (!value) {
    return state;
  }
  const text = state.text.slice(0, state.cursor) + value + state.text.slice(state.cursor);
  return { text, cursor: state.cursor + value.length };
}
function backspace(state) {
  if (state.cursor === 0) {
    return state;
  }
  const text = state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor);
  return { text, cursor: state.cursor - 1 };
}
function deleteForward(state) {
  if (state.cursor >= state.text.length) {
    return state;
  }
  const text = state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1);
  return { text, cursor: state.cursor };
}
function moveLeft(state) {
  if (state.cursor === 0) {
    return state;
  }
  return { ...state, cursor: state.cursor - 1 };
}
function moveRight(state) {
  if (state.cursor >= state.text.length) {
    return state;
  }
  return { ...state, cursor: state.cursor + 1 };
}
function moveWordLeft(state) {
  let cursor = state.cursor;
  while (cursor > 0 && /\s/.test(state.text[cursor - 1] ?? "")) {
    cursor--;
  }
  while (cursor > 0 && !/\s/.test(state.text[cursor - 1] ?? "")) {
    cursor--;
  }
  return { ...state, cursor };
}
function moveWordRight(state) {
  let cursor = state.cursor;
  while (cursor < state.text.length && /\s/.test(state.text[cursor] ?? "")) {
    cursor++;
  }
  while (cursor < state.text.length && !/\s/.test(state.text[cursor] ?? "")) {
    cursor++;
  }
  return { ...state, cursor };
}
function moveUp(state) {
  const { line, column, lineStart } = locate(state);
  if (line === 0) {
    return { ...state, cursor: 0 };
  }
  const previousLineEnd = lineStart - 1;
  const previousLineStart = state.text.lastIndexOf("\n", previousLineEnd - 1) + 1;
  const previousLineLength = previousLineEnd - previousLineStart;
  const targetColumn = Math.min(column, previousLineLength);
  return { ...state, cursor: previousLineStart + targetColumn };
}
function moveDown(state) {
  const { column, lineEnd } = locate(state);
  if (lineEnd >= state.text.length) {
    return { ...state, cursor: state.text.length };
  }
  const nextLineStart = lineEnd + 1;
  const nextLineNewline = state.text.indexOf("\n", nextLineStart);
  const nextLineEnd = nextLineNewline === -1 ? state.text.length : nextLineNewline;
  const nextLineLength = nextLineEnd - nextLineStart;
  const targetColumn = Math.min(column, nextLineLength);
  return { ...state, cursor: nextLineStart + targetColumn };
}
function moveLineStart(state) {
  const { lineStart } = locate(state);
  return { ...state, cursor: lineStart };
}
function moveLineEnd(state) {
  const { lineEnd } = locate(state);
  return { ...state, cursor: lineEnd };
}
function killLine(state) {
  const { lineEnd } = locate(state);
  if (state.cursor >= lineEnd) {
    return state;
  }
  const text = state.text.slice(0, state.cursor) + state.text.slice(lineEnd);
  return { text, cursor: state.cursor };
}
function deleteWordBefore(state) {
  const end = state.cursor;
  let start = end;
  while (start > 0 && /\s/.test(state.text[start - 1] ?? "")) {
    start--;
  }
  while (start > 0 && !/\s/.test(state.text[start - 1] ?? "")) {
    start--;
  }
  if (start === end) {
    return state;
  }
  return {
    text: state.text.slice(0, start) + state.text.slice(end),
    cursor: start
  };
}
function deleteWordAfter(state) {
  const start = state.cursor;
  let end = start;
  while (end < state.text.length && /\s/.test(state.text[end] ?? "")) {
    end++;
  }
  while (end < state.text.length && !/\s/.test(state.text[end] ?? "")) {
    end++;
  }
  if (start === end) {
    return state;
  }
  return {
    text: state.text.slice(0, start) + state.text.slice(end),
    cursor: start
  };
}
function isEmpty(state) {
  return state.text.length === 0;
}
function getCurrentSlashToken(state) {
  const text = state.text;
  if (text.length === 0) {
    return null;
  }
  const beforeCursor = text.slice(0, state.cursor);
  const lastNewline = beforeCursor.lastIndexOf("\n");
  const lineStart = lastNewline + 1;
  const line = beforeCursor.slice(lineStart);
  if (!line.startsWith("/")) {
    return null;
  }
  if (/\s/.test(line)) {
    return null;
  }
  return line;
}
function findPasteMarkerBefore(state) {
  let match;
  PASTE_MARKER_REGEX.lastIndex = 0;
  while ((match = PASTE_MARKER_REGEX.exec(state.text)) !== null) {
    if (match.index + match[0].length === state.cursor) {
      return { start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}
function findPasteMarkerAt(state) {
  let match;
  PASTE_MARKER_REGEX.lastIndex = 0;
  while ((match = PASTE_MARKER_REGEX.exec(state.text)) !== null) {
    if (match.index === state.cursor) {
      return { start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}
function deletePasteMarkerBackward(state, validIds) {
  const marker = findPasteMarkerBefore(state);
  if (!marker) return null;
  PASTE_MARKER_REGEX.lastIndex = 0;
  const m = PASTE_MARKER_REGEX.exec(state.text.slice(marker.start, marker.end));
  if (!m || !validIds.has(Number.parseInt(m[1], 10))) return null;
  const text = state.text.slice(0, marker.start) + state.text.slice(marker.end);
  return { text, cursor: marker.start };
}
function deletePasteMarkerForward(state, validIds) {
  const marker = findPasteMarkerAt(state);
  if (!marker) return null;
  PASTE_MARKER_REGEX.lastIndex = 0;
  const m = PASTE_MARKER_REGEX.exec(state.text.slice(marker.start, marker.end));
  if (!m || !validIds.has(Number.parseInt(m[1], 10))) return null;
  const text = state.text.slice(0, marker.start) + state.text.slice(marker.end);
  return { text, cursor: marker.start };
}
function cleanPasteContent(text) {
  return text.replace(/\r\n|\r/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").replace(/\t/g, "    ");
}
function expandPasteMarkers(text, pastes) {
  if (pastes.size === 0) return text;
  let result = text;
  for (const [pasteId, pasteContent] of pastes) {
    const markerRegex = new RegExp(`\\[paste #${pasteId} (\\+?\\d+ lines|\\d+ chars)\\]`, "g");
    result = result.replace(markerRegex, () => cleanPasteContent(pasteContent));
  }
  return result;
}
function findPasteMarkerContaining(state) {
  let match;
  PASTE_MARKER_REGEX.lastIndex = 0;
  while ((match = PASTE_MARKER_REGEX.exec(state.text)) !== null) {
    if (match.index <= state.cursor && match.index + match[0].length >= state.cursor) {
      return {
        start: match.index,
        end: match.index + match[0].length,
        id: Number.parseInt(match[1], 10)
      };
    }
  }
  return null;
}
function hasActivePasteMarkers(text, validIds) {
  if (!text.includes("[paste #")) return false;
  PASTE_MARKER_REGEX.lastIndex = 0;
  let match;
  while ((match = PASTE_MARKER_REGEX.exec(text)) !== null) {
    if (validIds.has(Number.parseInt(match[1], 10))) {
      return true;
    }
  }
  return false;
}
function locate(state) {
  const before = state.text.slice(0, state.cursor);
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineNumber = before.split("\n").length - 1;
  const after = state.text.slice(state.cursor);
  const nextNewline = after.indexOf("\n");
  const lineEnd = nextNewline === -1 ? state.text.length : state.cursor + nextNewline;
  return {
    line: lineNumber,
    column: state.cursor - lineStart,
    lineStart,
    lineEnd
  };
}
var EMPTY_BUFFER, PASTE_MARKER_REGEX;
var init_promptBuffer = __esm({
  "src/ui/promptBuffer.ts"() {
    "use strict";
    EMPTY_BUFFER = { text: "", cursor: 0 };
    PASTE_MARKER_REGEX = /\[paste #(\d+) (\+?\d+ lines|\d+ chars)\]/g;
  }
});

// src/ui/promptUndoRedo.ts
function createPromptUndoRedoState() {
  return { undoStack: [], redoStack: [] };
}
function recordPromptEdit(history, current, next, maxUndoEntries = 1e3) {
  if (next.text === current.text || next.text === history.undoStack.at(-1)?.text) {
    return;
  }
  history.undoStack.push(current);
  if (history.undoStack.length > maxUndoEntries) {
    history.undoStack = history.undoStack.slice(-maxUndoEntries);
  }
  history.redoStack = [];
}
function undoPromptEdit(history, current) {
  const previous = history.undoStack.pop();
  if (!previous) {
    return null;
  }
  history.redoStack.push(current);
  return previous;
}
function redoPromptEdit(history, current) {
  const next = history.redoStack.pop();
  if (!next) {
    return null;
  }
  history.undoStack.push(current);
  return next;
}
function clearPromptUndoRedoState(history) {
  history.undoStack = [];
  history.redoStack = [];
}
var init_promptUndoRedo = __esm({
  "src/ui/promptUndoRedo.ts"() {
    "use strict";
  }
});

// src/ui/slashCommands.ts
function buildSlashCommands(skills) {
  const skillItems = skills.map((skill) => ({
    kind: "skill",
    name: skill.name,
    label: `/${skill.name}`,
    description: skill.description || "(no description)",
    skill
  }));
  return [...skillItems, ...BUILTIN_SLASH_COMMANDS];
}
function filterSlashCommands(items, token) {
  if (!token.startsWith("/")) {
    return [];
  }
  const query = token.slice(1).toLowerCase();
  if (!query) {
    return items;
  }
  return items.filter((item) => item.name.toLowerCase().includes(query));
}
function findExactSlashCommand(items, token) {
  if (!token.startsWith("/")) {
    return null;
  }
  const query = token.slice(1);
  const matches = items.filter((item) => item.name === query);
  return matches.find((item) => item.kind !== "skill") ?? matches[0] ?? null;
}
function formatSlashCommandDescription(description) {
  return (description || "(no description)").trim().replace(/\s+/g, " ");
}
function formatSlashCommandLabel(item) {
  return item.kind === "skill" && item.skill?.isLoaded ? `${item.label} \u2713` : item.label;
}
var BUILTIN_SLASH_COMMANDS;
var init_slashCommands = __esm({
  "src/ui/slashCommands.ts"() {
    "use strict";
    BUILTIN_SLASH_COMMANDS = [
      {
        kind: "skills",
        name: "skills",
        label: "/skills",
        description: "\u5217\u51FA\u53EF\u7528\u6280\u80FD"
      },
      {
        kind: "model",
        name: "model",
        label: "/model",
        description: "\u9009\u62E9\u6A21\u578B\u3001\u601D\u8003\u6A21\u5F0F\u548C\u63A8\u7406\u5F3A\u5EA6"
      },
      {
        kind: "new",
        name: "new",
        label: "/new",
        description: "\u5F00\u542F\u65B0\u5BF9\u8BDD"
      },
      {
        kind: "init",
        name: "init",
        label: "/init",
        description: "\u521D\u59CB\u5316 AGENTS.md \u9879\u76EE\u6307\u4EE4\u6587\u4EF6"
      },
      {
        kind: "resume",
        name: "resume",
        label: "/resume",
        description: "\u9009\u62E9\u5386\u53F2\u5BF9\u8BDD\u7EE7\u7EED"
      },
      {
        kind: "continue",
        name: "continue",
        label: "/continue",
        description: "\u7EE7\u7EED\u5F53\u524D\u5BF9\u8BDD\uFF0C\u6216\u9009\u62E9\u5386\u53F2\u5BF9\u8BDD\u6062\u590D"
      },
      {
        kind: "undo",
        name: "undo",
        label: "/undo",
        description: "\u56DE\u9000\u4EE3\u7801\u6216\u5BF9\u8BDD\u5230\u5386\u53F2\u8282\u70B9"
      },
      {
        kind: "mcp",
        name: "mcp",
        label: "/mcp",
        description: "\u67E5\u770B MCP \u670D\u52A1\u72B6\u6001\u548C\u53EF\u7528\u5DE5\u5177"
      },
      {
        kind: "lima",
        name: "lima",
        label: "/lima",
        description: "LiMa worker\uFF1A\u5148\u7528 /lima vibe \u67E5\u770B doctor \u2192 plan \u2192 test \u2192 review \u5DE5\u4F5C\u6D41"
      },
      {
        kind: "raw",
        name: "raw",
        label: "/raw",
        args: ["lite", "normal", "raw-scrollback"],
        description: "\u5207\u6362\u63A8\u7406\u5185\u5BB9\u663E\u793A\u6A21\u5F0F"
      },
      {
        kind: "exit",
        name: "exit",
        label: "/exit",
        description: "\u9000\u51FA LiMa Code"
      }
    ];
  }
});

// src/ui/fileMentions.ts
import * as fs12 from "fs";
import * as path12 from "path";
import ignore2 from "ignore";
function scanFileMentionItems(root, maxItems = DEFAULT_MAX_ITEMS) {
  const items = [];
  const seen = /* @__PURE__ */ new Set();
  const gitRoot = findGitRoot(root);
  const visitedDirectories = /* @__PURE__ */ new Set();
  function addItem(item) {
    if (items.length >= maxItems || seen.has(item.path)) {
      return;
    }
    seen.add(item.path);
    items.push(item);
  }
  function visit(directory, depth, matchers) {
    if (items.length >= maxItems || depth > DEFAULT_MAX_DEPTH) {
      return;
    }
    const currentMatchers = [...matchers, ...loadDirectoryIgnoreMatchers(directory, gitRoot)];
    let entries;
    try {
      entries = fs12.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (items.length >= maxItems) {
        return;
      }
      if (entry.name === "." || entry.name === ".." || entry.name === ".git") {
        continue;
      }
      const absolute = path12.join(directory, entry.name);
      const relative7 = toMentionPath(path12.relative(root, absolute));
      if (!relative7) {
        continue;
      }
      const entryType = getMentionEntryType(entry, absolute);
      if (!entryType) {
        continue;
      }
      if (matchesAnyIgnore(absolute, entryType === "directory", currentMatchers)) {
        continue;
      }
      if (entryType === "directory") {
        const realPath = safeRealpath(absolute);
        if (realPath) {
          if (visitedDirectories.has(realPath)) {
            continue;
          }
          visitedDirectories.add(realPath);
        }
        addItem({ path: `${relative7}/`, type: "directory" });
        visit(absolute, depth + 1, currentMatchers);
        continue;
      }
      if (entryType === "file") {
        addItem({ path: relative7, type: "file" });
      }
    }
  }
  const rootRealPath = safeRealpath(root);
  if (rootRealPath) {
    visitedDirectories.add(rootRealPath);
  }
  visit(root, 0, loadAncestorIgnoreMatchers(root, gitRoot));
  return items;
}
function getMentionEntryType(entry, absolute) {
  if (entry.isDirectory()) {
    return "directory";
  }
  if (entry.isFile()) {
    return "file";
  }
  if (!entry.isSymbolicLink()) {
    return null;
  }
  try {
    const stat = fs12.statSync(absolute);
    if (stat.isDirectory()) {
      return "directory";
    }
    if (stat.isFile()) {
      return "file";
    }
  } catch {
    return null;
  }
  return null;
}
function safeRealpath(absolute) {
  try {
    return fs12.realpathSync(absolute);
  } catch {
    return null;
  }
}
function loadDirectoryIgnoreMatchers(directory, gitRoot) {
  const matchers = [];
  if (gitRoot && isPathInsideOrEqual(directory, gitRoot)) {
    const gitignoreMatcher = loadIgnoreFileMatcher(directory, path12.join(directory, ".gitignore"));
    if (gitignoreMatcher) {
      matchers.push(gitignoreMatcher);
    }
    if (path12.resolve(directory) === path12.resolve(gitRoot)) {
      const gitExcludeMatcher = loadIgnoreFileMatcher(directory, path12.join(directory, ".git", "info", "exclude"));
      if (gitExcludeMatcher) {
        matchers.push(gitExcludeMatcher);
      }
    }
  }
  const ignoreMatcher = loadIgnoreFileMatcher(directory, path12.join(directory, ".ignore"));
  if (ignoreMatcher) {
    matchers.push(ignoreMatcher);
  }
  return matchers;
}
function loadAncestorIgnoreMatchers(root, gitRoot) {
  const resolvedRoot = path12.resolve(root);
  const ancestors = [];
  let current = path12.dirname(resolvedRoot);
  while (gitRoot && isPathInsideOrEqual(current, gitRoot)) {
    ancestors.push(current);
    if (path12.resolve(current) === path12.resolve(gitRoot)) {
      break;
    }
    current = path12.dirname(current);
  }
  return ancestors.reverse().flatMap((directory) => loadDirectoryIgnoreMatchers(directory, gitRoot));
}
function loadIgnoreFileMatcher(base, ignoreFilePath) {
  try {
    if (!fs12.existsSync(ignoreFilePath)) {
      return null;
    }
    const content = fs12.readFileSync(ignoreFilePath, "utf8");
    if (!content.trim()) {
      return null;
    }
    return { base, matcher: ignore2().add(content) };
  } catch {
    return null;
  }
}
function matchesAnyIgnore(absolute, isDir, matchers) {
  let ignored = false;
  for (const { base, matcher } of matchers) {
    const relative7 = toMentionPath(path12.relative(base, absolute));
    if (!relative7 || relative7.startsWith("../")) {
      continue;
    }
    const result = matcher.test(isDir ? `${relative7}/` : relative7);
    if (result.ignored) {
      ignored = true;
    }
    if (result.unignored) {
      ignored = false;
    }
  }
  return ignored;
}
function findGitRoot(start) {
  let current = path12.resolve(start);
  while (true) {
    if (fs12.existsSync(path12.join(current, ".git"))) {
      return current;
    }
    const parent = path12.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
function isPathInsideOrEqual(candidate, parent) {
  const relative7 = path12.relative(parent, candidate);
  return relative7 === "" || !relative7.startsWith("..") && !path12.isAbsolute(relative7);
}
function filterFileMentionItems(items, query, maxResults = 12) {
  const normalizedQuery = normalizeForSearch(query);
  const scored = items.map((item, index) => ({ item, index, score: scoreFileMention(item.path, normalizedQuery) })).filter((entry) => entry.score !== Number.POSITIVE_INFINITY).sort((a, b) => a.score - b.score || a.item.path.length - b.item.path.length || a.index - b.index);
  return scored.slice(0, maxResults).map((entry) => entry.item);
}
function getCurrentFileMentionToken(state) {
  const text = state.text;
  const cursor = clampCursorToBoundary(text, state.cursor);
  const quoted = getCurrentQuotedFileMentionToken(text, cursor);
  if (quoted) {
    return quoted;
  }
  return getCurrentBareFileMentionToken(text, cursor);
}
function replaceCurrentFileMentionToken(state, token, selectedPath) {
  const inserted = `${formatFileMentionPath(selectedPath)} `;
  const end = token.end < state.text.length && isWhitespace(state.text[token.end] ?? "") ? token.end + 1 : token.end;
  const text = `${state.text.slice(0, token.start)}${inserted}${state.text.slice(end)}`;
  return { text, cursor: token.start + inserted.length };
}
function formatFileMentionPath(filePath) {
  if (!/[\s"]/.test(filePath)) {
    return `@${filePath}`;
  }
  return `@"${filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function getCurrentBareFileMentionToken(text, cursor) {
  const beforeCursor = text.slice(0, cursor);
  const afterCursor = text.slice(cursor);
  const start = findTokenStart(beforeCursor);
  const end = cursor + findTokenEnd(afterCursor);
  const token = text.slice(start, end);
  if (!token.startsWith("@") || token.startsWith('@"')) {
    return null;
  }
  if (start > 0 && !isWhitespace(text[start - 1] ?? "")) {
    return null;
  }
  return { query: token.slice(1), start, end, quoted: false };
}
function getCurrentQuotedFileMentionToken(text, cursor) {
  for (let index = cursor; index >= 0; index--) {
    if (text[index] !== "@" || text[index + 1] !== '"') {
      continue;
    }
    if (index > 0 && !isWhitespace(text[index - 1] ?? "")) {
      continue;
    }
    const closeQuote = findClosingQuote(text, index + 2);
    if (closeQuote !== -1 && cursor > closeQuote) {
      continue;
    }
    const end = closeQuote === -1 ? cursor : closeQuote + 1;
    return {
      query: unescapeQuotedMentionQuery(
        text.slice(index + 2, Math.min(cursor, closeQuote === -1 ? cursor : closeQuote))
      ),
      start: index,
      end,
      quoted: true
    };
  }
  return null;
}
function findTokenStart(beforeCursor) {
  const whitespaceIndex = findLastWhitespaceIndex(beforeCursor);
  return whitespaceIndex === -1 ? 0 : whitespaceIndex + 1;
}
function findTokenEnd(afterCursor) {
  const whitespaceIndex = afterCursor.search(/\s/);
  return whitespaceIndex === -1 ? afterCursor.length : whitespaceIndex;
}
function findLastWhitespaceIndex(value) {
  for (let index = value.length - 1; index >= 0; index--) {
    if (isWhitespace(value[index] ?? "")) {
      return index;
    }
  }
  return -1;
}
function findClosingQuote(text, start) {
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      return index;
    }
  }
  return -1;
}
function unescapeQuotedMentionQuery(query) {
  return query.replace(/\\(["\\])/g, "$1");
}
function clampCursorToBoundary(text, cursor) {
  return Math.max(0, Math.min(cursor, text.length));
}
function scoreFileMention(itemPath, normalizedQuery) {
  if (!normalizedQuery) {
    return itemPath.endsWith("/") ? 5 : 10;
  }
  const normalizedPath = normalizeForSearch(itemPath);
  const normalizedBase = normalizeForSearch(path12.posix.basename(itemPath.replace(/\/$/, "")));
  if (normalizedPath === normalizedQuery) {
    return 0;
  }
  if (normalizedPath.startsWith(normalizedQuery)) {
    return 1;
  }
  if (normalizedBase.startsWith(normalizedQuery)) {
    return isQueryBoundary(normalizedBase[normalizedQuery.length] ?? "") ? 2 : 3;
  }
  const pathIndex = normalizedPath.indexOf(normalizedQuery);
  if (pathIndex !== -1) {
    return 20 + pathIndex;
  }
  const fuzzyScore = fuzzyMatchScore(normalizedPath, normalizedQuery);
  return fuzzyScore === null ? Number.POSITIVE_INFINITY : 100 + fuzzyScore;
}
function fuzzyMatchScore(value, query) {
  let valueIndex = 0;
  let score = 0;
  for (const char of query) {
    const nextIndex = value.indexOf(char, valueIndex);
    if (nextIndex === -1) {
      return null;
    }
    score += nextIndex - valueIndex;
    valueIndex = nextIndex + 1;
  }
  return score;
}
function normalizeForSearch(value) {
  return value.trim().toLocaleLowerCase();
}
function isQueryBoundary(value) {
  return value === "" || /[\s._/-]/.test(value);
}
function toMentionPath(value) {
  return value.split(path12.sep).join("/");
}
function isWhitespace(value) {
  return /\s/.test(value);
}
var DEFAULT_MAX_ITEMS, DEFAULT_MAX_DEPTH;
var init_fileMentions = __esm({
  "src/ui/fileMentions.ts"() {
    "use strict";
    DEFAULT_MAX_ITEMS = 2e3;
    DEFAULT_MAX_DEPTH = 8;
  }
});

// src/ui/clipboard.ts
import { spawnSync as spawnSync3 } from "child_process";
import * as fs13 from "fs";
import * as os8 from "os";
import * as path13 from "path";
function bufferToDataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}
function isImageFilePath(value) {
  return IMAGE_MIME_BY_EXT.has(path13.extname(value.trim()).toLowerCase());
}
function mimeTypeForPath(value) {
  return IMAGE_MIME_BY_EXT.get(path13.extname(value.trim()).toLowerCase()) ?? PNG_MIME;
}
function tryRun(command, args2) {
  try {
    const result = spawnSync3(command, args2, { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
    if (result.status !== 0 || !result.stdout || result.stdout.length === 0) {
      return null;
    }
    return result.stdout;
  } catch {
    return null;
  }
}
function tryRunStatus(command, args2) {
  try {
    const result = spawnSync3(command, args2, { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
    return result.status === 0;
  } catch {
    return false;
  }
}
function readImageFile(filePath) {
  try {
    if (!isImageFilePath(filePath)) {
      return null;
    }
    const buffer = fs13.readFileSync(filePath);
    if (buffer.length === 0) {
      return null;
    }
    const mimeType = mimeTypeForPath(filePath);
    return { dataUrl: bufferToDataUrl(buffer, mimeType), mimeType };
  } catch {
    return null;
  }
}
function readMacClipboardImage() {
  const pngpaste = tryRun("pngpaste", ["-"]);
  if (pngpaste && pngpaste.length > 0) {
    return { dataUrl: bufferToDataUrl(pngpaste, PNG_MIME), mimeType: PNG_MIME };
  }
  const tempDir = fs13.mkdtempSync(path13.join(os8.tmpdir(), "deepcode-clipboard-"));
  const screenshotPath = path13.join(tempDir, "clipboard.png");
  try {
    const saved = tryRunStatus("osascript", [
      "-e",
      "set png_data to (the clipboard as \xABclass PNGf\xBB)",
      "-e",
      `set fp to open for access POSIX file "${screenshotPath}" with write permission`,
      "-e",
      "write png_data to fp",
      "-e",
      "close access fp"
    ]);
    if (saved) {
      const image = readImageFile(screenshotPath);
      if (image) {
        return image;
      }
    }
    const fileUrl = tryRun("osascript", ["-e", "get POSIX path of (the clipboard as \xABclass furl\xBB)"]);
    const filePath = fileUrl?.toString("utf8").trim();
    if (filePath) {
      return readImageFile(filePath);
    }
    return null;
  } finally {
    try {
      fs13.rmSync(tempDir, { recursive: true, force: true });
    } catch {
    }
  }
}
function readClipboardImage() {
  if (process.platform === "darwin") {
    return readMacClipboardImage();
  }
  if (process.platform === "linux") {
    const xclip = tryRun("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]);
    if (xclip && xclip.length > 0) {
      return { dataUrl: bufferToDataUrl(xclip, PNG_MIME), mimeType: PNG_MIME };
    }
    const wlPaste = tryRun("wl-paste", ["--type", "image/png"]);
    if (wlPaste && wlPaste.length > 0) {
      return { dataUrl: bufferToDataUrl(wlPaste, PNG_MIME), mimeType: PNG_MIME };
    }
    return null;
  }
  if (process.platform === "win32") {
    const script = "Add-Type -AssemblyName System.Windows.Forms;$img = [System.Windows.Forms.Clipboard]::GetImage();if ($img) { $ms = New-Object System.IO.MemoryStream;$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);[Console]::OpenStandardOutput().Write($ms.ToArray(), 0, $ms.Length); }";
    const out = tryRun("powershell", ["-NoProfile", "-Command", script]);
    if (out && out.length > 0) {
      return { dataUrl: bufferToDataUrl(out, PNG_MIME), mimeType: PNG_MIME };
    }
    return null;
  }
  return null;
}
async function readClipboardImageAsync() {
  return new Promise((resolve13, reject) => {
    setImmediate(() => {
      try {
        const result = readClipboardImage();
        resolve13(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}
var PNG_MIME, IMAGE_MIME_BY_EXT;
var init_clipboard = __esm({
  "src/ui/clipboard.ts"() {
    "use strict";
    PNG_MIME = "image/png";
    IMAGE_MIME_BY_EXT = /* @__PURE__ */ new Map([
      [".png", "image/png"],
      [".jpg", "image/jpeg"],
      [".jpeg", "image/jpeg"],
      [".gif", "image/gif"],
      [".webp", "image/webp"]
    ]);
  }
});

// src/ui/prompt/useTerminalInput.ts
import { useEffect as useEffect2, useRef } from "react";
import { useStdin } from "ink";
function parseTerminalInput(data) {
  const raw = String(data);
  let input = raw;
  if (CTRL_MINUS_SEQUENCES.has(raw)) {
    input = "-";
    const key2 = {
      upArrow: false,
      downArrow: false,
      leftArrow: false,
      rightArrow: false,
      home: false,
      end: false,
      pageDown: false,
      pageUp: false,
      return: false,
      escape: false,
      ctrl: true,
      shift: false,
      tab: false,
      backspace: false,
      delete: false,
      meta: false,
      focusIn: false,
      focusOut: false,
      paste: false
    };
    return { input, key: key2 };
  }
  if (CTRL_SHIFT_MINUS_SEQUENCES.has(raw) || raw === "") {
    input = "-";
    const key2 = {
      upArrow: false,
      downArrow: false,
      leftArrow: false,
      rightArrow: false,
      home: false,
      end: false,
      pageDown: false,
      pageUp: false,
      return: false,
      escape: false,
      ctrl: true,
      shift: true,
      tab: false,
      backspace: false,
      delete: false,
      meta: false,
      focusIn: false,
      focusOut: false,
      paste: false
    };
    return { input, key: key2 };
  }
  const key = {
    upArrow: raw === "\x1B[A",
    downArrow: raw === "\x1B[B",
    leftArrow: raw === "\x1B[D" || CTRL_LEFT_SEQUENCES.has(raw) || META_LEFT_SEQUENCES.has(raw),
    rightArrow: raw === "\x1B[C" || CTRL_RIGHT_SEQUENCES.has(raw) || META_RIGHT_SEQUENCES.has(raw),
    home: HOME_SEQUENCES.has(raw),
    end: END_SEQUENCES.has(raw),
    pageDown: raw === "\x1B[6~",
    pageUp: raw === "\x1B[5~",
    return: raw === "\r" || SHIFT_RETURN_SEQUENCES.has(raw) || META_RETURN_SEQUENCES.has(raw),
    escape: raw === "\x1B",
    ctrl: CTRL_LEFT_SEQUENCES.has(raw) || CTRL_RIGHT_SEQUENCES.has(raw),
    shift: SHIFT_RETURN_SEQUENCES.has(raw),
    tab: raw === "	" || raw === "\x1B[Z",
    backspace: BACKSPACE_BYTES.has(raw),
    delete: FORWARD_DELETE_SEQUENCES.has(raw),
    meta: META_LEFT_SEQUENCES.has(raw) || META_RIGHT_SEQUENCES.has(raw) || META_RETURN_SEQUENCES.has(raw),
    focusIn: raw === TERMINAL_FOCUS_IN,
    focusOut: raw === TERMINAL_FOCUS_OUT,
    paste: false
  };
  if (input <= "" && !key.return) {
    input = String.fromCharCode(input.charCodeAt(0) + "a".charCodeAt(0) - 1);
    key.ctrl = true;
  }
  const isKnownEscapeSequence = key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.home || key.end || key.pageDown || key.pageUp || key.tab || key.delete || key.return || key.ctrl || key.meta || key.focusIn || key.focusOut;
  if (raw.startsWith("\x1B")) {
    input = raw.slice(1);
    key.meta = key.meta || !isKnownEscapeSequence;
  }
  const isLatinUppercase = input >= "A" && input <= "Z";
  const isCyrillicUppercase = input >= "\u0410" && input <= "\u042F";
  if (input.length === 1 && (isLatinUppercase || isCyrillicUppercase)) {
    key.shift = true;
  }
  if (key.tab && input === "[Z") {
    key.shift = true;
  }
  if (key.tab || key.backspace || key.delete) {
    input = "";
  }
  return { input, key };
}
function dispatchTerminalInput(data, inputHandler) {
  const raw = String(data);
  if (!raw.startsWith("\x1B") && raw.includes("\x7F") && raw.length > 1) {
    const parts = raw.split("\x7F");
    if (parts[0]) {
      const { input: input2, key: key2 } = parseTerminalInput(parts[0]);
      inputHandler(input2, key2);
    }
    for (let i = 1; i < parts.length; i++) {
      const bs = parseTerminalInput("\x7F");
      inputHandler(bs.input, bs.key);
      if (parts[i]) {
        const { input: input2, key: key2 } = parseTerminalInput(parts[i]);
        inputHandler(input2, key2);
      }
    }
    return;
  }
  const { input, key } = parseTerminalInput(data);
  inputHandler(input, key);
}
function useTerminalInput(inputHandler, options = {}) {
  const { stdin, setRawMode: rawSetRawMode } = useStdin();
  const isActive = options.isActive ?? true;
  const handlerRef = useRef(inputHandler);
  handlerRef.current = inputHandler;
  const pasteRef = useRef({ active: false, chunks: [] });
  useEffect2(() => {
    const setRawMode = process.stdin.isTTY ? rawSetRawMode : (_v) => {
    };
    if (!isActive) {
      pasteRef.current.active = false;
      pasteRef.current.chunks = [];
      return;
    }
    setRawMode(true);
    return () => {
      setRawMode(false);
    };
  }, [isActive, rawSetRawMode]);
  useEffect2(() => {
    if (!isActive) {
      return;
    }
    const handleData = (data) => {
      const raw = String(data);
      if (raw.includes(PASTE_START)) {
        pasteRef.current.active = true;
        pasteRef.current.chunks = [];
        const startIdx = raw.indexOf(PASTE_START);
        const afterStart = raw.slice(startIdx + PASTE_START.length);
        const endIdx = afterStart.indexOf(PASTE_END);
        if (endIdx !== -1) {
          const pasteContent = afterStart.slice(0, endIdx);
          pasteRef.current.active = false;
          const remaining = afterStart.slice(endIdx + PASTE_END_LENGTH);
          if (pasteContent.length > 0) {
            handlerRef.current(pasteContent, { ...EMPTY_KEY, paste: true });
          }
          if (remaining.length > 0) {
            dispatchTerminalInput(remaining, handlerRef.current);
          }
          return;
        }
        if (afterStart) {
          pasteRef.current.chunks.push(afterStart);
        }
        return;
      }
      if (pasteRef.current.active) {
        pasteRef.current.chunks.push(raw);
        if (raw.includes("201~")) {
          const combined = pasteRef.current.chunks.join("");
          const endIdx = combined.indexOf(PASTE_END);
          if (endIdx !== -1) {
            const pasteContent = combined.slice(0, endIdx);
            pasteRef.current.active = false;
            const remaining = combined.slice(endIdx + PASTE_END_LENGTH);
            pasteRef.current.chunks = [];
            if (pasteContent.length > 0) {
              handlerRef.current(pasteContent, { ...EMPTY_KEY, paste: true });
            }
            if (remaining.length > 0) {
              dispatchTerminalInput(remaining, handlerRef.current);
            }
            return;
          }
          return;
        }
        return;
      }
      dispatchTerminalInput(data, handlerRef.current);
    };
    stdin?.on("data", handleData);
    return () => {
      stdin?.off("data", handleData);
    };
  }, [isActive, stdin]);
}
var BACKSPACE_BYTES, FORWARD_DELETE_SEQUENCES, HOME_SEQUENCES, END_SEQUENCES, SHIFT_RETURN_SEQUENCES, META_RETURN_SEQUENCES, CTRL_LEFT_SEQUENCES, CTRL_RIGHT_SEQUENCES, META_LEFT_SEQUENCES, META_RIGHT_SEQUENCES, TERMINAL_FOCUS_IN, TERMINAL_FOCUS_OUT, PASTE_START, PASTE_END, PASTE_END_LENGTH, CTRL_MINUS_SEQUENCES, CTRL_SHIFT_MINUS_SEQUENCES, EMPTY_KEY;
var init_useTerminalInput = __esm({
  "src/ui/prompt/useTerminalInput.ts"() {
    "use strict";
    BACKSPACE_BYTES = /* @__PURE__ */ new Set(["\x7F", "\b"]);
    FORWARD_DELETE_SEQUENCES = /* @__PURE__ */ new Set(["\x1B[3~", "\x1B[P"]);
    HOME_SEQUENCES = /* @__PURE__ */ new Set(["\x1B[H", "\x1B[1~", "\x1B[7~", "\x1BOH"]);
    END_SEQUENCES = /* @__PURE__ */ new Set(["\x1B[F", "\x1B[4~", "\x1B[8~", "\x1BOF"]);
    SHIFT_RETURN_SEQUENCES = /* @__PURE__ */ new Set(["\x1B\r", "\x1B[13;2u", "\x1B[13;2~", "\x1B[27;2;13~"]);
    META_RETURN_SEQUENCES = /* @__PURE__ */ new Set(["\x1B[13;3u", "\x1B[13;4u"]);
    CTRL_LEFT_SEQUENCES = /* @__PURE__ */ new Set(["\x1B[1;5D", "\x1B[5D"]);
    CTRL_RIGHT_SEQUENCES = /* @__PURE__ */ new Set(["\x1B[1;5C", "\x1B[5C"]);
    META_LEFT_SEQUENCES = /* @__PURE__ */ new Set(["\x1B[1;3D", "\x1B[3D", "\x1Bb"]);
    META_RIGHT_SEQUENCES = /* @__PURE__ */ new Set(["\x1B[1;3C", "\x1B[3C", "\x1Bf"]);
    TERMINAL_FOCUS_IN = "\x1B[I";
    TERMINAL_FOCUS_OUT = "\x1B[O";
    PASTE_START = "\x1B[200~";
    PASTE_END = "\x1B[201~";
    PASTE_END_LENGTH = 6;
    CTRL_MINUS_SEQUENCES = /* @__PURE__ */ new Set(["\x1B[45;5u", "\x1B[27;5;45~"]);
    CTRL_SHIFT_MINUS_SEQUENCES = /* @__PURE__ */ new Set(["\x1B[45;6u", "\x1B[27;6;45~"]);
    EMPTY_KEY = {
      upArrow: false,
      downArrow: false,
      leftArrow: false,
      rightArrow: false,
      home: false,
      end: false,
      pageDown: false,
      pageUp: false,
      return: false,
      escape: false,
      ctrl: false,
      shift: false,
      tab: false,
      backspace: false,
      delete: false,
      meta: false,
      focusIn: false,
      focusOut: false,
      paste: false
    };
  }
});

// src/ui/prompt/cursor.ts
import { useLayoutEffect, useRef as useRef2 } from "react";
function showCursor() {
  return "\x1B[?25h";
}
function hideCursor() {
  return "\x1B[?25l";
}
function enableTerminalFocusReporting() {
  return "\x1B[?1004h";
}
function disableTerminalFocusReporting() {
  return "\x1B[?1004l";
}
function enableBracketedPaste() {
  return "\x1B[?2004h";
}
function disableBracketedPaste() {
  return "\x1B[?2004l";
}
function enableTerminalExtendedKeys() {
  return "\x1B[>4;1m";
}
function disableTerminalExtendedKeys() {
  return "\x1B[>4;0m";
}
function useHiddenTerminalCursor(stdout, isActive) {
  useLayoutEffect(() => {
    if (!isActive || !stdout?.isTTY) {
      return;
    }
    stdout.write(hideCursor());
    return () => {
      stdout.write(showCursor());
    };
  }, [isActive, stdout]);
}
function useTerminalFocusReporting(stdout, isActive) {
  useLayoutEffect(() => {
    if (!isActive || !stdout?.isTTY) {
      return;
    }
    stdout.write(enableTerminalFocusReporting());
    return () => {
      stdout.write(disableTerminalFocusReporting());
    };
  }, [isActive, stdout]);
}
function useTerminalExtendedKeys(stdout, isActive) {
  useLayoutEffect(() => {
    if (!isActive || !stdout?.isTTY) {
      return;
    }
    stdout.write(enableTerminalExtendedKeys());
    return () => {
      stdout.write(disableTerminalExtendedKeys());
    };
  }, [isActive, stdout]);
}
function useBracketedPaste(stdout, isActive) {
  useLayoutEffect(() => {
    if (!isActive || !stdout?.isTTY) {
      return;
    }
    stdout.write(enableBracketedPaste());
    return () => {
      stdout.write(disableBracketedPaste());
    };
  }, [isActive, stdout]);
}
var init_cursor = __esm({
  "src/ui/prompt/cursor.ts"() {
    "use strict";
  }
});

// src/ui/prompt/index.ts
var init_prompt2 = __esm({
  "src/ui/prompt/index.ts"() {
    "use strict";
    init_useTerminalInput();
    init_cursor();
  }
});

// src/ui/SlashCommandMenu.tsx
import React3 from "react";
import { Box as Box2, Text as Text2 } from "ink";
import { jsx as jsx3, jsxs as jsxs2 } from "react/jsx-runtime";
function isSkillSelected(skills, skill) {
  return skills.some((item) => item.name === skill.name);
}
var SlashCommandMenu, SlashCommandMenu_default;
var init_SlashCommandMenu = __esm({
  "src/ui/SlashCommandMenu.tsx"() {
    "use strict";
    init_slashCommands();
    init_constants();
    SlashCommandMenu = React3.memo(function SlashCommandMenu2({
      items,
      activeIndex,
      maxVisible = 6,
      width
    }) {
      const labelColumnWidth = React3.useMemo(() => {
        if (items.length === 0) {
          return 0;
        }
        const longestLabel = Math.max(
          ...items.map((s) => s.label.length + (s.args ? s.args?.join(ARGS_SEPARATOR)?.length + 4 : 0))
        );
        const contentWidth = longestLabel + 2;
        const maxAllowed = Math.max(10, width - 2 >> 1);
        return Math.min(contentWidth, maxAllowed);
      }, [items, width]);
      if (items.length === 0) {
        return null;
      }
      const visibleStart = Math.min(
        Math.max(0, activeIndex - Math.floor((maxVisible - 1) / 2)),
        Math.max(0, items.length - maxVisible)
      );
      const visibleItems = items.slice(visibleStart, visibleStart + maxVisible);
      return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", marginBottom: 1, width, children: [
        visibleStart > 0 ? /* @__PURE__ */ jsx3(Box2, { marginLeft: 2, children: /* @__PURE__ */ jsx3(Text2, { dimColor: true, children: "\u25B2" }) }) : null,
        visibleItems.map((item, idx) => {
          const actualIndex = visibleStart + idx;
          return /* @__PURE__ */ jsxs2(Box2, { gap: 2, flexDirection: "row", flexGrow: 1, children: [
            /* @__PURE__ */ jsxs2(Box2, { width: labelColumnWidth, flexShrink: 0, gap: 2, children: [
              /* @__PURE__ */ jsxs2(Text2, { color: actualIndex === activeIndex ? "#229ac3" : void 0, wrap: "truncate-end", children: [
                actualIndex === activeIndex ? "> " : "  ",
                /* @__PURE__ */ jsx3(Text2, { bold: true, children: formatSlashCommandLabel(item) })
              ] }),
              item.args ? /* @__PURE__ */ jsx3(Text2, { dimColor: true, children: item.args.join(ARGS_SEPARATOR) }) : null
            ] }),
            /* @__PURE__ */ jsx3(Box2, { flexGrow: 1, children: /* @__PURE__ */ jsx3(Text2, { color: actualIndex === activeIndex ? "#229ac3" : void 0, wrap: "truncate-end", dimColor: true, children: formatSlashCommandDescription(item.description) }) })
          ] }, item.label);
        }),
        /* @__PURE__ */ jsxs2(Box2, { marginLeft: 2, flexDirection: "column", children: [
          visibleStart + visibleItems.length < items.length ? /* @__PURE__ */ jsx3(Text2, { dimColor: true, children: "\u25BC" }) : null,
          /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
            "(",
            activeIndex + 1,
            "/",
            items.length,
            ") \u2191\u2193 to navigate \xB7 Enter to select"
          ] })
        ] })
      ] });
    });
    SlashCommandMenu_default = SlashCommandMenu;
  }
});

// src/ui/contexts/AppContext.tsx
import { createContext, useContext } from "react";
var AppContext, useAppContext;
var init_AppContext = __esm({
  "src/ui/contexts/AppContext.tsx"() {
    "use strict";
    AppContext = createContext(null);
    useAppContext = () => {
      const context = useContext(AppContext);
      if (!context) {
        return { version: "unknown" };
      }
      return context;
    };
  }
});

// src/ui/contexts/RawModeContext.tsx
import { createContext as createContext2, useCallback, useContext as useContext2, useRef as useRef3, useState as useState2 } from "react";
import { jsx as jsx4 } from "react/jsx-runtime";
function useRawModeContext() {
  const context = useContext2(RawModeContext);
  if (!context) {
    throw new Error("useRawModeContext must be used within a RawModeProvider");
  }
  return context;
}
var RAW_COMMAND_MODELS, RawModeContext, RawModeProvider;
var init_RawModeContext = __esm({
  "src/ui/contexts/RawModeContext.tsx"() {
    "use strict";
    RAW_COMMAND_MODELS = [
      {
        label: "Lite mode",
        key: "Lite mode" /* Lite */,
        description: "Collapse chain-of-thought reasoning."
      },
      {
        label: "Normal mode",
        key: "Normal mode" /* None */,
        description: "Show full chain-of-thought reasoning."
      },
      {
        label: "Raw scrollback mode",
        key: "Raw scrollback mode" /* Raw */,
        description: "Show scrollback mode for copy-friendly terminal selection."
      }
    ];
    RawModeContext = createContext2({
      mode: "Lite mode" /* Lite */,
      setMode: () => {
      },
      previousMode: "Lite mode" /* Lite */
    });
    RawModeProvider = ({ children }) => {
      const [mode, _setMode] = useState2("Lite mode" /* Lite */);
      const previousModeRef = useRef3("Lite mode" /* Lite */);
      const setMode = useCallback((next) => {
        _setMode((current) => {
          const resolved = typeof next === "function" ? next(current) : next;
          if (resolved !== current) {
            previousModeRef.current = current;
          }
          return resolved;
        });
      }, []);
      return /* @__PURE__ */ jsx4(RawModeContext.Provider, { value: { mode, setMode, previousMode: previousModeRef.current }, children });
    };
  }
});

// src/ui/contexts/index.ts
var init_contexts = __esm({
  "src/ui/contexts/index.ts"() {
    "use strict";
    init_AppContext();
    init_RawModeContext();
  }
});

// src/ui/components/RawModelDropdown/index.tsx
import { useState as useState3 } from "react";
import { useInput as useInput2 } from "ink";
import { jsx as jsx5 } from "react/jsx-runtime";
var RawModelDropdown, RawModelDropdown_default;
var init_RawModelDropdown = __esm({
  "src/ui/components/RawModelDropdown/index.tsx"() {
    "use strict";
    init_DropdownMenu();
    init_contexts();
    RawModelDropdown = ({ open = false, screenWidth, onSelect, onClose }) => {
      const { mode, setMode } = useRawModeContext();
      const [index, setIndex] = useState3(0);
      useInput2(
        (input, key) => {
          if (key.upArrow) {
            setIndex((i) => Math.max(0, i - 1));
            return;
          }
          if (key.downArrow) {
            setIndex((i) => Math.min(RAW_COMMAND_MODELS.length - 1, i + 1));
            return;
          }
          if (input === " " && !key.ctrl && !key.meta || key.return && !key.shift && !key.meta) {
            setMode(RAW_COMMAND_MODELS[index].key);
            onClose?.(false);
            onSelect?.(RAW_COMMAND_MODELS[index].key);
            return;
          }
          if (key.escape) {
            onClose?.(false);
            return;
          }
        },
        { isActive: open }
      );
      if (!open) {
        return null;
      }
      return /* @__PURE__ */ jsx5(
        DropdownMenu_default,
        {
          title: "Select mode",
          items: RAW_COMMAND_MODELS.map((model) => ({ ...model, selected: model.key === mode })),
          helpText: "Space/Enter \u9009\u62E9\u6A21\u5F0F \xB7 Esc \u5173\u95ED",
          activeColor: "#229ac3",
          maxVisible: 6,
          activeIndex: index,
          width: screenWidth
        }
      );
    };
    RawModelDropdown_default = RawModelDropdown;
  }
});

// src/ui/components/MessageView/markdown.ts
import chalk from "chalk";
function renderMarkdown(text) {
  if (!text) {
    return "";
  }
  const fenceSegments = splitByFences(text);
  return fenceSegments.map((segment) => {
    if (segment.kind === "code") {
      const langTag = segment.lang ? chalk.dim(`[${segment.lang}]`) + "\n" : "";
      return langTag + chalk.cyan(segment.body);
    }
    return renderInlineBlock(segment.body);
  }).join("");
}
function splitByFences(text) {
  const segments = [];
  const lines = text.split(/\r?\n/);
  let buffer = [];
  let inFence = false;
  let fenceLang = "";
  let fenceBody = [];
  const flushText = () => {
    if (buffer.length === 0) {
      return;
    }
    segments.push({ kind: "text", body: buffer.join("\n") });
    buffer = [];
  };
  for (const line of lines) {
    const fenceMatch = /^\s*```(\w*)\s*$/.exec(line);
    if (fenceMatch) {
      if (!inFence) {
        flushText();
        inFence = true;
        fenceLang = fenceMatch[1] ?? "";
        fenceBody = [];
      } else {
        segments.push({ kind: "code", lang: fenceLang, body: fenceBody.join("\n") });
        inFence = false;
        fenceLang = "";
        fenceBody = [];
      }
      continue;
    }
    if (inFence) {
      fenceBody.push(line);
    } else {
      buffer.push(line);
    }
  }
  if (inFence) {
    segments.push({ kind: "code", lang: fenceLang, body: fenceBody.join("\n") });
  } else {
    flushText();
  }
  return segments;
}
function renderInlineBlock(text) {
  return text.split("\n").map((line) => renderInlineLine(line)).join("\n");
}
function renderInlineLine(line) {
  const headingMatch = /^(\s*)(#{1,6})\s+(.*)$/.exec(line);
  if (headingMatch) {
    const [, lead, hashes, content] = headingMatch;
    const styled = hashes.length <= 2 ? chalk.bold.cyanBright(content) : chalk.bold.cyan(content);
    return `${lead}${chalk.dim(hashes)} ${styled}`;
  }
  const listMatch = /^(\s*)([-*+])\s+(.*)$/.exec(line);
  if (listMatch) {
    const [, lead, bullet, content] = listMatch;
    return `${lead}${chalk.yellow(bullet)} ${renderInlineSpans(content)}`;
  }
  const numListMatch = /^(\s*)(\d+\.)\s+(.*)$/.exec(line);
  if (numListMatch) {
    const [, lead, marker, content] = numListMatch;
    return `${lead}${chalk.yellow(marker)} ${renderInlineSpans(content)}`;
  }
  const quoteMatch = /^(\s*)>\s?(.*)$/.exec(line);
  if (quoteMatch) {
    const [, lead, content] = quoteMatch;
    return `${lead}${chalk.dim("\u2502 ")}${chalk.italic(renderInlineSpans(content))}`;
  }
  return renderInlineSpans(line);
}
function renderInlineSpans(text) {
  if (!text) {
    return text;
  }
  let result = text;
  result = result.replace(/`([^`]+)`/g, (_, inner) => chalk.cyan(inner));
  result = result.replace(/\*\*([^*]+)\*\*/g, (_, inner) => chalk.bold(inner));
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, inner) => chalk.italic(inner));
  result = result.replace(/_([^_\n]+)_/g, (_, inner) => chalk.italic(inner));
  return result;
}
var init_markdown = __esm({
  "src/ui/components/MessageView/markdown.ts"() {
    "use strict";
  }
});

// src/ui/components/MessageView/utils.ts
import chalk2 from "chalk";
function isPlainRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function formatStatusName(value) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "Tool";
}
function truncate(value, max) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}\u2026`;
}
function firstNonEmptyLine(value) {
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/\s+/g, " ");
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}
function buildThinkingSummary(content, messageParams, mode) {
  if (content) {
    const normalized = content.replace(/\r?\n/g, " ").replace(/\s+/g, " ");
    let result = truncate(normalized, 100);
    if (result.endsWith(":") || result.endsWith("\uFF1A")) {
      result = result.slice(0, -1);
    }
    return result;
  }
  const params = messageParams;
  if (typeof params?.reasoning_content === "string" && params.reasoning_content.trim()) {
    return mode !== "Lite mode" /* Lite */ ? params?.reasoning_content || "" : "(reasoning...)";
  }
  return "";
}
function formatToolStatusParams(summary) {
  const params = firstNonEmptyLine(summary.params);
  return summary.name.toLowerCase() === "bash" ? params : truncate(params, 120);
}
function buildToolSummary(message) {
  const payload = parseToolPayload(message.content);
  const metaFunctionName = message.meta?.function && typeof message.meta.function.name === "string" ? message.meta.function.name : null;
  const name = payload.name || metaFunctionName || "tool";
  const params = name === "AskUserQuestion" ? extractAskUserQuestionParams(message) || getMetaParams(message) : getMetaParams(message);
  return {
    name,
    params,
    ok: payload.ok !== false,
    metadata: payload.metadata
  };
}
function getMetaParams(message) {
  return typeof message.meta?.paramsMd === "string" ? message.meta.paramsMd.trim() : "";
}
function extractAskUserQuestionParams(message) {
  const fromFunction = extractQuestionsFromToolFunction(message.meta?.function);
  if (fromFunction) {
    return fromFunction;
  }
  const params = getMetaParams(message);
  if (!params) {
    return "";
  }
  try {
    const parsed = JSON.parse(params);
    return extractQuestionsFromValue(parsed);
  } catch {
    return "";
  }
}
function extractQuestionsFromToolFunction(toolFunction) {
  if (!toolFunction || typeof toolFunction !== "object") {
    return "";
  }
  const args2 = toolFunction.arguments;
  if (typeof args2 !== "string" || !args2.trim()) {
    return "";
  }
  try {
    const parsed = JSON.parse(args2);
    return extractQuestionsFromValue(parsed?.questions);
  } catch {
    return "";
  }
}
function extractQuestionsFromValue(value) {
  if (!Array.isArray(value)) {
    return "";
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return "";
    }
    return typeof item.question === "string" ? item.question.trim() : "";
  }).filter(Boolean).join(" / ");
}
function parseToolPayload(content) {
  if (!content) {
    return { name: null, ok: true, metadata: null };
  }
  try {
    const parsed = JSON.parse(content);
    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : null,
      ok: parsed.ok !== false,
      metadata: isPlainRecord(parsed.metadata) ? parsed.metadata : null
    };
  } catch {
    return { name: null, ok: true, metadata: null };
  }
}
function getToolDiffPreviewLines(summary) {
  if (!summary.ok || !["edit", "write"].includes(summary.name.toLowerCase())) {
    return [];
  }
  const diffPreview = summary.metadata?.diff_preview;
  if (typeof diffPreview !== "string" || !diffPreview.trim()) {
    return [];
  }
  return parseDiffPreview(diffPreview);
}
function parseDiffPreview(diffPreview) {
  return diffPreview.split("\n").filter((line) => line && !line.startsWith("--- ") && !line.startsWith("+++ ") && !line.startsWith("@@ ")).map((line) => {
    if (line.startsWith("+")) {
      return { marker: "+", content: line.slice(1), kind: "added" };
    }
    if (line.startsWith("-")) {
      return { marker: "-", content: line.slice(1), kind: "removed" };
    }
    return {
      marker: " ",
      content: line.startsWith(" ") ? line.slice(1) : line,
      kind: "context"
    };
  });
}
function renderMessageToStdout(message, mode) {
  if (!message.visible) {
    return "";
  }
  if (message.role === "user") {
    const text = message.content || "(no content)";
    return chalk2(`> ${text}`);
  }
  if (message.role === "assistant") {
    const isThinking = Boolean(message.meta?.asThinking);
    const content = (message.content || "").trim();
    if (isThinking) {
      const summary = buildThinkingSummary(content, message.messageParams, mode);
      return `${chalk2("\u2727")} ${chalk2("\u601D\u8003")}${summary ? ` ${chalk2(summary)}` : ""}`;
    }
    return `${chalk2("\u2726")} ${content}`;
  }
  if (message.role === "tool") {
    const payload = parseToolPayload(message.content);
    const metaFunctionName = message.meta?.function && typeof message.meta.function.name === "string" ? message.meta.function.name : null;
    const name = payload.name || metaFunctionName || "tool";
    const metaParams = typeof message.meta?.paramsMd === "string" ? message.meta.paramsMd.trim() : "";
    const params = name.toLowerCase() === "bash" ? metaParams : truncate(metaParams, 120);
    const statusLine = `${chalk2("\u2727")} ${chalk2(formatStatusName(name))}${params ? ` ${chalk2(params)}` : ""}`;
    const metaResultMd = typeof message.meta?.resultMd === "string" ? message.meta.resultMd.trim() : "";
    const result = metaResultMd ? `
${chalk2.dim("  \u2514 Result")}
${metaResultMd}` : "";
    const summary = {
      name,
      params,
      ok: payload.ok !== false,
      metadata: payload.metadata
    };
    const planLines = getUpdatePlanPreviewLines(summary);
    if (planLines.length > 0) {
      const planText = planLines.map((line) => `  ${line}`).join("\n");
      return `${statusLine}
${chalk2.dim("  \u2514 Plan")}
${planText}${result}`;
    }
    return `${statusLine}${result}`;
  }
  if (message.role === "system") {
    if (message.meta?.isModelChange) {
      return chalk2(`> ${message.content}`);
    }
    if (message.meta?.skill && typeof message.meta.skill === "object") {
      const skillName = message.meta.skill.name;
      return chalk2(`\u26A1 \u5DF2\u52A0\u8F7D\u6280\u80FD: ${typeof skillName === "string" ? skillName : ""}`);
    }
    if (message.meta?.isSummary) {
      return chalk2.dim.italic("(\u5DF2\u63D2\u5165\u5BF9\u8BDD\u6458\u8981)");
    }
    return "";
  }
  return "";
}
function getUpdatePlanPreviewLines(summary) {
  if (!summary.ok || summary.name !== "UpdatePlan") {
    return [];
  }
  const plan = summary.metadata?.plan;
  if (typeof plan !== "string" || !plan.trim()) {
    return [];
  }
  return plan.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
}
var init_utils = __esm({
  "src/ui/components/MessageView/utils.ts"() {
    "use strict";
    init_contexts();
  }
});

// src/ui/components/MessageView/index.tsx
import { Box as Box3, Text as Text3 } from "ink";
import { jsx as jsx6, jsxs as jsxs3 } from "react/jsx-runtime";
function MessageView({ message, collapsed, width = 80 }) {
  const { mode } = useRawModeContext();
  if (!message.visible) {
    return null;
  }
  if (message.role === "user") {
    const text = message.content || "(no content)";
    return /* @__PURE__ */ jsxs3(Box3, { marginLeft: 1, marginBottom: 1, flexDirection: "row", marginY: 0, flexGrow: 1, gap: 1, children: [
      /* @__PURE__ */ jsx6(Box3, { children: /* @__PURE__ */ jsx6(Text3, { color: "#229ac3", children: `>` }) }),
      /* @__PURE__ */ jsxs3(Box3, { flexGrow: 1, children: [
        /* @__PURE__ */ jsx6(Text3, { color: "#229ac3", children: text }),
        Array.isArray(message.contentParams) && message.contentParams.length > 0 ? /* @__PURE__ */ jsx6(Text3, { color: "#229ac3", children: `  \u{1F4CE} ${message.contentParams.length} \u4E2A\u56FE\u7247\u9644\u4EF6` }) : null
      ] })
    ] });
  }
  if (message.role === "assistant") {
    const isThinking = Boolean(message.meta?.asThinking);
    const content = (message.content || "").trim();
    if (isThinking) {
      const summary = buildThinkingSummary(content, message.messageParams, mode);
      if (collapsed !== false) {
        return /* @__PURE__ */ jsx6(Box3, { marginLeft: 1, marginBottom: 1, marginY: 0, children: /* @__PURE__ */ jsx6(StatusLine, { width, bulletColor: "gray", name: "\u601D\u8003", params: summary }) });
      }
      return /* @__PURE__ */ jsxs3(Box3, { marginLeft: 1, flexDirection: "column", marginBottom: 1, marginY: 0, children: [
        /* @__PURE__ */ jsx6(StatusLine, { width, bulletColor: "gray", name: "\u601D\u8003", params: content ? "" : summary }),
        /* @__PURE__ */ jsx6(Box3, { flexDirection: "column", marginLeft: 2, children: content ? /* @__PURE__ */ jsx6(Text3, { dimColor: true, children: renderMarkdown(content) }) : null })
      ] });
    }
    const containerWidth = Math.max(1, width - 2);
    const contentWidth = Math.max(1, width - 4);
    return /* @__PURE__ */ jsxs3(Box3, { marginLeft: 1, marginBottom: 1, width: containerWidth, gap: 1, marginY: 0, flexDirection: "row", children: [
      /* @__PURE__ */ jsx6(Box3, { alignSelf: "stretch", children: /* @__PURE__ */ jsx6(Text3, { color: "#229ac3", children: "\u2726" }) }),
      /* @__PURE__ */ jsx6(Box3, { flexGrow: 1, width: contentWidth, children: content ? /* @__PURE__ */ jsx6(Text3, { wrap: "wrap", children: renderMarkdown(content) }) : null })
    ] });
  }
  if (message.role === "tool") {
    const summary = buildToolSummary(message);
    const diffLines = getToolDiffPreviewLines(summary);
    const planLines = getUpdatePlanPreviewLines(summary);
    return /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", marginLeft: 1, marginBottom: 1, marginY: 0, children: [
      /* @__PURE__ */ jsx6(
        StatusLine,
        {
          width,
          bulletColor: summary.ok ? "green" : "red",
          name: formatStatusName(summary.name),
          params: formatToolStatusParams(summary)
        }
      ),
      diffLines.length > 0 ? /* @__PURE__ */ jsx6(DiffPreview, { lines: diffLines }) : null,
      planLines.length > 0 ? /* @__PURE__ */ jsx6(PlanPreview, { lines: planLines }) : null
    ] });
  }
  if (message.role === "system") {
    if (message.meta?.isModelChange) {
      return /* @__PURE__ */ jsxs3(Box3, { marginY: 0, marginLeft: 1, marginBottom: 1, flexGrow: 1, flexDirection: "row", gap: 1, children: [
        /* @__PURE__ */ jsx6(Box3, { children: /* @__PURE__ */ jsx6(Text3, { color: "#229ac3", children: `>` }) }),
        /* @__PURE__ */ jsx6(Box3, { flexGrow: 1, flexDirection: "column", children: /* @__PURE__ */ jsx6(Text3, { color: "#229ac3", children: message.content }) })
      ] });
    }
    if (message.meta?.skill) {
      return /* @__PURE__ */ jsx6(Box3, { marginY: 0, marginLeft: 1, marginBottom: 1, children: /* @__PURE__ */ jsxs3(Text3, { color: "magenta", children: [
        "\u26A1 \u5DF2\u52A0\u8F7D\u6280\u80FD: ",
        message.meta.skill.name
      ] }) });
    }
    if (message.meta?.isSummary) {
      return /* @__PURE__ */ jsx6(Box3, { marginY: 0, marginLeft: 1, marginBottom: 1, children: /* @__PURE__ */ jsx6(Text3, { dimColor: true, italic: true, children: "(\u5DF2\u63D2\u5165\u5BF9\u8BDD\u6458\u8981)" }) });
    }
    return null;
  }
  return null;
}
function StatusLine({
  bulletColor,
  name,
  params,
  width
}) {
  const { mode } = useRawModeContext();
  const containerWidth = Math.max(1, width - 2);
  const contentWidth = Math.max(1, width - 4);
  return /* @__PURE__ */ jsxs3(Box3, { gap: 1, width: containerWidth, children: [
    /* @__PURE__ */ jsx6(Box3, { alignSelf: "stretch", children: /* @__PURE__ */ jsx6(Text3, { color: bulletColor, children: "\u2727" }, "bullet") }),
    /* @__PURE__ */ jsx6(Box3, { flexGrow: 1, width: contentWidth, gap: 1, children: /* @__PURE__ */ jsxs3(Text3, { wrap: mode === "Lite mode" /* Lite */ ? "truncate-end" : "wrap", children: [
      /* @__PURE__ */ jsx6(Text3, { bold: true, children: name }, "name"),
      params ? /* @__PURE__ */ jsx6(Text3, { color: "white", children: ` ${params}` }, "params") : null
    ] }) })
  ] });
}
function DiffPreview({ lines }) {
  return /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", marginLeft: 2, children: [
    /* @__PURE__ */ jsx6(Text3, { dimColor: true, children: "\u2514 Changes" }),
    /* @__PURE__ */ jsx6(Box3, { flexDirection: "column", marginLeft: 2, children: lines.map((line, index) => /* @__PURE__ */ jsxs3(Text3, { wrap: "truncate-end", children: [
      /* @__PURE__ */ jsx6(Text3, { color: line.kind === "added" ? "green" : line.kind === "removed" ? "red" : "gray", children: line.marker }),
      /* @__PURE__ */ jsx6(Text3, { color: line.kind === "added" ? "green" : line.kind === "removed" ? "red" : void 0, children: line.content })
    ] }, `${index}-${line.marker}-${line.content}`)) })
  ] });
}
function PlanPreview({ lines }) {
  return /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", marginLeft: 2, children: [
    /* @__PURE__ */ jsx6(Text3, { dimColor: true, children: "\u2514 Plan" }),
    /* @__PURE__ */ jsx6(Box3, { flexDirection: "column", marginLeft: 2, children: lines.map((line, index) => /* @__PURE__ */ jsx6(Text3, { wrap: "wrap", children: line }, `${index}-${line}`)) })
  ] });
}
var init_MessageView = __esm({
  "src/ui/components/MessageView/index.tsx"() {
    "use strict";
    init_markdown();
    init_utils();
    init_contexts();
  }
});

// src/ui/components/RawModeExitPrompt/index.tsx
import { useRef as useRef4 } from "react";
import { useInput as useInput3 } from "ink";
function RawModeExitPrompt({ onExit }) {
  const { previousMode } = useRawModeContext();
  const snapshotRef = useRef4(previousMode);
  useInput3(
    (_input, key) => {
      if (key.escape) {
        onExit(snapshotRef.current);
      }
    },
    { isActive: true }
  );
  return null;
}
var init_RawModeExitPrompt = __esm({
  "src/ui/components/RawModeExitPrompt/index.tsx"() {
    "use strict";
    init_contexts();
  }
});

// src/ui/components/SkillsDropdown/index.tsx
import { useEffect as useEffect3, useState as useState4 } from "react";
import { useInput as useInput4 } from "ink";
import { jsx as jsx7 } from "react/jsx-runtime";
var SkillsDropdown, SkillsDropdown_default;
var init_SkillsDropdown = __esm({
  "src/ui/components/SkillsDropdown/index.tsx"() {
    "use strict";
    init_DropdownMenu();
    init_SlashCommandMenu();
    SkillsDropdown = ({ open, width, skills, selectedSkills, onSelect, onClose }) => {
      const [skillsDropdownIndex, setSkillsDropdownIndex] = useState4(0);
      useInput4(
        (input, key) => {
          if (key.upArrow) {
            setSkillsDropdownIndex((idx) => (idx - 1 + skills.length) % skills.length);
            return;
          }
          if (key.downArrow) {
            setSkillsDropdownIndex((idx) => (idx + 1) % skills.length);
            return;
          }
          if (input === " " && !key.ctrl && !key.meta || key.return && !key.shift && !key.meta) {
            const skill = skills[skillsDropdownIndex];
            if (skill) {
              onSelect?.(skill);
            }
            return;
          }
          if (key.tab) {
            onClose?.(false);
            return;
          }
          if (key.escape) {
            onClose?.(false);
          }
        },
        { isActive: open }
      );
      useEffect3(() => {
        if (skillsDropdownIndex >= skills.length) {
          setSkillsDropdownIndex(Math.max(0, skills.length - 1));
        }
      }, [skills.length, skillsDropdownIndex]);
      if (!open) {
        return null;
      }
      return /* @__PURE__ */ jsx7(
        DropdownMenu_default,
        {
          width,
          title: "Select Skills",
          helpText: "Space \u5207\u6362 \xB7 Enter \u5207\u6362 \xB7 Esc \u5173\u95ED",
          emptyText: "No skills found",
          items: skills.map((skill) => ({
            key: skill.path || skill.name,
            label: skill.name,
            description: skill.path,
            selected: isSkillSelected(selectedSkills, skill),
            statusIndicator: skill.isLoaded ? { symbol: "\u2713", color: "green" } : void 0
          })),
          activeIndex: skillsDropdownIndex,
          activeColor: "#229ac3",
          maxVisible: 6
        }
      );
    };
    SkillsDropdown_default = SkillsDropdown;
  }
});

// src/ui/components/FileMentionMenu/index.tsx
import { useEffect as useEffect4, useState as useState5 } from "react";
import { Box as Box4, Text as Text4 } from "ink";
import { useInput as useInput5 } from "ink";
import { jsx as jsx8, jsxs as jsxs4 } from "react/jsx-runtime";
var FileMentionMenu, FileMentionMenu_default;
var init_FileMentionMenu = __esm({
  "src/ui/components/FileMentionMenu/index.tsx"() {
    "use strict";
    init_DropdownMenu();
    FileMentionMenu = ({ open, width, token, items, onClose, onSelect }) => {
      const [activeIndex, setActiveIndex] = useState5(0);
      useEffect4(() => {
        if (open) {
          setActiveIndex(0);
        }
      }, [open]);
      useEffect4(() => {
        if (!open) {
          return;
        }
        if (items.length === 0) {
          setActiveIndex(0);
          return;
        }
        if (activeIndex >= items.length) {
          setActiveIndex(Math.max(0, items.length - 1));
        }
      }, [activeIndex, items.length, open]);
      useInput5(
        (input, key) => {
          if (!open) {
            return;
          }
          if (key.escape) {
            onClose();
            return;
          }
          if (key.upArrow) {
            if (items.length > 0) {
              setActiveIndex((idx) => (idx - 1 + items.length) % items.length);
            }
            return;
          }
          if (key.downArrow) {
            if (items.length > 0) {
              setActiveIndex((idx) => (idx + 1) % items.length);
            }
            return;
          }
          if (key.tab || key.return && !key.shift && !key.meta) {
            const selected = items[activeIndex];
            if (selected) {
              onSelect(selected);
              return;
            }
            if (key.tab) {
              onClose();
            }
            return;
          }
        },
        { isActive: open }
      );
      if (!open) {
        return null;
      }
      return /* @__PURE__ */ jsx8(
        DropdownMenu_default,
        {
          width,
          title: "Mention File",
          helpText: "Enter/Tab \u63D2\u5165 \xB7 Esc \u5173\u95ED",
          emptyText: token?.query ? "\u6CA1\u6709\u5339\u914D\u6587\u4EF6" : "\u5728 @ \u540E\u8F93\u5165\u4EE5\u641C\u7D22\u6587\u4EF6",
          items: items.map((item) => ({
            key: item.path,
            label: item.path,
            description: item.type === "directory" ? "directory" : "file"
          })),
          activeIndex,
          activeColor: "#229ac3",
          maxVisible: 8,
          renderItem: (item, isActive) => /* @__PURE__ */ jsxs4(Box4, { flexDirection: "row", paddingX: 1, gap: 1, children: [
            /* @__PURE__ */ jsx8(Text4, { color: isActive ? "#229ac3" : void 0, children: isActive ? "> " : "  " }),
            /* @__PURE__ */ jsx8(Box4, { flexGrow: 1, children: /* @__PURE__ */ jsx8(Text4, { color: isActive ? "#229ac3" : void 0, wrap: "truncate-end", bold: isActive, children: item.label }) }),
            item.description ? /* @__PURE__ */ jsx8(Box4, { width: 10, flexShrink: 0, children: /* @__PURE__ */ jsx8(Text4, { dimColor: true, children: item.description }) }) : null
          ] })
        }
      );
    };
    FileMentionMenu_default = FileMentionMenu;
  }
});

// src/ui/components/index.ts
var init_components = __esm({
  "src/ui/components/index.ts"() {
    "use strict";
    init_RawModelDropdown();
    init_MessageView();
    init_RawModeExitPrompt();
    init_SkillsDropdown();
    init_ModelsDropdown();
    init_FileMentionMenu();
  }
});

// src/ui/PromptInput.tsx
import React8, { useEffect as useEffect5, useMemo as useMemo2, useState as useState6 } from "react";
import { Box as Box5, Text as Text5, useApp, useStdout } from "ink";
import chalk3 from "chalk";
import { jsx as jsx9, jsxs as jsxs5 } from "react/jsx-runtime";
function buildPromptFooterText(input) {
  const processOrPasteHint = input.hasRunningProcess ? " \xB7 ctrl+o \u67E5\u770B\u8F93\u51FA" : input.hasCollapsedMarkers ? " \xB7 ctrl+o \u5C55\u5F00\u7C98\u8D34" : input.hasExpandedRegions ? " \xB7 ctrl+o \u6536\u8D77\u7C98\u8D34" : "";
  if (input.statusMessage) {
    return input.statusMessage;
  }
  if (input.busy) {
    return input.loadingText && input.loadingText.trim() ? `${input.loadingText}${processOrPasteHint}` : `esc \u4E2D\u65AD \xB7 ctrl+c \u53D6\u6D88\u8F93\u5165${processOrPasteHint}`;
  }
  return `enter \u53D1\u9001 \xB7 shift+enter \u6362\u884C \xB7 @ \u6587\u4EF6 \xB7 ctrl+v \u56FE\u7247 \xB7 / \u547D\u4EE4 \xB7 ctrl+d \u9000\u51FA${processOrPasteHint}`;
}
function formatImageAttachmentStatus(count) {
  if (count <= 0) {
    return "";
  }
  return `\u{1F4CE} ${count} image${count === 1 ? "" : "s"} attached`;
}
function formatSelectedSkillsStatus(skills) {
  const names = skills.map((skill) => skill.name).filter(Boolean);
  if (names.length === 0) {
    return "";
  }
  return `\u26A1 ${names.join(", ")}`;
}
function addUniqueSkill(skills, skill) {
  if (isSkillSelected(skills, skill)) {
    return skills;
  }
  return [...skills, skill];
}
function toggleSkillSelection(skills, skill) {
  return isSkillSelected(skills, skill) ? skills.filter((item) => item.name !== skill.name) : [...skills, skill];
}
function buildInitPromptSubmission(selectedSkills) {
  return {
    text: "/init",
    imageUrls: [],
    selectedSkills: selectedSkills.length > 0 ? selectedSkills : void 0
  };
}
function removeCurrentSlashToken(state) {
  let start = state.cursor;
  while (start > 0 && !/\s/.test(state.text[start - 1] ?? "")) {
    start -= 1;
  }
  const token = state.text.slice(start, state.cursor);
  if (!token.startsWith("/")) {
    return state;
  }
  const text = `${state.text.slice(0, start)}${state.text.slice(state.cursor)}`;
  return { text, cursor: start };
}
function isClearImageAttachmentsShortcut(input, key) {
  return key.ctrl && (input === "x" || input === "X");
}
function getPromptReturnKeyAction(key) {
  if (!key.return) {
    return null;
  }
  if (key.shift || key.meta) {
    return "newline";
  }
  return "submit";
}
function renderBufferWithCursor(state, isFocused, placeholder, validPastes) {
  const text = state.text || "";
  const cursor = Math.max(0, Math.min(state.cursor, text.length));
  const validIds = validPastes ?? /* @__PURE__ */ new Map();
  if (text.length === 0 && placeholder) {
    if (!isFocused) {
      return chalk3.dim(`  ${placeholder}`);
    }
    return renderCursorCell(" ") + chalk3.dim(` ${placeholder}`);
  }
  if (text.length === 0) {
    return isFocused ? renderCursorCell(" ") : "";
  }
  if (!isFocused) {
    return highlightPasteMarkersInText(text, validIds);
  }
  return renderFocusedText(text, cursor, validIds);
}
function highlightPasteMarkersInText(s, validIds) {
  if (!s.includes("[paste #")) return s;
  PASTE_MARKER_REGEX.lastIndex = 0;
  let result = "";
  let pos = 0;
  let match;
  while ((match = PASTE_MARKER_REGEX.exec(s)) !== null) {
    result += s.slice(pos, match.index);
    const id = Number.parseInt(match[1], 10);
    result += validIds.has(id) ? chalk3.yellow(match[0]) : match[0];
    pos = match.index + match[0].length;
  }
  result += s.slice(pos);
  return result.endsWith("\n") ? `${result} ` : result;
}
function renderFocusedText(text, cursor, validIds) {
  let result = "";
  let pos = 0;
  PASTE_MARKER_REGEX.lastIndex = 0;
  let match;
  while ((match = PASTE_MARKER_REGEX.exec(text)) !== null) {
    const markerStart = match.index;
    const markerEnd = match.index + match[0].length;
    const id = Number.parseInt(match[1], 10);
    const isReal = validIds.has(id);
    result += renderTextSegmentWithCursor(text, pos, markerStart, cursor, false);
    pos = markerStart;
    result += renderTextSegmentWithCursor(text, pos, markerEnd, cursor, isReal);
    pos = markerEnd;
  }
  result += renderTextSegmentWithCursor(text, pos, text.length, cursor, false);
  return result;
}
function renderTextSegmentWithCursor(text, start, end, cursor, highlighted) {
  if (start >= end) return "";
  const segText = text.slice(start, end);
  const cursorRel = cursor - start;
  if (cursorRel < 0 || cursorRel > segText.length) {
    return highlighted ? chalk3.yellow(segText) : segText;
  }
  if (cursorRel === segText.length) {
    return highlighted ? chalk3.yellow(segText) + renderCursorCell(" ") : segText + renderCursorCell(" ");
  }
  const at = segText[cursorRel];
  if (at === "\n") {
    const before2 = segText.slice(0, cursorRel);
    const after2 = segText.slice(cursorRel + 1);
    return before2 + renderCursorCell(" ") + "\n" + after2;
  }
  const before = segText.slice(0, cursorRel);
  const after = segText.slice(cursorRel + 1);
  if (highlighted) {
    return chalk3.yellow(before) + renderCursorCell(at) + chalk3.yellow(after);
  }
  return before + renderCursorCell(at) + after;
}
function renderCursorCell(value) {
  return `\x1B[7m${value}\x1B[27m`;
}
var SPINNER_FRAMES, PromptPrefixLine, PromptInput, IMAGE_ATTACHMENT_CLEAR_HINT;
var init_PromptInput = __esm({
  "src/ui/PromptInput.tsx"() {
    "use strict";
    init_constants();
    init_promptBuffer();
    init_promptUndoRedo();
    init_slashCommands();
    init_fileMentions();
    init_clipboard();
    init_prompt2();
    init_prompt2();
    init_prompt2();
    init_SlashCommandMenu();
    init_components();
    SPINNER_FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
    PromptPrefixLine = React8.memo(function PromptPrefixLine2({ busy }) {
      const [spinnerIndex, setSpinnerIndex] = useState6(0);
      useEffect5(() => {
        if (!busy) {
          setSpinnerIndex(0);
          return;
        }
        const timer = setInterval(() => {
          setSpinnerIndex((index) => (index + 1) % SPINNER_FRAMES.length);
        }, 80);
        return () => clearInterval(timer);
      }, [busy]);
      const prefix = busy ? `${SPINNER_FRAMES[spinnerIndex]} ` : "> ";
      return /* @__PURE__ */ jsx9(Text5, { color: busy ? "yellow" : "#229ac3", children: prefix });
    });
    PromptInput = React8.memo(function PromptInput2({
      projectRoot: projectRoot2,
      skills,
      modelConfig,
      screenWidth,
      promptHistory,
      busy,
      loadingText,
      disabled,
      placeholder,
      runningProcesses,
      promptDraft,
      onSubmit,
      onModelConfigChange,
      onInterrupt,
      onToggleProcessStdout,
      onRawModeChange
    }) {
      const { exit } = useApp();
      const { stdout } = useStdout();
      const [buffer, setBuffer] = useState6(EMPTY_BUFFER);
      const [imageUrls, setImageUrls] = useState6([]);
      const [selectedSkills, setSelectedSkills] = useState6([]);
      const [statusMessage, setStatusMessage] = useState6(null);
      const [pendingExit, setPendingExit] = useState6(false);
      const [menuIndex, setMenuIndex] = useState6(0);
      const [showSkillsDropdown, setShowSkillsDropdown] = useState6(false);
      const [openRawModelDropdown, setOpenRawModelDropdown] = useState6(false);
      const [showModelDropdown, setShowModelDropdown] = useState6(false);
      const [fileMentionItems, setFileMentionItems] = useState6(() => scanFileMentionItems(projectRoot2));
      const [dismissedFileMentionKey, setDismissedFileMentionKey] = useState6(null);
      const [historyCursor, setHistoryCursor] = useState6(-1);
      const [draftBeforeHistory, setDraftBeforeHistory] = useState6(null);
      const [hasTerminalFocus, setHasTerminalFocus] = useState6(true);
      const lastCtrlDAt = React8.useRef(0);
      const undoRedoRef = React8.useRef(createPromptUndoRedoState());
      const wasBusyRef = React8.useRef(busy);
      const hadFileMentionTokenRef = React8.useRef(false);
      const appliedDraftNonceRef = React8.useRef(null);
      const pastesRef = React8.useRef(/* @__PURE__ */ new Map());
      const pasteCounterRef = React8.useRef(0);
      const expandedRegionsRef = React8.useRef(
        /* @__PURE__ */ new Map()
      );
      const fileMentionToken = getCurrentFileMentionToken(buffer);
      const hasFileMentionToken = fileMentionToken !== null;
      const fileMentionKey = fileMentionToken ? `${fileMentionToken.start}:${fileMentionToken.query}` : null;
      const fileMentionMatches = React8.useMemo(
        () => fileMentionToken ? filterFileMentionItems(fileMentionItems, fileMentionToken.query) : [],
        [fileMentionItems, fileMentionToken]
      );
      const showFileMentionMenu = !showSkillsDropdown && !showModelDropdown && fileMentionToken !== null && fileMentionKey !== dismissedFileMentionKey;
      const slashItems = React8.useMemo(() => buildSlashCommands(skills), [skills]);
      const slashToken = getCurrentSlashToken(buffer);
      const slashMenu = React8.useMemo(
        () => showSkillsDropdown || showModelDropdown || showFileMentionMenu ? [] : slashToken ? filterSlashCommands(slashItems, slashToken) : [],
        [showSkillsDropdown, showModelDropdown, showFileMentionMenu, slashToken, slashItems]
      );
      const showMenu = slashMenu.length > 0;
      const promptHistoryKey = React8.useMemo(() => promptHistory.join("\0"), [promptHistory]);
      const hasRunningProcess = runningProcesses && runningProcesses.size > 0;
      const hasCollapsedMarkers = hasActivePasteMarkers(buffer.text, pastesRef.current);
      const hasExpandedRegions = expandedRegionsRef.current.size > 0;
      const footerText = buildPromptFooterText({
        statusMessage,
        busy,
        loadingText,
        hasRunningProcess: Boolean(hasRunningProcess),
        hasCollapsedMarkers,
        hasExpandedRegions
      });
      useTerminalFocusReporting(stdout, !disabled);
      useTerminalExtendedKeys(stdout, !disabled);
      useBracketedPaste(stdout, !disabled);
      useHiddenTerminalCursor(stdout, !disabled);
      const refreshFileMentionItems = React8.useCallback(() => {
        setFileMentionItems(scanFileMentionItems(projectRoot2));
      }, [projectRoot2]);
      useEffect5(() => {
        refreshFileMentionItems();
      }, [refreshFileMentionItems]);
      useEffect5(() => {
        if (wasBusyRef.current && !busy) {
          refreshFileMentionItems();
        }
        wasBusyRef.current = busy;
      }, [busy, refreshFileMentionItems]);
      useEffect5(() => {
        if (hasFileMentionToken && !hadFileMentionTokenRef.current) {
          refreshFileMentionItems();
        }
        hadFileMentionTokenRef.current = hasFileMentionToken;
      }, [hasFileMentionToken, refreshFileMentionItems]);
      useEffect5(() => {
        if (!showMenu) {
          setMenuIndex(0);
          return;
        }
        if (menuIndex >= slashMenu.length) {
          setMenuIndex(slashMenu.length - 1);
        }
      }, [slashMenu, showMenu, menuIndex]);
      useEffect5(() => {
        if (!fileMentionKey) {
          setDismissedFileMentionKey(null);
        }
      }, [fileMentionKey]);
      useEffect5(() => {
        if (!statusMessage) {
          return;
        }
        const timer = setTimeout(() => setStatusMessage(null), 2500);
        return () => clearTimeout(timer);
      }, [statusMessage]);
      useEffect5(() => {
        if (!promptDraft || appliedDraftNonceRef.current === promptDraft.nonce) {
          return;
        }
        appliedDraftNonceRef.current = promptDraft.nonce;
        setBuffer({ text: promptDraft.text, cursor: promptDraft.text.length });
        setImageUrls(promptDraft.imageUrls);
        setSelectedSkills([]);
        setShowSkillsDropdown(false);
        setOpenRawModelDropdown(false);
        setHistoryCursor(-1);
        setDraftBeforeHistory(null);
        clearPromptUndoRedoState(undoRedoRef.current);
        pastesRef.current.clear();
        expandedRegionsRef.current.clear();
      }, [promptDraft]);
      useEffect5(() => {
        setHistoryCursor(-1);
        setDraftBeforeHistory(null);
      }, [promptHistoryKey]);
      useTerminalInput(
        (input, key) => {
          if (key.focusIn) {
            setHasTerminalFocus(true);
            return;
          }
          if (key.focusOut) {
            setHasTerminalFocus(false);
            return;
          }
          if (disabled) {
            return;
          }
          if (key.escape) {
            if (showFileMentionMenu) {
              return;
            }
            if (busy) {
              onInterrupt();
              setStatusMessage("Interrupting\u2026");
            }
            return;
          }
          if (key.ctrl && (input === "o" || input === "O")) {
            if (runningProcesses && runningProcesses.size > 0 && onToggleProcessStdout) {
              onToggleProcessStdout();
            } else {
              expandPasteMarkerAtCursor();
            }
            return;
          }
          if (key.ctrl && (input === "d" || input === "D")) {
            if (!isEmpty(buffer)) {
              updateBuffer((s) => deleteForward(s));
              return;
            }
            const now = Date.now();
            if (pendingExit && now - lastCtrlDAt.current < 2e3) {
              exit();
              return;
            }
            lastCtrlDAt.current = now;
            setPendingExit(true);
            setStatusMessage("\u518D\u6B21\u6309 ctrl+d \u9000\u51FA");
            return;
          }
          if (key.ctrl && (input === "c" || input === "C")) {
            if (busy) {
              onInterrupt();
              setStatusMessage("Interrupting\u2026");
            } else if (!isEmpty(buffer)) {
              setBuffer(EMPTY_BUFFER);
              clearUndoRedoStacks();
              pastesRef.current.clear();
              expandedRegionsRef.current.clear();
            } else {
              setStatusMessage("\u6309 ctrl+d \u9000\u51FA");
            }
            return;
          }
          if (pendingExit && (!key.ctrl || input !== "d" && input !== "D")) {
            setPendingExit(false);
          }
          if (openRawModelDropdown || showSkillsDropdown || showModelDropdown) {
            return;
          }
          if (historyCursor !== -1 && !key.upArrow && !key.downArrow) {
            exitHistoryBrowsing();
          }
          if (key.paste) {
            handlePaste(input);
            return;
          }
          if (key.ctrl && (input === "v" || input === "V")) {
            setStatusMessage("Reading clipboard...");
            readClipboardImageAsync().then((image) => {
              if (image) {
                setImageUrls((prev) => [...prev, image.dataUrl]);
                setStatusMessage("Attached image from clipboard");
              } else {
                setStatusMessage("No image found in clipboard");
              }
            }).catch(() => {
              setStatusMessage("\u8BFB\u53D6\u526A\u8D34\u677F\u5931\u8D25");
            });
            return;
          }
          if (isClearImageAttachmentsShortcut(input, key)) {
            if (imageUrls.length > 0) {
              setImageUrls([]);
              setStatusMessage("Cleared attached images");
            } else {
              setStatusMessage("No attached images to clear");
            }
            return;
          }
          const noModifier = !key.shift && !key.ctrl && !key.meta;
          const returnAction = getPromptReturnKeyAction(key);
          const isPlainReturn = returnAction === "submit";
          if (showFileMentionMenu) {
            if (key.upArrow || key.downArrow || key.tab || returnAction === "submit") {
              return;
            }
          }
          if (showMenu) {
            if (key.upArrow) {
              setMenuIndex((idx) => (idx - 1 + slashMenu.length) % slashMenu.length);
              return;
            }
            if (key.downArrow) {
              setMenuIndex((idx) => (idx + 1) % slashMenu.length);
              return;
            }
            if (key.tab || returnAction === "submit") {
              const selected = slashMenu[menuIndex];
              if (selected) {
                handleSlashSelection(selected);
                return;
              }
            }
          }
          if (busy && isPlainReturn) {
            setStatusMessage("wait for the current response or press esc to interrupt");
            return;
          }
          if (returnAction === "newline") {
            updateBuffer((s) => insertText(s, "\n"));
            return;
          }
          if (returnAction === "submit") {
            submitCurrentBuffer();
            return;
          }
          if (key.delete) {
            updateBuffer((s) => deletePasteMarkerForward(s, pastesRef.current) ?? deleteForward(s));
            return;
          }
          if (key.backspace) {
            updateBuffer((s) => deletePasteMarkerBackward(s, pastesRef.current) ?? backspace(s));
            return;
          }
          if ((key.ctrl || key.meta) && key.leftArrow) {
            updateBuffer((s) => moveWordLeft(s));
            return;
          }
          if ((key.ctrl || key.meta) && key.rightArrow) {
            updateBuffer((s) => moveWordRight(s));
            return;
          }
          if (key.leftArrow) {
            updateBuffer((s) => moveLeft(s));
            return;
          }
          if (key.rightArrow) {
            updateBuffer((s) => moveRight(s));
            return;
          }
          if (key.home) {
            updateBuffer((s) => moveLineStart(s));
            return;
          }
          if (key.end) {
            updateBuffer((s) => moveLineEnd(s));
            return;
          }
          if (key.upArrow) {
            if (noModifier && (historyCursor !== -1 || buffer.cursor === 0) && promptHistory.length > 0) {
              navigateHistory(-1);
              return;
            }
            updateBuffer((s) => moveUp(s));
            return;
          }
          if (key.downArrow) {
            if (noModifier && (historyCursor !== -1 || buffer.cursor === buffer.text.length)) {
              navigateHistory(1);
              return;
            }
            updateBuffer((s) => moveDown(s));
            return;
          }
          if (key.ctrl && (input === "p" || input === "P")) {
            navigateHistory(-1);
            return;
          }
          if (key.ctrl && (input === "n" || input === "N")) {
            navigateHistory(1);
            return;
          }
          if (key.ctrl && (input === "a" || input === "A")) {
            updateBuffer((s) => moveLineStart(s));
            return;
          }
          if (key.ctrl && (input === "e" || input === "E")) {
            updateBuffer((s) => moveLineEnd(s));
            return;
          }
          if (key.ctrl && (input === "b" || input === "B")) {
            updateBuffer((s) => moveLeft(s));
            return;
          }
          if (key.ctrl && (input === "f" || input === "F")) {
            updateBuffer((s) => moveRight(s));
            return;
          }
          if (key.meta && (input === "b" || input === "B")) {
            updateBuffer((s) => moveWordLeft(s));
            return;
          }
          if (key.meta && (input === "f" || input === "F")) {
            updateBuffer((s) => moveWordRight(s));
            return;
          }
          if (key.ctrl && (input === "k" || input === "K")) {
            updateBuffer((s) => killLine(s));
            return;
          }
          if (key.ctrl && (input === "u" || input === "U")) {
            updateBuffer(() => EMPTY_BUFFER);
            pastesRef.current.clear();
            expandedRegionsRef.current.clear();
            return;
          }
          if (key.ctrl && (input === "w" || input === "W")) {
            updateBuffer((s) => deleteWordBefore(s));
            return;
          }
          if (key.meta && (input === "d" || input === "D")) {
            updateBuffer((s) => deleteWordAfter(s));
            return;
          }
          if (key.meta && (input === "\x7F" || input === "\b")) {
            updateBuffer((s) => deleteWordBefore(s));
            return;
          }
          if (key.ctrl && (input === "j" || input === "J")) {
            updateBuffer((s) => insertText(s, "\n"));
            return;
          }
          if (key.ctrl && key.shift && input === "-") {
            redo();
            return;
          }
          if (key.ctrl && input === "-") {
            undo();
            return;
          }
          if (input.startsWith("\x1B")) {
            return;
          }
          if (input && !key.ctrl && !key.meta) {
            const sanitized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
            updateBuffer((s) => insertText(s, sanitized));
          }
        },
        { isActive: !disabled }
      );
      function undo() {
        const previous = undoPromptEdit(undoRedoRef.current, buffer);
        if (!previous) {
          return;
        }
        exitHistoryBrowsing();
        setBuffer(previous);
      }
      function redo() {
        const next = redoPromptEdit(undoRedoRef.current, buffer);
        if (!next) {
          return;
        }
        exitHistoryBrowsing();
        setBuffer(next);
      }
      function clearUndoRedoStacks() {
        clearPromptUndoRedoState(undoRedoRef.current);
      }
      function exitHistoryBrowsing() {
        setHistoryCursor(-1);
        setDraftBeforeHistory(null);
      }
      function updateBuffer(updater) {
        exitHistoryBrowsing();
        setBuffer((current) => {
          const next = updater(current);
          recordPromptEdit(undoRedoRef.current, current, next);
          return next;
        });
      }
      function handlePaste(pastedText) {
        const totalChars = pastedText.length;
        if (totalChars <= 1e3) {
          const newlineCount = (pastedText.match(/\n/g) ?? []).length;
          if (newlineCount <= 9) {
            const clean = pastedText.replace(/\r\n|\r/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").replace(/\t/g, "    ");
            updateBuffer((s) => insertText(s, clean));
            return;
          }
        }
        const lineCount = (pastedText.match(/\n/g) ?? []).length + 1;
        pasteCounterRef.current += 1;
        const pasteId = pasteCounterRef.current;
        pastesRef.current.set(pasteId, pastedText);
        const marker = lineCount > 10 ? `[paste #${pasteId} +${lineCount} lines]` : `[paste #${pasteId} ${totalChars} chars]`;
        updateBuffer((s) => insertText(s, marker));
      }
      function expandPasteMarkerAtCursor() {
        for (const [id, region] of expandedRegionsRef.current) {
          if (buffer.cursor >= region.start && buffer.cursor <= region.end) {
            expandedRegionsRef.current.delete(id);
            pastesRef.current.set(id, region.content);
            setTimeout(() => {
              updateBuffer((s) => {
                const text = s.text.slice(0, region.start) + region.marker + s.text.slice(region.end);
                return { text, cursor: region.start + region.marker.length };
              });
            }, 0);
            return;
          }
        }
        const marker = findPasteMarkerContaining(buffer);
        if (!marker) {
          setStatusMessage("No paste marker at cursor");
          return;
        }
        const content = pastesRef.current.get(marker.id);
        if (!content) {
          setStatusMessage("Paste content not found");
          return;
        }
        const pasteId = marker.id;
        const originalMarker = buffer.text.slice(marker.start, marker.end);
        pastesRef.current.delete(pasteId);
        setTimeout(() => {
          updateBuffer((s) => {
            const text = s.text.slice(0, marker.start) + cleanPasteContent(content) + s.text.slice(marker.end);
            const newEnd = marker.start + content.length;
            expandedRegionsRef.current.set(pasteId, {
              start: marker.start,
              end: newEnd,
              content,
              marker: originalMarker
            });
            return { text, cursor: marker.start };
          });
        }, 0);
      }
      function navigateHistory(direction) {
        if (promptHistory.length === 0) {
          return;
        }
        const previousCursor = historyCursor === -1 ? promptHistory.length : historyCursor;
        const nextCursor = Math.max(0, Math.min(promptHistory.length, previousCursor + direction));
        const draft = historyCursor === -1 ? buffer.text : draftBeforeHistory;
        if (historyCursor === -1) {
          setDraftBeforeHistory(buffer.text);
        }
        if (nextCursor === promptHistory.length) {
          const text2 = draft ?? "";
          setBuffer({ text: text2, cursor: text2.length });
          setHistoryCursor(-1);
          setDraftBeforeHistory(null);
          return;
        }
        const text = promptHistory[nextCursor] ?? "";
        setBuffer({ text, cursor: text.length });
        setHistoryCursor(nextCursor);
      }
      function insertFileMentionSelection(item) {
        if (!fileMentionToken) {
          return;
        }
        updateBuffer((state) => replaceCurrentFileMentionToken(state, fileMentionToken, item.path));
        setDismissedFileMentionKey(null);
      }
      function resetPromptInput() {
        setBuffer(EMPTY_BUFFER);
        clearUndoRedoStacks();
        setImageUrls([]);
        setSelectedSkills([]);
        setShowSkillsDropdown(false);
        pastesRef.current.clear();
        expandedRegionsRef.current.clear();
        pasteCounterRef.current = 0;
      }
      function handleSlashSelection(item) {
        if (busy && item.kind !== "exit") {
          setStatusMessage("wait for the current response or press esc to interrupt");
          return;
        }
        if (item.kind === "skill" && item.skill) {
          addSelectedSkill(item.skill);
          clearSlashToken();
          setShowSkillsDropdown(false);
          return;
        }
        if (item.kind === "skills") {
          clearSlashToken();
          setShowSkillsDropdown(true);
          return;
        }
        if (item.kind === "model") {
          clearSlashToken();
          setShowSkillsDropdown(false);
          setShowModelDropdown(true);
          return;
        }
        if (item.kind === "raw") {
          clearSlashToken();
          setOpenRawModelDropdown(true);
          return;
        }
        if (item.kind === "new") {
          onSubmit({ text: "", imageUrls: [], command: "new" });
          resetPromptInput();
          return;
        }
        if (item.kind === "init") {
          onSubmit(buildInitPromptSubmission(selectedSkills));
          resetPromptInput();
          return;
        }
        if (item.kind === "resume") {
          onSubmit({ text: "", imageUrls: [], command: "resume" });
          resetPromptInput();
          return;
        }
        if (item.kind === "continue") {
          onSubmit({ text: "/continue", imageUrls: [], command: "continue" });
          resetPromptInput();
          return;
        }
        if (item.kind === "undo") {
          onSubmit({ text: "/undo", imageUrls: [], command: "undo" });
          resetPromptInput();
          return;
        }
        if (item.kind === "mcp") {
          onSubmit({ text: "/mcp", imageUrls: [], command: "mcp" });
          resetPromptInput();
          return;
        }
        if (item.kind === "lima") {
          const trimmed = buffer.text.trim();
          if (trimmed !== "/lima") {
            onSubmit({ text: trimmed, imageUrls: [], command: "lima" });
            resetPromptInput();
            return;
          }
          setBuffer({ text: "/lima ", cursor: "/lima ".length });
          setShowSkillsDropdown(false);
          return;
        }
        if (item.kind === "exit") {
          onSubmit({ text: "/exit", imageUrls: [], command: "exit" });
          setBuffer(EMPTY_BUFFER);
          clearUndoRedoStacks();
          return;
        }
      }
      function submitCurrentBuffer() {
        if (busy) {
          setStatusMessage("wait for the current response or press esc to interrupt");
          return;
        }
        const trimmed = buffer.text.trim();
        if (!trimmed && imageUrls.length === 0 && selectedSkills.length === 0) {
          return;
        }
        if (trimmed.startsWith("/")) {
          const exactMatch = findExactSlashCommand(slashItems, trimmed.split(/\s+/, 1)[0]);
          if (exactMatch) {
            handleSlashSelection(exactMatch);
            return;
          }
        }
        onSubmit({
          text: expandPasteMarkers(buffer.text, pastesRef.current),
          imageUrls,
          selectedSkills
        });
        resetPromptInput();
      }
      function addSelectedSkill(skill) {
        setSelectedSkills((prev) => addUniqueSkill(prev, skill));
      }
      function toggleSelectedSkill(skill) {
        setSelectedSkills((prev) => toggleSkillSelection(prev, skill));
      }
      function clearSlashToken() {
        exitHistoryBrowsing();
        setBuffer((state) => removeCurrentSlashToken(state));
        clearUndoRedoStacks();
      }
      const showFooterText = useMemo2(
        () => showMenu || showSkillsDropdown || openRawModelDropdown || showModelDropdown || showFileMentionMenu,
        [showMenu, showSkillsDropdown, showModelDropdown, openRawModelDropdown, showFileMentionMenu]
      );
      const matchedCommand = slashToken ? findExactSlashCommand(slashItems, slashToken) : null;
      const inlineHint = matchedCommand?.args ? ` ${matchedCommand.args.join(ARGS_SEPARATOR)}` : "";
      return /* @__PURE__ */ jsxs5(Box5, { flexDirection: "column", width: screenWidth, children: [
        imageUrls.length > 0 ? /* @__PURE__ */ jsxs5(Box5, { children: [
          /* @__PURE__ */ jsx9(Text5, { color: "magenta", children: formatImageAttachmentStatus(imageUrls.length) }),
          /* @__PURE__ */ jsx9(Text5, { dimColor: true, children: ` (${IMAGE_ATTACHMENT_CLEAR_HINT})` })
        ] }) : null,
        selectedSkills.length > 0 ? /* @__PURE__ */ jsxs5(Box5, { children: [
          /* @__PURE__ */ jsx9(Text5, { color: "magenta", wrap: "truncate-end", children: formatSelectedSkillsStatus(selectedSkills) }),
          /* @__PURE__ */ jsx9(Text5, { dimColor: true, children: " (use /skills to edit)" })
        ] }) : null,
        /* @__PURE__ */ jsxs5(
          Box5,
          {
            borderStyle: "single",
            borderTop: true,
            borderBottom: true,
            borderLeft: false,
            borderRight: false,
            borderDimColor: true,
            children: [
              /* @__PURE__ */ jsx9(PromptPrefixLine, { busy }),
              /* @__PURE__ */ jsx9(Text5, { children: renderBufferWithCursor(buffer, !disabled && hasTerminalFocus, placeholder, pastesRef.current) }),
              inlineHint ? /* @__PURE__ */ jsx9(Text5, { dimColor: true, children: inlineHint }) : null
            ]
          }
        ),
        /* @__PURE__ */ jsx9(
          RawModelDropdown_default,
          {
            open: openRawModelDropdown,
            onClose: setOpenRawModelDropdown,
            onSelect: (mode) => onRawModeChange?.(mode),
            screenWidth
          }
        ),
        /* @__PURE__ */ jsx9(
          SkillsDropdown_default,
          {
            width: screenWidth,
            open: showSkillsDropdown,
            onClose: setShowSkillsDropdown,
            skills,
            selectedSkills,
            onSelect: toggleSelectedSkill
          }
        ),
        /* @__PURE__ */ jsx9(
          ModelsDropdown_default,
          {
            open: showModelDropdown,
            modelConfig,
            width: screenWidth,
            onClose: () => setShowModelDropdown(false),
            onModelConfigChange,
            onStatusMessage: setStatusMessage
          }
        ),
        /* @__PURE__ */ jsx9(
          FileMentionMenu_default,
          {
            open: showFileMentionMenu,
            width: screenWidth,
            token: fileMentionToken,
            items: fileMentionMatches,
            onClose: () => {
              if (fileMentionKey) {
                setDismissedFileMentionKey(fileMentionKey);
              }
            },
            onSelect: insertFileMentionSelection
          }
        ),
        /* @__PURE__ */ jsx9(SlashCommandMenu_default, { width: screenWidth, items: slashMenu, activeIndex: menuIndex }),
        !showFooterText && /* @__PURE__ */ jsx9(Box5, { children: /* @__PURE__ */ jsx9(Text5, { dimColor: true, children: footerText }) })
      ] });
    });
    IMAGE_ATTACHMENT_CLEAR_HINT = "ctrl+x clear images";
  }
});

// src/ui/SessionList.tsx
import { useState as useState7, useMemo as useMemo3, useCallback as useCallback2 } from "react";
import { Box as Box6, Text as Text6, useInput as useInput6, useWindowSize } from "ink";
import { jsx as jsx10, jsxs as jsxs6 } from "react/jsx-runtime";
function filterSessions(sessions, query) {
  if (!query.trim()) {
    return sessions;
  }
  const lowerQuery = query.toLowerCase().trim();
  return sessions.filter((session) => {
    if (session.summary && session.summary.toLowerCase().includes(lowerQuery)) {
      return true;
    }
    if (session.status.toLowerCase().includes(lowerQuery)) {
      return true;
    }
    if (session.failReason && session.failReason.toLowerCase().includes(lowerQuery)) {
      return true;
    }
    if (session.assistantReply && session.assistantReply.toLowerCase().includes(lowerQuery)) {
      return true;
    }
    return false;
  });
}
function SessionList({ sessions, onSelect, onCancel }) {
  const [index, setIndex] = useState7(0);
  const [searchQuery, setSearchQuery] = useState7("");
  const { columns, rows } = useWindowSize();
  const filteredSessions = useMemo3(() => filterSessions(sessions, searchQuery), [sessions, searchQuery]);
  const safeIndex = useMemo3(() => {
    if (filteredSessions.length === 0) return 0;
    return Math.max(0, Math.min(index, filteredSessions.length - 1));
  }, [index, filteredSessions.length]);
  const maxVisibleSessions = useMemo3(() => {
    const reservedLines = searchQuery ? 12 : 9;
    const linesPerSession = 3;
    const availableLines = Math.max(0, Math.min(rows, 30) - reservedLines);
    return Math.max(1, Math.floor(availableLines / linesPerSession));
  }, [rows, searchQuery]);
  const scrollOffset = useMemo3(() => {
    if (safeIndex < maxVisibleSessions) return 0;
    return safeIndex - maxVisibleSessions + 1;
  }, [safeIndex, maxVisibleSessions]);
  const visibleSessions = useMemo3(() => {
    return filteredSessions.slice(scrollOffset, scrollOffset + maxVisibleSessions);
  }, [filteredSessions, scrollOffset, maxVisibleSessions]);
  const handleBackspace = useCallback2(() => {
    setSearchQuery((prev) => prev.slice(0, -1));
    setIndex(0);
  }, []);
  useInput6((input, key) => {
    if (key.escape) {
      if (searchQuery) {
        setSearchQuery("");
        setIndex(0);
        return;
      }
      onCancel();
      return;
    }
    if (key.ctrl && (input === "c" || input === "C")) {
      onCancel();
      return;
    }
    if (key.backspace || key.delete) {
      if (searchQuery) {
        handleBackspace();
        return;
      }
    }
    if (input && input.length > 0 && !key.meta && !key.ctrl && !key.tab && !key.return) {
      if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
        return;
      }
      setSearchQuery((prev) => prev + input);
      setIndex(0);
      return;
    }
    if (filteredSessions.length === 0) {
      return;
    }
    if (key.upArrow) {
      setIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setIndex((i) => Math.min(filteredSessions.length - 1, i + 1));
      return;
    }
    if (key.pageUp) {
      setIndex((i) => Math.max(0, i - maxVisibleSessions));
      return;
    }
    if (key.pageDown) {
      setIndex((i) => Math.min(filteredSessions.length - 1, i + maxVisibleSessions));
      return;
    }
    if (key.home) {
      setIndex(0);
      return;
    }
    if (key.end) {
      setIndex(filteredSessions.length - 1);
      return;
    }
    if (key.return) {
      const session = filteredSessions[safeIndex];
      if (session) {
        onSelect(session.id);
      }
    }
  });
  const hasActiveSearch = searchQuery.trim().length > 0;
  if (sessions.length === 0) {
    return /* @__PURE__ */ jsxs6(Box6, { flexDirection: "column", children: [
      /* @__PURE__ */ jsx10(Text6, { color: "yellow", children: "\u6CA1\u6709\u5386\u53F2\u4F1A\u8BDD\u3002" }),
      /* @__PURE__ */ jsx10(Text6, { dimColor: true, children: "\u6309 Esc \u8FD4\u56DE\u3002" })
    ] });
  }
  return /* @__PURE__ */ jsx10(
    Box6,
    {
      flexDirection: "column",
      width: Math.max(20, columns - 6),
      height: Math.max(5, Math.min(rows - 1, 30)),
      overflow: "hidden",
      paddingX: 1,
      marginTop: 1,
      children: /* @__PURE__ */ jsxs6(Box6, { flexDirection: "column", borderStyle: "round", borderDimColor: true, flexGrow: 1, overflow: "hidden", children: [
        /* @__PURE__ */ jsxs6(Box6, { paddingX: 1, flexDirection: "column", children: [
          /* @__PURE__ */ jsxs6(Box6, { children: [
            /* @__PURE__ */ jsx10(Text6, { bold: true, color: "cyanBright", children: "\u7EE7\u7EED\u4F1A\u8BDD" }),
            /* @__PURE__ */ jsxs6(Text6, { bold: true, color: "#229ac3", children: [
              " ",
              "(\u5171 ",
              sessions.length,
              " \u4E2A",
              hasActiveSearch ? `, \u5339\u914D ${filteredSessions.length} \u4E2A` : "",
              ")"
            ] })
          ] }),
          /* @__PURE__ */ jsxs6(Box6, { marginTop: hasActiveSearch || searchQuery ? 0 : 0, children: [
            /* @__PURE__ */ jsx10(Text6, { dimColor: true, children: searchQuery ? `\u641C\u7D22: ${searchQuery}` : "\u8F93\u5165\u4EE5\u641C\u7D22..." }),
            searchQuery ? /* @__PURE__ */ jsx10(Text6, { bold: true, children: "|" }) : null
          ] })
        ] }),
        /* @__PURE__ */ jsxs6(
          Box6,
          {
            borderTop: true,
            borderBottom: true,
            borderLeft: false,
            borderRight: false,
            borderStyle: "round",
            borderDimColor: true,
            flexDirection: "column",
            flexGrow: 1,
            paddingX: 1,
            overflow: "hidden",
            children: [
              filteredSessions.length === 0 ? /* @__PURE__ */ jsx10(Box6, { paddingY: 1, children: /* @__PURE__ */ jsxs6(Text6, { color: "yellow", children: [
                '\u6CA1\u6709\u5339\u914D "',
                searchQuery,
                '" \u7684\u4F1A\u8BDD\u3002'
              ] }) }) : visibleSessions.map((session, i) => {
                const actualIndex = scrollOffset + i;
                return /* @__PURE__ */ jsxs6(Box6, { height: 2, marginBottom: 1, children: [
                  /* @__PURE__ */ jsx10(Box6, { children: /* @__PURE__ */ jsx10(Text6, { color: "#229ac3", children: actualIndex === safeIndex ? "> " : "  " }) }),
                  /* @__PURE__ */ jsxs6(Box6, { flexDirection: "column", flexGrow: 1, children: [
                    /* @__PURE__ */ jsxs6(Box6, { width: "100%", children: [
                      /* @__PURE__ */ jsx10(
                        Text6,
                        {
                          ...actualIndex === safeIndex ? { bold: true } : {},
                          color: actualIndex === safeIndex ? "#229ac3" : void 0,
                          children: formatSessionTitle(session.summary || "\u672A\u547D\u540D")
                        }
                      ),
                      /* @__PURE__ */ jsxs6(Text6, { dimColor: true, children: [
                        " (",
                        formatSessionStatus(session.status),
                        ")"
                      ] })
                    ] }),
                    /* @__PURE__ */ jsx10(Box6, { width: "100%", children: /* @__PURE__ */ jsxs6(Text6, { dimColor: true, children: [
                      formatTimestamp(session.updateTime),
                      " "
                    ] }) })
                  ] })
                ] }, session.id);
              }),
              scrollOffset > 0 || scrollOffset + maxVisibleSessions < filteredSessions.length ? /* @__PURE__ */ jsxs6(Box6, { marginTop: 1, children: [
                scrollOffset > 0 ? /* @__PURE__ */ jsxs6(Text6, { dimColor: true, children: [
                  "\u2026 \u4E0A\u65B9\u8FD8\u6709 ",
                  scrollOffset,
                  " \u4E2A\u4F1A\u8BDD\u3002 "
                ] }) : null,
                scrollOffset + maxVisibleSessions < filteredSessions.length ? /* @__PURE__ */ jsxs6(Text6, { dimColor: true, children: [
                  "\u2026 \u4E0B\u65B9\u8FD8\u6709 ",
                  filteredSessions.length - scrollOffset - maxVisibleSessions,
                  " \u4E2A\u4F1A\u8BDD\u3002"
                ] }) : null
              ] }) : null
            ]
          }
        ),
        /* @__PURE__ */ jsx10(Box6, { flexDirection: "column", children: hasActiveSearch ? /* @__PURE__ */ jsxs6(Box6, { children: [
          /* @__PURE__ */ jsx10(Text6, { dimColor: true, children: "Esc \u6E05\u7A7A\u641C\u7D22 \xB7 " }),
          /* @__PURE__ */ jsx10(Text6, { dimColor: true, children: "\u2191/\u2193 \u5BFC\u822A \xB7 Enter \u9009\u62E9 \xB7 \u518D\u6309 Esc \u53D6\u6D88" })
        ] }) : /* @__PURE__ */ jsx10(Box6, { children: /* @__PURE__ */ jsx10(Text6, { dimColor: true, children: "\u8F93\u5165\u641C\u7D22 \xB7 \u2191/\u2193 \u5BFC\u822A \xB7 PgUp/PgDn \u7FFB\u9875 \xB7 Enter \u9009\u62E9 \xB7 Esc \u53D6\u6D88" }) }) })
      ] })
    }
  );
}
function formatTimestamp(value) {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) {
      return value;
    }
    return date.toLocaleString();
  } catch {
    return value;
  }
}
function formatSessionTitle(value, max = 70) {
  return truncate2(value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim(), max);
}
function formatSessionStatus(status) {
  switch (status) {
    case "completed":
      return "\u5B8C\u6210";
    case "processing":
      return "\u5904\u7406\u4E2D";
    case "pending":
      return "\u7B49\u5F85\u4E2D";
    case "waiting_for_user":
      return "\u7B49\u5F85\u7528\u6237";
    case "failed":
      return "\u5931\u8D25";
    case "interrupted":
      return "\u5DF2\u505C\u6B62";
    default:
      return status;
  }
}
function truncate2(value, max) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}\u2026`;
}
var init_SessionList = __esm({
  "src/ui/SessionList.tsx"() {
    "use strict";
  }
});

// src/ui/UndoSelector.tsx
import { useMemo as useMemo4, useState as useState8 } from "react";
import { Box as Box7, Text as Text7, useInput as useInput7, useWindowSize as useWindowSize2 } from "ink";
import { jsx as jsx11, jsxs as jsxs7 } from "react/jsx-runtime";
function UndoSelector({ targets, onSelect, onCancel }) {
  const [phase, setPhase] = useState8("message");
  const [targetIndex, setTargetIndex] = useState8(Math.max(0, targets.length - 1));
  const [modeIndex, setModeIndex] = useState8(0);
  const { columns, rows } = useWindowSize2();
  const safeTargetIndex = useMemo4(() => {
    if (targets.length === 0) {
      return 0;
    }
    return Math.max(0, Math.min(targetIndex, targets.length - 1));
  }, [targetIndex, targets.length]);
  const selectedTarget = targets[safeTargetIndex] ?? null;
  const maxVisible = Math.max(1, Math.min(MAX_VISIBLE_TARGETS, rows - 8));
  const scrollOffset = Math.max(0, Math.min(safeTargetIndex - Math.floor(maxVisible / 2), targets.length - maxVisible));
  const visibleTargets = targets.slice(scrollOffset, scrollOffset + maxVisible);
  useInput7((input, key) => {
    if (key.escape || key.ctrl && (input === "c" || input === "C")) {
      if (phase === "mode") {
        setPhase("message");
        return;
      }
      onCancel();
      return;
    }
    if (targets.length === 0) {
      return;
    }
    if (phase === "message") {
      if (key.upArrow) {
        setTargetIndex((index) => Math.max(0, index - 1));
        return;
      }
      if (key.downArrow) {
        setTargetIndex((index) => Math.min(targets.length - 1, index + 1));
        return;
      }
      if (key.home) {
        setTargetIndex(0);
        return;
      }
      if (key.end) {
        setTargetIndex(targets.length - 1);
        return;
      }
      if (key.return) {
        setModeIndex(selectedTarget?.canRestoreCode ? 0 : 1);
        setPhase("mode");
      }
      return;
    }
    if (key.upArrow || key.downArrow) {
      setModeIndex((index) => index === 0 ? 1 : 0);
      return;
    }
    if (key.return && selectedTarget) {
      onSelect(selectedTarget, modeIndex === 0 ? "code-and-conversation" : "conversation");
    }
  });
  if (targets.length === 0) {
    return /* @__PURE__ */ jsxs7(Box7, { flexDirection: "column", marginTop: 1, children: [
      /* @__PURE__ */ jsx11(Text7, { color: "yellow", children: "\u6682\u65E0\u53EF\u64A4\u9500\u5185\u5BB9\u3002" }),
      /* @__PURE__ */ jsx11(Text7, { dimColor: true, children: "\u6309 Esc \u8FD4\u56DE\u3002" })
    ] });
  }
  return /* @__PURE__ */ jsx11(
    Box7,
    {
      flexDirection: "column",
      width: Math.max(20, columns - 6),
      height: Math.max(5, Math.min(rows - 1, 30)),
      overflow: "hidden",
      paddingX: 1,
      marginTop: 1,
      children: /* @__PURE__ */ jsxs7(Box7, { flexDirection: "column", borderStyle: "round", borderDimColor: true, flexGrow: 1, overflow: "hidden", children: [
        /* @__PURE__ */ jsxs7(Box7, { paddingX: 1, children: [
          /* @__PURE__ */ jsx11(Text7, { bold: true, color: "cyanBright", children: "\u64A4\u9500" }),
          /* @__PURE__ */ jsx11(Text7, { dimColor: true, children: " \u6062\u590D\u5230\u67D0\u6B21\u63D0\u793A\u8BCD\u4E4B\u524D" })
        ] }),
        phase === "message" ? /* @__PURE__ */ jsx11(
          Box7,
          {
            borderTop: true,
            borderBottom: true,
            borderLeft: false,
            borderRight: false,
            borderStyle: "round",
            borderDimColor: true,
            flexDirection: "column",
            flexGrow: 1,
            paddingX: 1,
            overflow: "hidden",
            children: visibleTargets.map((target, visibleIndex) => {
              const actualIndex = scrollOffset + visibleIndex;
              const isActive = actualIndex === safeTargetIndex;
              return /* @__PURE__ */ jsxs7(Box7, { height: 2, marginBottom: 1, children: [
                /* @__PURE__ */ jsx11(Text7, { color: "#229ac3", children: isActive ? "> " : "  " }),
                /* @__PURE__ */ jsxs7(Box7, { flexDirection: "column", flexGrow: 1, children: [
                  /* @__PURE__ */ jsx11(Text7, { color: isActive ? "#229ac3" : void 0, bold: isActive, children: formatUndoMessage(target.message.content) }),
                  /* @__PURE__ */ jsxs7(Text7, { dimColor: true, children: [
                    formatTimestamp2(target.message.createTime),
                    target.canRestoreCode ? " \xB7 \u53EF\u6062\u590D\u4EE3\u7801 checkpoint" : " \xB7 \u4EC5\u4F1A\u8BDD"
                  ] })
                ] })
              ] }, target.message.id);
            })
          }
        ) : /* @__PURE__ */ jsxs7(
          Box7,
          {
            borderTop: true,
            borderBottom: true,
            borderLeft: false,
            borderRight: false,
            borderStyle: "round",
            borderDimColor: true,
            flexDirection: "column",
            flexGrow: 1,
            paddingX: 1,
            overflow: "hidden",
            children: [
              /* @__PURE__ */ jsx11(Text7, { dimColor: true, children: "\u5DF2\u9009\u63D0\u793A\u8BCD:" }),
              /* @__PURE__ */ jsx11(Text7, { children: formatUndoMessage(selectedTarget?.message.content ?? "") }),
              /* @__PURE__ */ jsxs7(Box7, { marginTop: 1, flexDirection: "column", children: [
                /* @__PURE__ */ jsxs7(Text7, { color: modeIndex === 0 ? "cyanBright" : void 0, children: [
                  modeIndex === 0 ? "> " : "  ",
                  "\u6062\u590D\u4EE3\u7801\u548C\u4F1A\u8BDD"
                ] }),
                /* @__PURE__ */ jsxs7(Text7, { dimColor: true, children: [
                  "  ",
                  selectedTarget?.canRestoreCode ? "\u4ECE\u8BB0\u5F55\u7684 Git checkpoint \u6062\u590D\u6587\u4EF6\uFF0C\u7136\u540E\u5206\u53C9\u4F1A\u8BDD\u3002" : "\u8FD9\u6761\u63D0\u793A\u8BCD\u6CA1\u6709\u8BB0\u5F55\u4EE3\u7801 checkpoint\u3002"
                ] }),
                /* @__PURE__ */ jsxs7(Text7, { color: modeIndex === 1 ? "cyanBright" : void 0, children: [
                  modeIndex === 1 ? "> " : "  ",
                  "\u4EC5\u6062\u590D\u4F1A\u8BDD"
                ] }),
                /* @__PURE__ */ jsxs7(Text7, { dimColor: true, children: [
                  "  ",
                  "\u5206\u53C9\u4F1A\u8BDD\uFF0C\u4E0D\u6539\u52A8\u6587\u4EF6\u3002"
                ] })
              ] })
            ]
          }
        ),
        /* @__PURE__ */ jsx11(Box7, { children: /* @__PURE__ */ jsx11(Text7, { dimColor: true, children: phase === "message" ? "\u2191/\u2193 \u5BFC\u822A \xB7 Enter \u9009\u62E9 \xB7 Esc \u53D6\u6D88" : "\u2191/\u2193 \u9009\u62E9\u6062\u590D\u6A21\u5F0F \xB7 Enter \u6062\u590D \xB7 Esc \u8FD4\u56DE" }) })
      ] })
    }
  );
}
function formatUndoMessage(content) {
  const text = typeof content === "string" && content.trim() ? content.trim() : "(\u7A7A\u6D88\u606F)";
  const singleLine = text.replace(/\r?\n/g, " ").replace(/\s+/g, " ");
  return singleLine.length > 90 ? `${singleLine.slice(0, 89)}\u2026` : singleLine;
}
function formatTimestamp2(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return date.toLocaleString();
}
var MAX_VISIBLE_TARGETS;
var init_UndoSelector = __esm({
  "src/ui/UndoSelector.tsx"() {
    "use strict";
    MAX_VISIBLE_TARGETS = 7;
  }
});

// src/ui/loadingText.ts
function buildLoadingText(input) {
  const { progress, processes, now } = input;
  const processText = buildProcessLoadingText(processes, now);
  if (processText) {
    return processText;
  }
  if (!progress) {
    return THINKING_TEXT;
  }
  const startedAt = parseTimestamp(progress.startedAt);
  if (startedAt === null) {
    return THINKING_TEXT;
  }
  const elapsedMs = Math.max(0, now - startedAt);
  if (elapsedMs < STALL_THRESHOLD_MS) {
    return THINKING_TEXT;
  }
  const elapsedSeconds = Math.floor(elapsedMs / 1e3);
  if (progress.estimatedTokens <= 0) {
    const waitLabel = progress.transport === "non_stream" ? "\u7B49\u5F85 LiMa Router \u54CD\u5E94" : "\u7B49\u5F85\u9996\u4E2A token";
    return `${THINKING_TEXT} (${elapsedSeconds}s) \xB7 ${waitLabel}${buildModelText(progress)}${buildRequestTelemetryText(progress)}`;
  }
  const tokens = progress.formattedTokens || "0";
  return `${THINKING_TEXT} (${elapsedSeconds}s) \xB7 \u2193 ${tokens} token${buildModelText(progress)}`;
}
function buildModelText(progress) {
  return progress.model ? ` [${progress.model}]` : "";
}
function buildRequestTelemetryText(progress) {
  if (progress.transport !== "non_stream") {
    return "";
  }
  const parts = [];
  if (typeof progress.attempt === "number" && typeof progress.maxAttempts === "number" && progress.maxAttempts > 1) {
    parts.push(`\u7B2C ${progress.attempt}/${progress.maxAttempts} \u6B21`);
  }
  if (typeof progress.timeoutMs === "number" && progress.timeoutMs > 0) {
    parts.push(`\u8D85\u65F6 ${formatDuration(progress.timeoutMs)}`);
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}
function buildProcessLoadingText(processes, now) {
  if (!processes || processes.size === 0) {
    return null;
  }
  const first = processes.values().next().value;
  if (!first) {
    return null;
  }
  return `(${formatElapsedTime(first.startTime, now)}) ${first.command}`;
}
function formatElapsedTime(startTimeIso, now) {
  const startTime = parseTimestamp(startTimeIso);
  const elapsedMs = startTime === null ? 0 : Math.max(0, now - startTime);
  const elapsedSeconds = Math.floor(elapsedMs / 1e3);
  return formatDuration(elapsedSeconds * 1e3);
}
function formatDuration(ms) {
  const elapsedSeconds = Math.max(0, Math.floor(ms / 1e3));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m${seconds}s`;
  }
  return `${seconds}s`;
}
function parseTimestamp(value) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}
var STALL_THRESHOLD_MS, THINKING_TEXT;
var init_loadingText = __esm({
  "src/ui/loadingText.ts"() {
    "use strict";
    STALL_THRESHOLD_MS = 3e3;
    THINKING_TEXT = "\u601D\u8003\u4E2D...";
  }
});

// src/ui/thinkingState.ts
function findExpandedThinkingId(messages) {
  let expanded = null;
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    if (message.meta?.asThinking) {
      expanded = message.id;
    } else {
      expanded = null;
    }
  }
  return expanded;
}
var init_thinkingState = __esm({
  "src/ui/thinkingState.ts"() {
    "use strict";
  }
});

// src/ui/ThemedGradient.tsx
import { Text as Text8 } from "ink";
import Gradient from "ink-gradient";
import { jsx as jsx12 } from "react/jsx-runtime";
var ThemedGradient;
var init_ThemedGradient = __esm({
  "src/ui/ThemedGradient.tsx"() {
    "use strict";
    ThemedGradient = ({ children, ...props }) => {
      const gradient = ["#229ac3e6", "#229ac3e6"];
      if (gradient && gradient.length >= 2) {
        return /* @__PURE__ */ jsx12(Gradient, { colors: gradient, children: /* @__PURE__ */ jsx12(Text8, { ...props, children }) });
      }
      if (gradient && gradient.length === 1) {
        return /* @__PURE__ */ jsx12(Text8, { color: gradient[0], ...props, children });
      }
      return /* @__PURE__ */ jsx12(Text8, { color: "yellow", ...props, children });
    };
  }
});

// src/AsciiArt.ts
var AsciiLogo, BrandInfo;
var init_AsciiArt = __esm({
  "src/AsciiArt.ts"() {
    "use strict";
    AsciiLogo = [
      "  _ _      __  __    ____  ___   ____ ",
      " | | |    |  \\/  |  |  _ \\|  _ \\|  _ \\",
      " | | |    | |\\/| |  | | | | | | | | | |",
      " | | |__  | |  | |  | |_| | |_| | |_| |",
      " |_|____| |_|  |_|  |____/|____/|____/"
    ].join("\n");
    BrandInfo = [
      "",
      "  LiMa Code \u2014 \u6DF1\u5733\u5E02\u52A8\u529B\u5DE2\u79D1\u6280\u6709\u9650\u516C\u53F8\u51FA\u54C1",
      "  \u52A8\u529B\u5DE2\u79D1\u6280\uFF08\u6DF1\u5733\uFF09",
      "",
      "  \u7279\u70B9\uFF1A",
      "  \xB7 \u667A\u80FD\u8DEF\u7531 80+ AI \u540E\u7AEF\uFF0C\u81EA\u52A8\u9009\u62E9\u6700\u4F18\u6A21\u578B",
      "  \xB7 \u6DF1\u5EA6\u96C6\u6210 LiMa Server\uFF1A\u4EE3\u7801\u4E0A\u4E0B\u6587\u6CE8\u5165 + \u5B66\u4E60\u95ED\u73AF",
      "  \xB7 \u652F\u6301 Python/JS/TS/Go/Rust/Java \u591A\u8BED\u8A00\u4EE3\u7801\u7406\u89E3",
      "  \xB7 \u672C\u5730\u5DE5\u5177\u6267\u884C\uFF1Abash/read/write/edit + MCP \u6269\u5C55",
      "",
      "  \u89E3\u51B3\u7684\u95EE\u9898\uFF1A",
      "  \xB7 \u7F16\u7801\u52A9\u624B\u540E\u7AEF\u7EDF\u4E00\u7BA1\u7406\uFF0C\u65E0\u9700\u624B\u52A8\u5207\u6362\u6A21\u578B",
      "  \xB7 \u81EA\u52A8\u6545\u969C\u8F6C\u79FB\uFF0C\u5355\u540E\u7AEF\u6302\u4E86\u4E0D\u5F71\u54CD\u5DE5\u4F5C",
      "  \xB7 \u4EE3\u7801\u4E0A\u4E0B\u6587\u81EA\u52A8\u6CE8\u5165\uFF0C\u56DE\u7B54\u66F4\u7CBE\u51C6",
      ""
    ].join("\n");
  }
});

// src/ui/WelcomeScreen.tsx
import { useMemo as useMemo5, useState as useState9 } from "react";
import { Box as Box8, Text as Text9 } from "ink";
import * as os9 from "node:os";
import path14 from "node:path";
import { jsx as jsx13, jsxs as jsxs8 } from "react/jsx-runtime";
function WelcomeScreen({ projectRoot: projectRoot2, settings, skills, width }) {
  const { version } = useAppContext();
  const tips = useMemo5(() => buildWelcomeTips(skills), [skills]);
  const actions = useMemo5(() => buildWelcomeActions(), []);
  const [tipIndex] = useState9(() => randomTipIndex(tips.length));
  const compact = width < TITLE_PANEL_WIDTH + 42;
  const cwd = formatHomeRelativePath(projectRoot2);
  const tip = tips[Math.min(tipIndex, Math.max(0, tips.length - 1))] ?? tips[0];
  const panelWidth = compact ? void 0 : Math.min(width, 72);
  return /* @__PURE__ */ jsxs8(Box8, { flexDirection: "column", marginY: 1, children: [
    /* @__PURE__ */ jsx13(Box8, { flexDirection: "column", width: panelWidth, children: /* @__PURE__ */ jsxs8(Box8, { flexDirection: "column", paddingX: 1, children: [
      /* @__PURE__ */ jsx13(Box8, { flexDirection: "column", justifyContent: "center", paddingX: 1, children: /* @__PURE__ */ jsx13(Box8, { justifyContent: "center", width: compact ? void 0 : TITLE_PANEL_WIDTH, children: /* @__PURE__ */ jsx13(ThemedGradient, { children: AsciiLogo }) }) }),
      /* @__PURE__ */ jsx13(Box8, { flexDirection: "column", paddingX: 1, children: /* @__PURE__ */ jsx13(Text9, { color: "gray", children: BrandInfo }) }),
      /* @__PURE__ */ jsxs8(
        Box8,
        {
          borderStyle: "round",
          borderColor: "#229ac3e6",
          flexDirection: "column",
          flexGrow: 1,
          height: compact ? void 0 : PANEL_CONTENT_HEIGHT,
          marginTop: compact ? 1 : 0,
          paddingX: 1,
          children: [
            /* @__PURE__ */ jsxs8(Box8, { flexGrow: 1, marginBottom: compact ? 1 : 0, children: [
              /* @__PURE__ */ jsxs8(Text9, { color: "#229ac3e6", children: [
                ">",
                "_ LiMa Code "
              ] }),
              /* @__PURE__ */ jsxs8(Text9, { color: "gray", children: [
                " (v",
                version || "unknown",
                ")"
              ] })
            ] }),
            !compact ? /* @__PURE__ */ jsx13(Text9, { children: " " }) : null,
            /* @__PURE__ */ jsx13(SettingRow, { label: "\u6A21\u578B", value: settings.model }),
            /* @__PURE__ */ jsx13(SettingRow, { label: "\u601D\u8003\u6A21\u5F0F", value: settings.thinkingEnabled ? "\u5F00\u542F" : "\u5173\u95ED" }),
            /* @__PURE__ */ jsx13(SettingRow, { label: "\u63A8\u7406\u5F3A\u5EA6", value: settings.thinkingEnabled ? settings.reasoningEffort : "-" }),
            /* @__PURE__ */ jsx13(SettingRow, { label: "CWD", value: cwd })
          ]
        }
      )
    ] }) }),
    /* @__PURE__ */ jsx13(Box8, { flexDirection: "column", width: panelWidth, paddingX: 1, marginTop: 1, children: actions.map((action) => /* @__PURE__ */ jsxs8(Box8, { children: [
      /* @__PURE__ */ jsx13(Box8, { width: compact ? 24 : 34, children: /* @__PURE__ */ jsx13(Text9, { color: "#229ac3e6", children: action.command }) }),
      /* @__PURE__ */ jsx13(Text9, { dimColor: true, children: action.description })
    ] }, action.command)) }),
    /* @__PURE__ */ jsx13(Box8, { flexDirection: "column", width: panelWidth, paddingX: 1, children: tip ? /* @__PURE__ */ jsx13(Box8, { marginTop: 1, children: /* @__PURE__ */ jsxs8(Text9, { dimColor: true, children: [
      "\u63D0\u793A\uFF1A",
      tip.label,
      " - ",
      tip.description
    ] }) }) : null })
  ] });
}
function SettingRow({ label, value }) {
  return /* @__PURE__ */ jsxs8(Box8, { flexDirection: "row", children: [
    /* @__PURE__ */ jsx13(Box8, { width: 20, children: /* @__PURE__ */ jsx13(Text9, { children: label }) }),
    /* @__PURE__ */ jsx13(Box8, { flexGrow: 1, justifyContent: "flex-end", children: /* @__PURE__ */ jsx13(Text9, { children: value }) })
  ] });
}
function formatHomeRelativePath(value, home = os9.homedir()) {
  const normalizedValue = path14.resolve(value);
  const normalizedHome = path14.resolve(home);
  const relative7 = path14.relative(normalizedHome, normalizedValue);
  if (relative7 === "") {
    return "~";
  }
  if (!relative7.startsWith("..") && !path14.isAbsolute(relative7)) {
    return `~${path14.sep}${relative7}`;
  }
  return normalizedValue;
}
function buildWelcomeTips(skills) {
  const slashTips = buildSlashCommands(skills).filter((item) => item.kind !== "skill" || item.skill?.isLoaded).map((item) => ({
    label: item.label,
    description: formatSlashCommandDescription(item.description)
  }));
  return [
    ...slashTips,
    ...SHORTCUT_TIPS.filter((tip) => !BUILTIN_SLASH_COMMANDS.some((command) => command.label === tip.label))
  ];
}
function buildWelcomeActions() {
  return [
    { command: "/lima doctor", description: "\u5148\u786E\u8BA4\u670D\u52A1\u3001\u5BC6\u94A5\u3001worker \u548C\u5BA1\u8BA1\u72B6\u6001" },
    { command: "/lima plan", description: "\u628A\u60F3\u6CD5\u6574\u7406\u6210\u53EF\u6267\u884C\u5B9E\u65BD\u8BA1\u5212" },
    { command: "/lima test", description: "\u8FD0\u884C\u9879\u76EE\u6D4B\u8BD5\uFF0C\u5FEB\u901F\u53D1\u73B0\u65AD\u70B9" },
    { command: "/lima review", description: "\u4EA4\u4ED8\u524D\u5BA1\u67E5\u53D8\u66F4\u3001\u98CE\u9669\u548C\u8BC1\u636E" },
    { command: "\u76F4\u63A5\u63D0\u95EE", description: "\u4F8B\u5982\uFF1A\u4FEE\u590D\u767B\u5F55\u62A5\u9519\u5E76\u90E8\u7F72\u5230 VPS \u9A8C\u8BC1" }
  ];
}
function randomTipIndex(length) {
  return length > 0 ? Math.floor(Math.random() * length) : 0;
}
var TITLE_PANEL_WIDTH, PANEL_CONTENT_HEIGHT, SHORTCUT_TIPS;
var init_WelcomeScreen = __esm({
  "src/ui/WelcomeScreen.tsx"() {
    "use strict";
    init_slashCommands();
    init_ThemedGradient();
    init_AsciiArt();
    init_contexts();
    TITLE_PANEL_WIDTH = 70;
    PANEL_CONTENT_HEIGHT = 8;
    SHORTCUT_TIPS = [
      { label: "Enter", description: "\u53D1\u9001\u63D0\u793A\u8BCD" },
      { label: "Shift+Enter", description: "\u63D2\u5165\u6362\u884C" },
      { label: "Ctrl+V", description: "\u4ECE\u526A\u8D34\u677F\u7C98\u8D34\u56FE\u7247" },
      { label: "Esc", description: "\u4E2D\u65AD\u5F53\u524D\u6A21\u578B\u56DE\u5408" },
      { label: "/", description: "\u6253\u5F00\u6280\u80FD\u548C\u547D\u4EE4\u83DC\u5355" },
      { label: "Ctrl+D \u4E24\u6B21", description: "\u9000\u51FA LiMa Code" }
    ];
  }
});

// src/ui/AskUserQuestionPrompt.tsx
import { useEffect as useEffect6, useMemo as useMemo6, useState as useState10 } from "react";
import { Box as Box9, Text as Text10 } from "ink";
import { jsx as jsx14, jsxs as jsxs9 } from "react/jsx-runtime";
function AskUserQuestionPrompt({ questions, onSubmit, onCancel }) {
  const [questionIndex, setQuestionIndex] = useState10(0);
  const [cursorIndex, setCursorIndex] = useState10(0);
  const [answers, setAnswers] = useState10({});
  const [selectedValues, setSelectedValues] = useState10({});
  const [otherTexts, setOtherTexts] = useState10({});
  const [statusMessage, setStatusMessage] = useState10(null);
  const question = questions[questionIndex];
  const options = useMemo6(() => buildOptions(question), [question]);
  const selectedForQuestion = selectedValues[questionIndex] ?? [];
  const otherText = otherTexts[questionIndex] ?? "";
  const isCurrentOther = options[cursorIndex]?.isOther === true;
  useEffect6(() => {
    if (!statusMessage) {
      return;
    }
    const timer = setTimeout(() => setStatusMessage(null), 2500);
    return () => clearTimeout(timer);
  }, [statusMessage]);
  useEffect6(() => {
    setQuestionIndex(0);
    setCursorIndex(0);
    setAnswers({});
    setSelectedValues({});
    setOtherTexts({});
    setStatusMessage(null);
  }, [questions]);
  useEffect6(() => {
    if (cursorIndex >= options.length) {
      setCursorIndex(Math.max(0, options.length - 1));
    }
  }, [cursorIndex, options.length]);
  useTerminalInput((input, key) => {
    if (!question) {
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.ctrl && (input === "c" || input === "C")) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setCursorIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (key.downArrow) {
      setCursorIndex((index) => Math.min(options.length - 1, index + 1));
      return;
    }
    if (key.backspace && isCurrentOther) {
      setOtherTexts((prev) => ({
        ...prev,
        [questionIndex]: (prev[questionIndex] ?? "").slice(0, -1)
      }));
      return;
    }
    if (key.return) {
      commitCurrentQuestion();
      return;
    }
    if (isCurrentOther && input && !key.ctrl && !key.meta && !input.startsWith("\x1B")) {
      const sanitized = input.replace(/\r/g, "");
      if (sanitized) {
        setOtherTexts((prev) => ({
          ...prev,
          [questionIndex]: `${prev[questionIndex] ?? ""}${sanitized}`
        }));
      }
      return;
    }
    if (question.multiSelect && input === " " && !key.ctrl && !key.meta) {
      toggleCurrentOption();
      return;
    }
    if (question.multiSelect && input && /^[1-9]$/.test(input)) {
      const nextIndex = Number(input) - 1;
      if (nextIndex >= 0 && nextIndex < options.length) {
        toggleOption(options[nextIndex]?.value ?? "");
      }
    }
  });
  if (!question) {
    return null;
  }
  function toggleCurrentOption() {
    const value = options[cursorIndex]?.value;
    if (value) {
      toggleOption(value);
    }
  }
  function toggleOption(value) {
    setSelectedValues((prev) => {
      const current = prev[questionIndex] ?? [];
      const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
      return { ...prev, [questionIndex]: next };
    });
  }
  function commitCurrentQuestion() {
    const answer = buildAnswerForQuestion(question, options[cursorIndex], selectedForQuestion, otherText);
    if (!answer) {
      setStatusMessage(
        question.multiSelect ? "Select at least one option with Space, or type an Other answer." : "Select an option, or type an Other answer."
      );
      return;
    }
    const nextAnswers = {
      ...answers,
      [question.question]: answer
    };
    setAnswers(nextAnswers);
    if (questionIndex >= questions.length - 1) {
      onSubmit(nextAnswers);
      return;
    }
    setQuestionIndex((index) => index + 1);
    setCursorIndex(0);
  }
  return /* @__PURE__ */ jsxs9(Box9, { flexDirection: "column", borderStyle: "round", borderColor: "yellow", paddingX: 1, marginY: 1, children: [
    /* @__PURE__ */ jsxs9(Box9, { marginBottom: 1, children: [
      /* @__PURE__ */ jsx14(Text10, { color: "yellow", bold: true, children: "Answer questions" }),
      /* @__PURE__ */ jsxs9(Text10, { dimColor: true, children: [
        " ",
        questionIndex + 1,
        "/",
        questions.length
      ] })
    ] }),
    /* @__PURE__ */ jsx14(Text10, { bold: true, children: question.question }),
    /* @__PURE__ */ jsx14(Box9, { flexDirection: "column", marginTop: 1, children: options.map((option, index) => {
      const isCursor = index === cursorIndex;
      const isSelected = option.isOther ? selectedForQuestion.includes(OTHER_VALUE) || Boolean(otherText.trim()) : selectedForQuestion.includes(option.value) || answers[question.question] === option.label;
      const marker = question.multiSelect ? isSelected ? "[x]" : "[ ]" : isSelected ? "\u25CF" : "\u25CB";
      return /* @__PURE__ */ jsxs9(Box9, { flexDirection: "column", children: [
        /* @__PURE__ */ jsxs9(Text10, { color: isCursor ? "cyanBright" : void 0, children: [
          isCursor ? "> " : "  ",
          marker,
          " ",
          /* @__PURE__ */ jsx14(Text10, { bold: isCursor, children: option.label })
        ] }),
        option.isOther ? /* @__PURE__ */ jsx14(
          Box9,
          {
            marginLeft: 4,
            marginTop: 0,
            borderStyle: "single",
            borderColor: isCursor ? "cyanBright" : "gray",
            paddingX: 1,
            width: 64,
            children: otherText ? /* @__PURE__ */ jsxs9(Text10, { color: "white", children: [
              otherText,
              isCursor ? /* @__PURE__ */ jsx14(Text10, { color: "cyanBright", children: "\u258C" }) : null
            ] }) : /* @__PURE__ */ jsx14(Text10, { dimColor: true, children: isCursor ? "type your answer here" : "type a custom answer" })
          }
        ) : null,
        option.description ? /* @__PURE__ */ jsxs9(Text10, { dimColor: true, children: [
          " ",
          option.description
        ] }) : null
      ] }, option.value);
    }) }),
    /* @__PURE__ */ jsx14(Box9, { marginTop: 1, children: /* @__PURE__ */ jsx14(Text10, { dimColor: true, children: statusMessage ?? (isCurrentOther ? "\u8F93\u5165\u7B54\u6848 \xB7 Backspace \u7F16\u8F91 \xB7 Enter \u63D0\u4EA4/\u4E0B\u4E00\u6B65 \xB7 \u2191 \u9009\u62E9\u9884\u8BBE \xB7 Esc \u624B\u52A8\u8F93\u5165" : question.multiSelect ? "\u2191/\u2193 \u79FB\u52A8 \xB7 Space \u5207\u6362 \xB7 Enter \u63D0\u4EA4/\u4E0B\u4E00\u6B65 \xB7 Esc \u624B\u52A8\u8F93\u5165" : "\u2191/\u2193 move \xB7 Enter select/next \xB7 Esc type manually") }) })
  ] });
}
function buildOptions(question) {
  if (!question) {
    return [];
  }
  return [
    ...question.options.map((option) => ({
      label: option.label,
      description: option.description,
      value: option.label
    })),
    {
      label: "Other",
      value: OTHER_VALUE,
      isOther: true
    }
  ];
}
function buildAnswerForQuestion(question, focusedOption, selectedValues, otherText) {
  const trimmedOther = otherText.trim();
  if (question.multiSelect) {
    const labels = selectedValues.filter((value) => value !== OTHER_VALUE).map((value) => value.trim()).filter(Boolean);
    if (selectedValues.includes(OTHER_VALUE) && !trimmedOther) {
      return null;
    }
    if (trimmedOther) {
      labels.push(trimmedOther);
    }
    return labels.length > 0 ? labels.join(", ") : null;
  }
  if (!focusedOption) {
    return null;
  }
  if (focusedOption.isOther) {
    return trimmedOther || null;
  }
  return focusedOption.label;
}
var OTHER_VALUE;
var init_AskUserQuestionPrompt = __esm({
  "src/ui/AskUserQuestionPrompt.tsx"() {
    "use strict";
    init_PromptInput();
    OTHER_VALUE = "__other__";
  }
});

// src/ui/McpStatusList.tsx
import React13, { useState as useState11, useMemo as useMemo7, useCallback as useCallback3 } from "react";
import { Box as Box10, Text as Text11, useInput as useInput8, useWindowSize as useWindowSize3 } from "ink";
import { jsx as jsx15, jsxs as jsxs10 } from "react/jsx-runtime";
function McpStatusList({ statuses, onCancel, onReconnect }) {
  const { columns, rows } = useWindowSize3();
  const [viewMode, setViewMode] = useState11("server-list");
  const [selectedServerIndex, setSelectedServerIndex] = useState11(0);
  const goBack = useCallback3(() => {
    setViewMode("server-list");
  }, []);
  const enterDetail = useCallback3(() => {
    const server = statuses[selectedServerIndex];
    if (server && (server.status === "ready" || server.status === "failed" || server.status === "reconnecting")) {
      setViewMode("server-detail");
    }
  }, [statuses, selectedServerIndex]);
  useInput8((input, key) => {
    if (statuses.length === 0 && (key.escape || key.ctrl && (input === "c" || input === "C"))) {
      onCancel();
    }
  });
  if (statuses.length === 0) {
    return /* @__PURE__ */ jsxs10(Box10, { flexDirection: "column", marginLeft: 1, paddingX: 1, gap: 1, borderStyle: "round", borderDimColor: true, children: [
      /* @__PURE__ */ jsxs10(Box10, { flexDirection: "column", children: [
        /* @__PURE__ */ jsx15(Text11, { color: "#229ac3", bold: true, children: "MCP \u670D\u52A1\u7BA1\u7406" }),
        /* @__PURE__ */ jsx15(Text11, { dimColor: true, children: "0 \u4E2A\u670D\u52A1" })
      ] }),
      /* @__PURE__ */ jsxs10(Box10, { flexDirection: "column", children: [
        /* @__PURE__ */ jsx15(Text11, { dimColor: true, children: "\u5C1A\u672A\u914D\u7F6E MCP \u670D\u52A1\u3002" }),
        /* @__PURE__ */ jsx15(Text11, { dimColor: true, children: "\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u6DFB\u52A0 MCP \u670D\u52A1\u540E\u518D\u4F7F\u7528\u3002" })
      ] }),
      /* @__PURE__ */ jsx15(Text11, { dimColor: true, children: "Esc \u5173\u95ED" })
    ] });
  }
  if (viewMode === "server-detail") {
    return /* @__PURE__ */ jsx15(
      ServerDetailView,
      {
        server: statuses[selectedServerIndex],
        onBack: goBack,
        onCancel,
        onReconnect,
        rows,
        columns
      }
    );
  }
  return /* @__PURE__ */ jsx15(
    ServerListView,
    {
      statuses,
      selectedIndex: selectedServerIndex,
      onSelect: setSelectedServerIndex,
      onEnter: enterDetail,
      onCancel,
      rows,
      columns
    }
  );
}
function ServerListView({
  statuses,
  selectedIndex,
  onSelect,
  onEnter,
  onCancel,
  rows,
  columns
}) {
  const [scrollOffset, setScrollOffset] = useState11(0);
  const serverCount = statuses.length;
  const maxVisible = useMemo7(() => {
    const reservedLines = 8;
    const availableLines = Math.max(0, Math.min(rows, 30) - reservedLines);
    return Math.max(1, Math.floor(availableLines / 3));
  }, [rows]);
  const labelColumnWidth = useMemo7(() => {
    if (serverCount === 0) return 0;
    const longestName = Math.max(...statuses.map((s) => s.name.length));
    const contentWidth = longestName + 5;
    const maxAllowed = Math.max(15, Math.floor((columns - 6) * 0.4));
    return Math.min(contentWidth, maxAllowed);
  }, [statuses, serverCount, columns]);
  const safeIndex = useMemo7(() => {
    if (serverCount === 0) return 0;
    return Math.max(0, Math.min(selectedIndex, serverCount - 1));
  }, [selectedIndex, serverCount]);
  React13.useEffect(() => {
    if (safeIndex < scrollOffset) {
      setScrollOffset(safeIndex);
    } else if (safeIndex >= scrollOffset + maxVisible) {
      setScrollOffset(safeIndex - maxVisible + 1);
    }
  }, [safeIndex, scrollOffset, maxVisible]);
  const visibleServers = useMemo7(() => {
    return statuses.slice(scrollOffset, scrollOffset + maxVisible);
  }, [statuses, scrollOffset, maxVisible]);
  useInput8((input, key) => {
    if (key.escape || key.ctrl && (input === "c" || input === "C")) {
      onCancel();
      return;
    }
    if (serverCount === 0) {
      return;
    }
    if (key.upArrow) {
      onSelect(Math.max(0, selectedIndex - 1));
      return;
    }
    if (key.downArrow) {
      onSelect(Math.min(serverCount - 1, selectedIndex + 1));
      return;
    }
    if (key.pageUp) {
      onSelect(Math.max(0, selectedIndex - maxVisible));
      return;
    }
    if (key.pageDown) {
      onSelect(Math.min(serverCount - 1, selectedIndex + maxVisible));
      return;
    }
    if (key.home) {
      onSelect(0);
      return;
    }
    if (key.end) {
      onSelect(serverCount - 1);
    }
    if (key.return) {
      onEnter();
      return;
    }
  });
  const readyCount = statuses.filter((s) => s.status === "ready").length;
  const startingCount = statuses.filter((s) => s.status === "starting").length;
  const reconnectingCount = statuses.filter((s) => s.status === "reconnecting").length;
  const failedCount = statuses.filter((s) => s.status === "failed").length;
  return /* @__PURE__ */ jsx15(
    Box10,
    {
      flexDirection: "column",
      width: Math.max(20, columns - 6),
      height: Math.max(5, Math.min(rows - 1, 30)),
      overflow: "hidden",
      paddingX: 1,
      marginTop: 1,
      children: /* @__PURE__ */ jsxs10(Box10, { flexDirection: "column", borderStyle: "round", borderDimColor: true, flexGrow: 1, overflow: "hidden", children: [
        /* @__PURE__ */ jsxs10(Box10, { paddingX: 1, gap: 1, children: [
          /* @__PURE__ */ jsx15(Text11, { bold: true, color: "#229ac3", children: "MCP \u670D\u52A1\u7BA1\u7406" }),
          /* @__PURE__ */ jsxs10(Box10, { gap: 1, children: [
            /* @__PURE__ */ jsx15(Text11, { dimColor: true, children: "(" }),
            /* @__PURE__ */ jsxs10(Text11, { color: "green", bold: true, children: [
              "\u5C31\u7EEA ",
              readyCount,
              ","
            ] }),
            /* @__PURE__ */ jsxs10(Text11, { color: "yellow", bold: true, children: [
              "\u542F\u52A8\u4E2D ",
              startingCount,
              ","
            ] }),
            reconnectingCount > 0 && /* @__PURE__ */ jsxs10(Text11, { color: "#ff9900", bold: true, children: [
              "\u91CD\u8FDE\u4E2D ",
              reconnectingCount,
              ","
            ] }),
            /* @__PURE__ */ jsxs10(Text11, { color: "red", bold: true, children: [
              "\u5931\u8D25 ",
              failedCount
            ] }),
            /* @__PURE__ */ jsx15(Text11, { dimColor: true, children: ")" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs10(
          Box10,
          {
            borderTop: true,
            borderBottom: true,
            borderLeft: false,
            borderRight: false,
            borderStyle: "round",
            borderDimColor: true,
            flexDirection: "column",
            flexGrow: 1,
            paddingX: 1,
            overflow: "hidden",
            children: [
              visibleServers.map((status, i) => {
                const actualIndex = scrollOffset + i;
                const isSelected = actualIndex === safeIndex;
                return /* @__PURE__ */ jsx15(
                  ServerRow,
                  {
                    status,
                    selected: isSelected,
                    labelColumnWidth
                  },
                  `server-${status.name}`
                );
              }),
              scrollOffset > 0 || scrollOffset + maxVisible < serverCount ? /* @__PURE__ */ jsxs10(Box10, { marginTop: 1, children: [
                scrollOffset > 0 ? /* @__PURE__ */ jsxs10(Text11, { dimColor: true, children: [
                  "\u2026 \u4E0A\u65B9\u8FD8\u6709 ",
                  scrollOffset,
                  " \u4E2A\u670D\u52A1\u3002 "
                ] }) : null,
                scrollOffset + maxVisible < serverCount ? /* @__PURE__ */ jsxs10(Text11, { dimColor: true, children: [
                  "\u2026 \u4E0B\u65B9\u8FD8\u6709 ",
                  serverCount - scrollOffset - maxVisible,
                  " \u4E2A\u670D\u52A1\u3002"
                ] }) : null
              ] }) : null
            ]
          }
        ),
        /* @__PURE__ */ jsx15(Box10, { paddingX: 1, children: /* @__PURE__ */ jsx15(Text11, { dimColor: true, children: "\u2191/\u2193 \u5BFC\u822A \xB7 Enter \u67E5\u770B\u8BE6\u60C5 \xB7 Esc \u5173\u95ED" }) })
      ] })
    }
  );
}
function ServerRow({
  status,
  selected,
  labelColumnWidth
}) {
  const icon = status.status === "ready" ? "\u2713" : status.status === "failed" ? "\u2717" : status.status === "reconnecting" ? "\u21BB" : "\u25CF";
  const color = status.status === "ready" ? "green" : status.status === "failed" ? "red" : status.status === "reconnecting" ? "#ff9900" : "yellow";
  const [dots, setDots] = React13.useState(0);
  React13.useEffect(() => {
    if (status.status !== "starting" && status.status !== "reconnecting") return;
    const interval = setInterval(() => {
      setDots((d) => (d + 1) % 4);
    }, 500);
    return () => clearInterval(interval);
  }, [status.status]);
  const detail = status.status === "ready" ? `\u5C31\u7EEA (${status.toolCount} \u4E2A\u5DE5\u5177, ${status.promptCount} \u4E2A\u63D0\u793A, ${status.resourceCount} \u4E2A\u8D44\u6E90)` : status.status === "failed" ? `\u5931\u8D25` : status.status === "reconnecting" ? `\u91CD\u8FDE\u4E2D${dots > 0 ? ".".repeat(dots) : "   "}` : "\u542F\u52A8\u4E2D" + (dots > 0 ? ".".repeat(dots) : "   ");
  return /* @__PURE__ */ jsxs10(Box10, { flexDirection: "column", marginBottom: 1, children: [
    /* @__PURE__ */ jsxs10(Box10, { gap: 2, children: [
      /* @__PURE__ */ jsx15(Box10, { width: labelColumnWidth, flexShrink: 0, children: /* @__PURE__ */ jsxs10(Text11, { color: selected ? "#229ac3" : void 0, children: [
        selected ? "> " : "  ",
        /* @__PURE__ */ jsxs10(Text11, { color, children: [
          icon,
          " "
        ] }),
        /* @__PURE__ */ jsx15(Text11, { bold: true, children: status.name })
      ] }) }),
      /* @__PURE__ */ jsx15(Box10, { flexGrow: 1, children: /* @__PURE__ */ jsx15(Text11, { dimColor: true, children: detail }) })
    ] }),
    (status.status === "failed" || status.status === "reconnecting") && status.error ? /* @__PURE__ */ jsx15(ErrorRow, { error: status.error }) : null
  ] });
}
function ServerDetailView({
  server,
  onBack,
  onCancel,
  onReconnect,
  rows,
  columns
}) {
  const [activeIndex, setActiveIndex] = React13.useState(0);
  const hasReconnect = server.status === "failed";
  const canScroll = server.status === "ready";
  const allItems = useMemo7(() => {
    const items = [];
    if (hasReconnect) {
      items.push({ type: "action", name: "\u91CD\u65B0\u8FDE\u63A5" });
    }
    server.tools.forEach((tool) => items.push({ type: "tool", name: tool }));
    server.prompts.forEach((prompt) => items.push({ type: "prompt", name: prompt }));
    server.resources.forEach((resource) => items.push({ type: "resource", name: resource }));
    return items;
  }, [server, hasReconnect]);
  const totalItems = allItems.length;
  const maxVisible = useMemo7(() => {
    const reservedLines = 12;
    const availableLines = Math.max(0, Math.min(rows, 30) - reservedLines);
    return Math.max(1, availableLines);
  }, [rows]);
  const visibleStartRef = React13.useRef(0);
  const visibleStart = useMemo7(() => {
    if (totalItems === 0) return 0;
    const currentStart = visibleStartRef.current;
    let newStart = currentStart;
    if (activeIndex < currentStart) {
      newStart = activeIndex;
    } else if (activeIndex >= currentStart + maxVisible) {
      newStart = activeIndex - maxVisible + 1;
    }
    newStart = Math.max(0, Math.min(newStart, Math.max(0, totalItems - maxVisible)));
    visibleStartRef.current = newStart;
    return newStart;
  }, [activeIndex, maxVisible, totalItems]);
  const visibleItems = allItems.slice(visibleStart, visibleStart + maxVisible);
  useInput8((input, key) => {
    if (key.ctrl && (input === "c" || input === "C")) {
      onCancel();
      return;
    }
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return || input === " ") {
      if (activeIndex === 0 && hasReconnect) {
        onReconnect(server.name);
        onBack();
        return;
      }
      onBack();
      return;
    }
    if (!canScroll && !hasReconnect) return;
    if (key.upArrow) {
      setActiveIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setActiveIndex((prev) => Math.min(totalItems - 1, prev + 1));
      return;
    }
    if (key.pageUp && canScroll) {
      setActiveIndex((prev) => Math.max(0, prev - maxVisible));
      return;
    }
    if (key.pageDown && canScroll) {
      setActiveIndex((prev) => Math.min(totalItems - 1, prev + maxVisible));
      return;
    }
    if (key.home && canScroll) {
      setActiveIndex(0);
      return;
    }
    if (key.end && canScroll) {
      setActiveIndex(totalItems - 1);
    }
  });
  const statusIcon = server.status === "ready" ? "\u2713" : server.status === "failed" ? "\u2717" : server.status === "reconnecting" ? "\u21BB" : "\u25CF";
  const statusColor = server.status === "ready" ? "green" : server.status === "failed" ? "red" : server.status === "reconnecting" ? "#ff9900" : "yellow";
  return /* @__PURE__ */ jsx15(
    Box10,
    {
      flexDirection: "column",
      width: Math.max(20, columns - 6),
      height: Math.max(5, Math.min(rows - 1, 30)),
      overflow: "hidden",
      paddingX: 1,
      marginTop: 1,
      children: /* @__PURE__ */ jsxs10(Box10, { flexDirection: "column", borderStyle: "round", borderDimColor: true, flexGrow: 1, overflow: "hidden", children: [
        /* @__PURE__ */ jsxs10(Box10, { paddingX: 1, gap: 1, children: [
          /* @__PURE__ */ jsxs10(Text11, { color: statusColor, children: [
            statusIcon,
            " "
          ] }),
          /* @__PURE__ */ jsx15(Text11, { bold: true, color: "#229ac3", wrap: "truncate-end", children: server.name }),
          /* @__PURE__ */ jsxs10(Text11, { dimColor: true, children: [
            "\u2014 ",
            server.status === "ready" ? "\u8BE6\u60C5" : "\u72B6\u6001"
          ] })
        ] }),
        /* @__PURE__ */ jsx15(Box10, { paddingX: 1, marginLeft: 3, children: /* @__PURE__ */ jsx15(Text11, { wrap: "truncate-end", children: server.status === "ready" ? `${server.toolCount} \u4E2A\u5DE5\u5177, ${server.promptCount} \u4E2A\u63D0\u793A, ${server.resourceCount} \u4E2A\u8D44\u6E90` : `\u72B6\u6001: ${server.status}` }) }),
        server.error && (server.status === "failed" || server.status === "reconnecting") ? /* @__PURE__ */ jsx15(Box10, { paddingX: 1, marginLeft: 3, children: /* @__PURE__ */ jsx15(ErrorRow, { error: server.error }) }) : null,
        /* @__PURE__ */ jsxs10(
          Box10,
          {
            borderTop: true,
            borderBottom: true,
            borderLeft: false,
            borderRight: false,
            borderStyle: "round",
            borderDimColor: true,
            flexDirection: "column",
            flexGrow: 1,
            paddingX: 1,
            overflow: "hidden",
            children: [
              visibleStart > 0 ? /* @__PURE__ */ jsx15(Box10, { children: /* @__PURE__ */ jsx15(Text11, { dimColor: true, children: "\u25B2" }) }) : /* @__PURE__ */ jsx15(Text11, { children: " " }),
              /* @__PURE__ */ jsx15(Box10, { paddingX: 1, flexDirection: "column", children: visibleItems.length === 0 ? /* @__PURE__ */ jsx15(Box10, { paddingY: 1, children: /* @__PURE__ */ jsx15(Text11, { dimColor: true, children: "\u6CA1\u6709\u53EF\u7528\u6761\u76EE" }) }) : visibleItems.map((item, idx) => {
                const actualIndex = visibleStart + idx;
                const isSelected = actualIndex === activeIndex;
                return /* @__PURE__ */ jsx15(ItemRow, { item, selected: isSelected }, `${item.type}-${item.name}-${actualIndex}`);
              }) }),
              visibleStart > 0 || visibleStart + maxVisible < totalItems ? /* @__PURE__ */ jsxs10(Box10, { marginTop: 1, gap: 1, children: [
                totalItems - visibleStart - maxVisible > 0 ? /* @__PURE__ */ jsx15(Text11, { dimColor: true, children: "\u25BC" }) : /* @__PURE__ */ jsx15(Text11, { children: " " }),
                visibleStart > 0 ? /* @__PURE__ */ jsxs10(Text11, { dimColor: true, children: [
                  "\u2026 \u4E0A\u65B9\u8FD8\u6709 ",
                  visibleStart,
                  " \u4E2A\u9879\u76EE\u3002 "
                ] }) : null,
                totalItems - visibleStart - maxVisible > 0 ? /* @__PURE__ */ jsxs10(Text11, { dimColor: true, children: [
                  "\u2026 \u4E0B\u65B9\u8FD8\u6709 ",
                  totalItems - visibleStart - maxVisible,
                  " \u4E2A\u9879\u76EE\u3002"
                ] }) : null
              ] }) : null
            ]
          }
        ),
        /* @__PURE__ */ jsx15(Box10, { paddingX: 1, children: /* @__PURE__ */ jsx15(Text11, { dimColor: true, children: hasReconnect ? "Enter \u91CD\u65B0\u8FDE\u63A5 \xB7 Esc \u8FD4\u56DE \xB7 Ctrl+C \u5173\u95ED" : canScroll ? "\u2191/\u2193 \u6EDA\u52A8 \xB7 Space/Enter \u8FD4\u56DE \xB7 Esc \u8FD4\u56DE \xB7 Ctrl+C \u5173\u95ED" : "Space/Enter \u8FD4\u56DE \xB7 Esc \u8FD4\u56DE \xB7 Ctrl+C \u5173\u95ED" }) })
      ] })
    }
  );
}
function ItemRow({ item, selected }) {
  const isAction = item.type === "action";
  const icon = isAction ? "\u21BB" : item.type === "tool" ? "\u{1F527}" : item.type === "prompt" ? "\u{1F4DD}" : "\u{1F4E6}";
  const color = isAction && selected ? "#ff9900" : selected ? "#229ac3" : void 0;
  return /* @__PURE__ */ jsxs10(Box10, { height: 1, flexDirection: "row", children: [
    /* @__PURE__ */ jsx15(Text11, { color: selected ? "#229ac3" : void 0, children: selected ? "> " : "  " }),
    /* @__PURE__ */ jsxs10(Text11, { dimColor: true, children: [
      icon,
      " "
    ] }),
    /* @__PURE__ */ jsx15(Text11, { color, dimColor: !selected, bold: isAction, wrap: "truncate-end", children: isAction ? `[${item.name}]` : item.name })
  ] });
}
function ErrorRow({ error }) {
  const lines = error.split("\n").filter((line) => line.trim().length > 0);
  return /* @__PURE__ */ jsx15(
    Box10,
    {
      flexDirection: "column",
      marginLeft: 4,
      marginTop: 0,
      marginBottom: 0,
      borderStyle: "round",
      borderColor: "red",
      borderDimColor: true,
      children: lines.map((line, index) => /* @__PURE__ */ jsx15(Box10, { children: /* @__PURE__ */ jsx15(Text11, { color: "red", dimColor: true, children: line }) }, index))
    }
  );
}
var init_McpStatusList = __esm({
  "src/ui/McpStatusList.tsx"() {
    "use strict";
  }
});

// src/ui/ProcessStdoutView.tsx
import React14, { useEffect as useEffect7, useMemo as useMemo8, useRef as useRef5, useState as useState12 } from "react";
import { Box as Box11, Text as Text12 } from "ink";
import { jsx as jsx16, jsxs as jsxs11 } from "react/jsx-runtime";
function getLatestTimeoutProcess(runningProcesses) {
  if (!runningProcesses) {
    return null;
  }
  let latest = null;
  for (const [pid, entry] of runningProcesses.entries()) {
    if (typeof entry.timeoutMs !== "number") {
      continue;
    }
    latest = { pid, entry };
  }
  return latest;
}
function formatTimeoutHint(entry) {
  if (!entry || typeof entry.timeoutMs !== "number") {
    return "timeout unavailable";
  }
  return `timeout ${formatDuration2(entry.timeoutMs)}`;
}
function formatAdjustmentStatus(adjustment) {
  if (!adjustment) {
    return "\u6CA1\u6709\u53EF\u8C03\u6574\u7684 Bash timeout";
  }
  return `Timeout \u5DF2\u8BBE\u7F6E\u4E3A ${formatDuration2(adjustment.timeoutMs)}`;
}
function formatDuration2(ms) {
  const totalMinutes = Math.max(1, Math.round(ms / 6e4));
  return `${totalMinutes}m`;
}
var REFRESH_INTERVAL_MS, MAX_PANEL_HEIGHT, MIN_PANEL_HEIGHT, ProcessStdoutView;
var init_ProcessStdoutView = __esm({
  "src/ui/ProcessStdoutView.tsx"() {
    "use strict";
    init_bash_timeout();
    init_prompt2();
    REFRESH_INTERVAL_MS = 150;
    MAX_PANEL_HEIGHT = 30;
    MIN_PANEL_HEIGHT = 5;
    ProcessStdoutView = React14.memo(function ProcessStdoutView2({
      processStdoutRef,
      runningProcesses,
      onDismiss,
      onAdjustTimeout,
      screenWidth,
      screenHeight
    }) {
      const [stdoutText, setStdoutText] = useState12("");
      const [scrollOffset, setScrollOffset] = useState12(0);
      const [statusMessage, setStatusMessage] = useState12("");
      const statusTimerRef = useRef5(null);
      const panelHeight = Math.max(MIN_PANEL_HEIGHT, Math.min(screenHeight - 1, MAX_PANEL_HEIGHT));
      const reservedRows = statusMessage ? 2 : 1;
      const visibleLineLimit = Math.max(1, panelHeight - reservedRows);
      useEffect7(() => {
        const updateStdout = () => {
          let text = "";
          if (runningProcesses && runningProcesses.size > 0) {
            for (const [pid, proc] of runningProcesses.entries()) {
              const pidNum = Number(pid);
              const stdout = processStdoutRef.current.get(pidNum) ?? "";
              if (text) {
                text += "\n";
              }
              if (runningProcesses.size > 1) {
                text += `\u2500\u2500 Process ${pid} [${proc.command}] \u2500\u2500
`;
              }
              text += stdout || "(no output yet)";
            }
          } else {
            text = "(\u6CA1\u6709\u6B63\u5728\u8FD0\u884C\u7684\u8FDB\u7A0B)";
          }
          setStdoutText(text);
        };
        updateStdout();
        const interval = setInterval(updateStdout, REFRESH_INTERVAL_MS);
        return () => clearInterval(interval);
      }, [processStdoutRef, runningProcesses]);
      useEffect7(() => {
        return () => {
          if (statusTimerRef.current) {
            clearTimeout(statusTimerRef.current);
          }
        };
      }, []);
      const lines = useMemo8(() => stdoutText.split("\n"), [stdoutText]);
      const timeoutProcess = useMemo8(() => getLatestTimeoutProcess(runningProcesses), [runningProcesses]);
      const visibleLines = useMemo8(() => {
        if (lines.length <= visibleLineLimit) {
          return lines;
        }
        const outputLineLimit = Math.max(1, visibleLineLimit - 1);
        const start = Math.max(0, lines.length - outputLineLimit - scrollOffset);
        const slice = lines.slice(start, start + outputLineLimit);
        if (lines.length > visibleLineLimit) {
          slice.unshift(`... (\u4E0A\u65B9 ${start} \u884C \xB7 \u2191/\u2193 \u6EDA\u52A8 \xB7 \u5171 ${lines.length} \u884C) ...`);
        }
        return slice;
      }, [lines, scrollOffset, visibleLineLimit]);
      const setTemporaryStatus = (message) => {
        setStatusMessage(message);
        if (statusTimerRef.current) {
          clearTimeout(statusTimerRef.current);
        }
        statusTimerRef.current = setTimeout(() => setStatusMessage(""), 2e3);
      };
      useTerminalInput(
        (input, key) => {
          if (key.ctrl && (input === "o" || input === "O") || key.escape) {
            onDismiss();
            return;
          }
          if (input === "+") {
            const adjustment = onAdjustTimeout(BASH_TIMEOUT_INCREMENT_MS);
            setTemporaryStatus(formatAdjustmentStatus(adjustment));
            return;
          }
          if (input === "-") {
            const adjustment = onAdjustTimeout(-BASH_TIMEOUT_DECREMENT_MS);
            setTemporaryStatus(formatAdjustmentStatus(adjustment));
            return;
          }
          if (key.upArrow) {
            setScrollOffset((s) => Math.min(s + 10, Math.max(0, lines.length - visibleLineLimit)));
            return;
          }
          if (key.downArrow) {
            setScrollOffset((s) => Math.max(s - 10, 0));
            return;
          }
          if (key.pageUp) {
            setScrollOffset((s) => Math.min(s + visibleLineLimit, Math.max(0, lines.length - visibleLineLimit)));
            return;
          }
          if (key.pageDown) {
            setScrollOffset((s) => Math.max(s - visibleLineLimit, 0));
            return;
          }
        },
        { isActive: true }
      );
      return /* @__PURE__ */ jsxs11(Box11, { flexDirection: "column", width: screenWidth, minWidth: 80, height: panelHeight, overflow: "hidden", children: [
        /* @__PURE__ */ jsxs11(Box11, { borderStyle: "single", borderBottom: true, borderLeft: false, borderRight: false, borderTop: false, children: [
          /* @__PURE__ */ jsx16(Text12, { bold: true, children: "\u{1F4DF} Process Output" }),
          /* @__PURE__ */ jsx16(Text12, { dimColor: true, children: ` (${formatTimeoutHint(
            timeoutProcess?.entry
          )} \xB7 +/- \u8C03\u6574 \xB7 Ctrl+O \u6216 Esc \u5173\u95ED \xB7 \u2191\u2193 PageUp/PageDown \u6EDA\u52A8)` })
        ] }),
        /* @__PURE__ */ jsx16(Box11, { flexDirection: "column", paddingX: 1, overflow: "hidden", children: visibleLines.map((line, index) => /* @__PURE__ */ jsx16(Text12, { children: line }, `${index}`)) }),
        statusMessage ? /* @__PURE__ */ jsx16(Box11, { paddingX: 1, children: /* @__PURE__ */ jsx16(Text12, { dimColor: true, children: statusMessage }) }) : null
      ] });
    });
  }
});

// src/ui/RuntimeStatusPanel.tsx
import { Box as Box12, Text as Text13 } from "ink";
import { jsx as jsx17, jsxs as jsxs12 } from "react/jsx-runtime";
function RuntimeStatusPanel({ viewModel, width }) {
  if (!viewModel.visible) {
    return null;
  }
  if (viewModel.layoutMode === "wide") {
    return /* @__PURE__ */ jsxs12(
      Box12,
      {
        flexDirection: "column",
        width: RUNTIME_STATUS_PANEL_WIDTH,
        borderStyle: "single",
        borderColor: "gray",
        paddingX: 1,
        children: [
          /* @__PURE__ */ jsx17(Text13, { bold: true, color: "cyan", children: "\u8FD0\u884C\u6001" }),
          viewModel.items.map((item) => /* @__PURE__ */ jsxs12(Box12, { children: [
            /* @__PURE__ */ jsx17(Text13, { color: "yellow", children: item.label }),
            /* @__PURE__ */ jsx17(Text13, { dimColor: true, children: ": " }),
            /* @__PURE__ */ jsx17(ToneText, { item })
          ] }, item.label))
        ]
      }
    );
  }
  if (viewModel.layoutMode === "medium") {
    const usageLine = viewModel.items.filter((item) => ["Token", "\u7F13\u5B58", "\u8BF7\u6C42", "\u5DE5\u5177", "MCP"].includes(item.label)).map((item) => `${item.label} ${item.value}`).join(" \xB7 ");
    return /* @__PURE__ */ jsxs12(Box12, { flexDirection: "column", width, children: [
      /* @__PURE__ */ jsx17(Text13, { dimColor: true, children: viewModel.summary }),
      /* @__PURE__ */ jsx17(Text13, { dimColor: true, children: truncateText(usageLine, width) })
    ] });
  }
  return /* @__PURE__ */ jsx17(Box12, { width, children: /* @__PURE__ */ jsx17(Text13, { dimColor: true, children: truncateText(viewModel.summary, width) }) });
}
function ToneText({ item }) {
  if (item.tone === "danger") {
    return /* @__PURE__ */ jsx17(Text13, { color: "red", children: item.value });
  }
  if (item.tone === "warn") {
    return /* @__PURE__ */ jsx17(Text13, { color: "yellow", children: item.value });
  }
  if (item.tone === "success") {
    return /* @__PURE__ */ jsx17(Text13, { color: "green", children: item.value });
  }
  if (item.tone === "muted") {
    return /* @__PURE__ */ jsx17(Text13, { dimColor: true, children: item.value });
  }
  return /* @__PURE__ */ jsx17(Text13, { children: item.value });
}
function truncateText(value, maxWidth) {
  if (maxWidth <= 1) {
    return "";
  }
  if (value.length <= maxWidth) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxWidth - 1))}\u2026`;
}
var RUNTIME_STATUS_PANEL_WIDTH;
var init_RuntimeStatusPanel = __esm({
  "src/ui/RuntimeStatusPanel.tsx"() {
    "use strict";
    RUNTIME_STATUS_PANEL_WIDTH = 32;
  }
});

// src/ui/runtimeStatus.ts
function selectRuntimeLayoutMode(width) {
  if (width >= WIDE_MIN_COLUMNS) {
    return "wide";
  }
  if (width >= MEDIUM_MIN_COLUMNS) {
    return "medium";
  }
  return "narrow";
}
function formatRuntimeMetric(value) {
  return value.toLocaleString("en-US");
}
function buildRuntimeStatusViewModel(input) {
  const entry = input.entry ?? null;
  const processes = input.processes ?? entry?.processes ?? null;
  const progress = input.progress ?? null;
  const usage = sumRuntimeUsage(entry?.usagePerModel ?? null);
  const model = progress?.model || input.settings?.model || firstUsageModel(entry?.usagePerModel) || "-";
  const phase = resolvePhaseLabel({ entry, progress, processes, busy: input.busy });
  const elapsedLabel = resolveElapsedLabel({ progress, processes, now: input.now });
  const mcp = summarizeMcp(input.mcpStatuses ?? []);
  const risk = resolveRisk(input.errorLine ?? entry?.failReason ?? null, mcp);
  const retryText = typeof progress?.attempt === "number" && typeof progress.maxAttempts === "number" && progress.maxAttempts > 1 ? ` \xB7 \u91CD\u8BD5 ${progress.attempt}/${progress.maxAttempts}` : "";
  const items = [
    {
      label: "\u8DEF\u7531",
      value: elapsedLabel ? `${phase} ${elapsedLabel}` : phase,
      tone: entry?.status === "failed" ? "danger" : input.busy ? "warn" : "normal"
    },
    { label: "\u6A21\u578B", value: model },
    { label: "\u601D\u8003", value: formatThinking(input.settings) },
    {
      label: "Token",
      value: `\u672C\u8F6E ${formatRuntimeMetric(entry?.activeTokens ?? 0)} / \u5165 ${formatRuntimeMetric(
        usage.promptTokens
      )} / \u51FA ${formatRuntimeMetric(usage.completionTokens)}`
    },
    { label: "\u7F13\u5B58", value: formatCacheSummary(usage) },
    { label: "\u8BF7\u6C42", value: `${formatRuntimeMetric(usage.totalReqs)}${retryText}` },
    { label: "\u5DE5\u5177", value: formatProcessSummary(processes, input.now) },
    { label: "MCP", value: mcp.total > 0 ? `${mcp.ready}/${mcp.total} \u5C31\u7EEA` : "0 \u4E2A\u5DF2\u914D\u7F6E" },
    { label: "\u98CE\u9669", value: risk.label, tone: risk.tone }
  ];
  const visible = input.busy || Boolean(entry) || Boolean(progress) || Boolean(input.errorLine) || hasProcesses(processes);
  const summaryParts = [formatSessionStatus2(entry?.status ?? (input.busy ? "processing" : "idle"))];
  if (phase !== entry?.status) {
    summaryParts.push(elapsedLabel ? `${phase} ${elapsedLabel}` : phase);
  }
  summaryParts.push(`\u6A21\u578B ${model}`);
  return {
    visible,
    layoutMode: selectRuntimeLayoutMode(input.width ?? 80),
    phaseLabel: phase,
    elapsedLabel,
    summary: summaryParts.join(" \xB7 "),
    items
  };
}
function resolvePhaseLabel(input) {
  if (input.entry?.status === "failed") {
    return "\u5931\u8D25";
  }
  if (hasProcesses(input.processes)) {
    return "\u5DE5\u5177\u8FD0\u884C\u4E2D";
  }
  if (!input.progress) {
    return formatSessionStatus2(input.busy ? "processing" : input.entry?.status ?? "idle");
  }
  if (input.progress.estimatedTokens <= 0) {
    return input.progress.transport === "non_stream" ? "\u7B49\u5F85\u9996 token" : "\u7B49\u5F85\u9996 token";
  }
  return "\u6D41\u5F0F\u8F93\u51FA";
}
function formatSessionStatus2(status) {
  switch (status) {
    case "failed":
      return "\u5931\u8D25";
    case "pending":
      return "\u5F85\u5904\u7406";
    case "processing":
      return "\u5904\u7406\u4E2D";
    case "waiting_for_user":
      return "\u7B49\u5F85\u7528\u6237";
    case "completed":
      return "\u5DF2\u5B8C\u6210";
    case "interrupted":
      return "\u5DF2\u4E2D\u65AD";
    case "idle":
      return "\u7A7A\u95F2";
    default:
      return status;
  }
}
function resolveElapsedLabel(input) {
  const progressStartedAt = input.progress?.startedAt;
  if (progressStartedAt) {
    return formatElapsed(progressStartedAt, input.now);
  }
  const firstProcess = getFirstProcess(input.processes);
  if (firstProcess) {
    return formatElapsed(firstProcess.startTime, input.now);
  }
  return null;
}
function formatElapsed(startTimeIso, now) {
  const start = Date.parse(startTimeIso);
  if (!Number.isFinite(start)) {
    return null;
  }
  return formatDuration3(Math.max(0, now - start));
}
function formatDuration3(ms) {
  const totalSeconds = Math.floor(ms / 1e3);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m${seconds}s`;
  }
  return `${seconds}s`;
}
function formatThinking(settings) {
  if (!settings || typeof settings.thinkingEnabled !== "boolean") {
    return "-";
  }
  if (!settings.thinkingEnabled) {
    return "\u5173\u95ED";
  }
  return settings.reasoningEffort ? `\u5F00\u542F \xB7 ${settings.reasoningEffort}` : "\u5F00\u542F";
}
function formatCacheSummary(usage) {
  if (usage.cachedTokens <= 0) {
    return "0";
  }
  const denominator = usage.cacheMissTokens > 0 ? usage.cachedTokens + usage.cacheMissTokens : Math.max(usage.promptTokens, 1);
  const hitRate = usage.cachedTokens / denominator * 100;
  return `${formatRuntimeMetric(usage.cachedTokens)} (${hitRate.toFixed(1)}%)`;
}
function formatProcessSummary(processes, now) {
  if (!processes || processes.size === 0) {
    return "0 \u4E2A\u8FD0\u884C\u4E2D";
  }
  const first = getFirstProcess(processes);
  const elapsed = first ? formatElapsed(first.startTime, now) : null;
  const command = first?.command ? ` \xB7 ${truncateText2(first.command, 24)}` : "";
  return `${processes.size} \u4E2A\u8FD0\u884C\u4E2D${command}${elapsed ? ` \xB7 ${elapsed}` : ""}`;
}
function resolveRisk(rawReason, mcp) {
  if (rawReason) {
    if (/\b401\b|unauthorized|api key/i.test(rawReason)) {
      return { label: "401 \u8BA4\u8BC1", tone: "danger" };
    }
    if (/\b402\b|insufficient balance|quota|balance/i.test(rawReason)) {
      return { label: "402 \u989D\u5EA6/\u4F59\u989D", tone: "danger" };
    }
    if (/\b429\b|rate limit/i.test(rawReason)) {
      return { label: "429 \u9650\u6D41", tone: "warn" };
    }
    if (/empty response|空响应/i.test(rawReason)) {
      return { label: "\u7A7A\u54CD\u5E94", tone: "warn" };
    }
    if (/timeout|timed out|超时/i.test(rawReason)) {
      return { label: "\u8D85\u65F6", tone: "warn" };
    }
    return { label: truncateText2(rawReason, 32), tone: "danger" };
  }
  if (mcp.failed > 0) {
    return { label: "MCP \u5931\u8D25", tone: "warn" };
  }
  return { label: "\u65E0", tone: "success" };
}
function summarizeMcp(statuses) {
  let ready = 0;
  let failed = 0;
  for (const status of statuses) {
    if (status.status === "ready" && status.connected) {
      ready += 1;
    }
    if (status.status === "failed") {
      failed += 1;
    }
  }
  return { ready, failed, total: statuses.length };
}
function sumRuntimeUsage(usagePerModel) {
  const totals = {
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    cacheMissTokens: 0,
    totalReqs: 0
  };
  if (!usagePerModel) {
    return totals;
  }
  for (const usage of Object.values(usagePerModel)) {
    totals.promptTokens += numberField(usage.prompt_tokens);
    totals.completionTokens += numberField(usage.completion_tokens);
    totals.cachedTokens += extractCachedTokens(usage);
    totals.cacheMissTokens += numberField(usage.prompt_cache_miss_tokens);
    totals.totalReqs += numberField(usage.total_reqs);
  }
  return totals;
}
function extractCachedTokens(usage) {
  const promptDetails = usage.prompt_tokens_details;
  const cachedFromDetails = promptDetails && typeof promptDetails.cached_tokens === "number" ? promptDetails.cached_tokens : 0;
  return cachedFromDetails || numberField(usage.prompt_cache_hit_tokens);
}
function numberField(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function firstUsageModel(usagePerModel) {
  if (!usagePerModel) {
    return null;
  }
  return Object.keys(usagePerModel)[0] ?? null;
}
function getFirstProcess(processes) {
  if (!processes || processes.size === 0) {
    return null;
  }
  return processes.values().next().value ?? null;
}
function hasProcesses(processes) {
  return Boolean(processes && processes.size > 0);
}
function truncateText2(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}
var WIDE_MIN_COLUMNS, MEDIUM_MIN_COLUMNS;
var init_runtimeStatus = __esm({
  "src/ui/runtimeStatus.ts"() {
    "use strict";
    WIDE_MIN_COLUMNS = 118;
    MEDIUM_MIN_COLUMNS = 88;
  }
});

// src/ui/askUserQuestion.ts
function findPendingAskUserQuestion(messages, status) {
  if (status !== "waiting_for_user") {
    return null;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "tool" || message.visible === false) {
      continue;
    }
    const questions = parseAskUserQuestionContent(message.content);
    if (questions.length === 0) {
      continue;
    }
    return {
      messageId: message.id,
      sessionId: message.sessionId,
      questions
    };
  }
  return null;
}
function formatAskUserQuestionAnswers(answers) {
  const answersText = Object.entries(answers).map(([question, answer]) => `"${escapeAnswerPart(question)}"="${escapeAnswerPart(answer)}"`).join(", ");
  return `User has answered your questions: ${answersText}. You can now continue with the user's answers in mind.`;
}
function parseAskUserQuestionContent(content) {
  if (!content) {
    return [];
  }
  try {
    const parsed = JSON.parse(content);
    if (parsed.awaitUserResponse !== true) {
      return [];
    }
    const metadata = parsed.metadata;
    if (!metadata || metadata.kind !== "ask_user_question") {
      return [];
    }
    return normalizeQuestions(metadata.questions);
  } catch {
    return [];
  }
}
function normalizeQuestions(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const questions = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const question = typeof item.question === "string" ? item.question.trim() : "";
    const rawOptions = item.options;
    if (!question || !Array.isArray(rawOptions) || rawOptions.length === 0) {
      continue;
    }
    const options = rawOptions.map((option) => normalizeOption(option)).filter((option) => Boolean(option));
    if (options.length === 0) {
      continue;
    }
    const multiSelect = typeof item.multiSelect === "boolean" ? item.multiSelect : void 0;
    questions.push({ question, multiSelect, options });
  }
  return questions;
}
function normalizeOption(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (!label) {
    return null;
  }
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  return {
    label,
    description: description || void 0
  };
}
function escapeAnswerPart(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s+/g, " ").trim();
}
var init_askUserQuestion = __esm({
  "src/ui/askUserQuestion.ts"() {
    "use strict";
  }
});

// src/ui/exitSummary.ts
import chalk4 from "chalk";
import gradientString from "gradient-string";
function visibleLength(text) {
  return text.replace(ANSI_RE, "").length;
}
function padRight(text, width) {
  const padding = Math.max(0, width - visibleLength(text));
  return text + " ".repeat(padding);
}
function padLeft(text, width) {
  const padding = Math.max(0, width - visibleLength(text));
  return " ".repeat(padding) + text;
}
function formatNumber(n) {
  return n.toLocaleString("en-US");
}
function extractUsageFields(usage) {
  const empty = {
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    totalReqs: 0
  };
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return empty;
  }
  const record = usage;
  const promptTokens = typeof record.prompt_tokens === "number" ? record.prompt_tokens : 0;
  const completionTokens = typeof record.completion_tokens === "number" ? record.completion_tokens : 0;
  let cachedTokens = 0;
  const promptDetails = record.prompt_tokens_details;
  if (promptDetails && typeof promptDetails === "object" && !Array.isArray(promptDetails)) {
    const cached = promptDetails.cached_tokens;
    if (typeof cached === "number") {
      cachedTokens = cached;
    }
  }
  if (cachedTokens === 0 && typeof record.prompt_cache_hit_tokens === "number") {
    cachedTokens = record.prompt_cache_hit_tokens;
  }
  const totalReqs = typeof record.total_reqs === "number" ? record.total_reqs : 0;
  return { promptTokens, completionTokens, cachedTokens, totalReqs };
}
function buildExitSummaryText(input) {
  const { session } = input;
  const innerWidth = 98;
  const contentWidth = innerWidth - 4;
  const borderColor = chalk4.hex("#229ac3e6");
  const titleColor = gradientString("#229ac3e6", "rgb(125 51 247 / 0.7)");
  const line = (text) => `${borderColor("\u2502")}  ${padRight(text, contentWidth)}  ${borderColor("\u2502")}`;
  const header = chalk4.bold(titleColor("Goodbye!"));
  const rows = ["", `${header}`, ""];
  const usageRows = Object.entries(session?.usagePerModel ?? {}).map(([modelName, usage]) => ({
    modelName,
    usage: extractUsageFields(usage)
  })).filter(
    (row) => row.usage.totalReqs > 0 || row.usage.promptTokens > 0 || row.usage.completionTokens > 0 || row.usage.cachedTokens > 0
  ).sort(
    (left, right) => right.usage.totalReqs - left.usage.totalReqs || left.modelName.localeCompare(right.modelName)
  );
  const hasUsage = usageRows.length > 0;
  if (hasUsage) {
    const colModel = 34;
    const colReqs = 8;
    const colInput = 16;
    const colOutput = 16;
    const colCached = 18;
    const tableWidth = colModel + colReqs + colInput + colOutput + colCached;
    const divider = "\u2500".repeat(tableWidth);
    const headerRow = padRight("Model Usage", colModel) + padLeft("Reqs", colReqs) + padLeft("Input Tokens", colInput) + padLeft("Output Tokens", colOutput) + padLeft("Cached Tokens", colCached);
    rows.push(chalk4.bold(headerRow));
    rows.push(divider);
    for (const { modelName, usage } of usageRows) {
      const reqsStr = formatNumber(usage.totalReqs).padStart(colReqs);
      const inputStr = formatNumber(usage.promptTokens).padStart(colInput);
      const outputStr = formatNumber(usage.completionTokens).padStart(colOutput);
      const cachedStr = formatNumber(usage.cachedTokens).padStart(colCached);
      const dataRow = padRight(modelName, colModel) + padRight(reqsStr, colReqs) + padRight(chalk4.yellow(inputStr), colInput) + padRight(chalk4.yellow(outputStr), colOutput) + padRight(chalk4.yellow(cachedStr), colCached);
      rows.push(dataRow);
    }
    rows.push("");
  }
  rows.push("");
  const border = borderColor("\u2500".repeat(innerWidth));
  const top = `${borderColor("\u256D")}${border}${borderColor("\u256E")}`;
  const bottom = `${borderColor("\u2570")}${border}${borderColor("\u256F")}`;
  const body = rows.map((row) => line(row)).join("\n");
  return [top, body, bottom].join("\n");
}
var ANSI_RE;
var init_exitSummary = __esm({
  "src/ui/exitSummary.ts"() {
    "use strict";
    ANSI_RE = /\u001b\[[0-9;]*[a-zA-Z]/g;
  }
});

// src/lima/agent-task-types.ts
import { z as z5 } from "zod";
function validateLiMaAgentTaskRequest(value) {
  const parsed = taskRequestSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: formatValidationError("LiMa agent task request", parsed.error) };
  }
  return { ok: true, value: parsed.data };
}
function formatValidationError(label, error) {
  const issue = error.issues[0];
  if (!issue) {
    return `${label} is invalid.`;
  }
  const path31 = issue.path.length > 0 ? issue.path.join(".") : "payload";
  return `${label} is invalid at ${path31}: ${issue.message}`;
}
var LIMA_AGENT_TASK_MODES, LIMA_AGENT_TASK_STATUSES, taskRequestSchema, taskTestResultSchema, taskResultSchema;
var init_agent_task_types = __esm({
  "src/lima/agent-task-types.ts"() {
    "use strict";
    LIMA_AGENT_TASK_MODES = ["plan", "patch", "test", "review", "ship"];
    LIMA_AGENT_TASK_STATUSES = [
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
      "quarantined"
    ];
    taskRequestSchema = z5.object({
      task_id: z5.string().trim().min(1),
      repo: z5.string().trim().min(1),
      branch: z5.string().trim().min(1),
      goal: z5.string().trim().min(1),
      constraints: z5.array(z5.string()),
      allowed_tools: z5.array(z5.string().trim().min(1)),
      max_runtime_sec: z5.number().int().positive(),
      mode: z5.enum(LIMA_AGENT_TASK_MODES),
      worker_id: z5.string().optional(),
      lease_expires_at: z5.number().nonnegative().optional(),
      cancel_requested: z5.boolean().optional(),
      failure_count: z5.number().int().nonnegative().optional(),
      patch_files: z5.array(
        z5.object({
          file_path: z5.string().trim().min(1),
          content: z5.string()
        })
      ).optional(),
      test_commands: z5.array(z5.string().trim().min(1)).optional(),
      prompt_contract: z5.object({
        context: z5.string(),
        task: z5.string(),
        constraints: z5.array(z5.string()),
        verify: z5.array(z5.string()),
        output: z5.string()
      }).optional()
    });
    taskTestResultSchema = z5.object({
      command: z5.string().trim().min(1),
      exit_code: z5.number().int().nullable(),
      duration_ms: z5.number().int().nonnegative().optional(),
      stdout: z5.string().optional(),
      stderr: z5.string().optional()
    });
    taskResultSchema = z5.object({
      task_id: z5.string().trim().min(1),
      status: z5.enum(LIMA_AGENT_TASK_STATUSES),
      summary: z5.string(),
      changed_files: z5.array(z5.string()),
      test_commands: z5.array(z5.string()),
      test_results: z5.array(taskTestResultSchema),
      diff_preview: z5.string(),
      artifacts: z5.array(z5.string()),
      risks: z5.array(z5.string()),
      next_action: z5.string()
    });
  }
});

// src/lima/agent-task-client.ts
var agent_task_client_exports = {};
__export(agent_task_client_exports, {
  LiMaAgentTaskClient: () => LiMaAgentTaskClient
});
function normalizeServerUrl(value) {
  const trimmed = value.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}
function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
var LiMaAgentTaskClient;
var init_agent_task_client = __esm({
  "src/lima/agent-task-client.ts"() {
    "use strict";
    init_agent_task_types();
    LiMaAgentTaskClient = class {
      serverUrl;
      apiKey;
      fetchImpl;
      constructor(config = {}) {
        this.serverUrl = normalizeServerUrl(config.serverUrl ?? process.env.LIMA_CODE_SERVER_URL ?? "");
        this.apiKey = (config.apiKey ?? process.env.LIMA_CODE_API_KEY ?? "").trim();
        this.fetchImpl = config.fetch ?? fetch;
      }
      isConfigured() {
        return Boolean(this.serverUrl && this.apiKey);
      }
      async fetchTask(taskId) {
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
        const payload = await response.value.json();
        const task = isRecord(payload) && "task" in payload ? payload.task : payload;
        const parsed = validateLiMaAgentTaskRequest(task);
        if (!parsed.ok) {
          return parsed;
        }
        return { ok: true, value: parsed.value };
      }
      async fetchPendingTask() {
        const ready = this.requireConfig();
        if (!ready.ok) {
          return ready;
        }
        const response = await this.request("/agent/tasks?status=accepted&limit=1");
        if (!response.ok) {
          return response;
        }
        const payload = await response.value.json();
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
      async submitResult(result) {
        const ready = this.requireConfig();
        if (!ready.ok) {
          return ready;
        }
        const response = await this.request(`/agent/tasks/${encodeURIComponent(result.task_id)}/result`, {
          method: "POST",
          body: JSON.stringify(result)
        });
        if (!response.ok) {
          return response;
        }
        return { ok: true, value: { accepted: true } };
      }
      async fetchTaskEvents(taskId) {
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
        const payload = await response.value.json();
        return { ok: true, value: Array.isArray(payload.events) ? payload.events : [] };
      }
      async quarantineTask(taskId) {
        const ready = this.requireConfig();
        if (!ready.ok) {
          return ready;
        }
        const id = taskId.trim();
        if (!id) {
          return { ok: false, error: "LiMa task id is required." };
        }
        const response = await this.request(`/agent/tasks/${encodeURIComponent(id)}/quarantine`, {
          method: "POST"
        });
        if (!response.ok) {
          return response;
        }
        return { ok: true, value: { status: "quarantined" } };
      }
      requireConfig() {
        if (!this.serverUrl) {
          return { ok: false, error: "LIMA_CODE_SERVER_URL or lima.serverUrl is required." };
        }
        if (!this.apiKey) {
          return { ok: false, error: "LIMA_CODE_API_KEY or lima.apiKey is required." };
        }
        return { ok: true };
      }
      async request(path31, init = {}) {
        try {
          const response = await this.fetchImpl(`${this.serverUrl}${path31}`, {
            ...init,
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              "Content-Type": "application/json",
              ...init.headers ?? {}
            }
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
    };
  }
});

// src/lima/result-builder.ts
function buildLiMaTaskResult(task, input) {
  return {
    task_id: task.task_id,
    status: input.status,
    summary: truncateText3(input.summary),
    changed_files: input.changedFiles ?? [],
    test_commands: input.testCommands ?? [],
    test_results: input.testResults ?? [],
    diff_preview: truncateText3(input.diffPreview ?? ""),
    artifacts: input.artifacts ?? [],
    risks: input.risks ?? [],
    next_action: input.nextAction ?? ""
  };
}
function parseChangedFilesFromGitNameOnly(output) {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
function truncateText3(value, maxChars = MAX_TEXT_CHARS) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}
[truncated ${value.length - maxChars} chars]`;
}
var MAX_TEXT_CHARS;
var init_result_builder = __esm({
  "src/lima/result-builder.ts"() {
    "use strict";
    MAX_TEXT_CHARS = 4e3;
  }
});

// src/lima/evidence.ts
function buildLiMaEvidenceBundle(result) {
  return {
    task_id: result.task_id,
    status: result.status,
    summary: redactSecrets(truncateText3(result.summary)),
    changed_files: result.changed_files,
    test_commands: result.test_commands,
    test_results: result.test_results.map((testResult) => ({
      ...testResult,
      stdout: testResult.stdout ? redactSecrets(truncateText3(testResult.stdout)) : void 0,
      stderr: testResult.stderr ? redactSecrets(truncateText3(testResult.stderr)) : void 0
    })),
    diff_preview: redactSecrets(truncateText3(result.diff_preview)),
    risks: result.risks.map((risk) => redactSecrets(truncateText3(risk))),
    next_action: redactSecrets(truncateText3(result.next_action))
  };
}
function redactSecrets(value) {
  return SECRET_PATTERNS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);
}
var SECRET_PATTERNS;
var init_evidence = __esm({
  "src/lima/evidence.ts"() {
    "use strict";
    init_result_builder();
    SECRET_PATTERNS = [
      [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]"],
      [/\bghp_[A-Za-z0-9]{36}\b/g, "ghp_[REDACTED]"],
      [/\bgho_[A-Za-z0-9]{36}\b/g, "gho_[REDACTED]"],
      [/\bAKIA[A-Z0-9]{16}\b/g, "AKIA[REDACTED]"],
      [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "eyJ...[REDACTED]"],
      [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer [REDACTED]"],
      [/\b(api[_-]?key|token|password|secret|credential)=([^\s&]+)/gi, "$1=[REDACTED]"],
      [/"(api[_-]?key|token|password|secret|credential)"\s*:\s*"[^"]+"/gi, '"$1":"[REDACTED]"'],
      [/-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g, "[PRIVATE_KEY_REDACTED]"],
      [/mongodb(\+srv)?:\/\/[^\s"']+/gi, "mongodb://[REDACTED]"],
      [/postgres(ql)?:\/\/[^\s"']+/gi, "postgres://[REDACTED]"],
      [/mysql:\/\/[^\s"']+/gi, "mysql://[REDACTED]"],
      [/redis:\/\/[^\s"']+/gi, "redis://[REDACTED]"]
    ];
  }
});

// src/lima/audit-log.ts
import * as fs14 from "fs";
import * as path15 from "path";
function getLiMaAuditLogPath(projectRoot2) {
  return path15.join(projectRoot2, ".lima-code", "audit.jsonl");
}
function appendLiMaAuditEntry(projectRoot2, task, result, now = /* @__PURE__ */ new Date()) {
  const evidence = buildLiMaEvidenceBundle(result);
  const entry = {
    timestamp: now.toISOString(),
    task_id: task.task_id,
    mode: task.mode,
    status: result.status,
    repo: task.repo,
    changed_files: evidence.changed_files,
    test_commands: evidence.test_commands,
    summary: evidence.summary
  };
  const auditPath = getLiMaAuditLogPath(projectRoot2);
  fs14.mkdirSync(path15.dirname(auditPath), { recursive: true });
  fs14.appendFileSync(auditPath, `${JSON.stringify(entry)}
`, "utf8");
  return entry;
}
var init_audit_log = __esm({
  "src/lima/audit-log.ts"() {
    "use strict";
    init_evidence();
  }
});

// src/lima/audit-reader.ts
import * as fs15 from "fs";
import * as path16 from "path";
function readRecentAuditEntries(projectRoot2, limit = 10) {
  const file = path16.join(projectRoot2, ".lima-code", "audit.jsonl");
  if (!fs15.existsSync(file)) {
    return [];
  }
  return fs15.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => safeParse(line)).filter((entry) => Boolean(entry)).map(normalizeEntry).sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))).slice(0, limit);
}
function formatAuditSummary(entries) {
  if (entries.length === 0) {
    return "No LiMa audit entries found.";
  }
  return entries.map(
    (entry) => [
      entry.created_at ?? "unknown",
      entry.task_id ?? "unknown",
      entry.status ?? "unknown",
      entry.mode ?? "",
      entry.repo ?? ""
    ].filter(Boolean).join(" ")
  ).join("\n");
}
function safeParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
function normalizeEntry(entry) {
  return {
    ...entry,
    created_at: entry.created_at ?? entry.timestamp
  };
}
var init_audit_reader = __esm({
  "src/lima/audit-reader.ts"() {
    "use strict";
  }
});

// src/lima/commands.ts
function parseLiMaCommand(input) {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts[0] !== "/lima") {
    return { ok: false, error: "LiMa \u547D\u4EE4\u5FC5\u987B\u4EE5 /lima \u5F00\u5934\u3002" };
  }
  const subcommand = parts[1] ?? "";
  if (subcommand === "connect") {
    return { ok: true, command: { kind: "connect" } };
  }
  if (subcommand === "status") {
    return { ok: true, command: { kind: "status" } };
  }
  if (subcommand === "start") {
    return { ok: true, command: { kind: "start" } };
  }
  if (subcommand === "doctor") {
    return { ok: true, command: { kind: "doctor" } };
  }
  if (subcommand === "vibe") {
    return { ok: true, command: { kind: "vibe" } };
  }
  if (subcommand === "next") {
    return { ok: true, command: { kind: "next" } };
  }
  if (subcommand === "plan") {
    return { ok: true, command: { kind: "plan" } };
  }
  if (subcommand === "test") {
    return { ok: true, command: { kind: "test", command: readRestCommand(parts.slice(2), "npm test") } };
  }
  if (subcommand === "fix") {
    return { ok: true, command: { kind: "fix" } };
  }
  if (subcommand === "ship") {
    return { ok: true, command: { kind: "ship" } };
  }
  if (subcommand === "audit") {
    const limit = readPositiveInt(parts.slice(2), "--last", 10);
    if (!limit.ok) {
      return limit;
    }
    return { ok: true, command: { kind: "audit", limit: limit.value } };
  }
  if (subcommand === "daemon") {
    return parseDaemonCommand(parts.slice(2));
  }
  if (subcommand === "work") {
    return parseWorkCommand(parts.slice(2));
  }
  if (subcommand === "review") {
    return { ok: true, command: { kind: "review" } };
  }
  if (subcommand === "probe") {
    const json = parts.includes("--json");
    return { ok: true, command: { kind: "probe", json } };
  }
  if (subcommand === "drone") {
    return parseDroneCommand(parts.slice(2));
  }
  if (subcommand === "task") {
    const taskId = parts[2] ?? "";
    if (!taskId) {
      return { ok: false, error: "\u7528\u6CD5: /lima task <task_id>" };
    }
    return { ok: true, command: { kind: "task", taskId } };
  }
  return { ok: false, error: usageText() };
}
function formatLiMaCommandHelp() {
  return [
    "/lima connect",
    "/lima status",
    "/lima start",
    "/lima doctor",
    "/lima vibe",
    "/lima plan",
    "/lima test [--cmd <command>]",
    "/lima fix",
    "/lima next",
    "/lima probe [--json]",
    "/lima drone [--max-tasks <n>] [--max-minutes <n>] [--risk]",
    "/lima audit [--last <n>]",
    "/lima daemon status",
    "/lima daemon stop",
    "/lima daemon start [--max-minutes <n>] [--interval-ms <ms>] [--backoff-ms <ms>]  (requires LIMA_CODE_WORKER_DAEMON=1)",
    "/lima work --once",
    "/lima work --loop --max-tasks <n> [--max-minutes <n>] [--interval-ms <ms>] [--backoff-ms <ms>]",
    "/lima task <task_id>",
    "/lima review",
    "/lima ship"
  ].join("\n");
}
function parseDaemonCommand(args2) {
  const action = args2[0] ?? "";
  if (action === "status" || action === "stop") {
    return { ok: true, command: { kind: "daemon", action } };
  }
  if (action === "start") {
    const maxMinutes = readPositiveInt(args2, "--max-minutes", 480);
    if (!maxMinutes.ok) {
      return maxMinutes;
    }
    const intervalMs = readPositiveInt(args2, "--interval-ms", 15e3);
    if (!intervalMs.ok) {
      return intervalMs;
    }
    const backoffMs = readPositiveInt(args2, "--backoff-ms", 3e4);
    if (!backoffMs.ok) {
      return backoffMs;
    }
    return {
      ok: true,
      command: {
        kind: "daemon",
        action: "start",
        maxMinutes: maxMinutes.value,
        intervalMs: intervalMs.value,
        backoffMs: backoffMs.value
      }
    };
  }
  return { ok: false, error: "\u7528\u6CD5: /lima daemon status | stop | start [--max-minutes <n>]" };
}
function parseWorkCommand(args2) {
  const mode = args2.includes("--loop") ? "loop" : "once";
  const maxTasks = readPositiveInt(args2, "--max-tasks", mode === "once" ? 1 : null);
  if (!maxTasks.ok) {
    return maxTasks;
  }
  if (mode === "loop" && !args2.includes("--max-tasks")) {
    return { ok: false, error: "\u7528\u6CD5: /lima work --loop \u9700\u8981 --max-tasks <n>\u3002" };
  }
  const maxMinutes = readPositiveInt(args2, "--max-minutes", 60);
  if (!maxMinutes.ok) {
    return maxMinutes;
  }
  const intervalMs = readPositiveInt(args2, "--interval-ms", 5e3);
  if (!intervalMs.ok) {
    return intervalMs;
  }
  const backoffMs = readPositiveInt(args2, "--backoff-ms", 3e4);
  if (!backoffMs.ok) {
    return backoffMs;
  }
  if (maxTasks.value > 100) {
    return { ok: false, error: "\u7528\u6CD5: /lima work --max-tasks \u5FC5\u987B\u5C0F\u4E8E\u6216\u7B49\u4E8E 100\u3002" };
  }
  return {
    ok: true,
    command: {
      kind: "work",
      mode,
      maxTasks: maxTasks.value,
      maxMinutes: maxMinutes.value,
      intervalMs: intervalMs.value,
      backoffMs: backoffMs.value
    }
  };
}
function parseDroneCommand(args2) {
  const maxTasks = readPositiveInt(args2, "--max-tasks", 10);
  if (!maxTasks.ok) return maxTasks;
  const maxMinutes = readPositiveInt(args2, "--max-minutes", 60);
  if (!maxMinutes.ok) return maxMinutes;
  const intervalMs = readPositiveInt(args2, "--interval-ms", 2e3);
  if (!intervalMs.ok) return intervalMs;
  const allowMediumRisk = args2.includes("--risk");
  if (maxTasks.value > 50) {
    return { ok: false, error: "\u7528\u6CD5: /lima drone --max-tasks \u5FC5\u987B\u5C0F\u4E8E\u6216\u7B49\u4E8E 50\u3002" };
  }
  return {
    ok: true,
    command: {
      kind: "drone",
      maxTasks: maxTasks.value,
      maxMinutes: maxMinutes.value,
      allowMediumRisk,
      intervalMs: intervalMs.value
    }
  };
}
function readPositiveInt(args2, name, defaultValue) {
  const index = args2.indexOf(name);
  if (index < 0) {
    if (defaultValue === null) {
      return { ok: false, error: `\u7528\u6CD5: ${name} <n> \u4E3A\u5FC5\u586B\u3002` };
    }
    return { ok: true, value: defaultValue };
  }
  const raw = args2[index + 1] ?? "";
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, error: `\u7528\u6CD5: ${name} \u5FC5\u987B\u662F\u6B63\u6574\u6570\u3002` };
  }
  return { ok: true, value };
}
function readRestCommand(args2, defaultValue) {
  const index = args2.indexOf("--cmd");
  if (index < 0) {
    return defaultValue;
  }
  const command = args2.slice(index + 1).join(" ").trim();
  return command || defaultValue;
}
function usageText() {
  return "\u7528\u6CD5: /lima connect | /lima status | /lima start | /lima vibe | /lima doctor | /lima plan | /lima test [--cmd <command>] | /lima next | /lima probe [--json] | /lima drone [--max-tasks <n>] [--risk] | /lima audit [--last <n>] | /lima daemon status | /lima daemon stop | /lima work --once | /lima work --loop --max-tasks <n> [--max-minutes <n>] | /lima task <task_id> | /lima review | /lima ship";
}
var init_commands = __esm({
  "src/lima/commands.ts"() {
    "use strict";
  }
});

// src/lima/telegram-notifier.ts
function readLiMaTelegramConfig(env = process.env) {
  const botToken = (env.LIMA_CODE_TELEGRAM_BOT_TOKEN ?? "").trim();
  const chatId = (env.LIMA_CODE_TELEGRAM_CHAT_ID ?? "").trim();
  const proxyUrl = (env.LIMA_CODE_TELEGRAM_PROXY ?? "").trim();
  const b2bRaw = (env.LIMA_CODE_TELEGRAM_B2B ?? "").trim().toLowerCase();
  const serverBotUsername = (env.LIMA_SERVER_BOT_USERNAME ?? "").trim().replace(/^@/, "");
  const b2bEnabled = b2bRaw === "1" || b2bRaw === "true" || b2bRaw === "yes" || b2bRaw === "on";
  const configured = Boolean(botToken && (chatId || b2bEnabled && serverBotUsername));
  return {
    configured,
    botToken,
    chatId,
    proxyUrl,
    b2bEnabled,
    serverBotUsername
  };
}
function redactTelegramText(value) {
  let text = value;
  for (const [pattern, replacement] of SECRET_PATTERNS2) {
    text = text.replace(pattern, replacement);
  }
  return text;
}
function formatLiMaTelegramEvent(event) {
  const lines = [`LiMa Code ${event.type}`];
  if (event.taskId) {
    lines.push(`\u4EFB\u52A1: ${event.taskId}`);
  }
  if (event.status) {
    lines.push(`\u72B6\u6001: ${event.status}`);
  }
  lines.push(event.summary);
  if (event.changedFiles && event.changedFiles.length > 0) {
    lines.push(`\u6587\u4EF6: ${event.changedFiles.slice(0, 10).join(", ")}`);
  }
  return redactTelegramText(lines.join("\n"));
}
function formatLiMaB2BPayload(event) {
  const payload = {
    v: 1,
    type: event.type,
    task_id: event.taskId ?? "",
    status: event.status ?? "",
    summary: redactTelegramText(event.summary),
    changed_files: event.changedFiles?.slice(0, 20) ?? []
  };
  return B2B_PREFIX + JSON.stringify(payload);
}
function resolveTelegramTarget(config, event) {
  if (config.b2bEnabled && config.serverBotUsername) {
    return {
      chatId: `@${config.serverBotUsername}`,
      text: formatLiMaB2BPayload(event)
    };
  }
  return { chatId: config.chatId, text: formatLiMaTelegramEvent(event) };
}
async function sendLiMaTelegramEvent(event, options = {}) {
  const config = options.config ?? readLiMaTelegramConfig();
  if (!config.configured) {
    return false;
  }
  const target = resolveTelegramTarget(config, event);
  const fetchImpl = options.fetch ?? fetch;
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: target.chatId,
      text: target.text
    })
  };
  if (config.proxyUrl && !options.fetch) {
    const { ProxyAgent } = await import("undici");
    const proxiedInit = init;
    proxiedInit.dispatcher = new ProxyAgent(config.proxyUrl);
  }
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${config.botToken}/sendMessage`, init);
    return response.ok;
  } catch {
    return false;
  }
}
var SECRET_PATTERNS2, B2B_PREFIX;
var init_telegram_notifier = __esm({
  "src/lima/telegram-notifier.ts"() {
    "use strict";
    SECRET_PATTERNS2 = [
      [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, "$1***"],
      [/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "***"],
      [/\b(gh[pousr]_[A-Za-z0-9_]{12,})\b/g, "***"],
      [/\b(cfut_[A-Za-z0-9._~+/=-]{8,})\b/g, "***"],
      [/\b(api[_-]?key|token|secret|password)=([^\s&]+)/gi, "$1=***"]
    ];
    B2B_PREFIX = "LIMA_B2B\n";
  }
});

// src/lima/worker-control.ts
import * as fs16 from "fs";
import * as path17 from "path";
function requestWorkerStop(projectRoot2, reason = "user_requested") {
  const file = stopMarkerPath(projectRoot2);
  fs16.mkdirSync(path17.dirname(file), { recursive: true });
  fs16.writeFileSync(file, JSON.stringify({ reason, requested_at: (/* @__PURE__ */ new Date()).toISOString() }, null, 2), "utf8");
  return file;
}
function readWorkerStop(projectRoot2) {
  const file = stopMarkerPath(projectRoot2);
  if (!fs16.existsSync(file)) {
    return { stop: false, reason: "" };
  }
  try {
    const parsed = JSON.parse(fs16.readFileSync(file, "utf8"));
    return { stop: true, reason: parsed.reason ?? "user_requested" };
  } catch {
    return { stop: true, reason: "unreadable_stop_marker" };
  }
}
function stopMarkerPath(projectRoot2) {
  return path17.join(projectRoot2, ".lima-code", "worker.stop.json");
}
var init_worker_control = __esm({
  "src/lima/worker-control.ts"() {
    "use strict";
  }
});

// src/lima/doctor.ts
import * as fs17 from "fs";
import * as path18 from "path";
async function runLiMaDoctor(options) {
  const checks = [];
  checks.push(checkProjectRoot(options.projectRoot));
  const configured = options.client.isConfigured();
  checks.push({
    name: "server_config",
    status: configured ? "pass" : "fail",
    detail: configured ? "LiMa Server URL \u548C API key \u5DF2\u914D\u7F6E\u3002" : "\u8BF7\u8BBE\u7F6E LIMA_CODE_SERVER_URL \u548C LIMA_CODE_API_KEY\u3002"
  });
  if (configured) {
    checks.push(await checkServerReachable(options.client));
  } else {
    checks.push({
      name: "server_reachable",
      status: "skip",
      detail: "\u5DF2\u8DF3\u8FC7\uFF1ALiMa Server \u914D\u7F6E\u7F3A\u5931\u3002"
    });
  }
  checks.push(checkWorkerStop(options.projectRoot));
  checks.push(checkTelegram(options.env));
  checks.push(checkSkillRules(options.projectRoot));
  checks.push(checkAuditLog(options.projectRoot));
  return {
    ok: !checks.some((check) => check.status === "fail"),
    checks
  };
}
function formatLiMaDoctorReport(report) {
  const lines = [`LiMa doctor\uFF1A${report.ok ? "\u5C31\u7EEA" : "\u9700\u8981\u5904\u7406"}`];
  for (const check of report.checks) {
    lines.push(`[${formatDoctorStatus(check.status)}] ${formatDoctorCheckName(check.name)}: ${check.detail}`);
  }
  return redactTelegramText(lines.join("\n"));
}
function formatDoctorStatus(status) {
  switch (status) {
    case "pass":
      return "\u901A\u8FC7";
    case "warn":
      return "\u8B66\u544A";
    case "fail":
      return "\u5931\u8D25";
    case "skip":
      return "\u8DF3\u8FC7";
  }
}
function formatDoctorCheckName(name) {
  const labels = {
    project_root: "\u9879\u76EE\u76EE\u5F55",
    server_config: "\u670D\u52A1\u914D\u7F6E",
    server_reachable: "\u670D\u52A1\u8FDE\u901A",
    worker_stop: "\u505C\u6B62\u6807\u8BB0",
    telegram_outbound: "Telegram \u901A\u77E5",
    project_skill_rules: "\u9879\u76EE\u6280\u80FD\u89C4\u5219",
    audit_log: "\u672C\u5730\u5BA1\u8BA1\u65E5\u5FD7"
  };
  return labels[name] ?? name;
}
function checkProjectRoot(projectRoot2) {
  try {
    const stat = fs17.statSync(projectRoot2);
    return stat.isDirectory() ? { name: "project_root", status: "pass", detail: projectRoot2 } : { name: "project_root", status: "fail", detail: `${projectRoot2} \u4E0D\u662F\u76EE\u5F55\u3002` };
  } catch {
    return { name: "project_root", status: "fail", detail: `${projectRoot2} \u4E0D\u5B58\u5728\u3002` };
  }
}
async function checkServerReachable(client) {
  const pending = await client.fetchPendingTask();
  if (!pending.ok) {
    return { name: "server_reachable", status: "fail", detail: pending.error };
  }
  return {
    name: "server_reachable",
    status: "pass",
    detail: pending.value ? `\u53EF\u89C1\u5F85\u5904\u7406\u4EFB\u52A1: ${pending.value.task_id}` : "pending-task \u63A5\u53E3\u53EF\u8BBF\u95EE\u3002"
  };
}
function checkWorkerStop(projectRoot2) {
  const stop = readWorkerStop(projectRoot2);
  if (stop.stop) {
    return {
      name: "worker_stop",
      status: "fail",
      detail: `\u5B58\u5728 worker \u505C\u6B62\u6807\u8BB0: ${stop.reason}`
    };
  }
  return { name: "worker_stop", status: "pass", detail: "\u6CA1\u6709\u5F85\u5904\u7406\u7684 worker \u505C\u6B62\u6807\u8BB0\u3002" };
}
function checkTelegram(env) {
  const config = readLiMaTelegramConfig(env);
  return config.configured ? { name: "telegram_outbound", status: "pass", detail: "Telegram \u51FA\u7AD9\u901A\u77E5\u914D\u7F6E\u5DF2\u5B58\u5728\u3002" } : { name: "telegram_outbound", status: "warn", detail: "Telegram \u51FA\u7AD9\u901A\u77E5\u672A\u914D\u7F6E\uFF08\u53EF\u9009\uFF09\u3002" };
}
function checkSkillRules(projectRoot2) {
  const file = path18.join(projectRoot2, ".lima-code", "skill-rules.json");
  return fs17.existsSync(file) ? { name: "project_skill_rules", status: "pass", detail: ".lima-code/skill-rules.json \u5DF2\u5B58\u5728\u3002" } : { name: "project_skill_rules", status: "warn", detail: "\u672A\u627E\u5230\u9879\u76EE skill rules \u6587\u4EF6\u3002" };
}
function checkAuditLog(projectRoot2) {
  const file = path18.join(projectRoot2, ".lima-code", "audit.jsonl");
  return fs17.existsSync(file) ? { name: "audit_log", status: "pass", detail: ".lima-code/audit.jsonl \u5DF2\u5B58\u5728\u3002" } : { name: "audit_log", status: "warn", detail: "\u8FD8\u6CA1\u6709\u672C\u5730 LiMa \u5BA1\u8BA1\u65E5\u5FD7\u3002" };
}
var init_doctor = __esm({
  "src/lima/doctor.ts"() {
    "use strict";
    init_telegram_notifier();
    init_worker_control();
  }
});

// src/lima/failure-quarantine.ts
import * as fs18 from "fs";
import * as path19 from "path";
function recordTaskFailure(projectRoot2, taskId, error) {
  const state = readState(projectRoot2);
  const previous = state[taskId];
  const record = {
    task_id: taskId,
    failure_count: (previous?.failure_count ?? 0) + 1,
    last_error: error,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  state[taskId] = record;
  writeState(projectRoot2, state);
  return record;
}
function shouldQuarantineTask(projectRoot2, taskId, threshold = 3) {
  const record = readState(projectRoot2)[taskId];
  const failureCount = record?.failure_count ?? 0;
  return {
    quarantine: failureCount >= threshold,
    failureCount,
    reason: record?.last_error ?? ""
  };
}
function quarantinePath(projectRoot2) {
  return path19.join(projectRoot2, ".lima-code", "quarantine.json");
}
function readState(projectRoot2) {
  const file = quarantinePath(projectRoot2);
  if (!fs18.existsSync(file)) {
    return {};
  }
  try {
    return JSON.parse(fs18.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}
function writeState(projectRoot2, state) {
  const file = quarantinePath(projectRoot2);
  fs18.mkdirSync(path19.dirname(file), { recursive: true });
  fs18.writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
}
var init_failure_quarantine = __esm({
  "src/lima/failure-quarantine.ts"() {
    "use strict";
  }
});

// src/lima/prompt-contract.ts
function checkLen(value, maxLen, label) {
  if (value.length > maxLen) {
    throw new Error(`${label} exceeds max length ${maxLen}`);
  }
}
function checkStrList(items, label, itemMax, countMax) {
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
function outputHintForMode(mode) {
  if (mode === "plan") {
    return "Return needs_review with plan artifact paths and summary JSON: changed_files, tests_run, remaining_risks, review_status.";
  }
  if (mode === "review") {
    return "Return needs_review with diff review findings and summary JSON: changed_files, tests_run, remaining_risks, review_status.";
  }
  if (mode === "test") {
    return "Return succeeded or failed with test evidence and summary JSON: changed_files, tests_run, remaining_risks, review_status.";
  }
  return DEFAULT_PROMPT_OUTPUT;
}
function parsePromptContract(raw) {
  if (!raw) {
    return { context: "", task: "", constraints: [], verify: [], output: "" };
  }
  if (typeof raw !== "object" || raw === null) {
    throw new Error("prompt_contract must be an object");
  }
  const obj = raw;
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
    output
  };
}
function migrateFromLegacy(fields) {
  const task = fields.goal.trim();
  if (!task) {
    throw new Error("goal must not be empty");
  }
  return {
    context: "",
    task,
    constraints: [...fields.constraints ?? []],
    verify: [...fields.test_commands ?? []],
    output: outputHintForMode(fields.mode ?? "patch")
  };
}
function resolvePromptContract(fields, promptContract) {
  const migrated = migrateFromLegacy(fields);
  if (!promptContract) {
    return migrated;
  }
  if (typeof promptContract !== "object" || promptContract === null) {
    throw new Error("prompt_contract must be an object");
  }
  const obj = promptContract;
  const parsed = parsePromptContract(promptContract);
  return {
    context: "context" in obj ? parsed.context : migrated.context,
    task: parsed.task || migrated.task,
    constraints: "constraints" in obj ? parsed.constraints : migrated.constraints,
    verify: "verify" in obj ? parsed.verify : migrated.verify,
    output: parsed.output || migrated.output
  };
}
function renderPromptContract(contract) {
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
function resolveTaskPromptContract(task) {
  return resolvePromptContract(
    {
      goal: task.goal,
      constraints: task.constraints,
      test_commands: task.test_commands,
      mode: task.mode
    },
    task.prompt_contract
  );
}
var DEFAULT_PROMPT_OUTPUT, MAX_CONTEXT, MAX_TASK, MAX_CONSTRAINT_ITEM, MAX_CONSTRAINTS, MAX_VERIFY_ITEM, MAX_VERIFY, MAX_OUTPUT;
var init_prompt_contract = __esm({
  "src/lima/prompt-contract.ts"() {
    "use strict";
    DEFAULT_PROMPT_OUTPUT = "Return needs_review with summary JSON: changed_files, tests_run, remaining_risks, review_status.";
    MAX_CONTEXT = 2e3;
    MAX_TASK = 1e3;
    MAX_CONSTRAINT_ITEM = 500;
    MAX_CONSTRAINTS = 20;
    MAX_VERIFY_ITEM = 500;
    MAX_VERIFY = 10;
    MAX_OUTPUT = 1e3;
  }
});

// src/lima/lifecycle-hooks.ts
import * as fs19 from "fs";
import * as path20 from "path";
function createLiMaFilesystemLifecycleHooks(projectRoot2) {
  return {
    onTaskStart: (task, activeSkills) => writeLiMaTaskStartHook(projectRoot2, task, activeSkills),
    onTaskStop: (result) => writeLiMaTaskStopHook(projectRoot2, result)
  };
}
function writeLiMaTaskStartHook(projectRoot2, task, activeSkills) {
  const dir = taskDirectory(projectRoot2, task.task_id);
  const warnings = [];
  try {
    fs19.mkdirSync(dir, { recursive: true });
    fs19.writeFileSync(path20.join(dir, "context.md"), formatTaskContext(task, activeSkills), "utf8");
    fs19.writeFileSync(path20.join(dir, "tasks.md"), formatTaskChecklist(task, activeSkills), "utf8");
    return { ok: true, dir, warnings };
  } catch (error) {
    return { ok: false, dir, error: formatError(error), warnings };
  }
}
function writeLiMaTaskStopHook(projectRoot2, result) {
  const dir = taskDirectory(projectRoot2, result.task_id);
  const warnings = [];
  try {
    fs19.mkdirSync(dir, { recursive: true });
    fs19.writeFileSync(path20.join(dir, "summary.md"), formatTaskSummary(result), "utf8");
    fs19.writeFileSync(path20.join(dir, "touched-files.txt"), formatTouchedFiles(result.changed_files), "utf8");
    return { ok: true, dir, warnings };
  } catch (error) {
    return { ok: false, dir, error: formatError(error), warnings };
  }
}
function taskDirectory(projectRoot2, taskId) {
  return path20.join(projectRoot2, ".lima-code", "dev", "active", sanitizeTaskId(taskId));
}
function sanitizeTaskId(taskId) {
  const safe = taskId.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "task";
}
function formatTaskContext(task, activeSkills) {
  const skills = activeSkills.length > 0 ? activeSkills.map((skill) => `- ${skill.name}: ${skill.reason}`) : ["- none"];
  return [
    `# LiMa Task ${task.task_id}`,
    "",
    `- Mode: ${task.mode}`,
    `- Repo: ${task.repo}`,
    `- Branch: ${task.branch}`,
    `- Max runtime: ${task.max_runtime_sec}s`,
    "",
    "## Prompt Contract",
    "",
    renderPromptContract(resolveTaskPromptContract(task)),
    "",
    "## Allowed Tools",
    "",
    ...listOrNone(task.allowed_tools),
    "",
    "## Active Skill Candidates",
    "",
    ...skills,
    ""
  ].join("\n");
}
function formatTaskChecklist(task, activeSkills) {
  const lines = [
    `# Task ${task.task_id} Checklist`,
    "",
    "- [ ] Review task goal and constraints",
    "- [ ] Review active skill candidates"
  ];
  if (task.test_commands && task.test_commands.length > 0) {
    lines.push("- [ ] Run requested tests");
  }
  if (activeSkills.some((skill) => skill.name === "superpowers:test-driven-development")) {
    lines.push("- [ ] Preserve TDD evidence when code changes");
  }
  lines.push("- [ ] Record result summary", "- [ ] Leave remaining risks explicit", "");
  return lines.join("\n");
}
function formatTaskSummary(result) {
  return [
    `# LiMa Task ${result.task_id} Summary`,
    "",
    `- Status: ${result.status}`,
    `- Next action: ${result.next_action || "none"}`,
    "",
    "## Summary",
    "",
    result.summary || "No summary.",
    "",
    "## Changed Files",
    "",
    ...listOrNone(result.changed_files),
    "",
    "## Test Commands",
    "",
    ...listOrNone(result.test_commands),
    "",
    "## Risks",
    "",
    ...listOrNone(result.risks),
    ""
  ].join("\n");
}
function formatTouchedFiles(files) {
  return files.length > 0 ? `${files.join("\n")}
` : "";
}
function listOrNone(values) {
  return values.length > 0 ? values.map((value) => `- ${value}`) : ["- none"];
}
function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
var init_lifecycle_hooks = __esm({
  "src/lima/lifecycle-hooks.ts"() {
    "use strict";
    init_prompt_contract();
  }
});

// src/lima/skill-activation.ts
import * as fs20 from "fs";
import * as path21 from "path";
function evaluateLiMaSkillActivation(task, rules = DEFAULT_LIMA_SKILL_RULES) {
  const context = buildActivationContext(task);
  const seen = /* @__PURE__ */ new Set();
  const active = [];
  for (const rule of rules) {
    if (seen.has(rule.name) || !rule.matches(task, context)) {
      continue;
    }
    seen.add(rule.name);
    active.push({ name: rule.name, reason: rule.reason });
  }
  return active;
}
function evaluateLiMaSkillActivationForProject(task, projectRoot2) {
  return evaluateLiMaSkillActivation(task, [...DEFAULT_LIMA_SKILL_RULES, ...loadProjectSkillRules(projectRoot2)]);
}
function loadProjectSkillRules(projectRoot2) {
  const configPath = path21.join(projectRoot2, ".lima-code", "skill-rules.json");
  try {
    const raw = JSON.parse(fs20.readFileSync(configPath, "utf8"));
    if (!Array.isArray(raw.rules)) {
      return [];
    }
    return raw.rules.map((item) => buildProjectRule(item)).filter((rule) => Boolean(rule));
  } catch {
    return [];
  }
}
function buildActivationContext(task) {
  const files = (task.patch_files ?? []).map((file) => file.file_path.toLowerCase());
  const text = [
    task.mode,
    task.goal,
    ...task.constraints,
    ...task.allowed_tools,
    ...task.test_commands ?? [],
    ...files
  ].join("\n").toLowerCase();
  return { text, files };
}
function buildProjectRule(value) {
  if (!isRecord2(value) || typeof value.name !== "string" || !value.name.trim()) {
    return null;
  }
  const config = {
    name: value.name.trim(),
    reason: typeof value.reason === "string" ? value.reason : "Project skill rule matched.",
    keywords: readStringArray(value.keywords),
    files: readStringArray(value.files),
    modes: readStringArray(value.modes),
    tools: readStringArray(value.tools)
  };
  return {
    name: config.name,
    reason: config.reason ?? "Project skill rule matched.",
    matches: (task, context) => projectRuleMatches(config, task, context)
  };
}
function projectRuleMatches(config, task, context) {
  return groupMatches(config.keywords, (keyword) => context.text.includes(keyword.toLowerCase())) && groupMatches(config.files, (pattern) => context.files.some((file) => filePatternMatches(pattern, file))) && groupMatches(config.modes, (mode) => task.mode === mode) && groupMatches(config.tools, (tool) => task.allowed_tools.includes(tool));
}
function groupMatches(values, predicate) {
  if (!values || values.length === 0) {
    return true;
  }
  return values.some(predicate);
}
function filePatternMatches(pattern, file) {
  const normalizedPattern = pattern.replace(/\\/g, "/").toLowerCase();
  const normalizedFile = file.replace(/\\/g, "/").toLowerCase();
  if (!normalizedPattern.includes("*")) {
    return normalizedFile === normalizedPattern || normalizedFile.endsWith(normalizedPattern);
  }
  const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`).test(normalizedFile);
}
function readStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}
function isRecord2(value) {
  return typeof value === "object" && value !== null;
}
var DEFAULT_LIMA_SKILL_RULES;
var init_skill_activation = __esm({
  "src/lima/skill-activation.ts"() {
    "use strict";
    DEFAULT_LIMA_SKILL_RULES = [
      {
        name: "superpowers:test-driven-development",
        reason: "Patch/test task shape requires test-first discipline.",
        matches: (task, context) => task.mode === "patch" || task.mode === "test" || task.allowed_tools.includes("write") || task.allowed_tools.includes("test") || context.text.includes("test:")
      },
      {
        name: "security-review",
        reason: "Task text mentions auth, token, secret, key, permission, webhook, or Telegram.",
        matches: (_task, context) => /\b(auth|token|secret|key|permission|webhook|telegram)\b/i.test(context.text)
      },
      {
        name: "deployment-patterns",
        reason: "Task text mentions deployment, VPS, process, port, firewall, or restart concerns.",
        matches: (_task, context) => /\b(deploy|deployment|vps|pm2|systemd|docker|port|firewall|restart)\b/i.test(context.text)
      },
      {
        name: "source-command-python-review",
        reason: "Task touches Python files.",
        matches: (_task, context) => context.files.some((file) => file.endsWith(".py"))
      },
      {
        name: "source-command-go-review",
        reason: "Task touches Go files.",
        matches: (_task, context) => context.files.some((file) => file.endsWith(".go"))
      },
      {
        name: "source-command-rust-review",
        reason: "Task touches Rust files.",
        matches: (_task, context) => context.files.some((file) => file.endsWith(".rs"))
      },
      {
        name: "source-command-flutter-review",
        reason: "Task touches Dart or Flutter files.",
        matches: (_task, context) => context.files.some((file) => file.endsWith(".dart")) || /\bflutter\b/i.test(context.text)
      },
      {
        name: "superpowers:requesting-code-review",
        reason: "Review mode or git diff access should end with an explicit review gate.",
        matches: (task) => task.mode === "review" || task.allowed_tools.includes("git_diff")
      }
    ];
  }
});

// src/lima/artifact-bundle.ts
import * as fs21 from "fs";
import * as path22 from "path";
import { execSync as execSync2 } from "child_process";
function artifactDir(projectRoot2, taskId) {
  return path22.join(projectRoot2, ARTIFACTS_DIR, taskId);
}
function ensureArtifactDir(projectRoot2, taskId) {
  const dir = artifactDir(projectRoot2, taskId);
  fs21.mkdirSync(dir, { recursive: true });
  return dir;
}
function writePlanArtifacts(projectRoot2, options) {
  const dir = ensureArtifactDir(projectRoot2, options.task.task_id);
  const files = [];
  const contractBlock = renderPromptContract(resolveTaskPromptContract(options.task));
  const planLines = [
    `# \u8BA1\u5212: ${options.task.goal}`,
    `> task_id: ${options.task.task_id}`,
    `> branch: ${options.task.branch}`,
    `> repo: ${options.task.repo}`,
    ``,
    `## \u63D0\u793A\u8BCD\u5951\u7EA6`,
    contractBlock,
    ``,
    `## \u4ED3\u5E93\u4E0A\u4E0B\u6587`,
    `- \u53D8\u66F4\u6587\u4EF6 (${options.context.changedFiles.length}): ${options.context.changedFiles.join(", ") || "(\u65E0)"}`,
    `- \u8FD1\u671F\u6587\u4EF6 (${options.context.recentFiles.length}): ${options.context.recentFiles.join(", ") || "(\u65E0)"}`,
    ``,
    `## \u5EFA\u8BAE\u7684\u4E0B\u4E00\u5207\u7247`,
    options.suggestedSlice || "\u5BA1\u67E5\u4E0A\u65B9\u4E0A\u4E0B\u6587\uFF0C\u5E76\u51B3\u5B9A\u4E0B\u4E00\u6B65\u5B9E\u73B0\u3002",
    ``
  ];
  const planPath = path22.join(dir, "plan.md");
  fs21.writeFileSync(planPath, planLines.join("\n"), "utf8");
  files.push("plan.md");
  const contextPayload = {
    task_id: options.task.task_id,
    branch: options.task.branch,
    repo: options.task.repo,
    goal: options.task.goal,
    constraints: options.task.constraints,
    prompt_contract: resolveTaskPromptContract(options.task),
    changed_files: options.context.changedFiles,
    recent_files: options.context.recentFiles,
    git_status: options.context.gitStatus,
    agents_rules_present: !!options.context.agentsRules
  };
  const contextPath = path22.join(dir, "context.json");
  fs21.writeFileSync(contextPath, JSON.stringify(contextPayload, null, 2), "utf8");
  files.push("context.json");
  const risksLines = [
    `# \u98CE\u9669: ${options.task.goal}`,
    ``,
    `## \u65E2\u6709\u98CE\u9669`,
    ...options.context.existingRisks.map((r) => `- ${r}`),
    ...options.context.existingRisks.length === 0 ? ["(\u65E0\u8BB0\u5F55)"] : [],
    ``,
    `## \u65B0\u8BC6\u522B\u98CE\u9669`,
    `- (\u7531\u5BA1\u67E5\u8005\u8865\u5145)`,
    ``,
    `## \u7F13\u89E3\u63AA\u65BD`,
    `- \u6BCF\u9879\u98CE\u9669\u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u7F13\u89E3\u63AA\u65BD\u6216\u63A5\u53D7\u7406\u7531\u3002`,
    ``
  ];
  const risksPath = path22.join(dir, "risks.md");
  fs21.writeFileSync(risksPath, risksLines.join("\n"), "utf8");
  files.push("risks.md");
  return { taskId: options.task.task_id, dir, files };
}
function writeTestArtifacts(projectRoot2, options) {
  const dir = ensureArtifactDir(projectRoot2, options.task.task_id);
  const files = [];
  const payload = options.results.map((r) => ({
    command: r.command,
    exit_code: r.exit_code,
    duration_ms: r.duration_ms,
    stdout: (r.stdout ?? "").slice(0, 2e3),
    stderr: (r.stderr ?? "").slice(0, 2e3)
  }));
  const testPath = path22.join(dir, "tests.json");
  fs21.writeFileSync(testPath, JSON.stringify(payload, null, 2), "utf8");
  files.push("tests.json");
  return { taskId: options.task.task_id, dir, files };
}
function writeShipArtifacts(projectRoot2, options) {
  const dir = ensureArtifactDir(projectRoot2, options.task.task_id);
  const files = [];
  if (options.diffPreview) {
    const diffPath = path22.join(dir, "diff.patch");
    fs21.writeFileSync(diffPath, options.diffPreview, "utf8");
    files.push("diff.patch");
  }
  const shipLines = [
    `# \u4EA4\u4ED8\u5BA1\u67E5: ${options.task.goal}`,
    `> task_id: ${options.task.task_id}`,
    `> branch: ${options.task.branch}`,
    ``,
    `## \u53D8\u66F4\u6587\u4EF6`,
    ...options.changedFiles.map((f) => `- ${f}`),
    ...options.changedFiles.length === 0 ? ["(\u65E0\u53D8\u66F4)"] : [],
    ``,
    `## \u6D4B\u8BD5\u7ED3\u679C`,
    ...(options.testResults ?? []).map((r) => `- ${r.command}: exit=${r.exit_code} (${r.duration_ms}ms)`),
    ...!options.testResults || options.testResults.length === 0 ? ["(\u672A\u8FD0\u884C\u6D4B\u8BD5)"] : [],
    ``,
    `## \u5269\u4F59\u98CE\u9669`,
    ...options.remainingRisks.map((r) => `- ${r}`),
    ``,
    `## \u56DE\u6EDA\u8BF4\u660E`,
    options.rollbackNotes || "(\u672A\u63D0\u4F9B)",
    ``,
    `## Commit \u6458\u8981`,
    options.commitSummary || "(\u672A\u63D0\u4F9B)",
    ``,
    `## \u5BA1\u67E5\u6E05\u5355`,
    `- [ ] \u6240\u6709\u6D4B\u8BD5\u901A\u8FC7`,
    `- [ ] \u53D8\u66F4\u6587\u4EF6\u8303\u56F4\u8D34\u5408\u76EE\u6807`,
    `- [ ] \u65E0\u51ED\u636E\u3001\u8C03\u8BD5\u8BED\u53E5\u6216\u5927\u4E8C\u8FDB\u5236\u6587\u4EF6`,
    `- [ ] \u56DE\u6EDA\u8BF4\u660E\u6E05\u6670`,
    `- [ ] Commit message \u7B26\u5408\u89C4\u8303`,
    ``
  ];
  const shipPath = path22.join(dir, "ship.md");
  fs21.writeFileSync(shipPath, shipLines.join("\n"), "utf8");
  files.push("ship.md");
  return { taskId: options.task.task_id, dir, files };
}
function writeReviewArtifacts(projectRoot2, options) {
  const dir = ensureArtifactDir(projectRoot2, options.task.task_id);
  const files = [];
  if (options.diffPreview) {
    const diffPath = path22.join(dir, "diff.patch");
    fs21.writeFileSync(diffPath, options.diffPreview, "utf8");
    files.push("diff.patch");
  }
  const reviewLines = [
    `# Review: ${options.task.goal}`,
    `> task_id: ${options.task.task_id}`,
    ``,
    `## Changed Files`,
    ...options.changedFiles.map((f) => `- ${f}`),
    ...options.changedFiles.length === 0 ? ["(no changes)"] : [],
    ``,
    `## Findings`,
    ...options.findings.map((f) => `- ${f}`),
    ...options.findings.length === 0 ? ["(no findings)"] : [],
    ``
  ];
  const reviewPath = path22.join(dir, "review.md");
  fs21.writeFileSync(reviewPath, reviewLines.join("\n"), "utf8");
  files.push("review.md");
  return { taskId: options.task.task_id, dir, files };
}
function snapshotContext(projectRoot2) {
  const changedFiles = readGitChangedFiles(projectRoot2).filter((f) => !f.startsWith(".lima"));
  const recentFiles = readGitRecentFiles(projectRoot2);
  const gitStatus = readGitStatus(projectRoot2);
  const agentsRules = readFileIfExists(path22.join(projectRoot2, "AGENTS.md")) || readFileIfExists(path22.join(projectRoot2, "CLAUDE.md")) || "";
  const existingRisks = extractRisksFromFindings(projectRoot2);
  return {
    branch: readGitBranch(projectRoot2),
    recentFiles,
    changedFiles,
    gitStatus,
    agentsRules,
    existingRisks
  };
}
function readGitBranch(projectRoot2) {
  try {
    return execSync2("git rev-parse --abbrev-ref HEAD", {
      cwd: projectRoot2,
      encoding: "utf8",
      windowsHide: true
    }).trim();
  } catch {
    return "unknown";
  }
}
function readGitChangedFiles(projectRoot2) {
  try {
    return execSync2("git diff --name-only", { cwd: projectRoot2, encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}
function readGitRecentFiles(projectRoot2) {
  try {
    return execSync2("git log --name-only --oneline -5", { cwd: projectRoot2, encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/).filter((line) => !line.startsWith(" ") && line.includes(".")).slice(0, 15);
  } catch {
    return [];
  }
}
function readGitStatus(projectRoot2) {
  try {
    return execSync2("git status --short", { cwd: projectRoot2, encoding: "utf8", windowsHide: true }).trim();
  } catch {
    return "";
  }
}
function readFileIfExists(filePath) {
  try {
    return fs21.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
function extractRisksFromFindings(projectRoot2) {
  const findingsPath = path22.join(projectRoot2, "findings.md");
  const content = readFileIfExists(findingsPath);
  if (!content) return [];
  const risks = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("| PROD-") || trimmed.startsWith("| CQ-") || trimmed.startsWith("| PCA-")) {
      risks.push(trimmed);
    }
  }
  return risks.slice(0, 10);
}
var ARTIFACTS_DIR;
var init_artifact_bundle = __esm({
  "src/lima/artifact-bundle.ts"() {
    "use strict";
    init_prompt_contract();
    ARTIFACTS_DIR = ".lima/artifacts";
  }
});

// src/lima/repo-allowlist.ts
import * as path23 from "path";
function normalizeAllowedRepos(repos = []) {
  return repos.map((repo) => path23.resolve(repo));
}
function isRepoAllowed(repo, config) {
  const resolvedRepo = path23.resolve(repo);
  const allowed = [config.currentWorkspace, ...normalizeAllowedRepos(config.allowedRepos)].map(
    (root) => normalizePath(root)
  );
  const comparableRepo = normalizePath(resolvedRepo);
  if (allowed.some((root) => isSameOrInside(comparableRepo, root))) {
    return { ok: true, value: resolvedRepo };
  }
  return { ok: false, error: `LiMa task repo is not allowlisted: ${resolvedRepo}` };
}
function normalizePath(value) {
  const resolved = path23.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
function isSameOrInside(child, parent) {
  if (child === parent) {
    return true;
  }
  const relative7 = path23.relative(parent, child);
  return Boolean(relative7 && !relative7.startsWith("..") && !path23.isAbsolute(relative7));
}
var init_repo_allowlist = __esm({
  "src/lima/repo-allowlist.ts"() {
    "use strict";
  }
});

// src/lima/workspace-guard.ts
import * as fs22 from "fs";
import * as path24 from "path";
function resolveLiMaTaskRepo(repo, config) {
  const requested = repo.trim();
  if (!requested) {
    return { ok: false, error: "LiMa task repo is required." };
  }
  const repoRoot = safeRealPath(path24.resolve(requested));
  if (!repoRoot) {
    return { ok: false, error: `LiMa task repo does not exist: ${requested}` };
  }
  const allowedRoots = normalizeAllowedRoots(config);
  const allowed = isRepoAllowed(repoRoot, {
    currentWorkspace: config.currentWorkspace,
    allowedRepos: allowedRoots.filter((root) => root !== safeRealPath(path24.resolve(config.currentWorkspace)))
  });
  if (!allowed.ok) {
    return allowed;
  }
  return { ok: true, value: repoRoot };
}
function assertLiMaTaskToolsAllowed(tools) {
  const normalized = tools.map((tool) => tool.trim()).filter(Boolean);
  const disallowed = normalized.filter((tool) => !allowedToolSet.has(tool));
  if (disallowed.length > 0) {
    return { ok: false, error: `LiMa task requested disallowed tools: ${disallowed.join(", ")}` };
  }
  return { ok: true, value: normalized };
}
function resolveLiMaTaskRuntimeSec(requested, config = {}) {
  const cap = config.maxRuntimeCapSec ?? DEFAULT_RUNTIME_CAP_SEC;
  if (!Number.isInteger(cap) || cap <= 0) {
    return { ok: false, error: "LiMa task runtime cap must be a positive integer." };
  }
  const value = requested ?? DEFAULT_RUNTIME_SEC;
  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, error: "LiMa task runtime must be a positive integer." };
  }
  return { ok: true, value: Math.min(value, cap) };
}
function normalizeAllowedRoots(config) {
  const roots = [config.currentWorkspace, ...config.allowedRoots ?? [], ...config.allowedRepos ?? []];
  return roots.map((root) => safeRealPath(path24.resolve(root))).filter((root) => Boolean(root));
}
function safeRealPath(value) {
  try {
    if (!fs22.existsSync(value)) {
      return null;
    }
    const real = fs22.realpathSync(value);
    const lstat = fs22.lstatSync(value);
    if (lstat.isSymbolicLink()) {
      const realTarget = fs22.realpathSync(value);
      if (!realTarget.startsWith(path24.resolve(value, ".."))) {
        return null;
      }
    }
    return normalizePath2(real);
  } catch {
    return null;
  }
}
function normalizePath2(value) {
  const resolved = path24.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
var LIMA_ALLOWED_TASK_TOOLS, DEFAULT_RUNTIME_SEC, DEFAULT_RUNTIME_CAP_SEC, allowedToolSet;
var init_workspace_guard = __esm({
  "src/lima/workspace-guard.ts"() {
    "use strict";
    init_repo_allowlist();
    LIMA_ALLOWED_TASK_TOOLS = [
      "read",
      "write",
      "edit",
      "bash",
      "git_diff",
      "test",
      "shell_readonly",
      "mcp"
    ];
    DEFAULT_RUNTIME_SEC = 600;
    DEFAULT_RUNTIME_CAP_SEC = 1800;
    allowedToolSet = new Set(LIMA_ALLOWED_TASK_TOOLS);
  }
});

// src/lima/task-runner.ts
import { spawn as spawn5 } from "child_process";
import * as fs23 from "fs";
import * as path25 from "path";
async function runLiMaAgentTask(task, config) {
  const guard = prepareTask(task, config);
  if (!guard.ok) {
    return blockedResult(task, guard.error);
  }
  switch (task.mode) {
    case "plan":
      return runPlanMode(task, config.projectRoot ?? guard.value.repoRoot);
    case "patch":
      return runPatchMode(task, guard.value.repoRoot, guard.value.runtimeSec, config);
    case "test":
      return runTestMode(task, guard.value.repoRoot, guard.value.runtimeSec, config);
    case "review":
      return runReviewMode(task, guard.value.repoRoot, guard.value.runtimeSec, config);
    case "ship":
      return runShipMode(task, guard.value.repoRoot, guard.value.runtimeSec, config);
  }
}
function prepareTask(task, config) {
  const repo = resolveLiMaTaskRepo(task.repo, config);
  if (!repo.ok) {
    return repo;
  }
  const tools = assertLiMaTaskToolsAllowed(task.allowed_tools);
  if (!tools.ok) {
    return tools;
  }
  const runtime = resolveLiMaTaskRuntimeSec(task.max_runtime_sec, config);
  if (!runtime.ok) {
    return runtime;
  }
  return { ok: true, value: { repoRoot: repo.value, runtimeSec: runtime.value } };
}
function runPlanMode(task, projectRoot2) {
  const context = snapshotContext(projectRoot2);
  const suggestedSlice = buildSuggestedSlice(task, context);
  const bundle = writePlanArtifacts(projectRoot2, {
    task,
    context,
    suggestedSlice
  });
  return buildLiMaTaskResult(task, {
    status: "needs_review",
    summary: [
      `\u8BA1\u5212\u5DF2\u5199\u5165: ${task.goal}`,
      `\u4E0A\u4E0B\u6587: ${context.changedFiles.length} \u4E2A\u53D8\u66F4\u6587\u4EF6\uFF0C${context.recentFiles.length} \u4E2A\u8FD1\u671F\u6587\u4EF6\u3002`,
      `\u4EA7\u7269\u5305: ${bundle.dir}`,
      `\u6587\u4EF6: ${bundle.files.join(", ")}`
    ].join("\n"),
    changedFiles: context.changedFiles,
    artifacts: bundle.files.map((f) => `${bundle.dir}/${f}`),
    risks: context.existingRisks.slice(0, 5),
    nextAction: "\u5BA1\u67E5 plan.md\u3001context.json \u548C risks.md\uFF0C\u7136\u540E\u51B3\u5B9A patch/test/ship\u3002"
  });
}
function buildSuggestedSlice(task, context) {
  const lines = [
    `\u57FA\u4E8E\u5F53\u524D\u4ED3\u5E93\u72B6\u6001\uFF1A`,
    `- \u5206\u652F: ${context.branch}`,
    `- \u53D8\u66F4\u6587\u4EF6: ${context.changedFiles.length > 0 ? context.changedFiles.join(", ") : "(\u5DE5\u4F5C\u533A\u5E72\u51C0)"}`,
    `- \u4EFB\u52A1\u76EE\u6807: ${task.goal}`,
    ``,
    `\u5EFA\u8BAE\u8DEF\u5F84\uFF1A`,
    `1. \u5BA1\u67E5\u4E0A\u9762\u7684\u53D8\u66F4\u6587\u4EF6\u548C\u65E2\u6709\u98CE\u9669\u3002`,
    `2. \u627E\u5230\u80FD\u63A8\u8FDB\u76EE\u6807\u7684\u6700\u5C0F\u6539\u52A8\u3002`,
    `3. \u7F16\u5199\u8865\u4E01\u3001\u8FD0\u884C\u6D4B\u8BD5\uFF0C\u5E76\u7528 /lima ship \u5BA1\u67E5\u3002`
  ];
  if (context.changedFiles.length === 0) {
    lines.push(`4. \u4ECE\u4E00\u4E2A\u805A\u7126\u6587\u4EF6\u6539\u52A8\u5F00\u59CB\uFF0C\u7136\u540E\u91CD\u65B0\u8FD0\u884C /lima plan\u3002`);
  }
  return lines.join("\n");
}
async function runPatchMode(task, repoRoot, runtimeSec, config) {
  if (!task.allowed_tools.includes("write")) {
    return blockedResult(task, "patch \u6A21\u5F0F\u9700\u8981 write \u5DE5\u5177\u3002");
  }
  const testCommands = extractTestCommands(task);
  if (testCommands.length > 0 && !task.allowed_tools.includes("test")) {
    return blockedResult(task, "\u5E26\u6D4B\u8BD5\u547D\u4EE4\u7684 patch \u6A21\u5F0F\u9700\u8981 test \u5DE5\u5177\u3002");
  }
  const patchFiles = task.patch_files ?? [];
  for (const patchFile of patchFiles) {
    const target = resolveRepoFile(repoRoot, patchFile.file_path);
    if (!target.ok) {
      return blockedResult(task, target.error);
    }
    fs23.mkdirSync(path25.dirname(target.value), { recursive: true });
    fs23.writeFileSync(target.value, patchFile.content, "utf8");
  }
  const diff = await runGitDiff(repoRoot, runtimeSec, config);
  if (patchFiles.length === 0) {
    return buildLiMaTaskResult(task, {
      status: "blocked",
      summary: "patch \u6A21\u5F0F\u9700\u8981\u660E\u786E\u7684 patch_files\uFF1B\u672A\u4FEE\u6539\u4EFB\u4F55\u6587\u4EF6\u3002",
      changedFiles: diff.changedFiles,
      diffPreview: diff.preview,
      nextAction: "\u63D0\u4F9B\u660E\u786E\u7684 patch_files\u3002"
    });
  }
  if (testCommands.length > 0) {
    const testRun = await runTestCommands(testCommands, repoRoot, runtimeSec, config);
    if (!testRun.ok) {
      return buildLiMaTaskResult(task, {
        status: "failed",
        summary: `\u5DF2\u5E94\u7528 ${patchFiles.length} \u4E2A\u6587\u4EF6\u66F4\u65B0\uFF0C\u4F46\u6D4B\u8BD5\u547D\u4EE4\u5931\u8D25: ${testRun.failedCommand}`,
        changedFiles: diff.changedFiles,
        diffPreview: diff.preview,
        testCommands: testRun.commands,
        testResults: testRun.results,
        nextAction: "\u63D0\u4EA4\u524D\u5148\u4FEE\u590D\u5931\u8D25\u6D4B\u8BD5\u3002"
      });
    }
    return buildLiMaTaskResult(task, {
      status: "needs_review",
      summary: `\u5DF2\u5E94\u7528 ${patchFiles.length} \u4E2A\u6587\u4EF6\u66F4\u65B0\uFF0C\u4E14\u6240\u6709\u8BF7\u6C42\u7684\u6D4B\u8BD5\u547D\u4EE4\u5DF2\u901A\u8FC7\u3002\u672A\u521B\u5EFA commit\u3002`,
      changedFiles: diff.changedFiles,
      diffPreview: diff.preview,
      testCommands: testRun.commands,
      testResults: testRun.results,
      nextAction: "\u5BA1\u67E5 diff \u5E76\u5C06\u7ED3\u679C\u63D0\u4EA4\u5230 LiMa Server\u3002"
    });
  }
  return buildLiMaTaskResult(task, {
    status: "needs_review",
    summary: `\u5DF2\u5E94\u7528 ${patchFiles.length} \u4E2A\u6587\u4EF6\u66F4\u65B0\u3002\u672A\u521B\u5EFA commit\u3002`,
    changedFiles: diff.changedFiles,
    diffPreview: diff.preview,
    nextAction: "\u5BA1\u67E5 diff \u5E76\u8FD0\u884C\u6D4B\u8BD5\u3002"
  });
}
async function runTestMode(task, repoRoot, runtimeSec, config) {
  if (!task.allowed_tools.includes("test")) {
    return blockedResult(task, "test \u6A21\u5F0F\u9700\u8981 test \u5DE5\u5177\u3002");
  }
  const commands = extractTestCommands(task);
  if (commands.length === 0) {
    return blockedResult(task, "test \u6A21\u5F0F\u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u6D4B\u8BD5\u547D\u4EE4\u3002");
  }
  const testRun = await runTestCommands(commands, repoRoot, runtimeSec, config);
  writeTestArtifacts(config.projectRoot ?? repoRoot, {
    task,
    commands,
    results: testRun.results
  });
  if (!testRun.ok) {
    return buildLiMaTaskResult(task, {
      status: "failed",
      summary: `\u6D4B\u8BD5\u547D\u4EE4\u5931\u8D25: ${testRun.failedCommand}`,
      testCommands: testRun.commands,
      testResults: testRun.results,
      nextAction: "\u63D0\u4EA4\u524D\u5148\u4FEE\u590D\u5931\u8D25\u6D4B\u8BD5\u3002"
    });
  }
  return buildLiMaTaskResult(task, {
    status: "succeeded",
    summary: "\u6240\u6709\u8BF7\u6C42\u7684\u6D4B\u8BD5\u547D\u4EE4\u5DF2\u901A\u8FC7\u3002",
    testCommands: testRun.commands,
    testResults: testRun.results,
    nextAction: "\u63D0\u4EA4\u7ED3\u679C\u5230 LiMa Server\u3002"
  });
}
async function runReviewMode(task, repoRoot, runtimeSec, config) {
  if (!task.allowed_tools.includes("git_diff")) {
    return blockedResult(task, "review \u6A21\u5F0F\u9700\u8981 git_diff \u5DE5\u5177\u3002");
  }
  const diff = await runGitDiff(repoRoot, runtimeSec, config);
  const findings = diff.preview ? ["\u68C0\u6D4B\u5230 git diff \u53D8\u66F4\uFF0C\u9700\u8981\u5BA1\u67E5\u3002"] : [];
  writeReviewArtifacts(config.projectRoot ?? repoRoot, {
    task,
    diffPreview: diff.preview,
    changedFiles: diff.changedFiles,
    findings
  });
  return buildLiMaTaskResult(task, {
    status: "needs_review",
    summary: diff.preview ? "\u63D0\u4EA4 patch \u524D\u5BA1\u67E5\u5F53\u524D diff \u98CE\u9669\u3002" : "\u6CA1\u6709\u53EF\u5BA1\u67E5\u7684 git diff\u3002",
    changedFiles: diff.changedFiles,
    diffPreview: diff.preview,
    nextAction: diff.preview ? "\u68C0\u67E5\u53D1\u73B0\u9879\u5E76\u51B3\u5B9A\u662F\u5426\u6253\u8865\u4E01\u3002" : "\u65E0\u9700\u64CD\u4F5C\u3002"
  });
}
async function runShipMode(task, repoRoot, runtimeSec, config) {
  if (!task.allowed_tools.includes("git_diff")) {
    return blockedResult(task, "ship \u6A21\u5F0F\u9700\u8981 git_diff \u5DE5\u5177\u3002");
  }
  const projectRoot2 = config.projectRoot ?? repoRoot;
  const context = snapshotContext(projectRoot2);
  const diff = await runGitDiff(repoRoot, runtimeSec, config);
  const remainingRisks = [
    ...context.existingRisks.slice(0, 5),
    ...diff.changedFiles.length > 3 ? [`\u53D8\u66F4\u8F83\u5927: \u4FEE\u6539\u4E86 ${diff.changedFiles.length} \u4E2A\u6587\u4EF6\u3002`] : [],
    ...diff.changedFiles.length === 0 ? ["\u6CA1\u6709\u53EF\u4EA4\u4ED8\u7684\u53D8\u66F4\u3002"] : []
  ];
  const rollbackNotes = context.changedFiles.length > 0 ? `\u56DE\u6EDA\u547D\u4EE4: git checkout ${context.changedFiles.map((f) => `'${f}'`).join(" ")}` : "\u6CA1\u6709\u9700\u8981\u56DE\u6EDA\u7684\u53D8\u66F4\u3002";
  const commitSummary = context.changedFiles.length > 0 ? `feat: ${task.goal.slice(0, 60)}` : "";
  const bundle = writeShipArtifacts(projectRoot2, {
    task,
    diffPreview: diff.preview,
    changedFiles: diff.changedFiles,
    remainingRisks,
    rollbackNotes,
    commitSummary
  });
  return buildLiMaTaskResult(task, {
    status: "needs_review",
    summary: [
      `\u4EA4\u4ED8\u5BA1\u67E5\u5DF2\u5199\u5165: ${task.goal}`,
      `\u53D8\u66F4\u6587\u4EF6: ${diff.changedFiles.length}\u3002`,
      `\u5269\u4F59\u98CE\u9669: ${remainingRisks.length}\u3002`,
      `\u4EA7\u7269\u5305: ${bundle.dir}`,
      `\u6587\u4EF6: ${bundle.files.join(", ")}`
    ].join("\n"),
    changedFiles: diff.changedFiles,
    diffPreview: diff.preview,
    artifacts: bundle.files.map((f) => `${bundle.dir}/${f}`),
    risks: remainingRisks,
    nextAction: "\u63D0\u4EA4\u524D\u5BA1\u67E5 ship.md\u3001diff.patch \u548C\u98CE\u9669\u3002\u4E0D\u8981\u5728\u6B64\u68C0\u67E5\u4E2D\u90E8\u7F72\u6216\u63A8\u9001\u3002"
  });
}
async function runGitDiff(repoRoot, runtimeSec, config) {
  const names = await executeCommand("git diff --name-only", repoRoot, runtimeSec, config);
  const diff = await executeCommand("git diff --", repoRoot, runtimeSec, config);
  return {
    changedFiles: parseChangedFilesFromGitNameOnly(names.stdout),
    preview: diff.stdout
  };
}
function blockedResult(task, reason) {
  return buildLiMaTaskResult(task, {
    status: "blocked",
    summary: reason,
    risks: [reason],
    nextAction: "\u4FEE\u590D\u4EFB\u52A1\u914D\u7F6E\u540E\u91CD\u8BD5\u3002"
  });
}
function extractTestCommands(task) {
  const explicit = task.test_commands ?? [];
  const fromConstraints = task.constraints.map((item) => item.trim()).filter((item) => item.toLowerCase().startsWith("test:")).map((item) => item.slice("test:".length).trim()).filter(Boolean);
  return Array.from(/* @__PURE__ */ new Set([...explicit, ...fromConstraints]));
}
async function runTestCommands(commands, repoRoot, runtimeSec, config) {
  const results = [];
  for (const command of commands) {
    const execution = await executeCommand(command, repoRoot, runtimeSec, config);
    results.push({
      command,
      exit_code: execution.exitCode,
      duration_ms: execution.durationMs,
      stdout: truncateText3(execution.stdout),
      stderr: truncateText3(execution.stderr)
    });
    if (execution.exitCode !== 0) {
      return { ok: false, commands, results, failedCommand: command };
    }
  }
  return { ok: true, commands, results };
}
function resolveRepoFile(repoRoot, filePath) {
  const target = path25.resolve(repoRoot, filePath);
  const relative7 = path25.relative(repoRoot, target);
  if (!relative7 || relative7.startsWith("..") || path25.isAbsolute(relative7)) {
    return { ok: false, error: `Patch target is outside repo: ${filePath}` };
  }
  return { ok: true, value: target };
}
async function executeCommand(command, cwd, timeoutSec, config) {
  if (config.executeCommand) {
    return config.executeCommand(command, cwd, timeoutSec);
  }
  return spawnCommand(command, cwd, timeoutSec);
}
function spawnCommand(command, cwd, timeoutSec) {
  return new Promise((resolve13) => {
    const startedAt = Date.now();
    const [executable, ...args2] = splitCommand(command);
    if (!executable) {
      resolve13({ exitCode: 1, stdout: "", stderr: "Empty command.", durationMs: 0 });
      return;
    }
    const child = spawn5(executable, args2, { cwd, shell: false, windowsHide: true });
    const timer = setTimeout(() => child.kill(), timeoutSec * 1e3);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      stderr += error.message;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve13({
        exitCode: code,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt
      });
    });
  });
}
function splitCommand(command) {
  return command.match(/"[^"]+"|'[^']+'|\S+/g)?.map((part) => part.replace(/^["']|["']$/g, "")) ?? [];
}
var init_task_runner = __esm({
  "src/lima/task-runner.ts"() {
    "use strict";
    init_artifact_bundle();
    init_result_builder();
    init_workspace_guard();
  }
});

// src/lima/worker-budget.ts
function createWorkerBudget(config) {
  const now = config.now ?? Date.now;
  const startedAt = now();
  let taskCount = 0;
  return {
    recordTask() {
      taskCount += 1;
    },
    canStartNext() {
      if (taskCount >= config.maxTasks) {
        return { ok: false, reason: `LiMa worker \u4EFB\u52A1\u9884\u7B97\u5DF2\u8FBE\u5230: ${taskCount}/${config.maxTasks}` };
      }
      const elapsedMs = now() - startedAt;
      if (elapsedMs > config.maxMinutes * 6e4) {
        return { ok: false, reason: `LiMa worker \u65F6\u95F4\u9884\u7B97\u5DF2\u8FBE\u5230: ${config.maxMinutes} \u5206\u949F` };
      }
      return { ok: true };
    }
  };
}
var init_worker_budget = __esm({
  "src/lima/worker-budget.ts"() {
    "use strict";
  }
});

// src/lima/checkpoint.ts
import * as crypto4 from "crypto";
import * as fs24 from "fs";
import * as path26 from "path";
function saveCheckpoint(projectRoot2, checkpoint) {
  const store = readStore(projectRoot2);
  if (store.current && store.current.taskId !== checkpoint.taskId) {
    store.history.unshift(store.current);
    if (store.history.length > MAX_HISTORY) {
      store.history = store.history.slice(0, MAX_HISTORY);
    }
  }
  store.current = checkpoint;
  writeStore(projectRoot2, store);
}
function loadCheckpoint(projectRoot2) {
  return readStore(projectRoot2).current;
}
function clearCheckpoint(projectRoot2) {
  const store = readStore(projectRoot2);
  if (store.current) {
    store.history.unshift(store.current);
    if (store.history.length > MAX_HISTORY) {
      store.history = store.history.slice(0, MAX_HISTORY);
    }
  }
  store.current = null;
  writeStore(projectRoot2, store);
}
function snapshotFiles(projectRoot2, files) {
  const taskId = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const snapshotDir = path26.join(projectRoot2, ".lima-code", "snapshots", taskId);
  fs24.mkdirSync(snapshotDir, { recursive: true });
  for (const relPath of files) {
    const absPath = path26.resolve(projectRoot2, relPath);
    if (!fs24.existsSync(absPath)) continue;
    const destDir = path26.join(snapshotDir, path26.dirname(relPath));
    fs24.mkdirSync(destDir, { recursive: true });
    try {
      fs24.copyFileSync(absPath, path26.join(snapshotDir, relPath));
    } catch {
    }
  }
  return snapshotDir;
}
function rollbackSnapshots(projectRoot2, checkpoint) {
  const snapshotDir = checkpoint.snapshotDir;
  if (!snapshotDir || !fs24.existsSync(snapshotDir)) return 0;
  let restored = 0;
  walkSnapshotDir(snapshotDir, (relPath, absPath) => {
    const target = path26.resolve(projectRoot2, relPath);
    try {
      fs24.mkdirSync(path26.dirname(target), { recursive: true });
      fs24.copyFileSync(absPath, target);
      restored++;
    } catch {
    }
  });
  try {
    fs24.rmSync(snapshotDir, { recursive: true, force: true });
  } catch {
  }
  return restored;
}
function isStale(checkpoint, maxAgeMs = DEFAULT_STALE_MS) {
  const started = new Date(checkpoint.startedAt).getTime();
  if (isNaN(started)) return true;
  return Date.now() - started > maxAgeMs;
}
function checkpointPath(projectRoot2) {
  return path26.join(projectRoot2, ".lima-code", "checkpoint.json");
}
function readStore(projectRoot2) {
  const file = checkpointPath(projectRoot2);
  if (!fs24.existsSync(file)) {
    return { current: null, history: [] };
  }
  try {
    const raw = JSON.parse(fs24.readFileSync(file, "utf8"));
    return {
      current: raw.current ?? null,
      history: Array.isArray(raw.history) ? raw.history.slice(0, MAX_HISTORY) : []
    };
  } catch {
    return { current: null, history: [] };
  }
}
function writeStore(projectRoot2, store) {
  const file = checkpointPath(projectRoot2);
  fs24.mkdirSync(path26.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${crypto4.randomBytes(4).toString("hex")}`;
  fs24.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs24.renameSync(tmp, file);
}
function walkSnapshotDir(dir, callback, baseDir) {
  const root = baseDir ?? dir;
  for (const entry of fs24.readdirSync(dir, { withFileTypes: true })) {
    const abs = path26.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSnapshotDir(abs, callback, root);
    } else {
      callback(path26.relative(root, abs), abs);
    }
  }
}
var MAX_HISTORY, DEFAULT_STALE_MS;
var init_checkpoint = __esm({
  "src/lima/checkpoint.ts"() {
    "use strict";
    MAX_HISTORY = 10;
    DEFAULT_STALE_MS = 30 * 60 * 1e3;
  }
});

// src/lima/probe.ts
import * as crypto5 from "crypto";
import * as fs25 from "fs";
import * as path27 from "path";
function probeCodebase(projectRoot2, options) {
  const t0 = Date.now();
  const opts = {
    maxFileSize: options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
    extensions: options?.extensions ?? DEFAULT_EXTENSIONS,
    skipDirs: options?.skipDirs ?? [],
    minSeverity: options?.minSeverity ?? "trivial"
  };
  const skipSet = /* @__PURE__ */ new Set([...SKIP_DIRS, ...opts.skipDirs]);
  const files = collectFiles(projectRoot2, opts.extensions, skipSet, opts.maxFileSize);
  const findings = [];
  for (const relPath of files) {
    const absPath = path27.join(projectRoot2, relPath);
    try {
      const content = fs25.readFileSync(absPath, "utf8");
      const lines = content.split("\n");
      runDetectors(relPath, lines, findings);
    } catch {
    }
  }
  const minSev = SEVERITY_ORDER[opts.minSeverity];
  const filtered = findings.filter((f) => SEVERITY_ORDER[f.severity] >= minSev);
  filtered.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
  return {
    findings: filtered,
    scannedFiles: files.length,
    scanDurationMs: Date.now() - t0
  };
}
function findingToTask(finding, _projectRoot, _testCommands) {
  const isMedium = finding.severity === "medium";
  return {
    goal: finding.suggestedFix,
    constraints: [
      `Fix ${finding.rule} at ${finding.file}:${finding.line}`,
      `Severity: ${finding.severity}`,
      finding.message
    ],
    allowedTools: isMedium ? ["read"] : finding.severity === "trivial" ? ["read", "edit"] : ["read", "write", "edit", "bash", "git_diff", "test"],
    mode: isMedium ? "plan" : "patch"
  };
}
function runDetectors(file, lines, findings) {
  const isPython = file.endsWith(".py");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    if (isPython && /^\s*except\s*(Exception)?\s*:\s*$/.test(line)) {
      const nextLine = lines[i + 1]?.trim() ?? "";
      const hasLog = /log|warn|error|print|debug|_log|logger/.test(nextLine);
      if (!hasLog) {
        findings.push(
          makeFinding(
            file,
            lineNum,
            "bareExcept",
            "trivial",
            "Bare except without logging",
            `Add logging to this except block in ${file}. Example: _log.warning("error", exc_info=True)`
          )
        );
      }
    }
    if (/\b(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[A-Z0-9]{16})\b/.test(line)) {
      findings.push(
        makeFinding(
          file,
          lineNum,
          "hardcodedSecret",
          "trivial",
          "Potential hardcoded API key or token",
          `Replace hardcoded credential in ${file} with an environment variable reference.`
        )
      );
    }
    if (/\b(password|passwd|secret|token)\s*=\s*["'][^"']{8,}/i.test(line)) {
      const isTest = /test|spec|mock|fixture|example/i.test(file);
      const isComment = /^\s*[#/]/.test(line);
      if (!isTest && !isComment) {
        findings.push(
          makeFinding(
            file,
            lineNum,
            "hardcodedSecret",
            "trivial",
            "Potential hardcoded password or token",
            `Move credential to environment variable in ${file}.`
          )
        );
      }
    }
    const todoMatch = line.match(/(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)/i);
    if (todoMatch && !/^\s*[#/]/.test(line) || /^\s*[#/].*\b(TODO|FIXME|HACK|XXX)\b/.test(line)) {
      const tag = todoMatch?.[1]?.toUpperCase() ?? "TODO";
      const note = (todoMatch?.[2] ?? "").trim().slice(0, 80);
      findings.push(
        makeFinding(
          file,
          lineNum,
          "todoFixme",
          "small",
          `${tag} marker${note ? `: ${note}` : ""}`,
          `Address the ${tag} at ${file}:${lineNum} or remove it if no longer relevant.`
        )
      );
    }
    if (/\bos\.system\s*\(/.test(line)) {
      findings.push(
        makeFinding(
          file,
          lineNum,
          "securityPattern",
          "small",
          "os.system() usage \u2014 potential command injection",
          `Replace os.system() with subprocess.run(..., shell=False) in ${file}.`
        )
      );
    }
    if (/\beval\s*\(/.test(line) && !/\bevaluate/.test(line)) {
      const isTest = /test|spec/i.test(file);
      if (!isTest) {
        findings.push(
          makeFinding(
            file,
            lineNum,
            "securityPattern",
            "small",
            "eval() usage \u2014 potential code injection",
            `Replace eval() with safe alternatives (ast.literal_eval, json.loads) in ${file}.`
          )
        );
      }
    }
    if (/subprocess\.(call|run|Popen)\s*\(.*shell\s*=\s*True/.test(line)) {
      findings.push(
        makeFinding(
          file,
          lineNum,
          "securityPattern",
          "small",
          "subprocess with shell=True \u2014 potential injection",
          `Use shell=False with argument list instead of shell=True in ${file}.`
        )
      );
    }
    const indent = line.match(/^(\s*)/)?.[1] ?? "";
    const indentLevel = indent.includes("	") ? indent.split("	").length : Math.floor(indent.length / 4);
    if (indentLevel > 4 && line.trim().length > 0) {
      findings.push(
        makeFinding(
          file,
          lineNum,
          "deepNesting",
          "small",
          `Deep nesting (${indentLevel} levels)`,
          `Refactor deeply nested logic in ${file}:${lineNum} using early returns or extracted functions.`
        )
      );
    }
    if (isPython) {
      const fromImportMatch = line.match(/^from\s+\S+\s+import\s+(.+)/);
      if (fromImportMatch) {
        const imports = fromImportMatch[1].split(",").map((s) => {
          const name = s.trim().split(/\s+as\s+/)[0].trim();
          return name.replace(/[()]/g, "").trim();
        }).filter(Boolean);
        const restOfFile = lines.slice(i + 1).join("\n");
        for (const name of imports) {
          if (name === "*" || name.length < 2) continue;
          const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`);
          if (!pattern.test(restOfFile)) {
            findings.push(
              makeFinding(
                file,
                lineNum,
                "unusedImport",
                "trivial",
                `Unused import: '${name}'`,
                `Remove unused import '${name}' from ${file}.`
              )
            );
            break;
          }
        }
      }
      const plainImportMatch = line.match(/^import\s+(\w+)\s*(?:#.*)?$/);
      if (plainImportMatch) {
        const name = plainImportMatch[1];
        if (name.length >= 2) {
          const restOfFile = lines.slice(i + 1).join("\n");
          const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`);
          if (!pattern.test(restOfFile)) {
            findings.push(
              makeFinding(
                file,
                lineNum,
                "unusedImport",
                "trivial",
                `Unused import: '${name}'`,
                `Remove unused import '${name}' from ${file}.`
              )
            );
          }
        }
      }
    }
  }
  detectLongFunctions(file, lines, findings);
  if (lines.length > 300) {
    findings.push(
      makeFinding(
        file,
        1,
        "largeFile",
        "small",
        `File is ${lines.length} lines (>300)`,
        `Split ${file} into smaller, focused modules. Target: \u2264300 lines per file.`
      )
    );
  }
}
function detectLongFunctions(file, lines, findings) {
  const isPython = file.endsWith(".py");
  const funcPattern = isPython ? /^\s*(async\s+)?def\s+(\w+)/ : /^\s*(async\s+)?(\w+)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(funcPattern);
    if (!match) continue;
    const funcName = isPython ? match[2] : match[2] || match[1] || "anonymous";
    let endLine = i;
    if (isPython) {
      const funcIndent = (lines[i].match(/^(\s*)/)?.[1] ?? "").length;
      for (let j = i + 1; j < lines.length; j++) {
        const lineIndent = (lines[j].match(/^(\s*)/)?.[1] ?? "").length;
        if (lines[j].trim().length > 0 && lineIndent <= funcIndent) {
          break;
        }
        endLine = j;
      }
    } else {
      let depth = 0;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === "{") depth++;
          if (ch === "}") depth--;
        }
        endLine = j;
        if (depth <= 0 && j > i) break;
      }
    }
    const funcLen = endLine - i + 1;
    if (funcLen > 50) {
      findings.push(
        makeFinding(
          file,
          i + 1,
          "longFunction",
          "small",
          `Function '${funcName}' is ${funcLen} lines (>50)`,
          `Split function '${funcName}' in ${file} into smaller, focused functions.`
        )
      );
    }
  }
}
function makeFinding(file, line, rule, severity, message, suggestedFix) {
  const id = crypto5.createHash("sha256").update(`${file}:${rule}:${line}`).digest("hex").slice(0, 16);
  return { id, rule, file, line, severity, message, suggestedFix };
}
function collectFiles(root, extensions, skipDirs, maxFileSize) {
  const result = [];
  walkDir(root, root, extensions, skipDirs, maxFileSize, result);
  return result;
}
function walkDir(dir, root, extensions, skipDirs, maxFileSize, result) {
  let entries;
  try {
    entries = fs25.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    if (skipDirs.has(entry.name)) continue;
    const abs = path27.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(abs, root, extensions, skipDirs, maxFileSize, result);
    } else if (entry.isFile()) {
      const ext = path27.extname(entry.name).toLowerCase();
      if (!extensions.includes(ext)) continue;
      try {
        const stat = fs25.statSync(abs);
        if (stat.size > maxFileSize) continue;
      } catch {
        continue;
      }
      result.push(path27.relative(root, abs).replace(/\\/g, "/"));
    }
  }
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var DEFAULT_EXTENSIONS, DEFAULT_MAX_FILE_SIZE, SKIP_DIRS, SEVERITY_ORDER;
var init_probe = __esm({
  "src/lima/probe.ts"() {
    "use strict";
    DEFAULT_EXTENSIONS = [".py", ".ts", ".js", ".jsx", ".tsx"];
    DEFAULT_MAX_FILE_SIZE = 500 * 1024;
    SKIP_DIRS = /* @__PURE__ */ new Set([
      "node_modules",
      ".git",
      "venv",
      "__pycache__",
      ".lima",
      ".lima-code",
      "dist",
      "build",
      ".next",
      "coverage",
      ".tox",
      ".eggs",
      "egg-info",
      "deepcode-cli",
      "esp32S_XYZ",
      "donglicao-site"
    ]);
    SEVERITY_ORDER = { trivial: 0, small: 1, medium: 2 };
  }
});

// src/lima/drone.ts
var drone_exports = {};
__export(drone_exports, {
  probeOnly: () => probeOnly,
  runDroneLoop: () => runDroneLoop
});
import { execSync as execSync3 } from "child_process";
async function runDroneLoop(config, callbacks) {
  const t0 = Date.now();
  const messages = [];
  let tasksAttempted = 0;
  let tasksSucceeded = 0;
  let tasksFailed = 0;
  let checkpointUsed = false;
  const budget = createWorkerBudget({
    maxTasks: config.maxTasks,
    maxMinutes: config.maxMinutes
  });
  const existingCp = loadCheckpoint(config.projectRoot);
  if (existingCp && !isStale(existingCp)) {
    messages.push(`\u4ECE checkpoint \u6062\u590D: \u4EFB\u52A1 ${existingCp.taskId} (${existingCp.mode})`);
    checkpointUsed = true;
    const restored = rollbackSnapshots(config.projectRoot, existingCp);
    messages.push(`\u5DF2\u56DE\u6EDA ${restored} \u4E2A\u6587\u4EF6`);
    clearCheckpoint(config.projectRoot);
  } else if (existingCp && isStale(existingCp)) {
    messages.push(`\u53D1\u73B0\u8FC7\u671F checkpoint (\u4EFB\u52A1 ${existingCp.taskId})\uFF0C\u6B63\u5728\u56DE\u6EDA`);
    rollbackSnapshots(config.projectRoot, existingCp);
    clearCheckpoint(config.projectRoot);
  }
  const probeResult = probeCodebase(config.projectRoot);
  const findings = filterFindings(probeResult.findings, config.allowMediumRisk);
  messages.push(
    `\u63A2\u6D4B: \u5DF2\u626B\u63CF ${probeResult.scannedFiles} \u4E2A\u6587\u4EF6\uFF0C\u7528\u65F6 ${probeResult.scanDurationMs}ms\uFF0C\u53EF\u5904\u7406\u95EE\u9898 ${findings.length} \u4E2A`
  );
  if (findings.length === 0) {
    return buildReport(0, 0, 0, 0, probeResult.findings.length, t0, checkpointUsed, messages);
  }
  const processed = /* @__PURE__ */ new Set();
  while (findings.length > 0 && budget.canStartNext().ok) {
    const stop = readWorkerStop(config.projectRoot);
    if (stop.stop) {
      messages.push(`\u6536\u5230\u505C\u6B62\u8BF7\u6C42: ${stop.reason}`);
      break;
    }
    if (config.signal?.aborted) {
      messages.push("\u5DF2\u88AB\u5916\u90E8\u4FE1\u53F7\u4E2D\u6B62");
      break;
    }
    const finding = findings[0];
    if (processed.has(finding.id)) {
      findings.shift();
      continue;
    }
    tasksAttempted++;
    budget.recordTask();
    const taskConfig = findingToTask(finding, config.projectRoot);
    const taskId = `drone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const branch = getCurrentBranch(config.projectRoot);
    const taskRequest = {
      task_id: taskId,
      repo: config.projectRoot,
      branch,
      goal: taskConfig.goal,
      constraints: taskConfig.constraints,
      allowed_tools: taskConfig.allowedTools,
      max_runtime_sec: 300,
      mode: taskConfig.mode
    };
    const affectedFiles = [finding.file];
    const snapDir = snapshotFiles(config.projectRoot, affectedFiles);
    const checkpoint = {
      taskId,
      findingId: finding.id,
      mode: taskConfig.mode,
      status: "executing",
      snapshotDir: snapDir,
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      progress: ["claimed"]
    };
    saveCheckpoint(config.projectRoot, checkpoint);
    messages.push(
      `[${tasksAttempted}/${config.maxTasks}] ${finding.severity} ${finding.rule} -> ${finding.file}:${finding.line}`
    );
    await notifyBestEffort(callbacks.notify, {
      type: "task_started",
      taskId,
      status: "running",
      summary: finding.message
    });
    try {
      const result = await callbacks.runTask(taskRequest, {
        currentWorkspace: config.projectRoot,
        projectRoot: config.projectRoot
      });
      callbacks.writeAudit?.(config.projectRoot, taskRequest, result);
      if (result.status === "needs_review" || result.status === "succeeded") {
        tasksSucceeded++;
        processed.add(finding.id);
        messages.push(`  \u5B8C\u6210 ${result.status}: ${result.summary.slice(0, 80)}`);
        if (callbacks.submitResult) {
          const submitResult = await callbacks.submitResult(result);
          if (!submitResult.ok) {
            messages.push(`  \u63D0\u4EA4\u5931\u8D25: ${submitResult.error}`);
          }
        }
        await notifyBestEffort(callbacks.notify, {
          type: "task_finished",
          taskId,
          status: result.status,
          summary: result.summary
        });
      } else {
        tasksFailed++;
        messages.push(`  \u5931\u8D25 ${result.status}: ${result.summary.slice(0, 80)}`);
        recordTaskFailure(config.projectRoot, taskId, result.summary);
        const quarantine = shouldQuarantineTask(config.projectRoot, taskId);
        if (quarantine.quarantine) {
          messages.push(`  \u5DF2\u9694\u79BB: \u8FDE\u7EED\u5931\u8D25 ${quarantine.failureCount} \u6B21`);
          await notifyBestEffort(callbacks.notify, {
            type: "task_failed",
            taskId,
            status: "quarantined",
            summary: `\u5DF2\u9694\u79BB: ${quarantine.reason}`
          });
          break;
        }
        const restored = rollbackSnapshots(config.projectRoot, checkpoint);
        if (restored > 0) {
          messages.push(`  \u5DF2\u56DE\u6EDA ${restored} \u4E2A\u6587\u4EF6`);
        }
        await notifyBestEffort(callbacks.notify, {
          type: "task_failed",
          taskId,
          status: result.status,
          summary: result.summary
        });
      }
    } catch (err) {
      tasksFailed++;
      const errMsg = err instanceof Error ? err.message : String(err);
      messages.push(`  \u9519\u8BEF: ${errMsg.slice(0, 100)}`);
      recordTaskFailure(config.projectRoot, taskId, errMsg);
      rollbackSnapshots(config.projectRoot, checkpoint);
    }
    clearCheckpoint(config.projectRoot);
    findings.shift();
    if (findings.length > 0 && config.intervalMs > 0) {
      await sleepMs(config.intervalMs);
    }
  }
  const finalProbe = probeCodebase(config.projectRoot);
  const remainingFindings = filterFindings(finalProbe.findings, config.allowMediumRisk);
  const resolved = probeResult.findings.length - remainingFindings.length;
  messages.push(`\u6700\u7EC8\u63A2\u6D4B: \u5269\u4F59 ${remainingFindings.length} \u4E2A\u95EE\u9898\uFF0C\u5DF2\u89E3\u51B3 ${resolved} \u4E2A`);
  return buildReport(
    tasksAttempted,
    tasksSucceeded,
    tasksFailed,
    resolved,
    remainingFindings.length,
    t0,
    checkpointUsed,
    messages
  );
}
function probeOnly(projectRoot2, asJson) {
  const result = probeCodebase(projectRoot2);
  if (asJson) {
    return JSON.stringify(result, null, 2);
  }
  return formatProbeTable(result);
}
function filterFindings(findings, allowMedium) {
  return findings.filter((f) => {
    if (f.severity === "medium" && !allowMedium) return false;
    return true;
  });
}
function formatProbeTable(result) {
  const lines = [
    `\u5DF2\u626B\u63CF ${result.scannedFiles} \u4E2A\u6587\u4EF6\uFF0C\u7528\u65F6 ${result.scanDurationMs}ms`,
    `\u53D1\u73B0 ${result.findings.length} \u4E2A\u95EE\u9898`,
    ""
  ];
  if (result.findings.length === 0) {
    lines.push("\u672A\u53D1\u73B0\u53EF\u5904\u7406\u95EE\u9898\uFF0C\u4EE3\u7801\u5E93\u770B\u8D77\u6765\u5E72\u51C0\u3002");
    return lines.join("\n");
  }
  const bySeverity = { medium: [], small: [], trivial: [] };
  for (const f of result.findings) {
    bySeverity[f.severity]?.push(f);
  }
  for (const [sev, items] of Object.entries(bySeverity)) {
    if (items.length === 0) continue;
    lines.push(`-- ${sev.toUpperCase()} (${items.length}) --`);
    for (const f of items) {
      lines.push(`  ${f.file}:${f.line}  [${f.rule}]  ${f.message}`);
    }
    lines.push("");
  }
  lines.push("\u8FD0\u884C /lima drone \u81EA\u52A8\u5904\u7406 trivial \u548C small \u95EE\u9898\u3002");
  return lines.join("\n");
}
function buildReport(attempted, succeeded, failed, resolved, remaining, t0, checkpointUsed, messages) {
  return {
    tasksAttempted: attempted,
    tasksSucceeded: succeeded,
    tasksFailed: failed,
    findingsResolved: resolved,
    findingsRemaining: remaining,
    durationMs: Date.now() - t0,
    checkpointUsed,
    messages
  };
}
function getCurrentBranch(projectRoot2) {
  try {
    return execSync3("git rev-parse --abbrev-ref HEAD", {
      cwd: projectRoot2,
      encoding: "utf8",
      timeout: 5e3
    }).trim();
  } catch {
    return "main";
  }
}
async function notifyBestEffort(notify, event) {
  try {
    await notify?.(event);
  } catch {
  }
}
function sleepMs(ms) {
  return new Promise((resolve13) => setTimeout(resolve13, ms));
}
var init_drone = __esm({
  "src/lima/drone.ts"() {
    "use strict";
    init_checkpoint();
    init_probe();
    init_worker_control();
    init_failure_quarantine();
    init_worker_budget();
  }
});

// src/lima/command-runner.ts
var command_runner_exports = {};
__export(command_runner_exports, {
  executeLiMaCommand: () => executeLiMaCommand,
  formatLiMaCommandRunnerHelp: () => formatLiMaCommandRunnerHelp,
  formatVibeWorkflowHelp: () => formatVibeWorkflowHelp
});
async function executeLiMaCommand(input, options) {
  const parsed = parseLiMaCommand(input);
  if (!parsed.ok) {
    return { ok: false, message: parsed.error };
  }
  const client = options.client ?? new LiMaAgentTaskClient();
  const runTask = options.runTask ?? runLiMaAgentTask;
  const writeAudit = options.appendAudit ?? appendLiMaAuditEntry;
  const notify = options.notify ?? sendLiMaTelegramEvent;
  const lifecycleHooks = resolveLifecycleHooks(options);
  if (parsed.command.kind === "connect") {
    return client.isConfigured() ? { ok: true, message: "LiMa Server \u8FDE\u63A5\u5DF2\u914D\u7F6E\u3002" } : { ok: false, message: "LiMa Server \u5C1A\u672A\u914D\u7F6E\u3002\u8BF7\u8BBE\u7F6E LIMA_CODE_SERVER_URL \u548C LIMA_CODE_API_KEY\u3002" };
  }
  if (parsed.command.kind === "status") {
    return {
      ok: true,
      message: [
        `LiMa Code \u9879\u76EE: ${options.projectRoot}`,
        `LiMa Server \u914D\u7F6E: ${client.isConfigured() ? "\u5DF2\u914D\u7F6E" : "\u672A\u914D\u7F6E"}`
      ].join("\n")
    };
  }
  if (parsed.command.kind === "start") {
    return { ok: true, message: formatLiMaStartWorkbench(options.projectRoot, client.isConfigured()) };
  }
  if (parsed.command.kind === "doctor") {
    const report = await runLiMaDoctor({ projectRoot: options.projectRoot, client });
    return { ok: report.ok, message: formatLiMaDoctorReport(report) };
  }
  if (parsed.command.kind === "vibe") {
    return { ok: true, message: formatVibeWorkflowHelp() };
  }
  if (parsed.command.kind === "plan") {
    const task = buildLocalPlanTask(options.projectRoot);
    const result = await runTask(task, { currentWorkspace: options.projectRoot, projectRoot: options.projectRoot });
    writeAudit(options.projectRoot, task, result);
    return formatTaskResult(result, false);
  }
  if (parsed.command.kind === "test") {
    const task = buildLocalTestTask(options.projectRoot, parsed.command.command);
    const result = await runTask(task, { currentWorkspace: options.projectRoot, projectRoot: options.projectRoot });
    writeAudit(options.projectRoot, task, result);
    return formatTaskResult(result, false);
  }
  if (parsed.command.kind === "fix") {
    return runFixWorkflow(options.projectRoot, client, runTask, writeAudit, notify, lifecycleHooks);
  }
  if (parsed.command.kind === "review") {
    const task = buildLocalReviewTask(options.projectRoot);
    const result = await runTask(task, { currentWorkspace: options.projectRoot, projectRoot: options.projectRoot });
    writeAudit(options.projectRoot, task, result);
    return formatTaskResult(result, false);
  }
  if (parsed.command.kind === "ship") {
    const task = buildLocalShipTask(options.projectRoot);
    const result = await runTask(task, { currentWorkspace: options.projectRoot, projectRoot: options.projectRoot });
    writeAudit(options.projectRoot, task, result);
    return formatTaskResult(result, false);
  }
  if (parsed.command.kind === "probe") {
    const { probeOnly: probeOnly2 } = await Promise.resolve().then(() => (init_drone(), drone_exports));
    const output = probeOnly2(options.projectRoot, parsed.command.json);
    return { ok: true, message: output };
  }
  if (parsed.command.kind === "drone") {
    return runDroneMode(parsed.command, options, client, runTask, writeAudit, notify);
  }
  if (parsed.command.kind === "audit") {
    return {
      ok: true,
      message: formatAuditSummary(readRecentAuditEntries(options.projectRoot, parsed.command.limit))
    };
  }
  if (parsed.command.kind === "daemon") {
    if (parsed.command.action === "stop") {
      const marker = requestWorkerStop(options.projectRoot);
      return { ok: true, message: `\u5DF2\u8BF7\u6C42\u505C\u6B62 LiMa worker: ${marker}` };
    }
    if (parsed.command.action === "start") {
      if (process.env.LIMA_CODE_WORKER_DAEMON !== "1") {
        return {
          ok: false,
          message: "\u5E38\u9A7B daemon \u53D7\u5F00\u5173\u4FDD\u62A4\u3002\u7ECF\u64CD\u4F5C\u8005\u6279\u51C6\u540E\u8BBE\u7F6E LIMA_CODE_WORKER_DAEMON=1\uFF0C\u518D\u91CD\u8BD5 /lima daemon start\u3002"
        };
      }
      return runWorkLoop({
        command: {
          mode: "loop",
          maxTasks: 100,
          maxMinutes: parsed.command.maxMinutes,
          intervalMs: parsed.command.intervalMs,
          backoffMs: parsed.command.backoffMs
        },
        projectRoot: options.projectRoot,
        client,
        runTask,
        writeAudit,
        notify,
        lifecycleHooks,
        sleep: options.sleep ?? sleep,
        now: options.now,
        signal: options.signal,
        idleRetry: true
      });
    }
    const stop = readWorkerStop(options.projectRoot);
    return {
      ok: true,
      message: stop.stop ? `LiMa worker \u505C\u6B62\u8BF7\u6C42\u5F85\u5904\u7406: ${stop.reason}` : "LiMa worker \u5F53\u524D\u6CA1\u6709\u505C\u6B62\u8BF7\u6C42\u3002"
    };
  }
  if (parsed.command.kind === "next") {
    const fetched2 = await client.fetchPendingTask();
    if (!fetched2.ok) {
      return { ok: false, message: fetched2.error };
    }
    if (!fetched2.value) {
      return { ok: true, message: "\u5F53\u524D\u6CA1\u6709\u5F85\u5904\u7406\u7684 LiMa \u4EFB\u52A1\u3002" };
    }
    return runAndSubmitTask(fetched2.value, options.projectRoot, client, runTask, writeAudit, notify, lifecycleHooks);
  }
  if (parsed.command.kind === "work") {
    return runWorkLoop({
      command: parsed.command,
      projectRoot: options.projectRoot,
      client,
      runTask,
      writeAudit,
      notify,
      lifecycleHooks,
      sleep: options.sleep ?? sleep,
      now: options.now,
      signal: options.signal
    });
  }
  const fetched = await client.fetchTask(parsed.command.taskId);
  if (!fetched.ok) {
    return { ok: false, message: fetched.error };
  }
  return runAndSubmitTask(fetched.value, options.projectRoot, client, runTask, writeAudit, notify, lifecycleHooks);
}
function buildLocalReviewTask(projectRoot2) {
  return {
    task_id: "local-review",
    repo: projectRoot2,
    branch: "local",
    goal: "Review current git diff",
    constraints: [],
    allowed_tools: ["git_diff"],
    max_runtime_sec: 300,
    mode: "review"
  };
}
function formatLiMaStartWorkbench(projectRoot2, serverConfigured) {
  return [
    "LiMa Code \u5DE5\u4F5C\u53F0",
    `\u9879\u76EE: ${projectRoot2}`,
    `LiMa Server \u914D\u7F6E: ${serverConfigured ? "\u5DF2\u914D\u7F6E" : "\u672A\u914D\u7F6E"}`,
    "",
    "\u4ECE\u8FD9\u91CC\u5F00\u59CB:",
    "1. /lima doctor",
    "2. /lima review",
    '3. /lima test --cmd "npm run check"',
    "4. \u63D0\u95EE: \u4FEE\u590D/\u5BA1\u67E5/\u90E8\u7F72\u8FD9\u4E2A\u9879\u76EE",
    "",
    "\u670D\u52A1\u7AEF\u4EFB\u52A1:",
    "/lima next",
    "/lima work --once",
    "/lima work --loop --max-tasks <n>"
  ].join("\n");
}
function formatVibeWorkflowHelp() {
  return [
    "LiMa Code vibe coding workflow:",
    "1. /lima doctor  - confirm server, keys, worker, and audit state",
    "2. /lima plan    - turn the idea into an implementation plan",
    "3. /lima test    - run the project test command and inspect failures",
    "4. /lima review  - review diff, risks, evidence, and next action",
    "5. /lima ship    - final delivery check before handoff",
    "",
    "You can also type the goal directly, e.g. fix login error and deploy to VPS."
  ].join("\n");
}
function buildLocalPlanTask(projectRoot2) {
  return {
    task_id: "local-plan",
    repo: projectRoot2,
    branch: "local",
    goal: "Plan the next LiMa Code work slice",
    constraints: [
      "Keep the plan scoped to the current repository.",
      "Prefer small, testable changes with explicit verification commands."
    ],
    allowed_tools: ["git_diff"],
    max_runtime_sec: 300,
    mode: "plan"
  };
}
function buildLocalTestTask(projectRoot2, command) {
  return {
    task_id: "local-test",
    repo: projectRoot2,
    branch: "local",
    goal: "\u8FD0\u884C\u672C\u5730\u9A8C\u8BC1\u547D\u4EE4",
    constraints: [`\u547D\u4EE4: ${command}`],
    allowed_tools: ["test"],
    max_runtime_sec: 600,
    mode: "test",
    test_commands: [command]
  };
}
function buildLocalShipTask(projectRoot2) {
  return {
    task_id: "local-ship",
    repo: projectRoot2,
    branch: "local",
    goal: "\u5BA1\u67E5\u5F53\u524D git diff \u7684\u4EA4\u4ED8\u5C31\u7EEA\u72B6\u6001",
    constraints: ["\u786E\u8BA4\u53D8\u66F4\u6587\u4EF6\u3001\u9A8C\u8BC1\u8BC1\u636E\u3001\u56DE\u6EDA\u8BF4\u660E\u548C\u6B8B\u4F59\u98CE\u9669\u3002", "\u4E0D\u8981\u4ECE\u8FD9\u4E2A\u672C\u5730\u5C31\u7EEA\u68C0\u67E5\u4E2D\u90E8\u7F72\u6216\u63A8\u9001\u3002"],
    allowed_tools: ["git_diff"],
    max_runtime_sec: 300,
    mode: "ship"
  };
}
function formatTaskResult(result, submitted) {
  const lines = [
    `LiMa task ${result.task_id}: ${result.status}`,
    result.summary,
    submitted ? "\u7ED3\u679C\u5DF2\u63D0\u4EA4\u5230 LiMa Server\u3002" : "\u7ED3\u679C\u4FDD\u7559\u5728\u672C\u5730\u3002"
  ];
  if (result.changed_files.length > 0) {
    lines.push(`\u53D8\u66F4\u6587\u4EF6: ${result.changed_files.join(", ")}`);
  }
  if (result.next_action) {
    lines.push(`\u4E0B\u4E00\u6B65: ${result.next_action}`);
  }
  return { ok: result.status !== "failed" && result.status !== "blocked", message: lines.join("\n") };
}
async function runAndSubmitTask(task, projectRoot2, client, runTask, writeAudit, notify, lifecycleHooks) {
  await notifyBestEffort2(notify, {
    type: "task_started",
    taskId: task.task_id,
    status: "running",
    summary: task.goal
  });
  const activeSkills = evaluateLiMaSkillActivationForProject(task, projectRoot2);
  runLifecycleHookBestEffort(() => lifecycleHooks?.onTaskStart(task, activeSkills));
  const result = await runTask(task, { currentWorkspace: projectRoot2, projectRoot: projectRoot2 });
  writeAudit(projectRoot2, task, result);
  runLifecycleHookBestEffort(() => lifecycleHooks?.onTaskStop(result));
  const submitted = await client.submitResult(result);
  if (!submitted.ok) {
    return { ok: false, message: `\u4EFB\u52A1 ${result.task_id} \u5DF2\u8FD0\u884C\uFF0C\u4F46\u7ED3\u679C\u63D0\u4EA4\u5931\u8D25: ${submitted.error}` };
  }
  await notifyBestEffort2(notify, eventForTaskResult(result));
  return formatTaskResult(result, true);
}
async function runWorkLoop(options) {
  const taskLines = [];
  const budget = createWorkerBudget({
    maxTasks: options.command.maxTasks,
    maxMinutes: options.command.maxMinutes,
    now: options.now
  });
  let processed = 0;
  while (true) {
    const stop = readWorkerStop(options.projectRoot);
    if (stop.stop) {
      await notifyBestEffort2(options.notify, {
        type: "work_stopped",
        summary: `LiMa work \u56E0\u505C\u6B62\u6807\u8BB0\u9000\u51FA: ${stop.reason}`
      });
      return { ok: true, message: `LiMa work \u56E0\u505C\u6B62\u6807\u8BB0\u9000\u51FA: ${stop.reason}` };
    }
    if (options.signal?.aborted) {
      await notifyBestEffort2(options.notify, {
        type: "work_stopped",
        summary: `LiMa work \u5728\u5904\u7406 ${processed} \u4E2A\u4EFB\u52A1\u540E\u88AB\u4E2D\u65AD\u3002`
      });
      return { ok: false, message: `LiMa work \u5728\u5904\u7406 ${processed} \u4E2A\u4EFB\u52A1\u540E\u88AB\u4E2D\u65AD\u3002` };
    }
    const budgetDecision = budget.canStartNext();
    if (!budgetDecision.ok) {
      await notifyBestEffort2(options.notify, {
        type: "work_stopped",
        summary: budgetDecision.reason
      });
      return {
        ok: true,
        message: [`LiMa work \u5DF2\u5904\u7406 ${processed} \u4E2A\u4EFB\u52A1\u3002`, ...taskLines, budgetDecision.reason].join("\n")
      };
    }
    const fetched = await options.client.fetchPendingTask();
    if (!fetched.ok) {
      await waitAfterFailure(options.command.backoffMs, options.sleep, options.signal);
      await notifyBestEffort2(options.notify, {
        type: "work_stopped",
        summary: `LiMa work \u56E0\u62C9\u53D6\u4EFB\u52A1\u5931\u8D25\u800C\u505C\u6B62: ${fetched.error}`
      });
      return { ok: false, message: `LiMa work \u56E0\u62C9\u53D6\u4EFB\u52A1\u5931\u8D25\u800C\u505C\u6B62: ${fetched.error}` };
    }
    if (!fetched.value) {
      if (options.idleRetry) {
        await options.sleep(options.command.intervalMs, options.signal);
        continue;
      }
      const prefix = processed > 0 ? `LiMa work \u5DF2\u5904\u7406 ${processed} \u4E2A\u4EFB\u52A1\u3002` : "";
      await notifyBestEffort2(options.notify, {
        type: "work_stopped",
        summary: `${prefix}\u5F53\u524D\u6CA1\u6709\u5F85\u5904\u7406\u7684 LiMa \u4EFB\u52A1\u3002`
      });
      return { ok: true, message: `${prefix}\u5F53\u524D\u6CA1\u6709\u5F85\u5904\u7406\u7684 LiMa \u4EFB\u52A1\u3002` };
    }
    const result = await runAndSubmitTask(
      fetched.value,
      options.projectRoot,
      options.client,
      options.runTask,
      options.writeAudit,
      options.notify,
      options.lifecycleHooks
    );
    processed += 1;
    budget.recordTask();
    taskLines.push(firstLine(result.message));
    if (!result.ok) {
      const failure = recordTaskFailure(options.projectRoot, fetched.value.task_id, result.message);
      const quarantine = shouldQuarantineTask(options.projectRoot, fetched.value.task_id, 3);
      if (quarantine.quarantine && options.client.quarantineTask) {
        await notifyBestEffort2(options.notify, {
          type: "quarantine_requested",
          taskId: fetched.value.task_id,
          status: "quarantined",
          summary: quarantine.reason
        });
        const quarantined = await options.client.quarantineTask(fetched.value.task_id);
        if (!quarantined.ok) {
          return {
            ok: false,
            message: [
              `LiMa work \u5728\u5904\u7406 ${processed} \u4E2A\u4EFB\u52A1\u540E\u505C\u6B62\u3002`,
              ...taskLines,
              `\u4EFB\u52A1 ${fetched.value.task_id} \u5DF2\u8FBE\u5230\u9694\u79BB\u9608\u503C\uFF0C\u4F46 Server \u66F4\u65B0\u5931\u8D25: ${quarantined.error}`
            ].join("\n")
          };
        }
        return {
          ok: false,
          message: [
            `LiMa work \u5728\u5904\u7406 ${processed} \u4E2A\u4EFB\u52A1\u540E\u505C\u6B62\u3002`,
            ...taskLines,
            `\u4EFB\u52A1 ${fetched.value.task_id} \u5728 ${failure.failure_count} \u6B21\u5931\u8D25\u540E\u88AB\u9694\u79BB: ${quarantine.reason}`
          ].join("\n")
        };
      }
      await waitAfterFailure(options.command.backoffMs, options.sleep, options.signal);
      return {
        ok: false,
        message: [`LiMa work \u5728\u5904\u7406 ${processed} \u4E2A\u4EFB\u52A1\u540E\u505C\u6B62\u3002`, ...taskLines, result.message].join("\n")
      };
    }
    if (options.command.mode === "once" || processed >= options.command.maxTasks) {
      break;
    }
    await options.sleep(options.command.intervalMs, options.signal);
  }
  return { ok: true, message: [`LiMa work \u5DF2\u5904\u7406 ${processed} \u4E2A\u4EFB\u52A1\u3002`, ...taskLines].join("\n") };
}
function firstLine(value) {
  return value.split(/\r?\n/, 1)[0] ?? value;
}
function eventForTaskResult(result) {
  if (result.status === "needs_review") {
    return {
      type: "task_needs_review",
      taskId: result.task_id,
      status: result.status,
      summary: result.summary,
      changedFiles: result.changed_files
    };
  }
  if (result.status === "failed" || result.status === "blocked") {
    return {
      type: "task_failed",
      taskId: result.task_id,
      status: result.status,
      summary: result.summary,
      changedFiles: result.changed_files
    };
  }
  return {
    type: "task_finished",
    taskId: result.task_id,
    status: result.status,
    summary: result.summary,
    changedFiles: result.changed_files
  };
}
async function notifyBestEffort2(notify, event) {
  try {
    await notify(event);
  } catch {
  }
}
function resolveLifecycleHooks(options) {
  if (options.lifecycleHooks === false) {
    return null;
  }
  if (options.lifecycleHooks) {
    return options.lifecycleHooks;
  }
  if (options.client) {
    return null;
  }
  return createLiMaFilesystemLifecycleHooks(options.projectRoot);
}
function runLifecycleHookBestEffort(callback) {
  try {
    callback();
  } catch {
  }
}
async function waitAfterFailure(backoffMs, sleepImpl, signal) {
  try {
    await sleepImpl(backoffMs, signal);
  } catch {
  }
}
function sleep(ms, signal) {
  return new Promise((resolve13, reject) => {
    if (signal?.aborted) {
      reject(new Error("LiMa work \u5DF2\u4E2D\u65AD\u3002"));
      return;
    }
    const timer = setTimeout(resolve13, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("LiMa work \u5DF2\u4E2D\u65AD\u3002"));
      },
      { once: true }
    );
  });
}
async function runFixWorkflow(projectRoot2, client, runTask, writeAudit, notify, lifecycleHooks) {
  const fetched = await client.fetchPendingTask();
  if (!fetched.ok) {
    return { ok: false, message: `\u62C9\u53D6\u4EFB\u52A1\u5931\u8D25: ${fetched.error}` };
  }
  if (!fetched.value) {
    return { ok: true, message: "\u5F53\u524D\u6CA1\u6709\u5F85\u5904\u7406\u7684 LiMa \u4EFB\u52A1\u3002" };
  }
  const task = fetched.value;
  await notifyBestEffort2(notify, {
    type: "task_started",
    taskId: task.task_id,
    status: "running",
    summary: task.goal
  });
  const activeSkills = evaluateLiMaSkillActivationForProject(task, projectRoot2);
  runLifecycleHookBestEffort(() => lifecycleHooks?.onTaskStart(task, activeSkills));
  const planResult = await runTask(
    { ...task, mode: "plan" },
    { currentWorkspace: projectRoot2, projectRoot: projectRoot2 }
  );
  let testResult = null;
  const testCommands = task.test_commands ?? [];
  if (testCommands.length > 0) {
    testResult = await runTask(
      {
        ...task,
        mode: "test",
        test_commands: testCommands,
        allowed_tools: [...task.allowed_tools, "test"]
      },
      { currentWorkspace: projectRoot2, projectRoot: projectRoot2 }
    );
  }
  const lines = [
    `LiMa fix \u5DE5\u4F5C\u6D41\u5DF2\u4E3A\u4EFB\u52A1 ${task.task_id} \u51C6\u5907\u5C31\u7EEA: ${task.goal}`,
    `\u4EA7\u7269\u76EE\u5F55: .lima/artifacts/${task.task_id}/`,
    testResult ? `\u6D4B\u8BD5\u7ED3\u679C: ${testResult.status === "succeeded" ? "\u5168\u90E8\u901A\u8FC7" : "\u53D1\u73B0\u5931\u8D25"}` : "\u672A\u6307\u5B9A\u6D4B\u8BD5\u547D\u4EE4\u3002",
    planResult.artifacts.length > 0 ? `\u8BA1\u5212\u6587\u4EF6: ${planResult.artifacts.join(", ")}` : "\u8BA1\u5212\u4EA7\u7269\u5DF2\u5199\u5165\u3002",
    "",
    "\u4E0B\u4E00\u6B65:",
    "1. \u5BA1\u67E5 plan.md \u548C context.json",
    "2. \u4FEE\u590D\u5931\u8D25\u6D4B\u8BD5\u6216\u5B9E\u73B0\u4EFB\u52A1",
    testCommands.length > 0 ? `3. \u9A8C\u8BC1: /lima test --cmd "${testCommands[0]}"` : "",
    testCommands.length > 1 ? `   ...\u5176\u4F59\u547D\u4EE4: ${testCommands.slice(1).join(", ")}` : "",
    `4. \u51C6\u5907\u597D\u540E\u4EA4\u4ED8: /lima ship\uFF08\u4F1A\u63D0\u4EA4\u7ED3\u679C\uFF09`,
    testResult && testResult.status !== "succeeded" ? "\n\u63D0\u793A: \u67E5\u770B\u4EA7\u7269\u76EE\u5F55\u4E2D\u7684 tests.json \u4E86\u89E3\u5931\u8D25\u8BE6\u60C5\u3002" : ""
  ].filter(Boolean).join("\n");
  writeAudit(projectRoot2, task, planResult);
  return { ok: true, message: lines };
}
async function runDroneMode(command, options, client, runTask, writeAudit, notify) {
  const { runDroneLoop: runDroneLoop2 } = await Promise.resolve().then(() => (init_drone(), drone_exports));
  const report = await runDroneLoop2(
    {
      projectRoot: options.projectRoot,
      maxTasks: command.maxTasks,
      maxMinutes: command.maxMinutes,
      allowMediumRisk: command.allowMediumRisk,
      intervalMs: command.intervalMs,
      signal: options.signal
    },
    {
      runTask,
      submitResult: client.isConfigured() ? async (result) => {
        const r = await client.submitResult(result);
        return { ok: r.ok, error: r.ok ? void 0 : r.error };
      } : void 0,
      writeAudit,
      notify: options.notify ?? notify
    }
  );
  const lines = [
    `Drone \u5DF2\u5B8C\u6210\uFF0C\u7528\u65F6 ${(report.durationMs / 1e3).toFixed(1)}s`,
    `\u4EFB\u52A1: ${report.tasksSucceeded}/${report.tasksAttempted} \u6210\u529F\uFF0C${report.tasksFailed} \u5931\u8D25`,
    `\u53D1\u73B0\u9879: ${report.findingsResolved} \u5DF2\u89E3\u51B3\uFF0C${report.findingsRemaining} \u5269\u4F59`,
    report.checkpointUsed ? "\u5DF2\u4F7F\u7528 checkpoint \u6062\u590D" : "",
    "",
    ...report.messages
  ].filter(Boolean).join("\n");
  return { ok: report.tasksFailed === 0, message: lines };
}
function formatLiMaCommandRunnerHelp() {
  return formatLiMaCommandHelp();
}
var init_command_runner = __esm({
  "src/lima/command-runner.ts"() {
    "use strict";
    init_agent_task_client();
    init_audit_log();
    init_audit_reader();
    init_commands();
    init_doctor();
    init_failure_quarantine();
    init_lifecycle_hooks();
    init_skill_activation();
    init_task_runner();
    init_telegram_notifier();
    init_worker_budget();
    init_worker_control();
  }
});

// src/ui/App.tsx
var App_exports = {};
__export(App_exports, {
  App: () => App,
  buildPromptDraftFromSessionMessage: () => buildPromptDraftFromSessionMessage,
  buildStatusLine: () => buildStatusLine,
  createOpenAIClient: () => createOpenAIClient,
  readProjectSettings: () => readProjectSettings,
  readSettings: () => readSettings,
  resolveCurrentSettings: () => resolveCurrentSettings,
  writeModelConfigSelection: () => writeModelConfigSelection,
  writeProjectSettings: () => writeProjectSettings,
  writeSettings: () => writeSettings
});
import { useCallback as useCallback4, useEffect as useEffect8, useLayoutEffect as useLayoutEffect2, useMemo as useMemo9, useRef as useRef6, useState as useState13 } from "react";
import { Box as Box13, Static, Text as Text14, useApp as useApp2, useStdout as useStdout2, useWindowSize as useWindowSize4 } from "ink";
import chalk5 from "chalk";
import * as fs26 from "fs";
import * as os10 from "os";
import * as path28 from "path";
import { jsx as jsx18, jsxs as jsxs13 } from "react/jsx-runtime";
function App({ projectRoot: projectRoot2, initialPrompt: initialPrompt2, onRestart }) {
  const { exit } = useApp2();
  const { stdout, write } = useStdout2();
  const { columns, rows } = useWindowSize4();
  const { mode, setMode } = useRawModeContext();
  const initialPromptSubmittedRef = useRef6(false);
  const processStdoutRef = useRef6(/* @__PURE__ */ new Map());
  const rawModeRef = useRef6(mode);
  const writeRef = useRef6(write);
  const lastRenderedColumnsRef = useRef6(null);
  const messagesRef = useRef6([]);
  const limaCommandAbortRef = useRef6(null);
  const [view, setView] = useState13("chat");
  const [busy, setBusy] = useState13(false);
  const [skills, setSkills] = useState13([]);
  const [messages, setMessages] = useState13([]);
  const [sessions, setSessions] = useState13([]);
  const [undoTargets, setUndoTargets] = useState13([]);
  const [promptDraft, setPromptDraft] = useState13(null);
  const [statusLine, setStatusLine] = useState13("");
  const [errorLine, setErrorLine] = useState13(null);
  const [streamProgress, setStreamProgress] = useState13(null);
  const [runningProcesses, setRunningProcesses] = useState13(null);
  const [activeStatus, setActiveStatus] = useState13(null);
  const [activeEntry, setActiveEntry] = useState13(null);
  const [dismissedQuestionIds, setDismissedQuestionIds] = useState13(() => /* @__PURE__ */ new Set());
  const [isExiting, setIsExiting] = useState13(false);
  const [showWelcome, setShowWelcome] = useState13(true);
  const [welcomeNonce, setWelcomeNonce] = useState13(0);
  const [resolvedSettings, setResolvedSettings] = useState13(() => resolveCurrentSettings(projectRoot2));
  const [nowTick, setNowTick] = useState13(0);
  const [mcpStatuses, setMcpStatuses] = useState13([]);
  const [showProcessStdout, setShowProcessStdout] = useState13(false);
  rawModeRef.current = mode;
  messagesRef.current = messages;
  const sessionManager = useMemo9(() => {
    return new SessionManager({
      projectRoot: projectRoot2,
      createOpenAIClient: () => createOpenAIClient(projectRoot2),
      getResolvedSettings: () => resolveCurrentSettings(projectRoot2),
      renderMarkdown: (text) => text,
      onAssistantMessage: (message) => {
        setMessages((prev) => [...prev, message]);
        if (rawModeRef.current === "Raw scrollback mode" /* Raw */) {
          process.stdout.write("\n");
          process.stdout.write(renderMessageToStdout(message, rawModeRef.current) + "\n\n");
        }
      },
      onSessionEntryUpdated: (entry) => {
        setActiveEntry(entry);
        setStatusLine(buildStatusLine(entry));
        setRunningProcesses(entry.processes);
        setActiveStatus(entry.status);
      },
      onLlmStreamProgress: (progress) => {
        if (progress.phase === "end") {
          setStreamProgress(null);
          return;
        }
        setStreamProgress(progress);
      },
      onMcpStatusChanged: () => {
        setMcpStatuses(sessionManager.getMcpStatus());
      },
      onProcessStdout: (pid, chunk) => {
        const buf = processStdoutRef.current;
        const current = buf.get(pid) ?? "";
        const MAX_STDOUT_BUFFER = 1e6;
        if (current.length >= MAX_STDOUT_BUFFER) {
          return;
        }
        const text = typeof chunk === "string" ? chunk : String(chunk);
        const available = MAX_STDOUT_BUFFER - current.length;
        buf.set(pid, current + text.slice(0, available));
      }
    });
  }, [projectRoot2]);
  useEffect8(() => {
    if (!busy) {
      return;
    }
    const id = setInterval(() => setNowTick((tick) => tick + 1), 500);
    return () => clearInterval(id);
  }, [busy]);
  function loadVisibleMessages(manager, sessionId) {
    return manager.listSessionMessages(sessionId).filter((m) => m.visible);
  }
  const refreshSessionsList = useCallback4(() => {
    setSessions(sessionManager.listSessions());
  }, [sessionManager]);
  const refreshSkills = useCallback4(
    async (sessionId) => {
      try {
        const list = await sessionManager.listSkills(sessionId ?? sessionManager.getActiveSessionId() ?? void 0);
        setSkills(list);
      } catch {
      }
    },
    [sessionManager]
  );
  useEffect8(() => {
    refreshSessionsList();
    void refreshSkills();
  }, [refreshSessionsList, refreshSkills]);
  useEffect8(() => {
    createOpenAIClient(projectRoot2);
  }, [projectRoot2]);
  useLayoutEffect2(() => {
    const settings = resolveCurrentSettings(projectRoot2);
    void sessionManager.initMcpServers(settings.mcpServers);
  }, [projectRoot2, sessionManager]);
  useEffect8(() => {
    return () => {
      sessionManager.dispose();
    };
  }, [sessionManager]);
  writeRef.current = write;
  const handlePrompt = useCallback4(
    async (submission) => {
      if (submission.command === "exit") {
        setIsExiting(true);
        setTimeout(() => {
          const activeSessionId = sessionManager.getActiveSessionId();
          const session = activeSessionId ? sessionManager.getSession(activeSessionId) : null;
          const summary = buildExitSummaryText({ session });
          process.stdout.write("\n");
          process.stdout.write(chalk5.rgb(34, 154, 195)("> /exit "));
          process.stdout.write("\n\n");
          process.stdout.write(summary);
          process.stdout.write("\n\n");
          sessionManager.dispose();
          exit();
        }, 0);
        return;
      }
      if (submission.command === "new") {
        if (onRestart) {
          onRestart();
        } else {
          writeRef.current("\x1B[2J\x1B[3J\x1B[H");
          sessionManager.setActiveSessionId(null);
          setMessages([]);
          setStatusLine("");
          setErrorLine(null);
          setActiveEntry(null);
          setRunningProcesses(null);
          setActiveStatus(null);
          setDismissedQuestionIds(/* @__PURE__ */ new Set());
          setShowWelcome(true);
          setWelcomeNonce((n) => n + 1);
          await refreshSkills();
          refreshSessionsList();
        }
        return;
      }
      if (submission.command === "resume") {
        setShowWelcome(false);
        refreshSessionsList();
        setView("session-list");
        return;
      }
      if (submission.command === "continue" && isCurrentSessionEmpty(sessionManager)) {
        setShowWelcome(false);
        refreshSessionsList();
        setView("session-list");
        return;
      }
      if (submission.command === "undo") {
        const activeSessionId = sessionManager.getActiveSessionId();
        if (!activeSessionId) {
          setErrorLine("No active session to undo.");
          return;
        }
        setShowWelcome(false);
        setUndoTargets(sessionManager.listUndoTargets(activeSessionId));
        setView("undo");
        return;
      }
      if (submission.command === "mcp") {
        setShowWelcome(false);
        setMcpStatuses(sessionManager.getMcpStatus());
        setView("mcp-status");
        return;
      }
      if (submission.command === "lima") {
        setShowWelcome(false);
        setBusy(true);
        setErrorLine(null);
        setMessages((prev) => [...prev, buildSyntheticUserMessage(submission.text, 0)]);
        const abortController = new AbortController();
        limaCommandAbortRef.current = abortController;
        try {
          const result = await executeLiMaCommand(submission.text, { projectRoot: projectRoot2, signal: abortController.signal });
          setMessages((prev) => [...prev, buildSyntheticAssistantMessage(result.message)]);
          if (!result.ok) {
            setErrorLine(result.message);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setErrorLine(message);
          setMessages((prev) => [...prev, buildSyntheticAssistantMessage(message)]);
        } finally {
          setBusy(false);
          setStreamProgress(null);
          setRunningProcesses(null);
          setActiveEntry(null);
          limaCommandAbortRef.current = null;
        }
        return;
      }
      const prompt = {
        text: submission.text,
        imageUrls: submission.imageUrls,
        skills: submission.selectedSkills && submission.selectedSkills.length > 0 ? submission.selectedSkills : void 0
      };
      const trimmedText = (submission.text ?? "").trim();
      const selectedSkillNames = submission.selectedSkills?.map((skill) => skill.name).filter(Boolean) ?? [];
      const userDisplayContent = trimmedText || (selectedSkillNames.length > 0 ? `Use skills: ${selectedSkillNames.join(", ")}` : "") || (submission.imageUrls.length > 0 ? "[Image]" : "");
      if (userDisplayContent && submission.command !== "continue") {
        setMessages((prev) => [...prev, buildSyntheticUserMessage(userDisplayContent, submission.imageUrls.length)]);
      }
      setBusy(true);
      setErrorLine(null);
      setRunningProcesses(null);
      setShowProcessStdout(false);
      processStdoutRef.current.clear();
      try {
        await sessionManager.handleUserPrompt(prompt);
        await refreshSkills();
        refreshSessionsList();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setErrorLine(message);
      } finally {
        setBusy(false);
        setStreamProgress(null);
        setRunningProcesses(null);
      }
    },
    [exit, onRestart, projectRoot2, sessionManager, refreshSkills, refreshSessionsList]
  );
  const handleInterrupt = useCallback4(() => {
    if (limaCommandAbortRef.current) {
      limaCommandAbortRef.current.abort();
      return;
    }
    sessionManager.interruptActiveSession();
  }, [sessionManager]);
  const handleToggleProcessStdout = useCallback4(() => {
    setShowProcessStdout(true);
  }, []);
  const handleDismissProcessStdout = useCallback4(() => {
    setShowProcessStdout(false);
  }, []);
  const handleAdjustBashTimeout = useCallback4(
    (deltaMs) => sessionManager.adjustActiveBashTimeout(deltaMs),
    [sessionManager]
  );
  const handleModelConfigChange = useCallback4(
    (selection) => {
      const current = resolveCurrentSettings(projectRoot2);
      const { changed } = writeModelConfigSelection(selection, current, projectRoot2);
      const next = resolveCurrentSettings(projectRoot2);
      setResolvedSettings(next);
      if (!changed) {
        return "\u6A21\u578B\u8BBE\u7F6E\u672A\u53D8\u5316";
      }
      const activeSessionId = sessionManager.getActiveSessionId();
      const meta = {
        isModelChange: true
      };
      const content = `/model
\u2514 \u5DF2\u5207\u6362\u6A21\u578B\u5230 ${selection.model} (${formatThinkingMode(selection)})`;
      if (activeSessionId) {
        sessionManager.addSessionSystemMessage(activeSessionId, content, true, meta);
      } else {
        const now = (/* @__PURE__ */ new Date()).toISOString();
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            sessionId: "local",
            role: "system",
            content,
            contentParams: null,
            messageParams: null,
            compacted: false,
            visible: true,
            createTime: now,
            updateTime: now,
            meta
          }
        ]);
      }
      return `\u6A21\u578B\u8BBE\u7F6E\u5DF2\u66F4\u65B0\uFF1A${formatModelConfig(current)} \u2192 ${formatModelConfig(next)}`;
    },
    [projectRoot2, sessionManager]
  );
  const handleSubmit = useCallback4(
    (submission) => {
      void handlePrompt(submission);
    },
    [handlePrompt]
  );
  const reloadActiveSessionView = useCallback4(
    (sessionId) => {
      process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
      setMessages([]);
      setShowWelcome(false);
      setWelcomeNonce((n) => n + 1);
      setTimeout(() => {
        setMessages(loadVisibleMessages(sessionManager, sessionId));
        setShowWelcome(true);
      }, 0);
    },
    [sessionManager]
  );
  useEffect8(() => {
    if (initialPromptSubmittedRef.current || !initialPrompt2 || !initialPrompt2.trim()) {
      return;
    }
    initialPromptSubmittedRef.current = true;
    handleSubmit({
      text: initialPrompt2,
      imageUrls: [],
      selectedSkills: void 0
    });
  }, [handleSubmit, initialPrompt2]);
  const handleSelectSession = useCallback4(
    async (sessionId) => {
      const currentSessionId = sessionManager.getActiveSessionId();
      if (currentSessionId !== sessionId) {
        process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
      }
      sessionManager.setActiveSessionId(sessionId);
      setMessages([]);
      setShowWelcome(false);
      setWelcomeNonce((n) => n + 1);
      setView("chat");
      setTimeout(() => {
        setMessages(loadVisibleMessages(sessionManager, sessionId));
        setShowWelcome(true);
      }, 0);
      const session = sessionManager.getSession(sessionId);
      setStatusLine(session ? buildStatusLine(session) : "");
      setActiveEntry(session ?? null);
      setRunningProcesses(session?.processes ?? null);
      setActiveStatus(session?.status ?? null);
      await refreshSkills(sessionId);
    },
    [sessionManager, refreshSkills]
  );
  const handleUndoRestore = useCallback4(
    async (target, restoreMode) => {
      const sessionId = sessionManager.getActiveSessionId();
      if (!sessionId) {
        setErrorLine("No active session to undo.");
        setView("chat");
        setShowWelcome(true);
        return;
      }
      const errors = [];
      if (restoreMode === "code-and-conversation") {
        try {
          sessionManager.restoreSessionCode(sessionId, target.message.id);
        } catch (error) {
          errors.push(`\u4EE3\u7801\u6062\u590D\u5931\u8D25: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      let conversationRestored = false;
      try {
        sessionManager.restoreSessionConversation(sessionId, target.message.id);
        conversationRestored = true;
      } catch (error) {
        errors.push(`\u4F1A\u8BDD\u6062\u590D\u5931\u8D25: ${error instanceof Error ? error.message : String(error)}`);
      }
      refreshSessionsList();
      await refreshSkills(sessionId);
      setView("chat");
      setErrorLine(errors.length > 0 ? errors.join(" ") : null);
      if (conversationRestored) {
        setPromptDraft(buildPromptDraftFromSessionMessage(target.message, Date.now()));
      }
      reloadActiveSessionView(sessionId);
    },
    [reloadActiveSessionView, refreshSessionsList, refreshSkills, sessionManager]
  );
  const handleRawModeChange = useCallback4(
    (nextMode) => {
      const activeSessionId = sessionManager.getActiveSessionId();
      setMode(nextMode);
      setShowWelcome(false);
      setMessages([]);
      process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
      setTimeout(() => {
        if (nextMode === "Raw scrollback mode" /* Raw */) {
          const allMessages = activeSessionId ? loadVisibleMessages(sessionManager, activeSessionId) : [];
          for (const msg of allMessages) {
            process.stdout.write("\n");
            process.stdout.write(renderMessageToStdout(msg, nextMode) + "\n\n");
          }
          if (allMessages.length > 0) {
            process.stdout.write("\n\n");
            process.stdout.write(chalk5.dim("\u6309 ESC \u9000\u51FA\u539F\u59CB\u6A21\u5F0F"));
          } else {
            process.stdout.write("\n");
            process.stdout.write(chalk5.dim("(\u5F53\u524D\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u6D88\u606F\u3002\u53D1\u9001\u4E00\u6761\u6D88\u606F\u540E\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\u3002)"));
            process.stdout.write("\n\n");
            process.stdout.write(chalk5.dim("\u6309 ESC \u9000\u51FA\u539F\u59CB\u6A21\u5F0F"));
          }
        } else if (activeSessionId) {
          handleSelectSession(activeSessionId);
        } else {
          setWelcomeNonce((n) => n + 1);
          setShowWelcome(true);
        }
      }, 200);
    },
    [handleSelectSession, sessionManager, setMode]
  );
  useEffect8(() => {
    if (!stdout?.isTTY) {
      return;
    }
    if (columns <= 0) {
      return;
    }
    if (lastRenderedColumnsRef.current === null) {
      lastRenderedColumnsRef.current = columns;
      return;
    }
    if (lastRenderedColumnsRef.current === columns) {
      return;
    }
    lastRenderedColumnsRef.current = columns;
    if (mode === "Raw scrollback mode" /* Raw */) {
      process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
      const activeSessionId2 = sessionManager.getActiveSessionId();
      const allMessages = activeSessionId2 ? loadVisibleMessages(sessionManager, activeSessionId2) : [];
      for (const msg of allMessages) {
        process.stdout.write("\n");
        process.stdout.write(renderMessageToStdout(msg, mode) + "\n\n");
      }
      if (allMessages.length > 0) {
        process.stdout.write("\n\n");
        process.stdout.write(chalk5.dim("\u6309 ESC \u9000\u51FA\u539F\u59CB\u6A21\u5F0F"));
      } else {
        process.stdout.write("\n");
        process.stdout.write(chalk5.dim("(\u5F53\u524D\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u6D88\u606F\u3002\u53D1\u9001\u4E00\u6761\u6D88\u606F\u540E\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\u3002)"));
        process.stdout.write("\n\n");
        process.stdout.write(chalk5.dim("\u6309 ESC \u9000\u51FA\u539F\u59CB\u6A21\u5F0F"));
      }
      return;
    }
    writeRef.current("\x1B[2J\x1B[H");
    setMessages([]);
    setShowWelcome(false);
    setWelcomeNonce((n) => n + 1);
    const activeSessionId = sessionManager.getActiveSessionId();
    const nextMessages = activeSessionId && !busy ? loadVisibleMessages(sessionManager, activeSessionId) : messagesRef.current;
    setTimeout(() => {
      setMessages(nextMessages);
      setShowWelcome(true);
    }, 0);
  }, [busy, mode, sessionManager, columns, stdout]);
  const screenWidth = useMemo9(() => columns ?? stdout?.columns ?? 80, [columns, stdout]);
  const screenHeight = useMemo9(() => rows ?? stdout?.rows ?? 24, [rows, stdout]);
  const promptHistory = useMemo9(() => {
    return messages.filter((message) => message.role === "user" && typeof message.content === "string").map((message) => (message.content ?? "").trim()).filter((content) => content.length > 0);
  }, [messages]);
  const expandedThinkingId = findExpandedThinkingId(messages);
  const pendingQuestion = useMemo9(() => findPendingAskUserQuestion(messages, activeStatus), [activeStatus, messages]);
  const shouldShowQuestionPrompt = Boolean(pendingQuestion && !dismissedQuestionIds.has(pendingQuestion.messageId));
  const loadingText = useMemo9(
    () => busy ? buildLoadingText({ progress: streamProgress, processes: runningProcesses, now: Date.now() }) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nowTick forces periodic recalculation for spinner animation
    [busy, streamProgress, runningProcesses, nowTick]
  );
  const runtimeStatusNow = Date.now();
  const runtimeStatus = useMemo9(
    () => buildRuntimeStatusViewModel({
      entry: activeEntry,
      progress: streamProgress,
      processes: runningProcesses,
      mcpStatuses,
      settings: {
        model: resolvedSettings.model,
        thinkingEnabled: resolvedSettings.thinkingEnabled,
        reasoningEffort: resolvedSettings.reasoningEffort
      },
      errorLine,
      now: runtimeStatusNow,
      busy,
      width: screenWidth
    }),
    [
      activeEntry,
      busy,
      errorLine,
      mcpStatuses,
      resolvedSettings.model,
      resolvedSettings.reasoningEffort,
      resolvedSettings.thinkingEnabled,
      runtimeStatusNow,
      runningProcesses,
      screenWidth,
      streamProgress
    ]
  );
  const promptScreenWidth = runtimeStatus.visible && runtimeStatus.layoutMode === "wide" ? Math.max(80, screenWidth - RUNTIME_STATUS_PANEL_WIDTH) : screenWidth;
  const welcomeItem = useMemo9(
    () => ({
      id: `__welcome__${welcomeNonce}`,
      sessionId: "",
      role: "system",
      content: "",
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: "",
      updateTime: ""
    }),
    [welcomeNonce]
  );
  const staticItems = useMemo9(() => {
    if (mode === "Raw scrollback mode" /* Raw */) {
      return [];
    }
    if (showWelcome && view === "chat") {
      return [welcomeItem, ...messages];
    }
    return messages;
  }, [mode, showWelcome, view, messages, welcomeItem]);
  const handleQuestionAnswers = useCallback4(
    (answers) => {
      void handlePrompt({
        text: formatAskUserQuestionAnswers(answers),
        imageUrls: []
      });
    },
    [handlePrompt]
  );
  const handleQuestionCancel = useCallback4(() => {
    if (!pendingQuestion) {
      return;
    }
    setDismissedQuestionIds((prev) => new Set(prev).add(pendingQuestion.messageId));
  }, [pendingQuestion]);
  if (mode === "Raw scrollback mode" /* Raw */) {
    return /* @__PURE__ */ jsx18(RawModeExitPrompt, { onExit: (prev) => handleRawModeChange(prev) });
  }
  return /* @__PURE__ */ jsxs13(Box13, { flexDirection: "column", width: screenWidth, minWidth: 80, overflowX: "visible", children: [
    /* @__PURE__ */ jsx18(Static, { items: staticItems, children: (item) => {
      if (item.id.startsWith("__welcome__")) {
        return /* @__PURE__ */ jsx18(
          WelcomeScreen,
          {
            projectRoot: projectRoot2,
            settings: resolvedSettings,
            skills,
            width: screenWidth
          },
          item.id
        );
      }
      return /* @__PURE__ */ jsx18(
        MessageView,
        {
          message: item,
          collapsed: isCollapsedThinking(item, expandedThinkingId),
          width: screenWidth
        },
        item.id
      );
    } }),
    !runtimeStatus.visible && statusLine ? /* @__PURE__ */ jsx18(Box13, { children: /* @__PURE__ */ jsx18(Text14, { dimColor: true, children: statusLine }) }) : null,
    errorLine ? /* @__PURE__ */ jsx18(Box13, { children: /* @__PURE__ */ jsxs13(Text14, { color: "red", children: [
      "Error: ",
      errorLine
    ] }) }) : null,
    showProcessStdout ? /* @__PURE__ */ jsx18(
      ProcessStdoutView,
      {
        processStdoutRef,
        runningProcesses,
        onDismiss: handleDismissProcessStdout,
        onAdjustTimeout: handleAdjustBashTimeout,
        screenWidth,
        screenHeight
      }
    ) : view === "session-list" ? /* @__PURE__ */ jsx18(
      SessionList,
      {
        sessions,
        onSelect: (id) => void handleSelectSession(id),
        onCancel: () => setView("chat")
      }
    ) : view === "undo" ? /* @__PURE__ */ jsx18(
      UndoSelector,
      {
        targets: undoTargets,
        onSelect: (target, restoreMode) => void handleUndoRestore(target, restoreMode),
        onCancel: () => {
          setView("chat");
          setShowWelcome(true);
        }
      }
    ) : view === "mcp-status" ? /* @__PURE__ */ jsx18(
      McpStatusList,
      {
        statuses: mcpStatuses,
        onCancel: () => setView("chat"),
        onReconnect: (name) => {
          const latest = resolveCurrentSettings(projectRoot2);
          void sessionManager.reconnectMcpServer(name, latest.mcpServers?.[name]);
        }
      }
    ) : shouldShowQuestionPrompt && pendingQuestion && !busy ? /* @__PURE__ */ jsx18(
      AskUserQuestionPrompt,
      {
        questions: pendingQuestion.questions,
        onSubmit: handleQuestionAnswers,
        onCancel: handleQuestionCancel
      }
    ) : isExiting ? null : /* @__PURE__ */ jsxs13(
      Box13,
      {
        flexDirection: runtimeStatus.visible && runtimeStatus.layoutMode === "wide" ? "row" : "column",
        width: screenWidth,
        children: [
          runtimeStatus.visible && runtimeStatus.layoutMode !== "wide" ? /* @__PURE__ */ jsx18(RuntimeStatusPanel, { viewModel: runtimeStatus, width: screenWidth }) : null,
          /* @__PURE__ */ jsx18(Box13, { width: promptScreenWidth, children: /* @__PURE__ */ jsx18(
            PromptInput,
            {
              projectRoot: projectRoot2,
              screenWidth: promptScreenWidth,
              skills,
              modelConfig: resolvedSettings,
              promptHistory,
              busy,
              loadingText,
              runningProcesses,
              promptDraft,
              onSubmit: handleSubmit,
              onModelConfigChange: handleModelConfigChange,
              onRawModeChange: handleRawModeChange,
              onInterrupt: handleInterrupt,
              onToggleProcessStdout: handleToggleProcessStdout,
              placeholder: "\u8F93\u5165\u6D88\u606F..."
            }
          ) }),
          runtimeStatus.visible && runtimeStatus.layoutMode === "wide" ? /* @__PURE__ */ jsx18(RuntimeStatusPanel, { viewModel: runtimeStatus, width: RUNTIME_STATUS_PANEL_WIDTH }) : null
        ]
      }
    )
  ] });
}
function isCollapsedThinking(message, expandedId) {
  if (message.role !== "assistant") {
    return false;
  }
  if (!message.meta?.asThinking) {
    return false;
  }
  return message.id !== expandedId;
}
function buildSyntheticUserMessage(content, imageCount) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    id: `local-${Math.random().toString(36).slice(2)}`,
    sessionId: "local",
    role: "user",
    content,
    contentParams: imageCount > 0 ? Array.from({ length: imageCount }, () => ({
      type: "image_url",
      image_url: { url: "" }
    })) : null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: now,
    updateTime: now
  };
}
function buildSyntheticAssistantMessage(content) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    id: `local-${Math.random().toString(36).slice(2)}`,
    sessionId: "local",
    role: "assistant",
    content,
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: now,
    updateTime: now
  };
}
function buildPromptDraftFromSessionMessage(message, nonce) {
  return {
    nonce,
    text: typeof message.content === "string" ? message.content : "",
    imageUrls: extractImageUrlsFromContentParams(message.contentParams)
  };
}
function extractImageUrlsFromContentParams(contentParams) {
  const params = Array.isArray(contentParams) ? contentParams : contentParams ? [contentParams] : [];
  const imageUrls = [];
  for (const param of params) {
    if (!param || typeof param !== "object") {
      continue;
    }
    const record = param;
    const url = record.image_url?.url;
    if (record.type === "image_url" && typeof url === "string" && url) {
      imageUrls.push(url);
    }
  }
  return imageUrls;
}
function isCurrentSessionEmpty(sessionManager) {
  const activeSessionId = sessionManager.getActiveSessionId();
  return !activeSessionId || !sessionManager.getSession(activeSessionId);
}
function buildStatusLine(entry) {
  const parts = [`\u72B6\u6001: ${entry.status}`];
  if (typeof entry.activeTokens === "number" && entry.activeTokens > 0) {
    parts.push(`\u672C\u8F6E: ${entry.activeTokens.toLocaleString("en-US")}`);
  }
  const totals = sumStatusUsage(entry.usagePerModel);
  if (totals.promptTokens > 0) {
    parts.push(`\u8F93\u5165: ${totals.promptTokens.toLocaleString("en-US")}`);
  }
  if (totals.completionTokens > 0) {
    parts.push(`\u8F93\u51FA: ${totals.completionTokens.toLocaleString("en-US")}`);
  }
  if (totals.cachedTokens > 0) {
    parts.push(`\u7F13\u5B58: ${totals.cachedTokens.toLocaleString("en-US")}${formatCacheHitRate(totals)}`);
  }
  if (totals.totalReqs > 0) {
    parts.push(`\u8BF7\u6C42: ${totals.totalReqs.toLocaleString("en-US")}`);
  }
  if (entry.failReason) {
    parts.push(`\u5931\u8D25: ${entry.failReason}`);
  }
  return parts.join(" \xB7 ");
}
function sumStatusUsage(usagePerModel) {
  const totals = {
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    cacheMissTokens: 0,
    totalReqs: 0
  };
  if (!usagePerModel) {
    return totals;
  }
  for (const usage of Object.values(usagePerModel)) {
    totals.promptTokens += numberField2(usage.prompt_tokens);
    totals.completionTokens += numberField2(usage.completion_tokens);
    totals.cachedTokens += extractCachedTokens2(usage);
    totals.cacheMissTokens += numberField2(usage.prompt_cache_miss_tokens);
    totals.totalReqs += numberField2(usage.total_reqs);
  }
  return totals;
}
function formatCacheHitRate(totals) {
  const denominator = totals.cacheMissTokens > 0 ? totals.cachedTokens + totals.cacheMissTokens : totals.promptTokens;
  if (denominator <= 0) {
    return "";
  }
  const hitRate = totals.cachedTokens / denominator * 100;
  if (!Number.isFinite(hitRate) || hitRate <= 0) {
    return "";
  }
  return ` (${hitRate.toFixed(1)}%)`;
}
function extractCachedTokens2(usage) {
  const promptDetails = usage.prompt_tokens_details;
  const cachedFromDetails = promptDetails && typeof promptDetails.cached_tokens === "number" ? promptDetails.cached_tokens : 0;
  return cachedFromDetails || numberField2(usage.prompt_cache_hit_tokens);
}
function numberField2(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function readSettings() {
  return readFirstSettingsFile(getUserSettingsPath(), getLegacyUserSettingsPath());
}
function readProjectSettings(projectRoot2 = process.cwd()) {
  return readFirstSettingsFile(getProjectSettingsPath(projectRoot2), getLegacyProjectSettingsPath(projectRoot2));
}
function readFirstSettingsFile(...settingsPaths) {
  for (const settingsPath of settingsPaths) {
    const settings = readSettingsFile(settingsPath);
    if (settings) {
      return settings;
    }
  }
  return null;
}
function readSettingsFile(settingsPath) {
  try {
    if (!fs26.existsSync(settingsPath)) {
      return null;
    }
    const raw = fs26.readFileSync(settingsPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function writeSettings(settings) {
  const settingsPath = getUserSettingsPath();
  writeSettingsFile(settingsPath, settings);
}
function writeProjectSettings(settings, projectRoot2 = process.cwd()) {
  const settingsPath = getProjectSettingsPath(projectRoot2);
  writeSettingsFile(settingsPath, settings);
}
function writeSettingsFile(settingsPath, settings) {
  fs26.mkdirSync(path28.dirname(settingsPath), { recursive: true });
  fs26.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}
`, "utf8");
}
function writeModelConfigSelection(selection, current = resolveCurrentSettings(), projectRoot2 = process.cwd()) {
  const existingProjectSettingsPath = getExistingProjectSettingsPath(projectRoot2);
  const shouldWriteProjectSettings = existingProjectSettingsPath !== null;
  const rawSettings = shouldWriteProjectSettings ? readSettingsFile(existingProjectSettingsPath) : readSettings();
  const result = applyModelConfigSelection(rawSettings, current, selection);
  if (result.changed) {
    if (shouldWriteProjectSettings) {
      writeSettingsFile(existingProjectSettingsPath, result.settings);
    } else {
      writeSettings(result.settings);
    }
  }
  return result;
}
function resolveCurrentSettings(projectRoot2 = process.cwd()) {
  return resolveSettingsSources(
    readSettings(),
    readProjectSettings(projectRoot2),
    {
      model: DEFAULT_MODEL,
      baseURL: DEFAULT_BASE_URL
    },
    process.env
  );
}
function getUserSettingsPath() {
  return path28.join(os10.homedir(), ".lima-code", "settings.json");
}
function getLegacyUserSettingsPath() {
  return path28.join(os10.homedir(), ".deepcode", "settings.json");
}
function getProjectSettingsPath(projectRoot2) {
  return path28.join(projectRoot2, ".lima-code", "settings.json");
}
function getLegacyProjectSettingsPath(projectRoot2) {
  return path28.join(projectRoot2, ".deepcode", "settings.json");
}
function getExistingProjectSettingsPath(projectRoot2) {
  const projectSettingsPath = getProjectSettingsPath(projectRoot2);
  if (fs26.existsSync(projectSettingsPath)) {
    return projectSettingsPath;
  }
  const legacyProjectSettingsPath = getLegacyProjectSettingsPath(projectRoot2);
  return fs26.existsSync(legacyProjectSettingsPath) ? legacyProjectSettingsPath : null;
}
function formatThinkingMode(settings) {
  if (!settings.thinkingEnabled) {
    return "\u5173\u95ED\u601D\u8003";
  }
  return `\u601D\u8003 ${settings.reasoningEffort}`;
}
function formatModelConfig(settings) {
  return `${settings.model}, ${formatThinkingMode(settings)}`;
}
var DEFAULT_MODEL, DEFAULT_BASE_URL;
var init_App = __esm({
  "src/ui/App.tsx"() {
    "use strict";
    init_openai_client();
    init_session();
    init_settings();
    init_PromptInput();
    init_components();
    init_SessionList();
    init_UndoSelector();
    init_loadingText();
    init_thinkingState();
    init_WelcomeScreen();
    init_AskUserQuestionPrompt();
    init_McpStatusList();
    init_ProcessStdoutView();
    init_RuntimeStatusPanel();
    init_runtimeStatus();
    init_askUserQuestion();
    init_exitSummary();
    init_contexts();
    init_utils();
    init_command_runner();
    init_openai_client();
    DEFAULT_MODEL = "deepseek-v4-pro";
    DEFAULT_BASE_URL = "https://api.deepseek.com";
  }
});

// src/daemon.ts
var daemon_exports = {};
__export(daemon_exports, {
  runDaemon: () => runDaemon
});
async function runDaemon(options) {
  const client = new LiMaAgentTaskClient({
    serverUrl: options.serverUrl,
    apiKey: options.apiKey
  });
  if (!client.isConfigured()) {
    console.error("[daemon] LiMa Server not configured. Set LIMA_CODE_SERVER_URL and LIMA_CODE_API_KEY.");
    process.exit(1);
  }
  console.log(`[daemon] Starting. Polling every ${POLL_INTERVAL_MS / 1e3}s...`);
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
        return;
      }
      const task = taskResult.value;
      console.log(`[daemon] Received task: ${task.task_id} (${task.mode || "auto"})`);
      const config = {
        currentWorkspace: options.projectRoot,
        projectRoot: options.projectRoot
      };
      const result = await runLiMaAgentTask(task, config);
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
  await tick();
  const interval = setInterval(tick, POLL_INTERVAL_MS);
  const shutdown = () => {
    console.log("\n[daemon] Shutting down...");
    clearInterval(interval);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
var POLL_INTERVAL_MS, MAX_CONSECUTIVE_ERRORS;
var init_daemon = __esm({
  "src/daemon.ts"() {
    "use strict";
    init_task_runner();
    init_agent_task_client();
    POLL_INTERVAL_MS = 3e4;
    MAX_CONSECUTIVE_ERRORS = 10;
  }
});

// src/headless.ts
var headless_exports = {};
__export(headless_exports, {
  runHeadless: () => runHeadless
});
function createHeadlessTelemetry() {
  return {
    timeoutMs: readPositiveIntEnv("LIMA_CODE_HEADLESS_TIMEOUT_MS", DEFAULT_MODEL_TIMEOUT_MS),
    maxRetries: readPositiveIntEnv("LIMA_CODE_HEADLESS_RETRIES", DEFAULT_MODEL_RETRIES),
    retryCount: 0,
    modelCalls: [],
    toolCapability: {
      requested: false,
      observed: false,
      protocol: "none",
      toolCalls: 0
    }
  };
}
function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function normalizeError(error) {
  if (error instanceof Error) {
    return error.name && error.name !== "Error" ? `${error.name}: ${error.message}` : error.message;
  }
  return String(error);
}
function classifyTelemetryError(error) {
  const text = normalizeError(error).toLowerCase();
  if (!text) return void 0;
  if (text.includes("timeout") || text.includes("abort")) return "timeout";
  if (text.includes("401") || text.includes("403") || text.includes("forbidden") || text.includes("unauthorized")) {
    return "auth";
  }
  if (text.includes("429") || text.includes("rate") || text.includes("quota")) return "rate_limit";
  if (text.includes("reset") || text.includes("network") || text.includes("connect")) return "network_or_provider";
  return "provider_error";
}
function mergeToolProtocol(left, right) {
  if (left === "none") return right;
  if (right === "none" || left === right) return left;
  return "mixed";
}
function updateToolCapability(telemetry, result) {
  if (result.toolCalls.length > 0) {
    telemetry.toolCapability.observed = true;
    telemetry.toolCapability.protocol = mergeToolProtocol(telemetry.toolCapability.protocol, result.toolProtocol);
    telemetry.toolCapability.toolCalls += result.toolCalls.length;
    delete telemetry.toolCapability.unsupportedReason;
    return;
  }
  if (!telemetry.toolCapability.observed) {
    telemetry.toolCapability.unsupportedReason = "model_completed_without_tool_call";
  }
}
function validateCommand(command) {
  if (BLOCKED_COMMANDS.test(command)) {
    return `BLOCKED: dangerous command detected: "${command.split(/\s/)[0]}"`;
  }
  if (command.includes("sudo ") || command.includes("su ")) {
    return "BLOCKED: sudo/su not allowed";
  }
  return null;
}
function validateFilePath(filePath, projectRoot2) {
  const resolved = __require("path").resolve(filePath);
  const root = __require("path").resolve(projectRoot2);
  if (!resolved.startsWith(root + __require("path").sep) && resolved !== root) {
    return `BLOCKED: path "${filePath}" escapes project root`;
  }
  return null;
}
async function buildSystemPrompt(projectRoot2) {
  const fs29 = await import("fs/promises");
  const parts = [];
  const contextFiles = ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md"];
  for (const file of contextFiles) {
    try {
      const content = await fs29.readFile(projectRoot2 + "/" + file, "utf-8");
      if (content.trim()) {
        parts.push(`# ${file}
${content.trim().slice(0, 4e3)}`);
      }
    } catch {
    }
  }
  if (parts.length > 0) {
    return parts.join("\n\n---\n\n");
  }
  return "";
}
function buildToolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "bash",
        description: "Execute a shell command and return its output.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "Shell command to execute" },
            timeout: { type: "number", description: "Timeout in seconds (default 30)" }
          },
          required: ["command"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "read",
        description: "Read a file's contents.",
        parameters: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Absolute file path" },
            offset: { type: "number", description: "Line offset" },
            limit: { type: "number", description: "Max lines to read" }
          },
          required: ["file_path"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "write",
        description: "Write content to a file.",
        parameters: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Absolute file path" },
            content: { type: "string", description: "File content to write" }
          },
          required: ["file_path", "content"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "edit",
        description: "Edit a file by replacing a specific string.",
        parameters: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Absolute file path" },
            old_string: { type: "string", description: "Text to find and replace" },
            new_string: { type: "string", description: "Replacement text" }
          },
          required: ["file_path", "old_string", "new_string"]
        }
      }
    }
  ];
}
async function executeTool(name, args2, projectRoot2) {
  const fs29 = await import("fs/promises");
  const { execSync: execSync4 } = await import("child_process");
  switch (name) {
    case "bash": {
      const command = String(args2.command || "");
      const blockReason = validateCommand(command);
      if (blockReason) return blockReason;
      const timeout = Number(args2.timeout || 30) * 1e3;
      try {
        const output = execSync4(command, {
          cwd: projectRoot2,
          timeout,
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          stdio: ["pipe", "pipe", "pipe"]
        });
        return output.slice(0, 3e4) || "(no output)";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Exit 1: ${msg.slice(0, 5e3)}`;
      }
    }
    case "read": {
      const filePath = String(args2.file_path || "");
      const pathErr = validateFilePath(filePath, projectRoot2);
      if (pathErr) return pathErr;
      try {
        const content = await fs29.readFile(filePath, "utf-8");
        const offset = Number(args2.offset || 0);
        const limit = Number(args2.limit || 2e3);
        const lines = content.split("\n");
        return lines.slice(offset, offset + limit).join("\n");
      } catch (err) {
        return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    case "write": {
      const filePath = String(args2.file_path || "");
      const pathErr = validateFilePath(filePath, projectRoot2);
      if (pathErr) return pathErr;
      const content = String(args2.content || "");
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      if (dir) await fs29.mkdir(dir, { recursive: true });
      await fs29.writeFile(filePath, content, "utf-8");
      return `Written ${content.length} bytes to ${filePath}`;
    }
    case "edit": {
      const filePath = String(args2.file_path || "");
      const pathErr = validateFilePath(filePath, projectRoot2);
      if (pathErr) return pathErr;
      const oldStr = String(args2.old_string || "");
      const newStr = String(args2.new_string || "");
      let content = await fs29.readFile(filePath, "utf-8");
      if (!content.includes(oldStr)) {
        return `ERROR: old_string not found in ${filePath}`;
      }
      content = content.replace(oldStr, newStr);
      await fs29.writeFile(filePath, content, "utf-8");
      return `OK: edited ${filePath}`;
    }
    default:
      return `ERROR: unknown tool "${name}"`;
  }
}
async function callLiMaWithTools(messages, projectRoot2, opts) {
  const { resolveCurrentSettings: resolveCurrentSettings2 } = await Promise.resolve().then(() => (init_App(), App_exports));
  const settings = resolveCurrentSettings2(projectRoot2);
  const baseURL = settings.env?.BASE_URL || "https://chat.donglicao.com/v1";
  const apiKey = settings.env?.API_KEY || "";
  const model = opts.model || settings.model || "lima";
  const maxTokens = opts.maxTokens || DEFAULT_MAX_TOKENS;
  const stream = false;
  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0,
    tools: buildToolDefinitions(),
    tool_choice: "auto",
    stream
  };
  opts.telemetry.toolCapability.requested = true;
  for (let attempt = 1; attempt <= opts.telemetry.maxRetries + 1; attempt++) {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-Session-ID": opts.sessionId || "",
          "X-Project-Root": projectRoot2
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.telemetry.timeoutMs)
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LiMa Server ${response.status}: ${text.substring(0, 200)}`);
      }
      const parsed = await parseLiMaResponse(response);
      opts.telemetry.modelCalls.push({
        attempt,
        phase: "chat",
        stream,
        timeoutMs: opts.telemetry.timeoutMs,
        latencyMs: Date.now() - startedAt,
        ok: true,
        status: response.status,
        contentChars: parsed.content.length,
        toolCalls: parsed.toolCalls.length,
        toolProtocol: parsed.toolProtocol
      });
      updateToolCapability(opts.telemetry, parsed);
      return parsed;
    } catch (error) {
      opts.telemetry.modelCalls.push({
        attempt,
        phase: "chat",
        stream,
        timeoutMs: opts.telemetry.timeoutMs,
        latencyMs: Date.now() - startedAt,
        ok: false,
        error: normalizeError(error),
        contentChars: 0,
        toolCalls: 0,
        toolProtocol: "none"
      });
      if (attempt > opts.telemetry.maxRetries) {
        throw error;
      }
      opts.telemetry.retryCount++;
    }
  }
  throw new Error("LiMa Server model call failed without an error");
}
async function parseLiMaResponse(response) {
  let fullContent = "";
  let rawStreamText = "";
  const toolCallsMap = {};
  let toolProtocol = "none";
  const reader = response.body?.getReader();
  if (!reader) {
    const data = await response.json();
    const choice = data.choices?.[0];
    const msg = choice?.message;
    const toolCalls2 = parseToolCalls(msg?.tool_calls);
    return {
      content: msg?.content || "",
      toolCalls: toolCalls2,
      toolProtocol: toolCalls2.length > 0 ? "openai" : "none"
    };
  }
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunkText = decoder.decode(value, { stream: true });
    rawStreamText += chunkText;
    buffer += chunkText;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const dataText = line.replace(/^data:\s?/, "");
      if (dataText === "[DONE]") continue;
      try {
        const chunk = JSON.parse(dataText);
        const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : null;
        const delta = isRecord3(choice) && isRecord3(choice.delta) ? choice.delta : null;
        if (typeof delta?.content === "string") {
          fullContent += delta.content;
          process.stderr.write(delta.content);
        }
        if (Array.isArray(delta?.tool_calls)) {
          for (const tc of delta.tool_calls) {
            if (!isRecord3(tc)) continue;
            const idx = typeof tc.index === "number" ? tc.index : 0;
            const key = `tc_${idx}`;
            if (!toolCallsMap[key]) {
              toolCallsMap[key] = {
                id: typeof tc.id === "string" ? tc.id : "",
                name: "",
                arguments: ""
              };
            }
            const fn = isRecord3(tc.function) ? tc.function : null;
            if (typeof tc.id === "string") toolCallsMap[key].id = tc.id;
            if (typeof fn?.name === "string") toolCallsMap[key].name = fn.name;
            if (typeof fn?.arguments === "string") toolCallsMap[key].arguments += fn.arguments;
            toolProtocol = mergeToolProtocol(toolProtocol, "openai");
          }
        }
        const anthropicTextDelta = parseAnthropicTextDelta(chunk);
        if (anthropicTextDelta) {
          fullContent += anthropicTextDelta;
          process.stderr.write(anthropicTextDelta);
        }
        const anthropicToolStart = parseAnthropicToolStart(chunk);
        if (anthropicToolStart) {
          const key = `ant_${anthropicToolStart.index}`;
          toolCallsMap[key] = {
            id: anthropicToolStart.id,
            name: anthropicToolStart.name,
            arguments: anthropicToolStart.input ? JSON.stringify(anthropicToolStart.input) : ""
          };
          toolProtocol = mergeToolProtocol(toolProtocol, "anthropic");
        }
        const anthropicToolDelta = parseAnthropicToolDelta(chunk);
        if (anthropicToolDelta) {
          const key = `ant_${anthropicToolDelta.index}`;
          if (!toolCallsMap[key]) {
            toolCallsMap[key] = { id: "", name: "", arguments: "" };
          }
          toolCallsMap[key].arguments += anthropicToolDelta.partialJson;
          toolProtocol = mergeToolProtocol(toolProtocol, "anthropic");
        }
      } catch {
        continue;
      }
    }
  }
  process.stderr.write("\n");
  const toolCalls = Object.values(toolCallsMap).map((tc) => ({
    id: tc.id,
    name: tc.name,
    arguments: parseArgumentsJson(tc.arguments)
  }));
  if (!fullContent && toolCalls.length === 0) {
    const jsonResponse = parseChatCompletionJson(rawStreamText);
    if (jsonResponse) {
      return jsonResponse;
    }
  }
  return { content: fullContent, toolCalls, toolProtocol };
}
function parseChatCompletionJson(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("data:")) {
    return null;
  }
  try {
    const data = JSON.parse(trimmed);
    const choice = data.choices?.[0];
    const msg = choice?.message;
    const toolCalls = parseToolCalls(msg?.tool_calls);
    return {
      content: msg?.content || "",
      toolCalls,
      toolProtocol: toolCalls.length > 0 ? "openai" : "none"
    };
  } catch {
    return null;
  }
}
function parseToolCalls(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((tc) => ({
    id: String(tc.id || ""),
    name: String(tc.function?.name || ""),
    arguments: typeof tc.function?.arguments === "string" ? parseArgumentsJson(tc.function.arguments) : tc.function?.arguments || {}
  }));
}
function parseArgumentsJson(text) {
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return isRecord3(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function parseAnthropicTextDelta(chunk) {
  if (chunk.type !== "content_block_delta") return "";
  const delta = isRecord3(chunk.delta) ? chunk.delta : null;
  if (!delta || delta.type !== "text_delta") return "";
  return typeof delta.text === "string" ? delta.text : "";
}
function parseAnthropicToolStart(chunk) {
  if (chunk.type !== "content_block_start") return null;
  const contentBlock = isRecord3(chunk.content_block) ? chunk.content_block : null;
  if (!contentBlock || contentBlock.type !== "tool_use") return null;
  const index = typeof chunk.index === "number" ? chunk.index : 0;
  return {
    index,
    id: typeof contentBlock.id === "string" ? contentBlock.id : "",
    name: typeof contentBlock.name === "string" ? contentBlock.name : "",
    input: isRecord3(contentBlock.input) ? contentBlock.input : null
  };
}
function parseAnthropicToolDelta(chunk) {
  if (chunk.type !== "content_block_delta") return null;
  const delta = isRecord3(chunk.delta) ? chunk.delta : null;
  if (!delta || delta.type !== "input_json_delta") return null;
  const partialJson = typeof delta.partial_json === "string" ? delta.partial_json : "";
  if (!partialJson) return null;
  return {
    index: typeof chunk.index === "number" ? chunk.index : 0,
    partialJson
  };
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function reportOutcome(sessionId, backend, success, latencyMs, projectRoot2, telemetry) {
  const startedAt = Date.now();
  try {
    const { resolveCurrentSettings: resolveCurrentSettings2 } = await Promise.resolve().then(() => (init_App(), App_exports));
    const settings = resolveCurrentSettings2(projectRoot2);
    const baseURL = settings.env?.BASE_URL || "https://chat.donglicao.com/v1";
    const apiKey = settings.env?.API_KEY || "";
    const response = await fetch(`${baseURL.replace("/v1", "")}/agent/learn/outcome`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        task_id: sessionId,
        backend,
        scenario: "coding",
        success,
        latency_ms: latencyMs,
        quality_score: success ? 0.8 : 0.2,
        telemetry: {
          timeoutMs: telemetry.timeoutMs,
          maxRetries: telemetry.maxRetries,
          retryCount: telemetry.retryCount,
          modelCalls: telemetry.modelCalls.map((call) => ({
            attempt: call.attempt,
            phase: call.phase,
            stream: call.stream,
            timeoutMs: call.timeoutMs,
            latencyMs: call.latencyMs,
            ok: call.ok,
            status: call.status,
            error: classifyTelemetryError(call.error),
            contentChars: call.contentChars,
            toolCalls: call.toolCalls,
            toolProtocol: call.toolProtocol
          })),
          toolCapability: telemetry.toolCapability
        }
      }),
      signal: AbortSignal.timeout(5e3)
    });
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      error: response.ok ? void 0 : (await response.text()).slice(0, 200)
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: normalizeError(error)
    };
  }
}
function verifyResponseQuality(content) {
  if (!content || content.length < 5) {
    return { ok: false, warning: "Response is too short" };
  }
  if (content.includes("Traceback (most recent call last)")) {
    return { ok: false, warning: "Response contains Python traceback" };
  }
  if (content.includes("Error:") && content.includes("undefined")) {
    return { ok: false, warning: "Response contains undefined error" };
  }
  return { ok: true };
}
async function agentLoop(userPrompt, projectRoot2, opts) {
  const systemPrompt = await buildSystemPrompt(projectRoot2);
  const sessionId = `hls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const messages = [];
  const loopStartedAt = Date.now();
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: userPrompt });
  let totalToolCalls = 0;
  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    const { content, toolCalls } = await callLiMaWithTools(messages, projectRoot2, { ...opts, sessionId });
    if (toolCalls.length === 0) {
      const quality = verifyResponseQuality(content);
      if (!quality.ok && opts.verbose) {
        process.stderr.write(`
[quality] WARNING: ${quality.warning}
`);
      }
      opts.telemetry.outcomeReport = await reportOutcome(
        sessionId,
        "cli-agent",
        quality.ok,
        Date.now() - loopStartedAt,
        projectRoot2,
        opts.telemetry
      );
      return { content, toolCalls: totalToolCalls, sessionId };
    }
    messages.push({
      role: "assistant",
      content: content || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments)
        }
      }))
    });
    for (const tc of toolCalls) {
      totalToolCalls++;
      if (opts.verbose) {
        process.stderr.write(`
[tool] ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 100)})
`);
      }
      let result;
      try {
        result = await executeTool(tc.name, tc.arguments, projectRoot2);
      } catch (err) {
        result = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      }
      if ((tc.name === "write" || tc.name === "edit") && result.startsWith("OK:") || result.startsWith("Written")) {
        try {
          const filePath = String(tc.arguments.file_path || "");
          if (filePath) {
            const { execSync: execSync4 } = await import("child_process");
            const diff = execSync4(`git diff --no-color -- "${filePath}" 2>/dev/null || true`, {
              cwd: projectRoot2,
              encoding: "utf-8",
              timeout: 5e3
            }).trim();
            if (diff) {
              process.stderr.write(`
[diff] ${filePath}:
${diff.slice(0, 2e3)}
`);
            }
          }
        } catch {
        }
      }
      if (opts.verbose) {
        process.stderr.write(`[result] ${result.slice(0, 200)}
`);
      }
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result.slice(0, 5e4)
        // Truncate very long outputs
      });
    }
  }
  return { content: "[Max agent rounds reached]", toolCalls: totalToolCalls, sessionId };
}
async function executeLiMaCommand2(input, projectRoot2) {
  const { executeLiMaCommand: runCmd } = await Promise.resolve().then(() => (init_command_runner(), command_runner_exports));
  const { LiMaAgentTaskClient: LiMaAgentTaskClient2 } = await Promise.resolve().then(() => (init_agent_task_client(), agent_task_client_exports));
  const client = new LiMaAgentTaskClient2();
  const result = await runCmd(input, {
    projectRoot: projectRoot2,
    client: client.isConfigured() ? client : void 0
  });
  return result.message || (result.ok ? "OK" : "Failed");
}
async function runHeadless(prompt, options) {
  const projectRoot2 = options.projectRoot || process.cwd();
  const telemetry = createHeadlessTelemetry();
  try {
    let content;
    let toolCalls = 0;
    let sessionId = "";
    if (prompt.trim().startsWith("/lima")) {
      content = await executeLiMaCommand2(prompt.trim(), projectRoot2);
    } else {
      const result2 = await agentLoop(prompt, projectRoot2, {
        verbose: options.verbose,
        telemetry
      });
      content = result2.content;
      toolCalls = result2.toolCalls;
      sessionId = result2.sessionId;
    }
    content = content.trim();
    const result = {
      ok: true,
      content,
      sessionId,
      toolCalls,
      telemetry
    };
    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stdout.write(result.content + "\n");
    }
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const result = {
      ok: false,
      content: "",
      sessionId: "",
      toolCalls: 0,
      telemetry,
      error: msg
    };
    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stderr.write(`Error: ${msg}
`);
    }
    return result;
  }
}
var MAX_AGENT_ROUNDS, DEFAULT_MAX_TOKENS, DEFAULT_MODEL_TIMEOUT_MS, DEFAULT_MODEL_RETRIES, BLOCKED_COMMANDS;
var init_headless = __esm({
  "src/headless.ts"() {
    "use strict";
    MAX_AGENT_ROUNDS = 20;
    DEFAULT_MAX_TOKENS = 16384;
    DEFAULT_MODEL_TIMEOUT_MS = 9e4;
    DEFAULT_MODEL_RETRIES = 1;
    BLOCKED_COMMANDS = /^\s*(rm\s+-rf|mkfs|dd\s+if=|shutdown|reboot|halt|poweroff|sudo|su\s+|killall|pkill|nc\s|ncat|socat)\b/;
  }
});

// src/cli.tsx
init_shell_utils();
import { render as render2 } from "ink";
import * as fs28 from "fs";
import * as path30 from "path";
import { fileURLToPath as fileURLToPath3 } from "url";

// src/updateCheck.ts
import { spawn as spawn6 } from "child_process";
import React17 from "react";
import * as fs27 from "fs";
import * as os11 from "os";
import * as path29 from "path";
import { render } from "ink";
import chalk6 from "chalk";

// src/ui/index.ts
init_ModelsDropdown();
init_App();
init_openai_client();

// src/ui/AppContainer.tsx
init_contexts();
init_App();
init_RawModeContext();
import { jsx as jsx19 } from "react/jsx-runtime";
var AppContainer = ({ version, projectRoot: projectRoot2, initialPrompt: initialPrompt2, onRestart }) => {
  return /* @__PURE__ */ jsx19(AppContext.Provider, { value: { version }, children: /* @__PURE__ */ jsx19(RawModeProvider, { children: /* @__PURE__ */ jsx19(App, { initialPrompt: initialPrompt2, projectRoot: projectRoot2, onRestart }) }) });
};
var AppContainer_default = AppContainer;

// src/ui/index.ts
init_AskUserQuestionPrompt();
init_components();
init_utils();
init_PromptInput();
init_cursor();
init_SessionList();
init_ThemedGradient();

// src/ui/UpdatePrompt.tsx
import { useState as useState14 } from "react";
import { Box as Box14, Text as Text15, useApp as useApp3, useInput as useInput9 } from "ink";
import { jsx as jsx20, jsxs as jsxs14 } from "react/jsx-runtime";
function UpdatePrompt({ currentVersion, latestVersion, installCommand, onSelect }) {
  const { exit } = useApp3();
  const [selectedIndex, setSelectedIndex] = useState14(0);
  const options = [
    {
      value: "install",
      label: `Install the latest version with \`${installCommand}\``
    },
    {
      value: "ignore-once",
      label: "Ignore once"
    },
    {
      value: "ignore-version",
      label: `Ignore this version (${latestVersion})`
    }
  ];
  useInput9((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((index) => (index - 1 + options.length) % options.length);
      return;
    }
    if (key.downArrow || key.tab) {
      setSelectedIndex((index) => (index + 1) % options.length);
      return;
    }
    if (key.return) {
      onSelect(options[selectedIndex]?.value ?? "ignore-once");
      exit();
      return;
    }
    if (key.escape || key.ctrl && (input === "c" || input === "C")) {
      onSelect("ignore-once");
      exit();
      return;
    }
    if (/^[1-3]$/.test(input)) {
      onSelect(options[Number(input) - 1]?.value ?? "ignore-once");
      exit();
    }
  });
  return /* @__PURE__ */ jsxs14(Box14, { flexDirection: "column", marginY: 1, children: [
    /* @__PURE__ */ jsxs14(Text15, { bold: true, children: [
      "LiMa Code latest version has been released: ",
      currentVersion,
      " -> ",
      latestVersion
    ] }),
    /* @__PURE__ */ jsx20(Box14, { flexDirection: "column", marginTop: 1, children: options.map((option, index) => {
      const selected = index === selectedIndex;
      return /* @__PURE__ */ jsxs14(Text15, { color: selected ? "green" : void 0, children: [
        selected ? "> " : "  ",
        index + 1,
        ". ",
        option.label
      ] }, option.value);
    }) }),
    /* @__PURE__ */ jsx20(Box14, { marginTop: 1, children: /* @__PURE__ */ jsx20(Text15, { dimColor: true, children: "Use Up/Down to choose, Enter to confirm, Esc to ignore once." }) })
  ] });
}

// src/ui/index.ts
init_WelcomeScreen();
init_askUserQuestion();
init_clipboard();
init_loadingText();
init_runtimeStatus();
init_markdown();
init_promptBuffer();
init_slashCommands();
init_fileMentions();
init_thinkingState();
init_exitSummary();

// src/updateCheck.ts
init_process_tree();
var UPDATE_STATE_FILE = "update-check.json";
var NPM_VIEW_TIMEOUT_MS = 5e3;
var MAX_NPM_VIEW_OUTPUT_CHARS = 64 * 1024;
var TENCENT_MIRROR_REGISTRY = "https://mirrors.cloud.tencent.com/npm/";
async function promptForPendingUpdate(packageInfo2) {
  const state = readUpdateState();
  const pending = state.pending;
  if (!pending) {
    return { installed: false };
  }
  if (compareVersions(packageInfo2.version, pending.latestVersion) >= 0) {
    writeUpdateState({ ...state, pending: null });
    return { installed: false };
  }
  if (state.ignoredVersions?.includes(pending.latestVersion)) {
    writeUpdateState({ ...state, pending: null });
    return { installed: false };
  }
  const installSpec = `${pending.packageName}@${pending.latestVersion}`;
  const installCommand = `npm install -g ${installSpec}`;
  const choice = await promptUpdateChoice({
    currentVersion: packageInfo2.version,
    latestVersion: pending.latestVersion,
    installCommand
  });
  if (choice === "install") {
    const ok = await runNpmInstallGlobal(installSpec);
    if (ok) {
      writeUpdateState({ ...state, pending: null });
      process.stdout.write(
        `
${chalk6.red("LiMa Code has been updated. Please restart the CLI to use the new version.")}

`
      );
    }
    return { installed: ok };
  }
  if (choice === "ignore-version") {
    const ignoredVersions = Array.from(/* @__PURE__ */ new Set([...state.ignoredVersions ?? [], pending.latestVersion]));
    writeUpdateState({ ...state, pending: null, ignoredVersions });
    return { installed: false };
  }
  writeUpdateState({ ...state, pending: null });
  return { installed: false };
}
async function checkForNpmUpdate(packageInfo2) {
  if (!packageInfo2.name || !packageInfo2.version) {
    return;
  }
  try {
    const latestVersion = await fetchLatestNpmVersion(packageInfo2.name);
    if (!latestVersion || compareVersions(latestVersion, packageInfo2.version) <= 0) {
      clearPendingUpdate();
      return;
    }
    const state = readUpdateState();
    if (state.ignoredVersions?.includes(latestVersion)) {
      clearPendingUpdate(state);
      return;
    }
    writeUpdateState({
      ...state,
      pending: {
        currentVersion: packageInfo2.version,
        latestVersion,
        packageName: packageInfo2.name,
        checkedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  } catch {
  }
}
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const width = Math.max(left.length, right.length);
  for (let index = 0; index < width; index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }
  return 0;
}
function getUpdateStatePath() {
  return path29.join(os11.homedir(), ".deepcode", UPDATE_STATE_FILE);
}
async function promptUpdateChoice({
  currentVersion,
  latestVersion,
  installCommand
}) {
  return new Promise((resolve13) => {
    let selected = false;
    let instance = null;
    const handleSelect = (choice) => {
      if (selected) {
        return;
      }
      selected = true;
      resolve13(choice);
      instance?.unmount();
    };
    instance = render(
      React17.createElement(UpdatePrompt, {
        currentVersion,
        latestVersion,
        installCommand,
        onSelect: handleSelect
      }),
      { exitOnCtrlC: false }
    );
  });
}
async function runNpmInstallGlobal(installSpec) {
  return new Promise((resolve13) => {
    const child = spawnNpm(["install", "-g", installSpec], {
      stdio: "inherit"
    });
    child.on("error", (error) => {
      process.stderr.write(`Failed to start npm install: ${error.message}
`);
      resolve13(false);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve13(true);
        return;
      }
      process.stderr.write(`npm install exited with code ${code ?? "unknown"}.
`);
      resolve13(false);
    });
  });
}
async function fetchLatestNpmVersion(packageName) {
  const mirrorResult = await runNpmViewLatestVersion(packageName, TENCENT_MIRROR_REGISTRY, NPM_VIEW_TIMEOUT_MS);
  if (mirrorResult.ok) {
    return parseNpmViewVersion(mirrorResult.stdout);
  }
  const result = await runNpmViewLatestVersion(packageName, void 0, NPM_VIEW_TIMEOUT_MS);
  if (!result.ok) {
    return null;
  }
  return parseNpmViewVersion(result.stdout);
}
function runNpmViewLatestVersion(packageName, registry, timeoutMs) {
  return new Promise((resolve13) => {
    const args2 = ["view", packageName, "dist-tags.latest", "--json"];
    if (registry) {
      args2.push("--registry", registry);
    }
    const child = spawnNpm(args2, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve13(result);
    };
    const timer = setTimeout(() => {
      if (typeof child.pid === "number") {
        killProcessTree(child.pid, "SIGTERM", { killGroupOnNonWindows: false });
      } else {
        child.kill();
      }
      finish({ ok: false });
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      if (stdout.length >= MAX_NPM_VIEW_OUTPUT_CHARS) {
        return;
      }
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      stdout += text.slice(0, MAX_NPM_VIEW_OUTPUT_CHARS - stdout.length);
    });
    child.on("error", () => finish({ ok: false }));
    child.on("close", (code) => {
      finish(code === 0 ? { ok: true, stdout } : { ok: false });
    });
  });
}
function spawnNpm(args2, options) {
  if (process.platform === "win32") {
    return spawn6(["npm", ...args2.map(quoteCmdArg)].join(" "), [], {
      ...options,
      shell: true
    });
  }
  return spawn6("npm", args2, {
    ...options,
    shell: false
  });
}
function quoteCmdArg(arg) {
  return `"${String(arg).replace(/"/g, '\\"')}"`;
}
function parseNpmViewVersion(output) {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "string" && parsed.trim() ? parsed.trim() : null;
  } catch {
    return trimmed.split(/\r?\n/)[0]?.trim() || null;
  }
}
function readUpdateState() {
  const statePath = getUpdateStatePath();
  if (!fs27.existsSync(statePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs27.readFileSync(statePath, "utf8"));
    return {
      pending: parsed.pending ?? null,
      ignoredVersions: Array.isArray(parsed.ignoredVersions) ? parsed.ignoredVersions.filter(
        (value) => typeof value === "string" && value.trim().length > 0
      ) : []
    };
  } catch {
    return {};
  }
}
function writeUpdateState(state) {
  const statePath = getUpdateStatePath();
  fs27.mkdirSync(path29.dirname(statePath), { recursive: true });
  fs27.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}
`, "utf8");
}
function clearPendingUpdate(state = readUpdateState()) {
  if (!state.pending) {
    return;
  }
  writeUpdateState({ ...state, pending: null });
}
function parseVersion(value) {
  return value.split("-", 1)[0].split(".").map((part) => Number.parseInt(part, 10)).map((part) => Number.isFinite(part) ? part : 0);
}

// src/cliHelp.ts
function buildCliHelpText() {
  return [
    "lima-code - LiMa Code \u547D\u4EE4\u884C\u52A9\u624B",
    "",
    "\u7528\u6CD5\uFF1A",
    "  lima-code                             \u5728\u5F53\u524D\u76EE\u5F55\u542F\u52A8\u4EA4\u4E92\u5F0F TUI",
    "  lima-code -p <prompt>                 \u5E26\u9884\u586B\u63D0\u793A\u8BCD\u542F\u52A8",
    "  lima-code --prompt <prompt>           \u540C -p",
    "  lima-code --headless -p <prompt>      \u65E0 TUI \u6267\u884C\u4E00\u6B21\u63D0\u793A\u8BCD",
    "  lima-code --headless -p <p> --json    \u65E0 TUI \u6267\u884C\u5E76\u8F93\u51FA JSON",
    "  lima-code --headless                  \u65E0 TUI \u4EA4\u4E92\u6A21\u5F0F\uFF08\u9010\u884C\u8BFB\u53D6 stdin\uFF09",
    "  lima-code --daemon                    daemon \u6A21\u5F0F\uFF1A\u8F6E\u8BE2 LiMa Server \u4EFB\u52A1",
    "  lima-code --version                   \u6253\u5370\u7248\u672C\u53F7",
    "  lima-code --help                      \u663E\u793A\u5E2E\u52A9",
    "",
    "\u914D\u7F6E\uFF1A",
    "  ~/.lima-code/settings.json   \u7528\u6237\u7EA7 API key\u3001\u6A21\u578B\u3001base URL",
    "  ./.lima-code/settings.json   \u9879\u76EE\u7EA7\u8BBE\u7F6E",
    "  ~/.deepcode/settings.json    \u65E7\u7248\u517C\u5BB9\u914D\u7F6E\uFF08\u5DF2\u5E9F\u5F03\uFF09",
    "  ./.deepcode/settings.json    \u65E7\u7248\u517C\u5BB9\u914D\u7F6E\uFF08\u5DF2\u5E9F\u5F03\uFF09",
    "",
    "TUI \u5185\u5FEB\u6377\u952E\uFF1A",
    "  enter            \u53D1\u9001\u63D0\u793A\u8BCD",
    "  shift+enter      \u63D2\u5165\u6362\u884C",
    "  ctrl+v           \u4ECE\u526A\u8D34\u677F\u7C98\u8D34\u56FE\u7247",
    "  esc              \u4E2D\u65AD\u5F53\u524D\u6A21\u578B\u56DE\u5408",
    "  /                \u6253\u5F00\u547D\u4EE4\u83DC\u5355",
    "",
    "\u804A\u5929\u547D\u4EE4\uFF1A",
    "  /skills          \u5217\u51FA\u53EF\u7528\u6280\u80FD",
    "  /model           \u9009\u62E9\u6A21\u578B\u3001\u601D\u8003\u6A21\u5F0F\u548C\u63A8\u7406\u5F3A\u5EA6",
    "  /new             \u5F00\u542F\u65B0\u5BF9\u8BDD",
    "  /init            \u521D\u59CB\u5316 AGENTS.md \u9879\u76EE\u6307\u4EE4",
    "  /resume          \u9009\u62E9\u5386\u53F2\u5BF9\u8BDD\u7EE7\u7EED",
    "  /continue        \u7EE7\u7EED\u5F53\u524D\u5BF9\u8BDD",
    "  /undo            \u56DE\u9000\u4EE3\u7801\u6216\u5BF9\u8BDD\u5230\u5386\u53F2\u8282\u70B9",
    "  /mcp             \u67E5\u770B MCP \u670D\u52A1\u72B6\u6001\u548C\u5DE5\u5177",
    "  /raw             \u5207\u6362\u663E\u793A\u6A21\u5F0F\uFF08\u7CBE\u7B80/\u666E\u901A/\u539F\u59CB\u56DE\u6EDA\uFF09",
    "",
    "LiMa Worker \u547D\u4EE4\uFF1A",
    "  /lima connect    \u68C0\u67E5 LiMa Server \u8FDE\u63A5\u914D\u7F6E",
    "  /lima status     \u67E5\u770B worker \u72B6\u6001",
    "  /lima start      \u663E\u793A\u9879\u76EE\u5DE5\u4F5C\u53F0",
    "  /lima vibe       \u663E\u793A vibe coding \u5DE5\u4F5C\u6D41",
    "  /lima doctor     \u68C0\u67E5\u672C\u5730\u914D\u7F6E",
    "  /lima plan       \u751F\u6210\u5B9E\u65BD\u8BA1\u5212",
    "  /lima test       \u8FD0\u884C\u6D4B\u8BD5",
    "  /lima fix        \u4FEE\u590D\u95EE\u9898",
    "  /lima next       \u83B7\u53D6\u4E0B\u4E00\u9879\u4EFB\u52A1",
    "  /lima audit      \u67E5\u770B\u8FD1\u671F\u5BA1\u8BA1\u8BB0\u5F55",
    "  /lima work       \u81EA\u52A8\u5DE5\u4F5C\u5FAA\u73AF",
    "  /lima task       \u67E5\u770B\u4EFB\u52A1\u8BE6\u60C5",
    "  /lima review     \u5BA1\u67E5\u4EE3\u7801",
    "  /lima ship       \u4EA4\u4ED8\u524D\u68C0\u67E5",
    "",
    "  /exit            \u9000\u51FA",
    "  ctrl+d \u4E24\u6B21      \u9000\u51FA"
  ].join("\n") + "\n";
}

// src/cli.tsx
import { jsx as jsx21 } from "react/jsx-runtime";
var __dirname2 = path30.dirname(fileURLToPath3(import.meta.url));
var args = process.argv.slice(2);
var packageInfo = readPackageInfo();
if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`${packageInfo.version || "unknown"}
`);
  process.exit(0);
}
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(buildCliHelpText());
  process.exit(0);
}
function extractInitialPrompt(args2) {
  const promptIndex = args2.findIndex((arg) => arg === "-p" || arg === "--prompt");
  if (promptIndex !== -1 && promptIndex + 1 < args2.length) {
    return args2[promptIndex + 1];
  }
  return void 0;
}
var initialPrompt = extractInitialPrompt(args);
var projectRoot = process.cwd();
var headless = args.includes("--headless");
var daemon = args.includes("--daemon");
var jsonOutput = args.includes("--json");
configureWindowsShell();
if (daemon) {
  const { runDaemon: runDaemon2 } = await Promise.resolve().then(() => (init_daemon(), daemon_exports));
  await runDaemon2({
    projectRoot,
    verbose: args.includes("--verbose") || args.includes("-v")
  });
  process.exit(0);
}
if (headless) {
  const { runHeadless: runHeadless2 } = await Promise.resolve().then(() => (init_headless(), headless_exports));
  if (initialPrompt) {
    const result = await runHeadless2(initialPrompt, {
      json: jsonOutput,
      projectRoot,
      verbose: args.includes("--verbose")
    });
    process.exitCode = result.ok ? 0 : 1;
  } else if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const input = Buffer.concat(chunks).toString("utf-8").trim();
    if (input) {
      const result = await runHeadless2(input, { json: jsonOutput });
      process.exitCode = result.ok ? 0 : 1;
    } else {
      process.stderr.write("\u672A\u63D0\u4F9B\u8F93\u5165\u3002\n");
      process.exitCode = 1;
    }
  } else {
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin });
    process.stderr.write("LiMa Code\uFF08headless\uFF09\u2014 \u8F93\u5165\u63D0\u793A\u8BCD\u540E\u6309 Enter\uFF1A\n");
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "/exit") break;
      await runHeadless2(trimmed, { json: jsonOutput });
    }
    process.exitCode = 0;
  }
}
if (!headless && !process.stdin.isTTY && !process.env.LIMA_FORCE_TTY) {
  process.stderr.write("lima-code \u9700\u8981\u4EA4\u4E92\u5F0F\u7EC8\u7AEF\uFF08TTY\uFF09\u3002\u8BF7\u5728\u771F\u5B9E\u7EC8\u7AEF\u4F1A\u8BDD\u4E2D\u91CD\u65B0\u8FD0\u884C\u3002\n");
  process.exit(1);
}
if (!headless) {
  void main();
}
async function main() {
  const updatePromptResult = await promptForPendingUpdate(packageInfo);
  const restartRef = { current: null };
  function startApp() {
    let restarting = false;
    const appInitialPrompt = initialPrompt;
    initialPrompt = void 0;
    const inkInstance = render2(
      /* @__PURE__ */ jsx21(
        AppContainer_default,
        {
          projectRoot,
          version: packageInfo.version,
          initialPrompt: appInitialPrompt,
          onRestart: () => restartRef.current?.()
        }
      ),
      { exitOnCtrlC: false }
    );
    restartRef.current = () => {
      restarting = true;
      process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
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
function configureWindowsShell() {
  process.env.NoDefaultCurrentDirectoryInExePath = "1";
  try {
    setShellIfWindows();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`lima-code: ${message}
`);
    process.exit(1);
  }
}
function readPackageInfo() {
  try {
    const pkgPath = path30.resolve(__dirname2, "..", "package.json");
    const pkg = JSON.parse(fs28.readFileSync(pkgPath, "utf8"));
    return {
      name: typeof pkg.name === "string" ? pkg.name : "lima-code",
      version: typeof pkg.version === "string" ? pkg.version : ""
    };
  } catch {
    return { name: "lima-code", version: "" };
  }
}
