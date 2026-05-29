/**
 * Probe — codebase scanner that discovers fixable issues.
 *
 * Uses regex + line-counting heuristics (no AST dependency).
 * Designed for <5s scans on 500-file projects.
 *
 * Each finding maps to a LiMaTaskRunnerRequest via findingToTask().
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// ─── Types ────────────────────────────────────────────────────────────────

export type ProbeSeverity = "trivial" | "small" | "medium";

export type ProbeFinding = {
  id: string;
  rule: string;
  file: string;
  line: number;
  severity: ProbeSeverity;
  message: string;
  suggestedFix: string;
};

export type ProbeResult = {
  findings: ProbeFinding[];
  scannedFiles: number;
  scanDurationMs: number;
};

export type ProbeOptions = {
  /** Maximum file size in bytes (default: 500KB) */
  maxFileSize?: number;
  /** File extensions to scan (default: .py, .ts, .js, .jsx, .tsx) */
  extensions?: string[];
  /** Directories to skip (in addition to defaults) */
  skipDirs?: string[];
  /** Minimum severity to include (default: trivial — includes all) */
  minSeverity?: ProbeSeverity;
};

// ─── Constants ────────────────────────────────────────────────────────────

const DEFAULT_EXTENSIONS = [".py", ".ts", ".js", ".jsx", ".tsx"];
const DEFAULT_MAX_FILE_SIZE = 500 * 1024;
const SKIP_DIRS = new Set([
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
  "donglicao-site",
]);

const SEVERITY_ORDER: Record<ProbeSeverity, number> = { trivial: 0, small: 1, medium: 2 };

// ─── Main Entry ───────────────────────────────────────────────────────────

export function probeCodebase(projectRoot: string, options?: ProbeOptions): ProbeResult {
  const t0 = Date.now();
  const opts: Required<ProbeOptions> = {
    maxFileSize: options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
    extensions: options?.extensions ?? DEFAULT_EXTENSIONS,
    skipDirs: options?.skipDirs ?? [],
    minSeverity: options?.minSeverity ?? "trivial",
  };

  const skipSet = new Set([...SKIP_DIRS, ...opts.skipDirs]);
  const files = collectFiles(projectRoot, opts.extensions, skipSet, opts.maxFileSize);
  const findings: ProbeFinding[] = [];

  for (const relPath of files) {
    const absPath = path.join(projectRoot, relPath);
    try {
      const content = fs.readFileSync(absPath, "utf8");
      const lines = content.split("\n");
      runDetectors(relPath, lines, findings);
    } catch {
      // Skip unreadable files
    }
  }

  // Filter by min severity
  const minSev = SEVERITY_ORDER[opts.minSeverity];
  const filtered = findings.filter((f) => SEVERITY_ORDER[f.severity] >= minSev);

  // Sort: medium first, then small, then trivial
  filtered.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);

  return {
    findings: filtered,
    scannedFiles: files.length,
    scanDurationMs: Date.now() - t0,
  };
}

// ─── Finding to Task ──────────────────────────────────────────────────────

export function findingToTask(
  finding: ProbeFinding,
  _projectRoot: string,
  _testCommands?: string[]
): {
  goal: string;
  constraints: string[];
  allowedTools: string[];
  mode: "plan" | "patch";
} {
  const isMedium = finding.severity === "medium";
  return {
    goal: finding.suggestedFix,
    constraints: [
      `Fix ${finding.rule} at ${finding.file}:${finding.line}`,
      `Severity: ${finding.severity}`,
      finding.message,
    ],
    allowedTools: isMedium
      ? ["read"]
      : finding.severity === "trivial"
        ? ["read", "edit"]
        : ["read", "write", "edit", "bash", "git_diff", "test"],
    mode: isMedium ? "plan" : "patch",
  };
}

// ─── Detectors ────────────────────────────────────────────────────────────

function runDetectors(file: string, lines: string[], findings: ProbeFinding[]): void {
  const isPython = file.endsWith(".py");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // 1. Bare except
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

    // 2. Hardcoded secrets
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
      // Exclude test fixtures and example code
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

    // 3. TODO / FIXME / HACK / XXX
    const todoMatch = line.match(/(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)/i);
    if ((todoMatch && !/^\s*[#/]/.test(line)) || /^\s*[#/].*\b(TODO|FIXME|HACK|XXX)\b/.test(line)) {
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

    // 4. Security patterns
    if (/\bos\.system\s*\(/.test(line)) {
      findings.push(
        makeFinding(
          file,
          lineNum,
          "securityPattern",
          "small",
          "os.system() usage — potential command injection",
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
            "eval() usage — potential code injection",
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
          "subprocess with shell=True — potential injection",
          `Use shell=False with argument list instead of shell=True in ${file}.`
        )
      );
    }

    // 5. Deep nesting (>4 levels)
    const indent = line.match(/^(\s*)/)?.[1] ?? "";
    const indentLevel = indent.includes("\t") ? indent.split("\t").length : Math.floor(indent.length / 4);
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

    // 6. Unused import (Python only)
    if (isPython) {
      // Handle `from X import Y, Z`
      const fromImportMatch = line.match(/^from\s+\S+\s+import\s+(.+)/);
      if (fromImportMatch) {
        const imports = fromImportMatch[1]
          .split(",")
          .map((s) => {
            const name = s
              .trim()
              .split(/\s+as\s+/)[0]
              .trim();
            return name.replace(/[()]/g, "").trim();
          })
          .filter(Boolean);
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
      // Handle `import X`
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

  // 7. Long functions (brace/def counting)
  detectLongFunctions(file, lines, findings);

  // 8. Large file
  if (lines.length > 300) {
    findings.push(
      makeFinding(
        file,
        1,
        "largeFile",
        "small",
        `File is ${lines.length} lines (>300)`,
        `Split ${file} into smaller, focused modules. Target: ≤300 lines per file.`
      )
    );
  }
}

function detectLongFunctions(file: string, lines: string[], findings: ProbeFinding[]): void {
  const isPython = file.endsWith(".py");
  const funcPattern = isPython ? /^\s*(async\s+)?def\s+(\w+)/ : /^\s*(async\s+)?(\w+)\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(funcPattern);
    if (!match) continue;
    const funcName = isPython ? match[2] : match[2] || match[1] || "anonymous";

    // Find end of function by counting indentation (Python) or braces (JS/TS)
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

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeFinding(
  file: string,
  line: number,
  rule: string,
  severity: ProbeSeverity,
  message: string,
  suggestedFix: string
): ProbeFinding {
  const id = crypto.createHash("sha256").update(`${file}:${rule}:${line}`).digest("hex").slice(0, 16);
  return { id, rule, file, line, severity, message, suggestedFix };
}

function collectFiles(root: string, extensions: string[], skipDirs: Set<string>, maxFileSize: number): string[] {
  const result: string[] = [];
  walkDir(root, root, extensions, skipDirs, maxFileSize, result);
  return result;
}

function walkDir(
  dir: string,
  root: string,
  extensions: string[],
  skipDirs: Set<string>,
  maxFileSize: number,
  result: string[]
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    if (skipDirs.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(abs, root, extensions, skipDirs, maxFileSize, result);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!extensions.includes(ext)) continue;
      try {
        const stat = fs.statSync(abs);
        if (stat.size > maxFileSize) continue;
      } catch {
        continue;
      }
      result.push(path.relative(root, abs).replace(/\\/g, "/"));
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
