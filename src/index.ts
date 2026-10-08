import dotenv from 'dotenv';
import bolt from '@slack/bolt';
import OpenAI from 'openai';
import { config } from './config.js';
import { Agent } from './agent.js';
import { Handler, type Event } from './slack.js';
import { acquireLock, shutdown } from './lifecycle.js';
import { DirectMessages } from './dm.js';
async function main() {
  dotenv.config({ quiet: true });
  let cfg: ReturnType<typeof config>;
  try { cfg = config(process.env); } catch (error) { console.error(error instanceof Error ? error.message : 'Invalid configuration'); process.exitCode = 1; return; }
  const lock = await acquireLock();
  const logger = { debug() {}, info() {}, warn() { console.info('slack_warning'); }, error() { console.error('slack_error'); }, setLevel() {}, getLevel() { return bolt.LogLevel.ERROR; }, setName() {} };
  const app = new bolt.App({ token: cfg.botToken, appToken: cfg.appToken, socketMode: true, logger, clientOptions: { retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, timeout: 15000 } });
  try {
    const auth = await app.client.auth.test();
    if (!auth.user_id || !auth.team_id) throw new Error('Slack bot identity unavailable');
    const dm = new DirectMessages(cfg, auth.user_id, auth.team_id, app.client);
    const handler = new Handler(cfg, auth.user_id, new Agent(new OpenAI({ apiKey: cfg.apiKey, maxRetries: 0, timeout: cfg.timeout }), cfg), app.client, undefined, undefined, undefined, dm);
    app.event('app_mention', async ({ event }) => { await handler.handle(event as Event); });
    app.event('message', async ({ event }) => { await handler.handle(event as Event); });
    app.error(async () => { console.error('slack_event_error'); });
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; const timer = setTimeout(() => process.exit(1), cfg.timeout + 20000); timer.unref(); try { await shutdown(handler, app); } finally { lock.close(); clearTimeout(timer); } };
    process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
    await app.start(); console.info('Dottie Socket Mode started; verify with the manual Slack smoke test.');
  } catch { lock.close(); throw new Error('Startup failed: check Slack tokens, model configuration and connectivity privately'); }
}
main().catch(() => { console.error('Startup failed: check configuration, connectivity and local instance port 47741 privately'); process.exitCode = 1; });
