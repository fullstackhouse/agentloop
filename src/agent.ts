import { ClaudeCodeExecutor, ClaudeCodeOptions } from './claude-code-executor.js';
import type { McpServerConfig } from './config.js';

const SYSTEM_PROMPT = `You are a helpful assistant in a Slack workspace. Respond concisely. Format responses for Slack (use mrkdwn, not markdown).

Your text response will be posted as a reply automatically. Do NOT use messaging tools (like conversations_add_message) to send your reply — just respond with text. Use tools only for gathering information or performing actions.`;

export interface AgentConfig {
  model: string;
  workspaceDir?: string;
  mcpServers: Record<string, McpServerConfig>;
}

export class Agent {
  private executor: ClaudeCodeExecutor;

  constructor(config: AgentConfig) {
    this.executor = new ClaudeCodeExecutor({
      workspaceDir: config.workspaceDir,
      model: config.model,
      systemPrompt: SYSTEM_PROMPT,
      mcpServers: config.mcpServers,
    });
  }

  async chat(userMessage: string): Promise<string> {
    return this.executor.execute(userMessage);
  }
}
