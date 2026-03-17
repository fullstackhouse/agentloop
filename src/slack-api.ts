export interface SlackMessage {
  type: string;
  text: string;
  user: string;
  ts: string;
  thread_ts?: string;
  channel?: { id: string; name: string };
  reactions?: Array<{ name: string; users: string[] }>;
  permalink?: string;
}

export interface SlackSearchResult {
  messages: {
    matches: SlackMessage[];
    total: number;
  };
}

export class SlackApiError extends Error {
  constructor(public method: string, public slackError: string) {
    super(`Slack API ${method}: ${slackError}`);
  }
}

export class SlackApi {
  private baseUrl = 'https://slack.com/api';

  constructor(
    private xoxc: string,
    private xoxd: string,
  ) {}

  private async call<T>(method: string, params: Record<string, string> = {}): Promise<T> {
    const body = new URLSearchParams({ token: this.xoxc, ...params });

    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `d=${this.xoxd}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      body,
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      return this.call(method, params);
    }

    const data = await res.json() as { ok: boolean; error?: string } & T;
    if (!data.ok) throw new SlackApiError(method, data.error || 'unknown');
    return data;
  }

  async authTest(): Promise<{ user_id: string; team_id: string; user: string }> {
    return this.call('auth.test');
  }

  async searchMessages(query: string, opts: { sort?: string; count?: string } = {}): Promise<SlackSearchResult> {
    return this.call('search.messages', {
      query,
      sort: opts.sort || 'timestamp',
      sort_dir: 'desc',
      count: opts.count || '20',
    });
  }

  async reactionsAdd(channel: string, timestamp: string, name: string): Promise<void> {
    await this.call('reactions.add', { channel, timestamp, name });
  }

  async reactionsRemove(channel: string, timestamp: string, name: string): Promise<void> {
    await this.call('reactions.remove', { channel, timestamp, name });
  }

  async chatPostMessage(channel: string, text: string, threadTs?: string): Promise<{ ts: string }> {
    const params: Record<string, string> = { channel, text };
    if (threadTs) params.thread_ts = threadTs;
    return this.call('chat.postMessage', params);
  }

  async reactionsGet(channel: string, timestamp: string): Promise<{
    message: { reactions?: Array<{ name: string; users: string[] }> };
  }> {
    return this.call('reactions.get', { channel, timestamp, full: 'true' });
  }

  async conversationsReplies(channel: string, ts: string): Promise<{
    messages: SlackMessage[];
  }> {
    return this.call('conversations.replies', { channel, ts, limit: '100' });
  }

  async conversationsList(cursor?: string): Promise<{
    channels: Array<{ id: string; name: string }>;
    response_metadata?: { next_cursor?: string };
  }> {
    const params: Record<string, string> = { types: 'public_channel,private_channel', limit: '200' };
    if (cursor) params.cursor = cursor;
    return this.call('conversations.list', params);
  }

  async usersList(cursor?: string): Promise<{
    members: Array<{ id: string; name: string; profile: { real_name?: string; display_name?: string } }>;
    response_metadata?: { next_cursor?: string };
  }> {
    const params: Record<string, string> = { limit: '200' };
    if (cursor) params.cursor = cursor;
    return this.call('users.list', params);
  }
}
