import { readFileSync } from 'node:fs';

export interface StdioMcpServerConfig {
  type?: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface HttpMcpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = StdioMcpServerConfig | HttpMcpServerConfig;

/**
 * Default Slack MCP server config.
 * Uses official @modelcontextprotocol/server-slack
 * Requires SLACK_BOT_TOKEN and SLACK_TEAM_ID env vars.
 */
export function getDefaultSlackMcp(): StdioMcpServerConfig {
  return {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: {
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || '',
      SLACK_TEAM_ID: process.env.SLACK_TEAM_ID || '',
    },
  };
}

export interface AppConfig {
  claude?: { model?: string };
  platforms?: string[];
  slackChannels?: string[];
  slackChannelBlacklist?: string[];
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
  console.log(`[config] Loading config from ${path}`);
  const content = readFileSync(path, 'utf-8');
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    console.error(`[config] Failed to parse ${path}:`, e);
    throw e;
  }
  const config = substituteEnvVars(raw) as AppConfig;

  // All fields optional - CLI provides defaults/overrides
  config.claude = config.claude ?? {};
  config.platforms = config.platforms ?? ['slack'];
  config.mcpServers = config.mcpServers ?? {};

  // Add default Slack MCP if no MCP servers configured and using Slack platform
  if (Object.keys(config.mcpServers).length === 0 && config.platforms.includes('slack')) {
    config.mcpServers.slack = getDefaultSlackMcp();
    console.log('[config] Added default Slack MCP server');
  }

  console.log(`[config] Loaded successfully: platforms=${config.platforms.join(',')}, mcpServers=${Object.keys(config.mcpServers).length}`);
  return config;
}
