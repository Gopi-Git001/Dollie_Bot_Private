import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { Handler, type Event, type Poster } from '../src/slack.js';
import type { Message } from '../src/store.js';
const user = 'U11111111', other = 'U22222222', channel = 'D12345678';
const env = { OPENAI_API_KEY: 'sk-fake-test-only', SLACK_BOT_TOKEN: 'xoxb-fake-test-only', SLACK_APP_TOKEN: 'xapp-fake-test-only', ALLOWED_CHANNELS: 'C12345678', DM_REPLIES_ENABLED: 'true', DM_ALLOWED_USERS: `${user},${other}` };
const message: Event = { type: 'message', channel_type: 'im', channel, user, ts: '1.001', text: 'Hi' };
function fixture(overrides = {}, reply?: () => Promise<string>) {
  const calls: { history: Message[]; proactive: boolean }[] = [], posts: Parameters<Poster['chat']['postMessage']>[0][] = [];
  let commands = 0;
  const h = new Handler({ ...config(env), ...overrides }, 'UBOT', { reply: async (history, proactive) => { calls.push({ history, proactive }); return reply ? reply() : 'Hello, I am Dottie, your AI teammate.'; } }, { chat: { postMessage: async p => { posts.push(p); } } }, undefined, undefined, () => {}, { handle: async () => { commands++; return false; }, stop() {} });
  return { h, calls, posts, commands: () => commands };
}
test('incoming human DM answers without mention or proactive mode and without starting a thread', async () => { const f = fixture(); await f.h.handle(message); assert.equal(f.posts.length, 1); assert.equal(f.posts[0].channel, channel); assert.ok(!('thread_ts' in f.posts[0])); assert.equal(f.calls[0].proactive, false); assert.equal(f.commands(), 0); });
test('DM follow-ups use private main conversation context', async () => { const f = fixture(); await f.h.handle(message); await f.h.handle({ ...message, ts: '2.001', text: 'What did I say?' }); assert.equal(f.calls[1].history.length, 3); assert.equal(f.calls[1].history[0].content, 'Hi'); });
test('DM context isolates channel, user, public conversations and threads', async () => {
  const f = fixture(); await f.h.handle(message);
  await f.h.handle({ ...message, user: other, ts: '2.001' }); await f.h.handle({ ...message, channel: 'D87654321', ts: '3.001' });
  await f.h.handle({ ...message, channel: 'C12345678', channel_type: 'channel', ts: '4.001', text: '<@UBOT> public question' });
  await f.h.handle({ ...message, ts: '5.001', thread_ts: '1.001' });
  assert.deepEqual(f.calls.map(x => x.history.length), [1, 1, 1, 1, 1]); assert.equal(f.posts[4].thread_ts, '1.001');
  await f.h.handle({ ...message, ts: '6.001', thread_ts: '1.001' }); assert.equal(f.calls[5].history.length, 3);
});
test('DM opt-out, unauthorized user, private channels, group DMs and malformed routing ignored', async () => {
  const off = fixture({ dmReplies: false }); await off.h.handle(message); assert.equal(off.calls.length, 0);
  const f = fixture(); for (const change of [{ user: 'U33333333' }, { channel_type: 'mpim' }, { channel_type: 'group', channel: 'G12345678' }, { channel_type: undefined }, { channel: 'C12345678' }, { type: 'app_mention' }]) await f.h.handle({ ...message, ...change }); assert.equal(f.calls.length, 0);
});
test('DM bot/app events, edits, deletions and duplicates cannot loop', async () => {
  const f = fixture(); for (const change of [{ user: 'UBOT' }, { bot_id: 'B1' }, { app_id: 'A1' }, { subtype: 'message_changed' }, { subtype: 'message_deleted' }, { text: '' }]) await f.h.handle({ ...message, ...change }); assert.equal(f.calls.length, 0);
  await Promise.all([f.h.handle(message), f.h.handle(message)]); assert.equal(f.calls.length, 1); assert.equal(f.posts.length, 1);
});
test('DM shares global API budget with channel mentions', async () => { const f = fixture({ dailyCap: 1 }); await f.h.handle(message); await f.h.handle({ ...message, channel: 'C12345678', channel_type: 'channel', ts: '2.001', text: '<@UBOT> hello' }); assert.equal(f.calls.length, 1); });
test('DM model failure has one redacted fallback and shutdown ignores new messages', async () => { const f = fixture({}, async () => { throw new Error('SECRET'); }); await f.h.handle(message); assert.equal(f.posts.length, 1); assert.ok(!f.posts[0].text.includes('SECRET')); await f.h.stop(); await f.h.handle({ ...message, ts: '2.001' }); assert.equal(f.posts.length, 1); });
test('DM cannot initiate or confirm outbound sends', async () => { const f = fixture(); for (const [i, text] of ['DM everyone Hi', '<@UBOT> confirm dm 123456abcdef', 'cancel dm 123456abcdef'].entries()) await f.h.handle({ ...message, ts: `${i + 1}.001`, text }); assert.equal(f.commands(), 0); assert.equal(f.calls.length, 0); assert.equal(f.posts.length, 3); assert.match(f.posts[0].text, /approved public channel/); });
test('DM conversation allowlist validation and requester fallback', () => {
  const cfg = config({ ...env, DM_ALLOWED_USERS: undefined, DM_ALLOWED_REQUESTERS: user }); assert.ok(cfg.dmUsers.has(user));
  for (const change of [{ DM_ALLOWED_USERS: '' }, { DM_ALLOWED_USERS: 'bad' }, { DM_REPLIES_ENABLED: 'yes' }]) assert.throws(() => config({ ...env, ...change }));
  const separate = config({ ...env, DM_ALLOWED_REQUESTERS: user, DM_ALLOWED_USERS: other }); assert.ok(separate.dmUsers.has(other)); assert.ok(!separate.dmUsers.has(user));
});
