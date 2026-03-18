# AgentLoop

AI agent that monitors chat platforms and responds using Claude Code subprocess.

## How It Works

AgentLoop connects to chat platforms (Slack first) and listens for bot mentions. When mentioned, it spawns Claude Code with the workspace directory set, giving Claude access to CLAUDE.md context, filesystem, and git. Claude responds — using built-in tools and MCP servers — and the reply is posted as a thread.

Emoji reactions (👀 → ✅) track processing state, surviving restarts without a database.

## Quick Start

```bash
cp .env.example .env
cp config.example.json config.json
npm install
npm run dev
```

## CLI Usage

```bash
agentloop serve [options]

Options:
  --workspace, -w <path>   Workspace directory (default: cwd)
  --config, -c <path>      Config file path (default: config.json)
  --model, -m <model>      Claude model (overrides config)
  --channel <name>         Slack channel filter (can repeat)
  --help, -h               Show help

Examples:
  agentloop serve --workspace /app/monorepo
  agentloop serve -w ./my-project --channel "#dev"
```

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (used by Claude Code) |
| `SLACK_XOXC` | Slack user token (browser session) |
| `SLACK_XOXD` | Slack session token (browser session) |

### config.json

```json
{
  "claude": { "model": "claude-sonnet-4-20250514" },
  "platforms": ["slack"],
  "slackChannels": ["#agent-playground"],
  "slackUsers": ["Jacek Tomaszewski"],
  "workspaceDir": "/path/to/your/project",
  "mcpServers": {
    "slack": {
      "command": "npx",
      "args": ["slack-mcp-server@latest"],
      "env": {
        "SLACK_MCP_XOXC_TOKEN": "${SLACK_XOXC}",
        "SLACK_MCP_XOXD_TOKEN": "${SLACK_XOXD}",
        "SLACK_MCP_ADD_MESSAGE_TOOL": "true"
      }
    }
  }
}
```

## Docker

```bash
docker-compose up
```

Mount your workspace directory in `docker-compose.yml`:

```yaml
volumes:
  - /path/to/your/repo:/workspace:ro
command: ["--workspace", "/workspace"]
```

## Testing

```bash
npm run test:e2e
```

## Architecture

See [SPEC.md](SPEC.md) for full specification.
