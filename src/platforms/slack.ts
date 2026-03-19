import type { Agent } from '../agent.js';
import type { SlackApi, SlackApiError, SlackMessage } from '../slack-api.js';

export class SlackAdapter {
  private botUserId = '';
  private processing = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private channelIds: Set<string> | null = null;
  private allowedUserIds: Set<string> | null = null;

  constructor(
    private agent: Agent,
    private slackApi: SlackApi,
    private channels?: string[],
    private users?: string[],
    private pollIntervalMs = 10_000,
  ) {}

  async start(): Promise<void> {
    const auth = await this.slackApi.authTest();
    this.botUserId = auth.user_id;
    console.log(`[slack] Authenticated as ${auth.user} (${auth.user_id})`);

    if (this.channels?.length) {
      await this.resolveChannelIds();
    }

    if (this.users?.length) {
      await this.resolveUserIds();
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

  private async resolveUserIds(): Promise<void> {
    const names = new Set(this.users!);
    this.allowedUserIds = new Set<string>();

    let cursor: string | undefined;
    do {
      const res = await this.slackApi.usersList(cursor);
      for (const user of res.members) {
        if (names.has(user.profile.real_name || '') || names.has(user.profile.display_name || '')) {
          this.allowedUserIds.add(user.id);
        }
      }
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor);

    if (this.allowedUserIds.size < names.size) {
      const found = this.allowedUserIds.size;
      console.warn(`[slack] Only found ${found}/${names.size} configured users`);
    }

    console.log(`[slack] Allowed users: ${[...this.allowedUserIds].join(', ')}`);
  }

  private async poll(): Promise<void> {
    try {
      const result = await this.slackApi.searchMessages(`<@${this.botUserId}>`);
      const messages = result.messages.matches;
      console.log(`[slack] Poll found ${messages.length} messages mentioning bot`);

      for (const msg of messages) {
        const channelId = msg.channel?.id;
        if (!channelId) {
          console.log(`[slack] Skipping message ${msg.ts}: no channel ID`);
          continue;
        }

        const key = `${channelId}:${msg.ts}`;

        // Skip bot's own messages
        if (msg.user === this.botUserId) {
          console.log(`[slack] Skipping ${key}: bot's own message`);
          continue;
        }

        // Skip empty text
        if (!msg.text?.trim()) {
          console.log(`[slack] Skipping ${key}: empty text`);
          continue;
        }

        // Channel filter
        if (this.channelIds && !this.channelIds.has(channelId)) {
          console.log(`[slack] Skipping ${key}: channel not in whitelist`);
          continue;
        }

        // User filter
        if (this.allowedUserIds && !this.allowedUserIds.has(msg.user)) {
          console.log(`[slack] Skipping ${key}: user ${msg.user} not in allowlist`);
          continue;
        }

        // Currently processing
        if (this.processing.has(key)) {
          console.log(`[slack] Skipping ${key}: already processing`);
          continue;
        }

        // Check ✅ reaction via API (search results don't include reactions)
        try {
          const { message } = await this.slackApi.reactionsGet(channelId, msg.ts);
          if (message.reactions?.some(r => r.name === 'white_check_mark')) {
            console.log(`[slack] Skipping ${key}: already has ✅ reaction`);
            continue;
          }
        } catch (e) {
          // If reaction check fails, skip to avoid duplicate processing
          console.warn(`[slack] reactionsGet failed for ${key}, skipping:`, e);
          continue;
        }

        console.log(`[slack] Processing ${key}: "${msg.text.substring(0, 50)}${msg.text.length > 50 ? '...' : ''}"`);
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
    const startTime = Date.now();

    try {
      // Add 👀 (ignore already_reacted)
      console.log(`[slack] ${key}: Adding 👀 reaction`);
      await this.slackApi.reactionsAdd(channel, msg.ts, 'eyes').catch(this.ignoreSlackError('already_reacted'));

      // Strip bot mention from text before sending to Claude
      const cleanText = msg.text.replace(new RegExp(`<@${this.botUserId}>\\s*`, 'g'), '').trim();

      // Get Claude's response
      console.log(`[slack] ${key}: Sending to Claude (${cleanText.length} chars)`);
      const response = await this.agent.chat(cleanText);
      console.log(`[slack] ${key}: Claude responded (${response.length} chars)`);

      // Reply in thread (use thread_ts if it's a threaded reply, otherwise use msg.ts)
      const threadTs = msg.thread_ts || msg.ts;
      console.log(`[slack] ${key}: Posting reply to thread ${threadTs}`);
      await this.slackApi.chatPostMessage(channel, response, threadTs);

      // Remove 👀, add ✅
      console.log(`[slack] ${key}: Marking complete with ✅`);
      await this.slackApi.reactionsRemove(channel, msg.ts, 'eyes').catch(this.ignoreSlackError('no_reaction'));
      await this.slackApi.reactionsAdd(channel, msg.ts, 'white_check_mark').catch(this.ignoreSlackError('already_reacted'));

      const elapsed = Date.now() - startTime;
      console.log(`[slack] ${key}: Completed successfully in ${elapsed}ms`);
    } catch (e) {
      const elapsed = Date.now() - startTime;
      console.error(`[slack] ${key}: Failed after ${elapsed}ms:`, e);
      try {
        const threadTs = msg.thread_ts || msg.ts;
        console.log(`[slack] ${key}: Notifying user of error`);
        await this.slackApi.chatPostMessage(channel, `Error: ${e instanceof Error ? e.message : String(e)}`, threadTs);
        await this.slackApi.reactionsRemove(channel, msg.ts, 'eyes').catch((e) => {
          console.warn(`[slack] ${key}: Failed to remove eyes reaction:`, e);
        });
        console.log(`[slack] ${key}: Error notification sent`);
      } catch (e) {
        console.warn(`[slack] ${key}: Failed to notify user of error:`, e);
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
