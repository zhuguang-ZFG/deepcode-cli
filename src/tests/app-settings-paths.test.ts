import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  readProjectSettings,
  readSettings,
  writeModelConfigSelection,
  writeProjectSettings,
  writeSettings,
} from "../ui/App";

function withTempHome(fn: (home: string) => void): void {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lima-code-settings-home-"));
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;

  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    fn(home);
  } finally {
    restoreEnv("HOME", previousHome);
    restoreEnv("USERPROFILE", previousUserProfile);
  }
}

function restoreEnv(name: "HOME" | "USERPROFILE", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath: string): {
  env?: { MODEL?: string };
  model?: string;
  thinkingEnabled?: boolean;
  reasoningEffort?: string;
} {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    env?: { MODEL?: string };
    model?: string;
    thinkingEnabled?: boolean;
    reasoningEffort?: string;
  };
}

test("readSettings prefers .lima-code and falls back to legacy .deepcode", () => {
  withTempHome((home) => {
    writeJson(path.join(home, ".deepcode", "settings.json"), { env: { MODEL: "legacy-model" } });
    assert.equal(readSettings()?.env?.MODEL, "legacy-model");

    writeJson(path.join(home, ".lima-code", "settings.json"), { env: { MODEL: "native-model" } });
    assert.equal(readSettings()?.env?.MODEL, "native-model");
  });
});

test("readProjectSettings prefers .lima-code and falls back to legacy .deepcode", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "lima-code-settings-project-"));

  writeJson(path.join(project, ".deepcode", "settings.json"), { env: { MODEL: "legacy-project-model" } });
  assert.equal(readProjectSettings(project)?.env?.MODEL, "legacy-project-model");

  writeJson(path.join(project, ".lima-code", "settings.json"), { env: { MODEL: "native-project-model" } });
  assert.equal(readProjectSettings(project)?.env?.MODEL, "native-project-model");
});

test("writeSettings creates .lima-code user settings", () => {
  withTempHome((home) => {
    writeSettings({ env: { MODEL: "written-model" } });

    const nativePath = path.join(home, ".lima-code", "settings.json");
    assert.equal(fs.existsSync(nativePath), true);
    assert.equal(fs.existsSync(path.join(home, ".deepcode", "settings.json")), false);
    assert.equal(readJson(nativePath).env?.MODEL, "written-model");
  });
});

test("writeProjectSettings creates .lima-code project settings", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "lima-code-settings-project-"));

  writeProjectSettings({ env: { MODEL: "project-written" } }, project);

  const nativePath = path.join(project, ".lima-code", "settings.json");
  assert.equal(fs.existsSync(nativePath), true);
  assert.equal(fs.existsSync(path.join(project, ".deepcode", "settings.json")), false);
  assert.equal(readJson(nativePath).env?.MODEL, "project-written");
});

test("writeModelConfigSelection updates existing legacy project settings when native project settings is absent", () => {
  withTempHome(() => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "lima-code-settings-project-"));
    const legacyPath = path.join(project, ".deepcode", "settings.json");
    const nativePath = path.join(project, ".lima-code", "settings.json");
    writeJson(legacyPath, { env: { MODEL: "old-model" }, thinkingEnabled: false });

    const result = writeModelConfigSelection(
      { model: "new-model", thinkingEnabled: true, reasoningEffort: "high" },
      { model: "old-model", thinkingEnabled: false, reasoningEffort: "max" },
      project
    );

    const legacySettings = readJson(legacyPath);
    assert.equal(result.changed, true);
    assert.equal(legacySettings.model, "new-model");
    assert.equal(legacySettings.thinkingEnabled, true);
    assert.equal(legacySettings.reasoningEffort, "high");
    assert.equal(fs.existsSync(nativePath), false);
  });
});
