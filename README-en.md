<div align="center">
<br/>
<br/>
<p align="center">
  <a href='https://github.com/zhuguang-ZFG/deepcode-cli'>
    <img src='resources/lima-code-logo.svg' width='100' alt="LiMa Code logo"/>
  </a>
</p>
<h1>LiMa Code CLI</h1>

[![][npm-release-shield]][npm-release-link] [![][npm-downloads-shield]][npm-downloads-link] [![][github-contributors-shield]][github-contributors-link] [![][github-forks-shield]][github-forks-link] [![][github-stars-shield]][github-stars-link]
[![][github-issues-shield]][github-issues-link] [![][github-issues-pr-shield]][github-issues-pr-link] [![][github-license-shield]][github-license-link]

English · [中文](./README.md)

<br/>
</div>

[LiMa Code](https://github.com/zhuguang-ZFG/deepcode-cli) is a terminal AI coding worker adapted for the LiMa personal coding assistant stack. It keeps the CLI vibe-coding workflow, Agent Skills, MCP, notifications, and multi-turn coding loops, while LiMa Server can handle model routing, memory, health checks, and backend selection.


## Installation

```bash
npm install -g lima-code
```

Run `lima-code` inside any project directory to get started.

![intro2](resources/intro2.png)

## Configuration

Create `~/.lima-code/settings.json`:

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

You can also keep secrets in environment variables:

```powershell
$env:LIMA_CODE_MODEL = "lima-1.3"
$env:LIMA_CODE_BASE_URL = "https://chat.donglicao.com/v1"
$env:LIMA_CODE_API_KEY = "<YOUR_LIMA_API_KEY>"
lima-code
```

Legacy `~/.deepcode/settings.json` files are still read as fallbacks, but new LiMa Code configuration should use `~/.lima-code/settings.json`.

For complete configuration details (multi-level priority, environment variables, etc.), see [docs/configuration.md](docs/configuration.md).

## Key Features

### **Skills**
LiMa Code CLI supports agent skills that allow you to extend the assistant's capabilities:

- **User-level Skills**: discovered and activated from `~/.agents/skills/`.
- **Project-level Skills**: loaded from `./.agents/skills/` for project-specific workflows, with legacy `./.deepcode/skills/` compatibility.

### **LiMa Server Integration**
- Recommended default: connect to LiMa's OpenAI-compatible endpoint.
- LiMa Code handles the local coding worker experience; LiMa Server handles routing, memory, health checks, and safety policy.
- Ready for LiMa agent task contracts, MCP presets, and task-result archival.

### **OpenAI-compatible Provider**
- Connect directly to LiMa, DeepSeek, Volcano Ark, or any other OpenAI-compatible API.
- Supports thinking mode, reasoning effort, MCP, web search, and task-completion notifications.

## Slash Commands & Keyboard Shortcuts

| Slash Command    | Action                                                  |
|------------------|---------------------------------------------------------|
| `/`              | Open the skills / commands menu                         |
| `/new`           | Start a fresh conversation                              |
| `/resume`        | Choose a previous conversation to continue              |
| `/continue`      | Continue the active conversation or pick one to resume  |
| `/model`         | Switch model, thinking mode, and reasoning effort       |
| `/raw`           | Toggle display mode (Normal / Lite / Raw scrollback)    |
| `/init`          | Initialize an AGENTS.md file (LLM project instructions) |
| `/skills`        | List available skills                                   |
| `/mcp`           | View MCP server status and available tools              |
| `/undo`          | Restore code and/or conversation to a previous point    |
| `/exit`          | Quit (also `Ctrl+D` twice)                              |

| Key              | Action                                                   |
|------------------|----------------------------------------------------------|
| `Enter`          | Send the prompt                                          |
| `Shift+Enter`    | Insert a newline (also `Ctrl+J`)                         |
| `Ctrl+V`         | Paste an image from the clipboard                        |
| `Esc`            | Interrupt the current model turn                         |
| `Ctrl+D` twice   | Quit LiMa Code                                           |

## Recommended Model Setup

- `lima-1.3` (recommended through LiMa Server)
- DeepSeek V4 series
- Volcano Ark Coding Plan
- Any other OpenAI-compatible model

## FAQ

### Does LiMa Code have a VSCode extension?

The CLI is the recommended entry point right now. The legacy VSCode extension may still read compatible settings, but it has not been republished under the LiMa Code name, so this README no longer points users to the old extension listing as the recommended install path.

### Does LiMa Code support understanding images?

LiMa Code supports image paste from the clipboard with `Ctrl+V`. Whether the image is understood depends on the LiMa backend or OpenAI-compatible provider you connect to.

### How to automatically send a Slack message after a task completes?

Write a shell notification script that calls a Slack webhook, then set the `notify` field in `~/.lima-code/settings.json` to the full path of the script. For detailed steps, see [docs/notify_en.md](docs/notify_en.md).

### How do I enable web search?

LiMa Code comes with a built-in Web Search tool. If you prefer custom search logic, set `webSearchTool` in `~/.lima-code/settings.json` to the full path of your script.

### Does it support Coding Plan?

Yes. Just set `env.BASE_URL` in `~/.lima-code/settings.json` to an OpenAI-compatible API endpoint. Take Volcano Ark's Coding Plan as an example:

```json
{
  "env": {
    "MODEL": "ark-code-latest",
    "BASE_URL": "https://ark.cn-beijing.volces.com/api/coding/v3",
    "API_KEY": "**************"
  },
  "thinkingEnabled": true
}
```

### How do I configure MCP?

LiMa Code supports MCP (Model Context Protocol) to connect external services such as GitHub, browsers, databases, and more. Configure the `mcpServers` field in `settings.json` to enable it, then use the `/mcp` command to view MCP server status and available tools.

For detailed setup instructions, see: [docs/mcp.md](docs/mcp.md)

### How to configure LiMa Code to send notifications after a task completes?

When the AI assistant completes a task, LiMa Code can automatically execute a notification script to send the task results to the specified channel (e.g., Slack, system notifications, etc.).

For detailed configuration instructions, see: [docs/notify_en.md](docs/notify_en.md)

### Can I use LiMa as the model provider?

Yes. LiMa Code can point to LiMa's OpenAI-compatible endpoint and use LiMa for model routing, memory, and backend selection. See [docs/lima.md](docs/lima.md) for the recommended profile and safety boundaries.

## Contributing

Contributions are welcome! Here's how to get started:

```bash
# Clone the repository
git clone https://github.com/zhuguang-ZFG/deepcode-cli.git
cd lima-code

# Install dependencies
npm install

# Local development (typecheck + lint + format check + bundle)
npm run build

# Run tests
npm test

# Link globally (local global install)
npm link
```

- Make sure `npm run check` passes before submitting a PR (typecheck + lint + format check)
- We recommend running `npm run format` before building to avoid errors

## Getting Help

- Report bugs or request features on GitHub Issues (https://github.com/zhuguang-ZFG/deepcode-cli/issues)

## License

- MIT

## Support Us

If you find this tool helpful, please consider supporting us by:

- Giving us a Star on GitHub (https://github.com/zhuguang-ZFG/deepcode-cli)
- Submitting feedback and suggestions
- Sharing with your friends and colleagues


<!-- LINK GROUP -->

[npm-release-link]: https://www.npmjs.com/package/lima-code
[npm-release-shield]: https://img.shields.io/npm/v/lima-code?color=4d6BFE&labelColor=black&logo=npm&logoColor=white&style=flat-square&cacheSeconds=1800
[npm-downloads-link]: https://www.npmjs.com/package/lima-code
[npm-downloads-shield]: https://img.shields.io/npm/dt/lima-code?labelColor=black&style=flat-square&color=4d6BFE&cacheSeconds=1800
[github-contributors-link]: https://github.com/zhuguang-ZFG/deepcode-cli/graphs/contributors
[github-contributors-shield]: https://img.shields.io/github/contributors/zhuguang-ZFG/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
[github-forks-link]: https://github.com/zhuguang-ZFG/deepcode-cli/network/members
[github-forks-shield]: https://img.shields.io/github/forks/zhuguang-ZFG/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
[github-stars-link]: https://github.com/zhuguang-ZFG/deepcode-cli/network/stargazers
[github-stars-shield]: https://img.shields.io/github/stars/zhuguang-ZFG/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
[github-issues-link]: https://github.com/zhuguang-ZFG/deepcode-cli/issues
[github-issues-shield]: https://img.shields.io/github/issues/zhuguang-ZFG/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
[github-issues-pr-link]: https://github.com/zhuguang-ZFG/deepcode-cli/pulls
[github-issues-pr-shield]: https://img.shields.io/github/issues-pr/zhuguang-ZFG/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
[github-license-link]: https://github.com/zhuguang-ZFG/deepcode-cli/blob/main/LICENSE
[github-license-shield]: https://img.shields.io/github/license/zhuguang-ZFG/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
