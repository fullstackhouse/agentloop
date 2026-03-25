#!/usr/bin/env node
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig } from './config.js';
import { Agent } from './agent.js';
import { SlackApi } from './slack-api.js';
import { SlackAdapter } from './platforms/slack.js';

const HELP = `
agentloop - AI agent that monitors chat platforms and responds using Claude Code

USAGE
  agentloop serve [options]

OPTIONS
  --workspace, -w <path>        Workspace directory (default: cwd)
  --config, -c <path>           Config file path (default: config.json)
  --model, -m <model>           Claude model (overrides config)
  --channel <name>              Slack channel allowlist (can repeat)
  --channel-blacklist <name>    Slack channel blacklist (can repeat)
  --help, -h                    Show this help

ENVIRONMENT
  ANTHROPIC_API_KEY        Required for Claude Code
  SLACK_XOXC, SLACK_XOXD   Required for Slack platform

EXAMPLES
  agentloop serve --workspace /app/monorepo
  agentloop serve -w ./my-project -c ./agentloop.json
  agentloop serve --channel "#dev" --channel "#support"
`;

interface CliOptions {
  workspace?: string;
  config?: string;
  model?: string;
  channels?: string[];
  channelBlacklist?: string[];
  help?: boolean;
}

function parseCliArgs(): { command: string; options: CliOptions } {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      workspace: { type: 'string', short: 'w' },
      config: { type: 'string', short: 'c' },
      model: { type: 'string', short: 'm' },
      channel: { type: 'string', multiple: true },
      'channel-blacklist': { type: 'string', multiple: true },
      help: { type: 'boolean', short: 'h' },
    },
  });

  return {
    command: positionals[0] || 'serve',
    options: {
      workspace: values.workspace,
      config: values.config,
      model: values.model,
      channels: values.channel,
      channelBlacklist: values['channel-blacklist'],
      help: values.help,
    },
  };
}

async function serve(options: CliOptions): Promise<void> {
  const configPath = options.config || 'config.json';
  if (!existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const workspaceDir = options.workspace ? resolve(options.workspace) : config.workspaceDir || process.cwd();
  const model = options.model || config.claude?.model;
  const slackChannels = options.channels?.length ? options.channels : config.slackChannels;
  const slackChannelBlacklist = options.channelBlacklist?.length ? options.channelBlacklist : config.slackChannelBlacklist;

  console.log(`[agentloop] Model: ${model || '(default)'}`);
  console.log(`[agentloop] Workspace: ${workspaceDir}`);
  const mcpServerNames = Object.keys(config.mcpServers ?? {});
  if (mcpServerNames.length) {
    console.log(`[agentloop] MCP servers: ${mcpServerNames.join(', ')}`);
  }
  if (slackChannels?.length) {
    console.log(`[agentloop] Channels: ${slackChannels.join(', ')}`);
  }
  if (slackChannelBlacklist?.length) {
    console.log(`[agentloop] Channel blacklist: ${slackChannelBlacklist.join(', ')}`);
  }

  const agent = new Agent({
    model,
    workspaceDir,
    mcpServers: config.mcpServers,
  });

  const adapters: { stop: () => void }[] = [];

  if (config.platforms?.includes('slack')) {
    const xoxc = process.env.SLACK_XOXC;
    const xoxd = process.env.SLACK_XOXD;
    if (!xoxc || !xoxd) {
      console.error('SLACK_XOXC and SLACK_XOXD environment variables required');
      process.exit(1);
    }

    const slackApi = new SlackApi(xoxc, xoxd);
    const adapter = new SlackAdapter(
      agent,
      slackApi,
      slackChannels,
      slackChannelBlacklist,
      config.slackUsers,
      10_000,  // pollIntervalMs
      config.maxRetries,
    );
    await adapter.start();
    adapters.push(adapter);
  }

  const shutdown = () => {
    console.log('\n[agentloop] Shutting down...');
    adapters.forEach(a => a.stop());
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main(): Promise<void> {
  const { command, options } = parseCliArgs();

  if (options.help || command === 'help') {
    console.log(HELP);
    process.exit(0);
  }

  if (command === 'serve') {
    await serve(options);
  } else {
    console.error(`Unknown command: ${command}`);
    console.log(HELP);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
