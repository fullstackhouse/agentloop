# AgentLoop Specification

## Overview

Platform-agnostic AI agent that monitors chat platforms for mentions and responds using Claude Code. Spawns Claude Code as subprocess with workspace directory set, giving Claude full filesystem access and CLAUDE.md context.

## Architecture

```
Message Ingestion (websocket / webhook / polling fallback)
├── Platform Adapters (Slack first, extensible to Discord/Telegram)
├── Claude Code Executor (subprocess with cwd set to workspace)
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
4. Spawn Claude Code subprocess with workspace cwd
5. Claude responds, using built-in tools and MCP servers
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
    "slackChannels": ["#channel"],
    "workspaceDir": "/path/to/workspace",
    "mcpServers": {
      "name": {
        "command": "npx",
        "args": ["..."],
        "env": { "KEY": "${ENV_VAR}" }
      }
    }
  }
  ```

### Claude Code Executor (`src/claude-code-executor.ts`)
- Spawns `npx @anthropic-ai/claude-code` as subprocess
- Sets `cwd` to workspace directory (for CLAUDE.md loading, filesystem access)
- Passes MCP server config via `--mcp-config` flag
- Streams NDJSON output and extracts final response

### Platform: Slack (`src/platforms/slack.ts`)
- Receives messages via best available transport (WebSocket > webhook > polling)
- Detects bot mentions (resolves bot user ID on startup via `users_search`)
- Manages reactions (👀 typing, ✅ done) as persistent state
- Sends thread replies via MCP `conversations_add_message`

### Agent (`src/agent.ts`)
- Wraps ClaudeCodeExecutor
- Passes system prompt for Slack assistant behavior
- Delegates tool-use loop to Claude Code subprocess

### Main Loop (`src/index.ts`)
- Entry point, starts platform adapters and processes incoming messages
- Graceful error handling: responds with error message, cleans up reactions

## Tech Stack

- **Runtime**: Node.js 22+ (ESM)
- **Language**: TypeScript (strict mode)
- **Dependencies**: `dotenv` (Claude Code handles API + MCP)
- **Build**: `tsc` → JavaScript
- **Dev**: `tsx` for on-the-fly TypeScript execution

## Deployment

- Docker multi-stage build (builder + runtime)
- Docker Compose for local dev
- CI/CD: GitHub Actions on version tags → container registry

## Configuration

### Environment Variables
- `ANTHROPIC_API_KEY` — Anthropic API key (used by Claude Code subprocess)
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
