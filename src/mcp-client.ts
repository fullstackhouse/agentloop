import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerConfig } from './config.js';

interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class McpClientManager {
  private clients = new Map<string, Client>();
  private toolMap = new Map<string, string>(); // tool name → server name
  private allTools: ToolInfo[] = [];

  async connect(servers: Record<string, McpServerConfig>): Promise<void> {
    for (const [name, config] of Object.entries(servers)) {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env as Record<string, string>, ...config.env },
      });

      const client = new Client({ name: `agentloop-${name}`, version: '0.1.0' });
      await client.connect(transport);

      const { tools } = await client.listTools();
      for (const tool of tools) {
        this.toolMap.set(tool.name, name);
        this.allTools.push({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema as Record<string, unknown>,
        });
      }

      this.clients.set(name, client);
      console.log(`[mcp] ${name}: ${tools.length} tools`);
    }
  }

  getTools(): ToolInfo[] {
    return this.allTools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const serverName = this.toolMap.get(name);
    if (!serverName) throw new Error(`Unknown tool: ${name}`);

    const client = this.clients.get(serverName)!;
    const result = await client.callTool({ name, arguments: args });
    return result;
  }

  async close(): Promise<void> {
    for (const [name, client] of this.clients) {
      try {
        await client.close();
      } catch (e) {
        console.error(`[mcp] Error closing ${name}:`, e);
      }
    }
    this.clients.clear();
    this.toolMap.clear();
    this.allTools = [];
  }
}
