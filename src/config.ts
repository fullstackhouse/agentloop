import { readFileSync } from 'node:fs';

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AppConfig {
  claude?: { model?: string };
  platforms?: string[];
  slackChannels?: string[];
  slackUsers?: string[];
  workspaceDir?: string;  // Working directory for Claude Code subprocess
  mcpServers?: Record<string, McpServerConfig>;
}

function substituteEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)\}/g, (_, name) => {
      const val = process.env[name];
      if (val === undefined) throw new Error(`Missing env var: ${name}`);
      return val;
    });
  }
  if (Array.isArray(value)) return value.map(substituteEnvVars);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, substituteEnvVars(v)])
    );
  }
  return value;
}

export function loadConfig(path = 'config.json'): AppConfig {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  const config = substituteEnvVars(raw) as AppConfig;

  // All fields optional - CLI provides defaults/overrides
  config.claude = config.claude ?? {};
  config.platforms = config.platforms ?? ['slack'];
  config.mcpServers = config.mcpServers ?? {};

  return config;
}
