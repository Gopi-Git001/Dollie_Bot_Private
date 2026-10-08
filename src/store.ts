export type Message = { role: 'user' | 'assistant'; content: string; id: string; at: number };
export class Store {
  private seen = new Map<string, number>();
  private history = new Map<string, Message[]>();
  constructor(private now = Date.now, private ttl = 3600000, private cap = 1000) {}
  cleanup() {
    const cutoff = this.now() - this.ttl;
    for (const [key, at] of this.seen) if (at <= cutoff) this.seen.delete(key);
    for (const [key, entries] of this.history) {
      const fresh = entries.filter(x => x.at > cutoff);
      if (fresh.length) this.history.set(key, fresh); else this.history.delete(key);
    }
  }
  claim(key: string) {
    this.cleanup();
    if (this.seen.has(key)) return false;
    this.seen.set(key, this.now());
    while (this.seen.size > 10000) this.seen.delete(this.seen.keys().next().value!);
    return true;
  }
  add(key: string, message: Omit<Message, 'at'>) {
    this.cleanup();
    const entries = this.history.get(key) ?? [];
    if (entries.some(x => x.id === message.id)) return;
    entries.push({ ...message, content: message.content.slice(0, 3000), at: this.now() });
    while (entries.length > 12 || entries.reduce((n, x) => n + x.content.length, 0) > 12000) entries.shift();
    this.history.delete(key); this.history.set(key, entries);
    while (this.history.size > this.cap) this.history.delete(this.history.keys().next().value!);
  }
  get(key: string) { this.cleanup(); return (this.history.get(key) ?? []).map(x => ({ ...x })); }
}
