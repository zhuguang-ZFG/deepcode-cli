import React, { useMemo, useState } from "react";
import { Box, Text } from "ink";
import * as os from "node:os";
import path from "node:path";
import type { SkillInfo } from "../session";
import type { ResolvedDeepcodingSettings } from "../settings";
import { buildSlashCommands, BUILTIN_SLASH_COMMANDS, formatSlashCommandDescription } from "./slashCommands";
import { ThemedGradient } from "./ThemedGradient";
import { AsciiLogo, BrandInfo } from "../AsciiArt";
import { useAppContext } from "./contexts";

type WelcomeScreenProps = {
  projectRoot: string;
  settings: ResolvedDeepcodingSettings;
  skills: SkillInfo[];
  width: number;
};

const TITLE_PANEL_WIDTH = 70;
const PANEL_CONTENT_HEIGHT = 8;

const SHORTCUT_TIPS = [
  { label: "Enter", description: "发送提示词" },
  { label: "Shift+Enter", description: "插入换行" },
  { label: "Ctrl+V", description: "从剪贴板粘贴图片" },
  { label: "Esc", description: "中断当前模型回合" },
  { label: "/", description: "打开技能和命令菜单" },
  { label: "Ctrl+D 两次", description: "退出 LiMa Code" },
];

export type WelcomeAction = {
  command: string;
  description: string;
};

export function WelcomeScreen({ projectRoot, settings, skills, width }: WelcomeScreenProps): React.ReactElement {
  const { version } = useAppContext();
  const tips = useMemo(() => buildWelcomeTips(skills), [skills]);
  const actions = useMemo(() => buildWelcomeActions(), []);
  const [tipIndex] = useState(() => randomTipIndex(tips.length));
  const compact = width < TITLE_PANEL_WIDTH + 42;
  const cwd = formatHomeRelativePath(projectRoot);
  const tip = tips[Math.min(tipIndex, Math.max(0, tips.length - 1))] ?? tips[0];
  const panelWidth = compact ? undefined : Math.min(width, 72);

  return (
    <Box flexDirection="column" marginY={1}>
      <Box flexDirection="column" width={panelWidth}>
        <Box flexDirection="column" paddingX={1}>
          <Box flexDirection="column" justifyContent="center" paddingX={1}>
            <Box justifyContent="center" width={compact ? undefined : TITLE_PANEL_WIDTH}>
              <ThemedGradient>{AsciiLogo}</ThemedGradient>
            </Box>
          </Box>

          <Box flexDirection="column" paddingX={1}>
            <Text color="gray">{BrandInfo}</Text>
          </Box>

          <Box
            borderStyle={"round"}
            borderColor={"#229ac3e6"}
            flexDirection="column"
            flexGrow={1}
            height={compact ? undefined : PANEL_CONTENT_HEIGHT}
            marginTop={compact ? 1 : 0}
            paddingX={1}
          >
            <Box flexGrow={1} marginBottom={compact ? 1 : 0}>
              <Text color={"#229ac3e6"}>{">"}_ LiMa Code </Text>
              <Text color="gray"> (v{version || "unknown"})</Text>
            </Box>
            {!compact ? <Text> </Text> : null}
            <SettingRow label="模型" value={settings.model} />
            <SettingRow label="思考模式" value={settings.thinkingEnabled ? "开启" : "关闭"} />
            <SettingRow label="推理强度" value={settings.thinkingEnabled ? settings.reasoningEffort : "-"} />
            <SettingRow label="CWD" value={cwd} />
          </Box>
        </Box>
      </Box>

      <Box flexDirection="column" width={panelWidth} paddingX={1} marginTop={1}>
        {actions.map((action) => (
          <Box key={action.command}>
            <Box width={compact ? 24 : 34}>
              <Text color={"#229ac3e6"}>{action.command}</Text>
            </Box>
            <Text dimColor>{action.description}</Text>
          </Box>
        ))}
      </Box>

      <Box flexDirection="column" width={panelWidth} paddingX={1}>
        {tip ? (
          <Box marginTop={1}>
            <Text dimColor>
              Tips: {tip.label} - {tip.description}
            </Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

function SettingRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <Box flexDirection="row">
      <Box width={20}>
        <Text>{label}</Text>
      </Box>
      <Box flexGrow={1} justifyContent="flex-end">
        <Text>{value}</Text>
      </Box>
    </Box>
  );
}

export function formatHomeRelativePath(value: string, home = os.homedir()): string {
  const normalizedValue = path.resolve(value);
  const normalizedHome = path.resolve(home);
  const relative = path.relative(normalizedHome, normalizedValue);

  if (relative === "") {
    return "~";
  }
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return `~${path.sep}${relative}`;
  }
  return normalizedValue;
}

export function buildWelcomeTips(skills: SkillInfo[]): Array<{ label: string; description: string }> {
  const slashTips = buildSlashCommands(skills)
    .filter((item) => item.kind !== "skill" || item.skill?.isLoaded)
    .map((item) => ({
      label: item.label,
      description: formatSlashCommandDescription(item.description),
    }));

  return [
    ...slashTips,
    ...SHORTCUT_TIPS.filter((tip) => !BUILTIN_SLASH_COMMANDS.some((command) => command.label === tip.label)),
  ];
}

export function buildWelcomeActions(): WelcomeAction[] {
  return [
    { command: "/lima start", description: "推荐：打开当前项目工作台" },
    { command: "/lima doctor", description: "检查服务、密钥、worker 停止标记与本地审计状态" },
    { command: "提问: 修复/审查/部署这个项目", description: "直接在对话里发起项目任务" },
  ];
}

function randomTipIndex(length: number): number {
  return length > 0 ? Math.floor(Math.random() * length) : 0;
}
