# LiMa Code Command Center TUI Design

Updated: 2026-05-31
Status: direction-selected

## Goal

LiMa Code 的 TUI 要从“能聊天”升级为“能监督真实编码工作流”的命令中心。
用户选择方案 A：主对话保持核心位置，同时提供清晰的运行态信息层，让操作者知道一次请求卡在 Router、模型、工具、MCP、缓存、网络还是本地进程。

这次重设计不追求花哨视觉。目标是中文优先、信息密度合适、键盘可达、终端宽度变化稳定，并把 token/cache/工具能力/失败层级从隐藏信息变成可见反馈。

## Product Principles

1. 主对话永远是第一工作区，不能被仪表盘挤掉。
2. 运行态必须显式展示：模型、Router 阶段、等待首 token、token 用量、cache 命中、请求数、工具调用、MCP 状态和最近失败。
3. 中文界面优先，但保留协议名、模型名、命令名、环境变量、JSON key 和工具名的原文。
4. 不自动编造“无限额度”“100% 可用”等承诺；UI 只能展示当前真实配置和观测到的证据。
5. TUI 需要适配窄终端，不能因为右侧栏导致文本重叠或输入区跳动。

## Chosen Layout

### Wide Terminal: Command Center

适用于宽度大于等于 118 列的终端。

```text
┌ LiMa Code ──────────────────────────────────────────────── lima-1.3 ─┐
│ 主对话 / diff 摘要 / 工具结果                                         │
│                                                                      │
│ > 用户任务                                                           │
│ LiMa: 正在读取项目结构...                                            │
├─────────────────────────────────────────────────┬────────────────────┤
│ > 输入区                                        │ 运行态              │
│ enter 发送 / shift+enter 换行 / @ 文件 / / 命令 │ Router: 等待首 token │
│                                                 │ Token: 1.2k / 0     │
│                                                 │ Cache: 99.1%        │
│                                                 │ Tools: Bash running │
│                                                 │ MCP: 5/6 ready      │
└─────────────────────────────────────────────────┴────────────────────┘
```

右侧运行态栏只显示可观测信息，不放长说明文：

- Router：`queued`、`sent`、`waiting_first_token`、`streaming`、`retrying`、`failed`。
- Model：当前模型和 thinking/reasoning 状态。
- Usage：本轮 active tokens、累计 input/output、cached tokens、cache hit rate、request count。
- Tools：运行中的 Bash/Read/Write/Edit/MCP 调用数量和最长等待时长。
- Health：最近失败原因、空响应、401/402/429、timeout、tool-call capability retry。
- Controls：只在有意义时显示 `/mcp`、`/raw`、`ctrl+c`、`stdout` 等短命令提示。

### Medium Terminal: Inline Status Band

适用于 88 到 117 列。运行态栏收缩为输入区上方的两行状态带。

```text
status: processing · Router waiting_first_token 42s · model lima-1.3
usage: in 1,204 · out 0 · cache 99.1% · req 1 · tools 0 · MCP 5/6
────────────────────────────────────────────────────────────────────
> 输入区
```

### Narrow Terminal: Compact Mode

适用于 88 列以下。保持单列，不强行 minWidth 到 80 以上之外的横向撑开；所有状态压缩为一行，必要时轮播或截断。

```text
processing · waiting_first_token 42s · cache 99% · req 1
> 输入区
```

窄屏下不能显示右侧栏，也不能让欢迎页、菜单或按钮文字溢出。

## Interaction States

### Idle

- 显示当前模型、thinking 状态、工作目录和最近可用命令。
- 不显示空的运行态栏。
- 欢迎页避免长篇营销文案，聚焦“当前配置是否能工作”。

### Processing Before First Token

- 明确显示 `waiting for first token`，并显示已等待秒数。
- 如果有 Router retry telemetry，显示当前尝试次数、供应商/模型标签和失败类型。
- token 数为 0 时直接显示 `out 0` 或 `等待首 token`，避免用户误以为统计坏了。

### Streaming

- loading 文案随阶段变化，但保持一行稳定高度。
- usage 持续刷新 active tokens、input/output/cache/request count。

### Tool Running

- 输入区保留 interrupt 提示。
- 工具 stdout 以可展开面板展示，默认只显示摘要、pid、时长、超时控制。
- 大输出必须截断并提示已截断，避免 TUI 被刷屏。

### Failure

- 错误显示为中文可行动描述，同时保留 HTTP 状态码和服务端 fail reason。
- 401：提示检查 API key / server URL，不隐藏认证失败。
- 402：提示余额或额度不足，不把它描述成网络失败。
- Empty response：提示可能是后端超时或模型无内容，并展示最近 Router/模型阶段。
- Timeout：展示是哪一层超时：HTTP、Router、供应商、工具或本地进程。

## Component Plan

先新增纯展示 helper，再把 App 主布局拆薄：

- `src/ui/runtimeStatus.ts`
  - 从 `SessionEntry`、`LlmStreamProgress`、running processes、MCP status 和 settings 生成展示模型。
  - 暴露 `buildRuntimeStatusViewModel`、`formatRuntimeMetric`、`selectRuntimeLayoutMode`。

- `src/ui/RuntimeStatusPanel.tsx`
  - 宽屏右侧栏。
  - 中屏两行状态带。
  - 窄屏单行状态。

- `src/ui/App.tsx`
  - 保持状态来源不变。
  - 只负责选择 layout mode 并渲染主对话、输入区和运行态组件。
  - 避免继续堆大函数。

- `src/ui/ProcessStdoutView.tsx`
  - 与运行态 panel 对齐术语：运行中、已截断、延长超时、隐藏输出。

## Test Plan

采用 TDD，小步落地：

1. `selectRuntimeLayoutMode` 覆盖 wide / medium / narrow 宽度边界。
2. `buildRuntimeStatusViewModel` 覆盖 idle、processing、waiting first token、streaming、tool running、failure。
3. cache hit rate 使用已有 usage 字段，不重复造统计口径。
4. 401/402/429/timeout/empty response 文案保持可行动且不吞掉原始状态码。
5. 渲染测试覆盖宽屏右侧栏、中屏状态带、窄屏单行。
6. 运行 `npm.cmd test`、`npm.cmd run check`、`npm.cmd run build` 和 `git diff --check`。

## Non-Goals

- 不改 LiMa Server 协议。
- 不改模型路由策略。
- 不内置真实 key 或绕过额度。
- 不引入全屏鼠标 UI。
- 不把 TUI 做成复杂 dashboard，避免牺牲日常编码输入体验。

## Open Implementation Notes

- 需要优先修复现有 TUI 文案编码显示问题，确保源码保存为 UTF-8，终端渲染只输出真实中文。
- `App.tsx` 已超过理想文件大小，本轮应至少把运行态格式化逻辑拆出，避免继续加重。
- `.superpowers/brainstorm` 仅作为本地视觉辅助，不进入提交。
