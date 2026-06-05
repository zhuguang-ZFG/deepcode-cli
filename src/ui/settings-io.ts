import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  applyModelConfigSelection,
  type DeepcodingSettings,
  type ModelConfigSelection,
  type ResolvedDeepcodingSettings,
  resolveSettingsSources,
} from "../settings";

const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_BASE_URL = "https://api.deepseek.com";

export function readSettings(): DeepcodingSettings | null {
  return readFirstSettingsFile(getUserSettingsPath(), getLegacyUserSettingsPath());
}

export function readProjectSettings(projectRoot: string = process.cwd()): DeepcodingSettings | null {
  return readFirstSettingsFile(getProjectSettingsPath(projectRoot), getLegacyProjectSettingsPath(projectRoot));
}

function readFirstSettingsFile(...settingsPaths: string[]): DeepcodingSettings | null {
  for (const settingsPath of settingsPaths) {
    const settings = readSettingsFile(settingsPath);
    if (settings) {
      return settings;
    }
  }
  return null;
}

function readSettingsFile(settingsPath: string): DeepcodingSettings | null {
  try {
    if (!fs.existsSync(settingsPath)) {
      return null;
    }
    const raw = fs.readFileSync(settingsPath, "utf8");
    return JSON.parse(raw) as DeepcodingSettings;
  } catch {
    return null;
  }
}

export function writeSettings(settings: DeepcodingSettings): void {
  const settingsPath = getUserSettingsPath();
  writeSettingsFile(settingsPath, settings);
}

export function writeProjectSettings(settings: DeepcodingSettings, projectRoot: string = process.cwd()): void {
  const settingsPath = getProjectSettingsPath(projectRoot);
  writeSettingsFile(settingsPath, settings);
}

function writeSettingsFile(settingsPath: string, settings: DeepcodingSettings): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function writeModelConfigSelection(
  selection: ModelConfigSelection,
  current: ModelConfigSelection = resolveCurrentSettings(),
  projectRoot: string = process.cwd()
): { changed: boolean; settings: DeepcodingSettings } {
  const existingProjectSettingsPath = getExistingProjectSettingsPath(projectRoot);
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

export function resolveCurrentSettings(projectRoot: string = process.cwd()): ResolvedDeepcodingSettings {
  return resolveSettingsSources(
    readSettings(),
    readProjectSettings(projectRoot),
    {
      model: DEFAULT_MODEL,
      baseURL: DEFAULT_BASE_URL,
    },
    process.env
  );
}

function getUserSettingsPath(): string {
  return path.join(os.homedir(), ".lima", "settings.json");
}

function getLegacyUserSettingsPath(): string {
  return path.join(os.homedir(), ".deepcode", "settings.json");
}

function getProjectSettingsPath(projectRoot: string): string {
  return path.join(projectRoot, ".lima", "settings.json");
}

function getLegacyProjectSettingsPath(projectRoot: string): string {
  return path.join(projectRoot, ".deepcode", "settings.json");
}

function getExistingProjectSettingsPath(projectRoot: string): string | null {
  const projectSettingsPath = getProjectSettingsPath(projectRoot);
  if (fs.existsSync(projectSettingsPath)) {
    return projectSettingsPath;
  }

  const legacyProjectSettingsPath = getLegacyProjectSettingsPath(projectRoot);
  return fs.existsSync(legacyProjectSettingsPath) ? legacyProjectSettingsPath : null;
}
