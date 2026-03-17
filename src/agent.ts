import Anthropic from '@anthropic-ai/sdk';
import type { McpClientManager } from './mcp-client.js';

const SYSTEM_PROMPT = `You are a helpful assistant in a Slack workspace. Respond concisely. Format responses for Slack (use mrkdwn, not markdown).

Your text response will be posted as a reply automatically. Do NOT use messaging tools (like conversations_add_message) to send your reply — just respond with text. Use tools only for gathering information or performing actions.`;

const MAX_ITERATIONS = 20;

export class Agent {
  private client: Anthropic;

  constructor(
    private model: string,
    private mcpManager: McpClientManager,
  ) {
    this.client = new Anthropic();
  }

  async chat(userMessage: string): Promise<string> {
    const tools = this.mcpManager.getTools().map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }));

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: userMessage },
    ];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: tools.length ? tools : undefined,
        messages,
      });

      if (response.stop_reason !== 'tool_use') {
        return response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n');
      }

      // Append assistant response
      messages.push({ role: 'assistant', content: response.content });

      // Execute tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        try {
          const result = await this.mcpManager.callTool(block.name, block.input as Record<string, unknown>);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } catch (e) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: String(e),
            is_error: true,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }

    return 'Reached maximum tool iterations. Please try a simpler request.';
  }
}
