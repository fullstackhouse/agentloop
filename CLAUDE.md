# AgentLoop

Platform-agnostic AI agent: monitors chat platforms, responds using Claude Code subprocess.

## Tech Stack

- TypeScript (strict, ESM), Node.js 22+
- Claude Code CLI (`npx @anthropic-ai/claude-code`) as subprocess
- `dotenv` for environment variables
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
  cli.ts                   # CLI entry point (agentloop serve)
  agent.ts                 # Wraps ClaudeCodeExecutor with system prompt
  claude-code-executor.ts  # Spawns Claude Code subprocess
  config.ts                # Config loader with env var substitution
  platforms/
    slack.ts               # Slack adapter: polling, reactions, thread replies
```

## Code Style

- ESM imports (no CommonJS)
- Strict TypeScript, explicit types on public APIs
- Minimal dependencies — prefer stdlib
- Error handling: catch per-message, never crash the loop
- Config: JSON with `${ENV_VAR}` substitution

## Architecture Notes

- Claude Code runs as subprocess with `cwd` set to workspace directory
- Workspace cwd enables: CLAUDE.md loading, filesystem access, git awareness
- MCP servers passed via `--mcp-config` flag to Claude Code
- State via Slack reactions (✅) — no database needed
- Platform-agnostic design: add adapters in `src/platforms/`

## Infrastructure

- Docker multi-stage build
- Use `tofu` not `terraform` for IaC
