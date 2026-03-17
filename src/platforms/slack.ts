import type { Agent } from '../agent.js';
import type { SlackApi, SlackApiError, SlackMessage } from '../slack-api.js';

export class SlackAdapter {
  private botUserId = '';
  private processing = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private channelIds: Set<string> | null = null;

  constructor(
    private agent: Agent,
    private slackApi: SlackApi,
    private channels?: string[],
    private pollIntervalMs = 10_000,
  ) {}

  async start(): Promise<void> {
    const auth = await this.slackApi.authTest();
    this.botUserId = auth.user_id;
    console.log(`[slack] Authenticated as ${auth.user} (${auth.user_id})`);

    if (this.channels?.length) {
      await this.resolveChannelIds();
    }

    await this.poll(); // initial poll
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);
    console.log(`[slack] Polling every ${this.pollIntervalMs / 1000}s`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async resolveChannelIds(): Promise<void> {
    const names = this.channels!.map(c => c.replace(/^#/, ''));
    this.channelIds = new Set<string>();

    let cursor: string | undefined;
    do {
      const res = await this.slackApi.conversationsList(cursor);
      for (const ch of res.channels) {
        if (names.includes(ch.name)) {
          this.channelIds.add(ch.id);
        }
      }
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor);

    console.log(`[slack] Watching channels: ${[...this.channelIds].join(', ')}`);
  }

  private async poll(): Promise<void> {
    try {
      const result = await this.slackApi.searchMessages(`<@${this.botUserId}>`);
      const messages = result.messages.matches;

      for (const msg of messages) {
        const channelId = msg.channel?.id;
        if (!channelId) continue;

        // Skip bot's own messages
        if (msg.user === this.botUserId) continue;

        // Skip empty text
        if (!msg.text?.trim()) continue;

        // Channel filter
        if (this.channelIds && !this.channelIds.has(channelId)) continue;

        // Currently processing
        const key = `${channelId}:${msg.ts}`;
        if (this.processing.has(key)) continue;

        // Check ✅ reaction via API (search results don't include reactions)
        try {
          const { message } = await this.slackApi.reactionsGet(channelId, msg.ts);
          if (message.reactions?.some(r => r.name === 'white_check_mark')) continue;
        } catch {
          // If reactions.get fails, process anyway
        }

        this.processMessage(channelId, msg).catch(e =>
          console.error(`[slack] Error processing message ${key}:`, e)
        );
      }
    } catch (e) {
      console.error('[slack] Poll error:', e);
    }
  }

  private async processMessage(channel: string, msg: SlackMessage): Promise<void> {
    const key = `${channel}:${msg.ts}`;
    this.processing.add(key);

    try {
      // Add 👀 (ignore already_reacted)
      await this.slackApi.reactionsAdd(channel, msg.ts, 'eyes').catch(this.ignoreSlackError('already_reacted'));

      // Strip bot mention from text before sending to Claude
      const cleanText = msg.text.replace(new RegExp(`<@${this.botUserId}>\\s*`, 'g'), '').trim();

      // Get Claude's response
      const response = await this.agent.chat(cleanText);

      // Reply in thread (use thread_ts if it's a threaded reply, otherwise use msg.ts)
      const threadTs = msg.thread_ts || msg.ts;
      await this.slackApi.chatPostMessage(channel, response, threadTs);

      // Remove 👀, add ✅
      await this.slackApi.reactionsRemove(channel, msg.ts, 'eyes').catch(this.ignoreSlackError('no_reaction'));
      await this.slackApi.reactionsAdd(channel, msg.ts, 'white_check_mark').catch(this.ignoreSlackError('already_reacted'));
    } catch (e) {
      console.error(`[slack] Failed to process ${key}:`, e);
      try {
        const threadTs = msg.thread_ts || msg.ts;
        await this.slackApi.chatPostMessage(channel, `Error: ${e instanceof Error ? e.message : String(e)}`, threadTs);
        await this.slackApi.reactionsRemove(channel, msg.ts, 'eyes').catch(() => {});
      } catch {
        // Best effort error reporting
      }
    } finally {
      this.processing.delete(key);
    }
  }

  private ignoreSlackError(...codes: string[]) {
    return (e: unknown) => {
      if (e && typeof e === 'object' && 'slackError' in e && codes.includes((e as SlackApiError).slackError)) return;
      throw e;
    };
  }
}
