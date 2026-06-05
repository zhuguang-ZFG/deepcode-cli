import type { SkillInfo } from "../session";

export type SlashCommandKind =
  | "skill"
  | "skills"
  | "model"
  | "new"
  | "init"
  | "resume"
  | "continue"
  | "undo"
  | "mcp"
  | "lima"
  | "raw"
  | "exit";

export type SlashCommandItem = {
  kind: SlashCommandKind;
  name: string;
  label: string;
  description: string;
  skill?: SkillInfo;
  args?: string[];
};

export const BUILTIN_SLASH_COMMANDS: SlashCommandItem[] = [
  {
    kind: "skills",
    name: "skills",
    label: "/skills",
    description: "列出可用技能",
  },
  {
    kind: "model",
    name: "model",
    label: "/model",
    description: "选择模型、思考模式和推理强度",
  },
  {
    kind: "new",
    name: "new",
    label: "/new",
    description: "开启新对话",
  },
  {
    kind: "init",
    name: "init",
    label: "/init",
    description: "初始化 AGENTS.md 项目指令文件",
  },
  {
    kind: "resume",
    name: "resume",
    label: "/resume",
    description: "选择历史对话继续",
  },
  {
    kind: "continue",
    name: "continue",
    label: "/continue",
    description: "继续当前对话，或选择历史对话恢复",
  },
  {
    kind: "undo",
    name: "undo",
    label: "/undo",
    description: "回退代码或对话到历史节点",
  },
  {
    kind: "mcp",
    name: "mcp",
    label: "/mcp",
    description: "查看 MCP 服务状态和可用工具",
  },
  {
    kind: "lima",
    name: "lima",
    label: "/lima",
    description: "LiMa worker：先用 /lima vibe 查看 doctor → plan → test → review 工作流",
  },
  {
    kind: "raw",
    name: "raw",
    label: "/raw",
    args: ["lite", "normal", "raw-scrollback"],
    description: "切换推理内容显示模式",
  },
  {
    kind: "exit",
    name: "exit",
    label: "/exit",
    description: "退出 LiMa",
  },
];

export function buildSlashCommands(skills: SkillInfo[]): SlashCommandItem[] {
  const skillItems: SlashCommandItem[] = skills.map((skill) => ({
    kind: "skill",
    name: skill.name,
    label: `/${skill.name}`,
    description: skill.description || "(no description)",
    skill,
  }));
  return [...skillItems, ...BUILTIN_SLASH_COMMANDS];
}

export function filterSlashCommands(items: SlashCommandItem[], token: string): SlashCommandItem[] {
  if (!token.startsWith("/")) {
    return [];
  }
  const query = token.slice(1).toLowerCase();
  if (!query) {
    return items;
  }
  return items.filter((item) => item.name.toLowerCase().includes(query));
}

export function findExactSlashCommand(items: SlashCommandItem[], token: string): SlashCommandItem | null {
  if (!token.startsWith("/")) {
    return null;
  }
  const query = token.slice(1);
  const matches = items.filter((item) => item.name === query);
  return matches.find((item) => item.kind !== "skill") ?? matches[0] ?? null;
}

export function formatSlashCommandDescription(description: string): string {
  return (description || "(no description)").trim().replace(/\s+/g, " ");
}

export function formatSlashCommandLabel(item: SlashCommandItem): string {
  return item.kind === "skill" && item.skill?.isLoaded ? `${item.label} ✓` : item.label;
}
