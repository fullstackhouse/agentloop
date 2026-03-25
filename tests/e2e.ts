import 'dotenv/config';
import { SlackApi, type SlackMessage } from '../src/slack-api.js';

const TIMEOUT = 60_000; // 60s: ~10s search indexing + Claude response time
const POLL_INTERVAL = 3_000;
const TEST_CHANNEL = process.env.SLACK_TEST_CHANNEL || '#agentloop-test';

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

  // Log inquirer info for slackUsers config help
  const inquirerAuth = await inquirerApi.authTest();
  console.log(`Inquirer: ${inquirerAuth.user_id} (${inquirerAuth.user})`);
  console.log(`  To test user filter, configure: slackUsers: ["<inquirer's display_name or real_name>"]`);

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

  // --- Test 2b: User filter - non-allowed user ignored (if slackUsers configured) ---
  // This test only runs if SLACK_TEST_BLOCKED_* env vars are set (a third user not in slackUsers)
  if (process.env.SLACK_TEST_BLOCKED_XOXC && process.env.SLACK_TEST_BLOCKED_XOXD) {
    await test('mention from non-allowed user is ignored', async () => {
      const blockedApi = new SlackApi(
        process.env.SLACK_TEST_BLOCKED_XOXC!,
        process.env.SLACK_TEST_BLOCKED_XOXD!,
      );

      const text = `<@${agentUserId}> blocked user test ${Date.now()}`;
      const { ts } = await blockedApi.chatPostMessage(channelId, text);
      console.log(`  Posted mention from blocked user ts=${ts}`);

      await new Promise(r => setTimeout(r, 25_000));
      const reacted = await hasReaction(channelId, ts, 'eyes') || await hasReaction(channelId, ts, 'white_check_mark');
      if (reacted) throw new Error('Agent reacted to mention from non-allowed user');
    });
  } else {
    console.log('⏭️  Skipping user filter test (SLACK_TEST_BLOCKED_* not set)');
  }

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

  // --- Test 4: HTTP MCP server (Linear) works ---
  // This test requires LINEAR_API_KEY env var and the agent config to include linear MCP server
  if (process.env.LINEAR_API_KEY) {
    await test('HTTP MCP server (Linear) can be used', async () => {
      const nonce = Date.now();

      // Ask the agent to use Linear MCP to list teams - this verifies HTTP MCP works end-to-end
      const text = `<@${agentUserId}> Use your Linear MCP tools to list teams. Just reply with the team names you find, nothing else. (test ${nonce})`;
      const { ts } = await inquirerApi.chatPostMessage(channelId, text);
      console.log(`  Posted Linear MCP test message ts=${ts}`);

      const gotReaction = await waitForReaction(channelId, ts, 'white_check_mark');
      if (!gotReaction) throw new Error('No ✅ reaction within timeout');

      // Check that the reply contains something (Linear returned data)
      const replies = await getThreadReplies(channelId, ts);
      const botReply = findReplyTo(replies, ts);
      if (!botReply) throw new Error('No bot reply found');

      // The reply should contain team info from Linear (not an error message)
      const replyText = botReply.text.toLowerCase();
      if (replyText.includes('error') || replyText.includes('failed') || replyText.includes('unable') ||
          replyText.includes("don't have access") || replyText.includes('not available')) {
        throw new Error(`Linear MCP call appears to have failed: "${botReply.text}"`);
      }
      console.log(`  Linear MCP response: "${botReply.text.substring(0, 100)}..."`);
    });
  } else {
    console.log('⏭️  Skipping HTTP MCP test (LINEAR_API_KEY not set)');
  }

  // --- Test 5: Each mention gets a separate reply ---
  await test('each mention gets a separate reply', async () => {
    const nonce = Date.now();

    // Post parent with a math question
    const msg1Text = `<@${agentUserId}> what is 5+5? just give me the number (test ${nonce})`;
    const { ts: parentTs } = await inquirerApi.chatPostMessage(channelId, msg1Text);
    console.log(`  Posted parent ts=${parentTs}`);

    const got1 = await waitForReaction(channelId, parentTs, 'white_check_mark');
    if (!got1) throw new Error('No ✅ on first mention');

    // Post follow-up in thread with a different math question
    const msg2Text = `<@${agentUserId}> what is 7+7? just give me the number (test ${nonce})`;
    const { ts: threadReplyTs } = await inquirerApi.chatPostMessage(channelId, msg2Text, parentTs);
    console.log(`  Posted thread reply ts=${threadReplyTs}`);

    const got2 = await waitForReaction(channelId, threadReplyTs, 'white_check_mark');
    if (!got2) throw new Error('No ✅ on second mention');

    // Check that both mentions got replies
    const replies = await getThreadReplies(channelId, parentTs);

    const reply1 = findReplyTo(replies, parentTs);
    const reply2 = findReplyTo(replies, threadReplyTs);

    if (!reply1) throw new Error('No bot reply found for first mention');
    if (!reply2) throw new Error('No bot reply found for second mention');

    // Check that replies contain appropriate answers (10 and 14)
    const text1 = reply1.text;
    const text2 = reply2.text;

    if (!text1.includes('10')) {
      throw new Error(`First reply should contain "10", got: "${reply1.text}"`);
    }
    if (!text2.includes('14')) {
      throw new Error(`Second reply should contain "14", got: "${reply2.text}"`);
    }
  });

  // --- Test 5: Session resumption preserves conversation context ---
  // NOTE: This test requires the agent to have session resumption support (--resume flag)
  // It will fail if the deployed agent doesn't have this feature yet
  await test('resumed session remembers previous conversation', async () => {
    const nonce = Date.now();
    const secretWord = `zebra${nonce}`;

    // First message: tell the bot a secret word
    const msg1Text = `<@${agentUserId}> remember this secret word: "${secretWord}". Just confirm you got it. (test ${nonce})`;
    const { ts: parentTs } = await inquirerApi.chatPostMessage(channelId, msg1Text);
    console.log(`  Posted first message with secret word ts=${parentTs}`);

    const got1 = await waitForReaction(channelId, parentTs, 'white_check_mark');
    if (!got1) throw new Error('No ✅ on first mention');

    // Second message: ask the bot to recall the secret word
    const msg2Text = `<@${agentUserId}> what was the secret word I just told you? Reply with just the word.`;
    const { ts: threadReplyTs } = await inquirerApi.chatPostMessage(channelId, msg2Text, parentTs);
    console.log(`  Posted follow-up asking for secret word ts=${threadReplyTs}`);

    const got2 = await waitForReaction(channelId, threadReplyTs, 'white_check_mark');
    if (!got2) throw new Error('No ✅ on second mention');

    // Check that the second reply contains the secret word
    const replies = await getThreadReplies(channelId, parentTs);
    const reply2 = findReplyTo(replies, threadReplyTs);

    if (!reply2) throw new Error('No bot reply found for second mention');

    const text2 = reply2.text.toLowerCase();
    if (!text2.includes(secretWord)) {
      throw new Error(`Second reply should contain secret word "${secretWord}", got: "${reply2.text}"`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
}

main().catch(e => {
  console.error('E2E fatal:', e);
  process.exit(1);
});
