import 'dotenv/config';
import { loadConfig } from './config.js';
import { McpClientManager } from './mcp-client.js';
import { Agent } from './agent.js';
import { SlackApi } from './slack-api.js';
import { SlackAdapter } from './platforms/slack.js';

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(`[config] Model: ${config.claude.model}, platforms: ${config.platforms.join(', ')}`);

  // Connect MCP servers
  const mcpManager = new McpClientManager();
  await mcpManager.connect(config.mcpServers);
  const tools = mcpManager.getTools();
  console.log(`[mcp] ${tools.length} tools available: ${tools.map(t => t.name).join(', ')}`);

  // Create agent
  const agent = new Agent(config.claude.model, mcpManager);

  // Start platform adapters
  const adapters: { stop: () => void }[] = [];

  if (config.platforms.includes('slack')) {
    const xoxc = process.env.SLACK_XOXC;
    const xoxd = process.env.SLACK_XOXD;
    if (!xoxc || !xoxd) throw new Error('SLACK_XOXC and SLACK_XOXD required');

    const slackApi = new SlackApi(xoxc, xoxd);
    const adapter = new SlackAdapter(agent, slackApi, config.slackChannels);
    await adapter.start();
    adapters.push(adapter);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[shutdown] Stopping...');
    adapters.forEach(a => a.stop());
    await mcpManager.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
