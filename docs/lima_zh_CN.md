# LiMa Provider Profile

LiMa Code 可以把 LiMa 当作 OpenAI-compatible 模型供应方使用。这个组合里，LiMa Code 负责终端 coding workflow 和 vibe coding 体验，LiMa 负责模型路由、后端健康、长期记忆和安全策略。

## 推荐分工

```text
用户
  -> LiMa Code CLI
  -> LiMa OpenAI-compatible endpoint
  -> LiMa 模型路由 / 记忆 / 安全
  -> 被选中的后端模型
```

这个接入方式适合先快速跑通 LiMa Code + LiMa，而不是把 LiMa Code 直接合进 LiMa 仓库。

## 用户级配置

创建或更新 `~/.lima-code/settings.json`：

```json
{
  "env": {
    "MODEL": "lima-1.3",
    "BASE_URL": "https://chat.donglicao.com/v1",
    "API_KEY": "<YOUR_LIMA_API_KEY>"
  },
  "thinkingEnabled": false,
  "reasoningEffort": "high"
}
```

旧的 `~/.deepcode/settings.json` 仍可作为 fallback 使用，但新的 LiMa profile 应使用 `.lima-code`。

如果要连本机 Windows LiMa router：

```json
{
  "env": {
    "MODEL": "lima-1.3",
    "BASE_URL": "http://127.0.0.1:8080/v1",
    "API_KEY": "<YOUR_LOCAL_LIMA_API_KEY>"
  },
  "thinkingEnabled": false,
  "reasoningEffort": "high"
}
```

不要提交真实 API key。更推荐用系统环境变量放密钥：

```powershell
$env:LIMA_CODE_API_KEY = "<YOUR_LIMA_API_KEY>"
$env:LIMA_CODE_BASE_URL = "https://chat.donglicao.com/v1"
$env:LIMA_CODE_MODEL = "lima-1.3"
lima-code
```

## 项目级配置

在沙盒仓库里创建 `<project>/.lima-code/settings.json`：

```json
{
  "env": {
    "MODEL": "lima-1.3",
    "BASE_URL": "https://chat.donglicao.com/v1"
  },
  "thinkingEnabled": false,
  "reasoningEffort": "high"
}
```

除非该配置文件已被 ignore 且只在本地使用，否则不要把 `API_KEY` 写进项目级配置。

## 第一个安全任务

先用一次性沙盒，不要直接指向生产仓库或当前很脏的 `D:\GIT`：

```powershell
mkdir D:\GIT\lima-code-sandbox
cd D:\GIT\lima-code-sandbox
git init
lima-code -p "Create a tiny JavaScript add function and a simple test. Do not use git push or deployment commands."
```

任务结束后至少要能看到：

- plan 或说明；
- 修改了哪些文件；
- diff；
- 执行过哪些命令；
- 测试输出；
- 风险摘要。

## LiMa 使用安全边界

- 第一次不要在主 `D:\GIT` LiMa 工作区运行。
- 真实 LiMa 任务使用 sandbox 或 git worktree。
- 不允许自动 `git push`、VPS deploy、nginx/firewall 修改或服务重启。
- 不要把 `.env`、token、VPS 凭据或 provider key 写入 LiMa Code 项目配置。
- GitHub、浏览器、数据库 MCP 先不要启用，等 LiMa Code + LiMa 基础流程稳定后再说。
- `bash` 是真实本地执行工具，高风险命令必须人工确认。

## 下一步推荐集成

基础 provider profile 跑通后，再加 LiMa result adapter，把 LiMa Code 任务输出归一成：

```json
{
  "task": "...",
  "repo": "...",
  "plan": "...",
  "touched_files": [],
  "diff_summary": "...",
  "commands": [],
  "test_result": "...",
  "risk_summary": "...",
  "status": "success|failed|blocked"
}
```

之后 LiMa 可以把这份结果写入 Session Memory、未来的 mastery loop 或 agent workbench trace。
