# AgentLoop

Platform-agnostic AI agent: monitors chat platforms via MCP, responds with Claude.

## Tech Stack

- TypeScript (strict, ESM), Node.js 22+
- `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `dotenv`
- Build: `tsc` → JS. Dev: `tsx`

## Commands

```bash
npm run dev        # Run with tsx (dev)
npm run build      # Compile TypeScript
npm start          # Run compiled JS
npm run test:e2e   # E2E test (needs running agent)
```

## Project Structure

```
src/
  index.ts          # Entry point, message processing
  agent.ts          # Claude API wrapper + tool-use loop
  mcp-client.ts     # MCP server manager + tool discovery
  config.ts         # Config loader with env var substitution
  platforms/
    slack.ts        # Slack adapter: message ingestion, reactions, thread replies
```

## Code Style

- ESM imports (no CommonJS)
- Strict TypeScript, explicit types on public APIs
- Minimal dependencies — prefer stdlib
- Error handling: catch per-message, never crash the loop
- Config: JSON with `${ENV_VAR}` substitution

## Architecture Notes

- Message ingestion: prefer real-time (websocket/webhook), fall back to polling
- State via Slack reactions (✅) — no database needed
- MCP tools auto-discovered from configured servers
- Platform-agnostic design: add adapters in `src/platforms/`

## Infrastructure

- Docker multi-stage build
- Use `tofu` not `terraform` for IaC
