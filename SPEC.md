# AgentLoop Specification

## Overview

Platform-agnostic AI agent that monitors chat platforms for mentions and responds using Claude. Connects to platforms via MCP, with tools auto-discovered from configured MCP servers.

## Architecture

```
Message Ingestion (websocket / webhook / polling fallback)
├── MCP Client Manager (discovers tools from MCP servers)
├── Platform Adapters (Slack first, extensible to Discord/Telegram)
├── Claude Agent (Anthropic SDK, tool-use loop)
└── Config Loader (JSON config with ${ENV_VAR} substitution)
```

## Message Ingestion

Platform adapters receive new messages via the best available transport:
1. **WebSocket / real-time API** — preferred (lowest latency)
2. **Webhooks** — if the platform supports them and infra allows inbound connections
3. **Polling** — fallback when real-time options are unavailable

The ingestion mechanism is an implementation detail of each platform adapter. The rest of the system receives messages through a uniform interface regardless of transport.

## Message Flow

1. Receive new message mentioning the bot (via adapter)
2. Filter: must not have completion reaction (✅) already
3. Add typing indicator reaction (👀)
4. Send message + available MCP tools to Claude
5. Claude responds, optionally calling tools (multi-turn)
6. Post response as thread reply
7. Replace 👀 with ✅

## Core Components

### Config (`src/config.ts`)
- Loads `config.json` with env var substitution (`${VAR_NAME}`)
- Validates required fields
- Schema:
  ```json
  {
    "claude": { "model": "claude-sonnet-4-20250514" },
    "platforms": ["slack"],
    "slackChannels": ["#channel"],  // optional — if omitted, responds in all channels
    "slackUsers": ["Jacek Tomaszewski"],  // optional — if omitted, responds to all users
    "mcpServers": {
      "name": {
        "command": "npx",
        "args": ["..."],
        "env": { "KEY": "${ENV_VAR}" }
      }
    }
  }
  ```

### MCP Client Manager (`src/mcp-client.ts`)
- Spawns and manages MCP server processes (stdio transport)
- Discovers available tools from each server
- Routes tool calls to correct server
- HTTP transport: planned, not yet implemented

### Platform: Slack (`src/platforms/slack.ts`)
- Receives messages via best available transport (WebSocket > webhook > polling)
- Detects bot mentions (resolves bot user ID on startup via `users_search`)
- Resolves allowed user display names to IDs on startup (if `slackUsers` configured)
- Filters messages to only respond to allowed users (if configured)
- Manages reactions (👀 typing, ✅ done) as persistent state
- Sends thread replies via MCP `conversations_add_message`

### Agent (`src/agent.ts`)
- Wraps Anthropic SDK
- Runs tool-use loop: send → check for tool calls → execute → send results → repeat
- System prompt instructs Claude to behave as helpful assistant
- All MCP tools available to Claude during conversation

### Main Loop (`src/index.ts`)
- Entry point, starts platform adapters and processes incoming messages
- Graceful error handling: responds with error message, cleans up reactions

## Tech Stack

- **Runtime**: Node.js 22+ (ESM)
- **Language**: TypeScript (strict mode)
- **Dependencies**: `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `dotenv`
- **Build**: `tsc` → JavaScript
- **Dev**: `tsx` for on-the-fly TypeScript execution

## Deployment

- Docker multi-stage build (builder + runtime)
- Docker Compose for local dev
- CI/CD: GitHub Actions on version tags → container registry

## Configuration

### Environment Variables
- `ANTHROPIC_API_KEY` — Anthropic API key
- `SLACK_XOXC` — Slack user token (browser session)
- `SLACK_XOXD` — Slack session token (browser session)

### Bot Identity
- Resolves own user ID from the Slack session on startup
- Handles both raw user ID and `<@U0ABC123>` mention format

## State Management

- Slack emoji reactions (✅) — survives container restarts, prevents reprocessing

## Error Handling

- On failure: send error message to thread, remove 👀 reaction
- Graceful degradation — single message failure doesn't crash loop

## Testing

- E2E tests against a running agent instance
- Verify full flow: mention → 👀 reaction → thread reply with correct content → ✅ reaction
- Test edge cases: non-matching channels (if filter set), messages without mention ignored
