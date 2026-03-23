import { ClaudeCodeExecutor, ExecuteResult } from './claude-code-executor.js';
import type { McpServerConfig } from './config.js';

const SYSTEM_PROMPT = `You are a helpful assistant in a Slack workspace. Respond concisely. Format responses for Slack (use mrkdwn, not markdown).

Your text response will be posted as a reply automatically. Do NOT use messaging tools (like conversations_add_message) to send your reply — just respond with text. Use tools only for gathering information or performing actions.

IMPORTANT: For EVERY message you receive, you MUST first call conversations_replies with the channel and thread_ts from <slack_context> to fetch the full thread history. This is required because you cannot see previous messages in the thread without fetching them.

The <slack_message> tag contains the CURRENT message you must respond to - answer ONLY what is asked in that specific message. Thread history is for background context only.`;

export interface AgentConfig {
  model?: string;
  workspaceDir?: string;
  mcpServers?: Record<string, McpServerConfig>;
}

export interface ChatResult {
  response: string;
  sessionId?: string;
}

export class Agent {
  private executor: ClaudeCodeExecutor;

  constructor(config: AgentConfig) {
    // Auto-allow all tools from configured MCP servers
    const allowedTools = config.mcpServers
      ? Object.keys(config.mcpServers).map(name => `mcp__${name}__*`)
      : [];

    this.executor = new ClaudeCodeExecutor({
      workspaceDir: config.workspaceDir,
      model: config.model,
      systemPrompt: SYSTEM_PROMPT,
      mcpServers: config.mcpServers,
      allowedTools,
    });
  }

  async chat(userMessage: string, sessionId?: string): Promise<ChatResult> {
    const result = await this.executor.execute(userMessage, sessionId);
    return { response: result.response, sessionId: result.sessionId };
  }
}
