import 'dotenv/config';
import { SlackApi, type SlackMessage } from '../src/slack-api.js';

const TIMEOUT = 60_000; // 60s: ~10s search indexing + Claude response time
const POLL_INTERVAL = 3_000;
const TEST_CHANNEL = process.env.SLACK_TEST_CHANNEL || '#agent-playground';

// Agent's Slack API (for checking state)
const agentApi = new SlackApi(
  process.env.SLACK_XOXC!,
  process.env.SLACK_XOXD!,
);

// Inquirer's Slack API (for sending test messages)
const inquirerApi = new SlackApi(
  process.env.SLACK_TEST_INQUIRER_XOXC!,
  process.env.SLACK_TEST_INQUIRER_XOXD!,
);

let channelId: string;
let agentUserId: string;

async function setup(): Promise<void> {
  const auth = await agentApi.authTest();
  agentUserId = auth.user_id;

  // Resolve test channel ID
  let cursor: string | undefined;
  do {
    const res = await inquirerApi.conversationsList(cursor);
    const ch = res.channels.find(c => c.name === TEST_CHANNEL.replace(/^#/, ''));
    if (ch) { channelId = ch.id; break; }
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);

  if (!channelId) throw new Error(`Channel ${TEST_CHANNEL} not found`);
  console.log(`Test channel: ${TEST_CHANNEL} (${channelId}), agent: ${agentUserId}`);
}

async function waitForReaction(channel: string, ts: string, reaction: string): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT) {
    try {
      const { message } = await agentApi.reactionsGet(channel, ts);
      if (message.reactions?.some(r => r.name === reaction)) return true;
    } catch {
      // reactions.get fails if no reactions yet
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
  return false;
}

async function hasReaction(channel: string, ts: string, reaction: string): Promise<boolean> {
  try {
    const { message } = await agentApi.reactionsGet(channel, ts);
    return message.reactions?.some(r => r.name === reaction) ?? false;
  } catch {
    return false;
  }
}

async function getThreadReplies(channel: string, threadTs: string): Promise<SlackMessage[]> {
  const { messages } = await agentApi.conversationsReplies(channel, threadTs);
  // First message is the parent; rest are replies
  return messages.slice(1);
}

/** Find the bot reply that immediately follows a given message ts in a thread */
function findReplyTo(replies: SlackMessage[], mentionTs: string): SlackMessage | undefined {
  // Find bot replies that came after this mention, sorted by ts
  const botReplies = replies
    .filter(r => r.user === agentUserId && parseFloat(r.ts) > parseFloat(mentionTs));
  // The first bot reply after the mention is the response to it
  return botReplies[0];
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`❌ ${name}:`, e);
    failed++;
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  await setup();

  // --- Test 1: Basic mention ---
  await test('mention triggers reply and ✅ reaction', async () => {
    const text = `<@${agentUserId}> hello, this is e2e test ${Date.now()}`;
    const { ts } = await inquirerApi.chatPostMessage(channelId, text);
    console.log(`  Posted mention message ts=${ts}`);

    const gotReaction = await waitForReaction(channelId, ts, 'white_check_mark');
    if (!gotReaction) throw new Error('No ✅ reaction within timeout');
  });

  // --- Test 2: Non-mention ignored ---
  await test('message without mention is ignored', async () => {
    const text = `no mention here, e2e test ${Date.now()}`;
    const { ts } = await inquirerApi.chatPostMessage(channelId, text);
    console.log(`  Posted non-mention message ts=${ts}`);

    await new Promise(r => setTimeout(r, 25_000));
    const reacted = await hasReaction(channelId, ts, 'eyes') || await hasReaction(channelId, ts, 'white_check_mark');
    if (reacted) throw new Error('Agent reacted to non-mention message');
  });

  // --- Test 3: Multiple mentions in a thread each get separate replies ---
  await test('multiple mentions in thread get separate replies', async () => {
    const nonce = Date.now();

    // Post top-level mention
    const msg1Text = `<@${agentUserId}> what is 2+2? (thread test ${nonce} msg1)`;
    const { ts: parentTs } = await inquirerApi.chatPostMessage(channelId, msg1Text);
    console.log(`  Posted thread parent ts=${parentTs}`);

    // Wait for first reply
    const got1 = await waitForReaction(channelId, parentTs, 'white_check_mark');
    if (!got1) throw new Error('No ✅ on first mention');

    // Post second mention in the same thread
    const msg2Text = `<@${agentUserId}> what is 3+3? (thread test ${nonce} msg2)`;
    const { ts: reply1Ts } = await inquirerApi.chatPostMessage(channelId, msg2Text, parentTs);
    console.log(`  Posted thread reply ts=${reply1Ts}`);

    // Wait for second reply
    const got2 = await waitForReaction(channelId, reply1Ts, 'white_check_mark');
    if (!got2) throw new Error('No ✅ on second mention');

    // Verify both got separate bot replies in the thread
    const replies = await getThreadReplies(channelId, parentTs);
    const botReplies = replies.filter(r => r.user === agentUserId);
    if (botReplies.length < 2) {
      throw new Error(`Expected at least 2 bot replies in thread, got ${botReplies.length}`);
    }
  });

  // --- Test 4: Each reply corresponds to its specific mention ---
  await test('replies correspond to specific mentions', async () => {
    const nonce = Date.now();

    // Post parent with a specific question
    const msg1Text = `<@${agentUserId}> reply with exactly the word "alpha" and nothing else (test ${nonce})`;
    const { ts: parentTs } = await inquirerApi.chatPostMessage(channelId, msg1Text);
    console.log(`  Posted parent ts=${parentTs}`);

    const got1 = await waitForReaction(channelId, parentTs, 'white_check_mark');
    if (!got1) throw new Error('No ✅ on first mention');

    // Post follow-up in thread with different specific question
    const msg2Text = `<@${agentUserId}> reply with exactly the word "bravo" and nothing else (test ${nonce})`;
    const { ts: threadReplyTs } = await inquirerApi.chatPostMessage(channelId, msg2Text, parentTs);
    console.log(`  Posted thread reply ts=${threadReplyTs}`);

    const got2 = await waitForReaction(channelId, threadReplyTs, 'white_check_mark');
    if (!got2) throw new Error('No ✅ on second mention');

    // Check that replies match their specific mentions
    const replies = await getThreadReplies(channelId, parentTs);

    const reply1 = findReplyTo(replies, parentTs);
    const reply2 = findReplyTo(replies, threadReplyTs);

    if (!reply1) throw new Error('No bot reply found for first mention');
    if (!reply2) throw new Error('No bot reply found for second mention');

    const text1 = reply1.text.toLowerCase();
    const text2 = reply2.text.toLowerCase();

    if (!text1.includes('alpha')) {
      throw new Error(`First reply should contain "alpha", got: "${reply1.text}"`);
    }
    if (!text2.includes('bravo')) {
      throw new Error(`Second reply should contain "bravo", got: "${reply2.text}"`);
    }
    if (text1.includes('bravo')) {
      throw new Error(`First reply should NOT contain "bravo" — agent mixed up responses`);
    }
    if (text2.includes('alpha')) {
      throw new Error(`Second reply should NOT contain "alpha" — agent mixed up responses`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
}

main().catch(e => {
  console.error('E2E fatal:', e);
  process.exit(1);
});
