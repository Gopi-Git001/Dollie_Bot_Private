import type { Config } from './config.js';
import type { Message } from './store.js';
import { PERSONA } from './persona.js';
export interface ModelClient { responses: { create: (body: { model: string; instructions: string; input: { role: 'user' | 'assistant'; content: string }[]; max_output_tokens: number; store: false }, options: { signal: AbortSignal; timeout: number; maxRetries: number }) => Promise<{ output_text?: string }> } }
export function safeText(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/@(everyone|here|channel)/gi, '@\u200b$1').slice(0, 1800);
}
export class Agent {
  constructor(private client: ModelClient, private cfg: Config) {}
  async reply(history: Message[], proactive: boolean) {
    const result = await this.client.responses.create({ model: this.cfg.model, instructions: PERSONA + (proactive ? '\nThis is a proactive contribution; add new value.' : '\nAnswer the direct mention.'), input: history.map(({ role, content }) => ({ role, content })), max_output_tokens: 600, store: false }, { signal: AbortSignal.timeout(this.cfg.timeout), timeout: this.cfg.timeout, maxRetries: 0 });
    if (typeof result.output_text !== 'string' || !result.output_text.trim()) throw new Error('empty_model_output');
    return safeText(result.output_text.trim());
  }
}
