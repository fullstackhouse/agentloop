import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface ClaudeCodeOptions {
  workspaceDir?: string;
  model?: string;
  mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  systemPrompt?: string;
  allowedTools?: string[];
  timeoutMs?: number;
}

interface StreamMessage {
  type: string;
  subtype?: string;
  result?: string;
  content?: unknown;
  session_id?: string;
  [key: string]: unknown;
}

/**
 * Executes Claude Code CLI as subprocess with streaming NDJSON output.
 * Sets cwd to workspace directory so Claude Code loads CLAUDE.md and has fs access.
 */
export class ClaudeCodeExecutor {
  constructor(private options: ClaudeCodeOptions) {}

  /**
   * Send a prompt to Claude Code and return the final response text.
   * Handles the full agent loop internally (tool use, etc).
   */
  async execute(prompt: string): Promise<string> {
    const args = this.buildArgs(prompt);
    const startTime = Date.now();
    const cwd = this.options.workspaceDir || process.cwd();

    console.log(`[claude-code] Spawning subprocess in ${cwd}`);
    console.log(`[claude-code] Prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`);

    return new Promise((resolve, reject) => {
      const proc = spawn('claude', args, {
        cwd,
        env: {
          ...process.env,
          CLAUDE_CODE_ENTRYPOINT: 'sdk-agentloop',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Close stdin immediately - Claude Code waits for EOF before processing --print prompt
      proc.stdin.end();

      let result = '';
      const stderrChunks: string[] = [];
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;

      if (this.options.timeoutMs) {
        timeoutId = setTimeout(() => {
          timedOut = true;
          console.warn(`[claude-code] Timeout after ${this.options.timeoutMs}ms, killing process`);
          proc.kill('SIGTERM');
        }, this.options.timeoutMs);
      }

      const rl = createInterface({ input: proc.stdout });

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const msg: StreamMessage = JSON.parse(line);
          this.handleMessage(msg, (text) => { result = text; });
        } catch {
          // Ignore non-JSON lines (e.g., npm output)
        }
      });

      proc.stderr.on('data', (chunk) => {
        stderrChunks.push(chunk.toString());
      });

      proc.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        const elapsed = Date.now() - startTime;

        if (timedOut) {
          console.error(`[claude-code] Timed out after ${elapsed}ms`);
          reject(new Error(`Claude Code timed out after ${this.options.timeoutMs}ms`));
          return;
        }
        if (code !== 0 && code !== null) {
          const stderr = stderrChunks.join('');
          console.error(`[claude-code] Exited with code ${code} after ${elapsed}ms: ${stderr}`);
          reject(new Error(`Claude Code exited with code ${code}: ${stderr}`));
          return;
        }
        console.log(`[claude-code] Completed in ${elapsed}ms (response: ${result.length} chars)`);
        resolve(result);
      });

      proc.on('error', (err) => {
        if (timeoutId) clearTimeout(timeoutId);
        console.error(`[claude-code] Failed to spawn:`, err);
        reject(new Error(`Failed to spawn Claude Code: ${err.message}`));
      });
    });
  }

  private buildArgs(prompt: string): string[] {
    const args: string[] = [
      '--verbose',
      '--output-format', 'stream-json',
      '--print', prompt,
    ];

    if (this.options.model) {
      args.push('--model', this.options.model);
    }

    if (this.options.systemPrompt) {
      args.push('--system-prompt', this.options.systemPrompt);
    }

    if (this.options.allowedTools?.length) {
      args.push('--allowedTools', this.options.allowedTools.join(','));
    }

    if (this.options.mcpServers && Object.keys(this.options.mcpServers).length > 0) {
      args.push('--mcp-config', JSON.stringify({ mcpServers: this.options.mcpServers }));
    }

    return args;
  }

  private handleMessage(msg: StreamMessage, onResult: (text: string) => void): void {
    // The final result comes in a message with type 'result' or in assistant messages
    if (msg.type === 'result' && typeof msg.result === 'string') {
      onResult(msg.result);
    }
    // Also check for assistant text blocks
    if (msg.type === 'assistant' && Array.isArray(msg.content)) {
      const textBlocks = msg.content
        .filter((b: unknown) => typeof b === 'object' && b !== null && (b as { type: string }).type === 'text')
        .map((b: unknown) => (b as { text: string }).text);
      if (textBlocks.length > 0) {
        onResult(textBlocks.join('\n'));
      }
    }
  }
}
