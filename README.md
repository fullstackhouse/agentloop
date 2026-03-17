# AgentLoop

Platform-agnostic AI agent that monitors chat platforms via MCP and responds using Claude.

## How It Works

AgentLoop connects to chat platforms (Slack first) and listens for bot mentions. When mentioned, it sends the message to Claude along with all available MCP tools. Claude responds — optionally calling tools — and the reply is posted as a thread.

Uses real-time connections (WebSocket/webhooks) when available, falling back to polling. Emoji reactions (👀 → ✅) track processing state, surviving restarts without a database.

## Quick Start

```bash
cp .env.example .env        # Add your API keys
cp config.example.json config.json  # Configure channels & MCP servers
npm install
npm run dev
```

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `SLACK_XOXC` | Slack user token (browser session) |
| `SLACK_XOXD` | Slack session token (browser session) |

### config.json

```json
{
  "claude": { "model": "claude-sonnet-4-20250514" },
  "platforms": ["slack"],
  "slackChannels": ["#agent-playground"],  // optional — omit to respond in all channels
  "slackUsers": ["Jacek Tomaszewski"],  // optional — omit to respond to all users
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

## Testing

E2E tests verify the full flow — mentions, reactions, thread replies, and filtering. Requires a running agent:

```bash
npm run test:e2e
```

## Architecture

See [SPEC.md](SPEC.md) for full specification.
