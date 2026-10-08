import type { Config } from './config.js';
import { Store } from './store.js';
import { Policy, relevant } from './policy.js';
export type Event = { type?: string; channel?: string; channel_type?: string; user?: string; text?: string; ts?: string; thread_ts?: string; bot_id?: string; app_id?: string; subtype?: string; hidden?: boolean };
export interface Poster { chat: { postMessage: (args: { channel: string; thread_ts: string; text: string; unfurl_links: false; unfurl_media: false; parse: 'none' }) => Promise<unknown> } }
export class Handler {
  private pending = new Set<Promise<void>>(); private busy = new Set<string>(); private stopping = false;
  constructor(private cfg: Config, private botId: string, private agent: { reply: (history: ReturnType<Store['get']>, proactive: boolean) => Promise<string> }, private slack: Poster, readonly store = new Store(), private policy = new Policy(cfg), private log: (code: string) => void = console.info) {}
  handle(event: Event) {
    const job = this.process(event).catch(() => { this.log('event_failed'); });
    this.pending.add(job); void job.finally(() => this.pending.delete(job)); return job;
  }
  async stop() { this.stopping = true; await Promise.all(this.pending); }
  private async process(e: Event) {
    if (this.stopping || !['message', 'app_mention'].includes(e.type ?? '') || !e.channel || !this.cfg.channels.has(e.channel) || (e.channel_type && e.channel_type !== 'channel') || !e.user || e.user === this.botId || e.bot_id || e.app_id || e.subtype || e.hidden || !e.text?.trim() || !e.ts || !/^\d+\.\d+$/.test(e.ts) || (e.thread_ts && !/^\d+\.\d+$/.test(e.thread_ts))) return;
    if (!this.store.claim(`${e.channel}:${e.ts}`)) return;
    const key = `${e.channel}:${e.thread_ts ?? e.ts}`;
    const text = e.text.replace(new RegExp(`<@${this.botId}>`, 'g'), '@Dottie').slice(0, 3000);
    this.store.add(key, { id: e.ts, role: 'user', content: text });
    const mentioned = e.text.includes(`<@${this.botId}>`);
    if (!mentioned && (!this.cfg.proactive || !relevant(text))) return;
    if (this.busy.has(key)) { this.log('conversation_busy'); return; }
    const release = this.policy.reserve(e.channel, !mentioned, text);
    if (!release) { this.log('budget_or_frequency_limit'); return; }
    this.busy.add(key);
    try {
      let answer: string;
      try { answer = await this.agent.reply(this.store.get(key), !mentioned); }
      catch { this.log('model_failed_check_model_billing_or_network'); if (!mentioned) return; answer = 'I could not generate a response right now. Please try again later; the operator can check model access, billing and connectivity.'; }
      await this.slack.chat.postMessage({ channel: e.channel, thread_ts: e.thread_ts ?? e.ts, text: answer, unfurl_links: false, unfurl_media: false, parse: 'none' });
      if ('success' in release) (release.success as () => void)();
      this.store.add(key, { id: `reply:${e.ts}`, role: 'assistant', content: answer });
      this.log('reply_posted');
    } catch { this.log('slack_post_failed_no_retry'); }
    finally { this.busy.delete(key); release(); }
  }
}
