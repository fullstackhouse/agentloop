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

## Release Process

1. Bump version in `package.json`
2. Commit: `git commit -m "chore: bump version to X.Y.Z"`
3. Tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
4. Push: `git push origin main && git push origin vX.Y.Z`
5. Create GitHub release: `gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."`
   - CI publishes npm package (OIDC provenance) and Docker image to `ghcr.io/fullstackhouse/agentloop`
