# LiMa Provider Profile

LiMa can use LiMa as an OpenAI-compatible model provider. In this setup, LiMa remains the coding CLI and vibe-coding workflow, while LiMa handles model routing, backend health, memory, and safety policy.

## Recommended Role Split

```text
User
  -> LiMa CLI
  -> LiMa OpenAI-compatible endpoint
  -> LiMa model routing / memory / safety
  -> selected backend model
```

Use this integration when you want LiMa's terminal coding workflow with LiMa's router and model pool.

## User Settings

Create or update `~/.lima/settings.json`:

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

Legacy `~/.deepcode/settings.json` still works as a fallback, but new LiMa profiles should use `.lima`.

For local development against a Windows LiMa router:

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

Do not commit real API keys. Prefer system environment variables for secrets:

```powershell
$env:LIMA_API_KEY = "<YOUR_LIMA_API_KEY>"
$env:LIMA_BASE_URL = "https://chat.donglicao.com/v1"
$env:LIMA_MODEL = "lima-1.3"
lima
```

## Project Settings

For a sandbox repository, create `<project>/.lima/settings.json`:

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

Keep `API_KEY` outside project settings unless the project settings file is ignored and local-only.

## Safe First Task

Use a disposable sandbox before pointing LiMa at a production or messy repository:

```powershell
mkdir D:\GIT\lima-sandbox
cd D:\GIT\lima-sandbox
git init
lima -p "Create a tiny JavaScript add function and a simple test. Do not use git push or deployment commands."
```

Expected evidence after the run:

- Plan or explanation.
- Files touched.
- Diff.
- Commands run.
- Test output.
- Risk summary.

## Safety Rules For LiMa Use

- Do not run first trials in the main `D:\GIT` LiMa workspace.
- Use a sandbox or git worktree for real LiMa tasks.
- Do not allow automatic `git push`, VPS deploy, nginx/firewall edits, or service restarts.
- Do not store `.env`, tokens, VPS credentials, or provider keys in LiMa project settings.
- Avoid enabling GitHub, browser, or database MCP servers until the local LiMa + LiMa flow is stable.
- Treat `bash` as a powerful local execution tool; review commands before allowing risky actions.

## Recommended Next Integration

Once the basic provider profile works, add a LiMa result adapter that records LiMa runs as:

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

LiMa can then write the result into Session Memory, the future mastery loop, or an agent workbench trace.
