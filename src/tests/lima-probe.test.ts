import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { probeCodebase, findingToTask } from "../lima/probe";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lima-probe-test-"));
}

test("probe: empty findings for clean code", () => {
  const tmpDir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmpDir, "clean.py"), 'def hello():\n    return "world"\n');
    const result = probeCodebase(tmpDir);
    assert.equal(result.findings.length, 0);
    assert.equal(result.scannedFiles, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("probe: detects bare except without logging", () => {
  const tmpDir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmpDir, "bare.py"), "try:\n    pass\nexcept:\n    pass\n");
    const result = probeCodebase(tmpDir);
    const bare = result.findings.filter((f) => f.rule === "bareExcept");
    assert.ok(bare.length >= 1);
    assert.equal(bare[0].severity, "trivial");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("probe: does not flag except with logging", () => {
  const tmpDir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmpDir, "logged.py"), 'try:\n    pass\nexcept Exception:\n    logger.warning("err")\n');
    const result = probeCodebase(tmpDir);
    const bare = result.findings.filter((f) => f.rule === "bareExcept");
    assert.equal(bare.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("probe: detects hardcoded API keys", () => {
  const tmpDir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmpDir, "secrets.py"), 'key = "sk-abcdefghijklmnopqrstuvwxyz123456"\n');
    const result = probeCodebase(tmpDir);
    const secrets = result.findings.filter((f) => f.rule === "hardcodedSecret");
    assert.ok(secrets.length >= 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("probe: detects TODO markers", () => {
  const tmpDir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmpDir, "todo.py"), '# TODO: implement this\nprint("hello")\n');
    const result = probeCodebase(tmpDir);
    const todos = result.findings.filter((f) => f.rule === "todoFixme");
    assert.ok(todos.length >= 1);
    assert.equal(todos[0].severity, "small");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("probe: detects large files", () => {
  const tmpDir = makeTmpDir();
  try {
    const lines = Array.from({ length: 350 }, (_, i) => `line ${i}`);
    fs.writeFileSync(path.join(tmpDir, "big.py"), lines.join("\n") + "\n");
    const result = probeCodebase(tmpDir);
    const large = result.findings.filter((f) => f.rule === "largeFile");
    assert.ok(large.length >= 1);
    assert.equal(large[0].severity, "small");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("probe: detects os.system usage", () => {
  const tmpDir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmpDir, "insec.py"), 'import os\nos.system("ls")\n');
    const result = probeCodebase(tmpDir);
    const sec = result.findings.filter((f) => f.rule === "securityPattern");
    assert.ok(sec.length >= 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("probe: detects deep nesting", () => {
  const tmpDir = makeTmpDir();
  try {
    fs.writeFileSync(
      path.join(tmpDir, "deep.py"),
      "def f():\n    if True:\n        if True:\n            if True:\n                if True:\n                    if True:\n                        x = 1\n"
    );
    const result = probeCodebase(tmpDir);
    const deep = result.findings.filter((f) => f.rule === "deepNesting");
    assert.ok(deep.length >= 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("probe: detects unused imports", () => {
  const tmpDir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmpDir, "unused.py"), "import os\nimport sys\nprint('hello')\n");
    const result = probeCodebase(tmpDir);
    const unused = result.findings.filter((f) => f.rule === "unusedImport");
    assert.ok(unused.length >= 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("probe: skips node_modules", () => {
  const tmpDir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(tmpDir, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "node_modules", "pkg", "index.ts"), "TODO: fix");
    fs.writeFileSync(path.join(tmpDir, "good.ts"), 'console.log("hi")\n');
    const result = probeCodebase(tmpDir);
    assert.equal(result.scannedFiles, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("probe: respects minSeverity filter", () => {
  const tmpDir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmpDir, "a.py"), "try:\n    pass\nexcept:\n    pass\n");
    fs.writeFileSync(path.join(tmpDir, "b.py"), "x".repeat(4000) + "\n");
    const result = probeCodebase(tmpDir, { minSeverity: "small" });
    const trivial = result.findings.filter((f) => f.severity === "trivial");
    assert.equal(trivial.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("findingToTask: trivial → patch with limited tools", () => {
  const finding = {
    id: "x",
    rule: "bareExcept",
    file: "a.py",
    line: 3,
    severity: "trivial" as const,
    message: "bare except",
    suggestedFix: "Add logging",
  };
  const task = findingToTask(finding, "/project");
  assert.equal(task.mode, "patch");
  assert.ok(task.allowedTools.includes("read"));
  assert.ok(task.allowedTools.includes("edit"));
  assert.ok(!task.allowedTools.includes("bash"));
});

test("findingToTask: small → patch with full tools", () => {
  const finding = {
    id: "x",
    rule: "longFunction",
    file: "a.py",
    line: 10,
    severity: "small" as const,
    message: "long func",
    suggestedFix: "Split function",
  };
  const task = findingToTask(finding, "/project");
  assert.equal(task.mode, "patch");
  assert.ok(task.allowedTools.includes("bash"));
});

test("findingToTask: medium → plan with read-only", () => {
  const finding = {
    id: "x",
    rule: "deadCode",
    file: "a.py",
    line: 10,
    severity: "medium" as const,
    message: "dead code",
    suggestedFix: "Remove unused function",
  };
  const task = findingToTask(finding, "/project");
  assert.equal(task.mode, "plan");
  assert.deepEqual(task.allowedTools, ["read"]);
});
