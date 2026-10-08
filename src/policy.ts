import type { Config } from './config.js';
export function relevant(text: string) {
  return text.length >= 70 && /\b(problem|risk|market|customer|hypothes[ie]s|opportunit|startup|enterprise|future)\w*/i.test(text) && /\b(why|how|will|could|should|struggle|need|worthwhile|assum|validate)\w*/i.test(text);
}
export class Policy {
  private day = ''; private calls = 0; private active = 0;
  private channels = new Map<string, { count: number; attempts: number; last: number; busy: boolean; ideas: Set<string> }>();
  constructor(private cfg: Config, private now = Date.now) {}
  reserve(channel: string, proactive: boolean, text: string): (() => void) | undefined {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.day) { this.day = day; this.calls = 0; this.channels.clear(); }
    if (this.active >= this.cfg.concurrency || this.calls >= this.cfg.dailyCap) return;
    const state = this.channels.get(channel) ?? { count: 0, attempts: 0, last: -Infinity, busy: false, ideas: new Set<string>() };
    const fingerprint = text.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 500);
    if (proactive && (state.busy || state.count >= this.cfg.proactiveCap || state.attempts >= this.cfg.proactiveCap * 2 || this.now() - state.last < this.cfg.cooldown || state.ideas.has(fingerprint))) return;
    this.calls++; this.active++;
    if (proactive) { state.busy = true; state.attempts++; state.last = this.now(); state.ideas.add(fingerprint); }
    this.channels.set(channel, state);
    let released = false;
    const release = () => { if (!released) { released = true; this.active--; state.busy = false; } };
    return Object.assign(release, { success: () => { if (proactive) state.count++; } });
  }
}
