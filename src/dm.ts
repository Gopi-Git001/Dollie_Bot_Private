import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Config } from './config.js';
import type { Event } from './slack.js';

export interface DmClient {
  conversations: {
    members(args: { channel: string; cursor?: string; limit: number }): Promise<{ ok?: boolean; members?: string[]; response_metadata?: { next_cursor?: string } }>;
    open(args: { users: string }): Promise<{ ok?: boolean; channel?: { id?: string } }>;
  };
  users: { info(args: { user: string }): Promise<{ ok?: boolean; user?: { id?: string; team_id?: string; is_bot?: boolean; is_app_user?: boolean; deleted?: boolean; is_stranger?: boolean } }> };
  chat: { postMessage(args: { channel: string; thread_ts?: string; text: string; mrkdwn: false; parse: 'none'; unfurl_links: false; unfurl_media: false }): Promise<{ ok?: boolean }> };
}
type Draft = { requester: string; channel: string; thread: string; recipients: string[]; text: string; expires: number };
const TTL = 5 * 60000;

/** Explicit messaging commands only. The language model cannot select recipients or authorize sends. */
export class DirectMessages {
  private drafts = new Map<string, Draft>();
  private lastPreview = new Map<string, number>();
  private busy = false; private stopped = false; private day = ''; private attempts = 0;
  constructor(private cfg: Config, private botId: string, private teamId: string, private client: DmClient, private now = Date.now, private pause: () => Promise<unknown> = () => sleep(1250), private log: (code: string) => void = console.info) {}
  stop() { this.stopped = true; this.drafts.clear(); }
  private async post(channel: string, text: string, thread?: string) {
    const result = await this.client.chat.postMessage({ channel, ...(thread ? { thread_ts: thread } : {}), text, mrkdwn: false, parse: 'none', unfurl_links: false, unfurl_media: false });
    if (result.ok !== true) throw new Error('post_failed');
  }
  async handle(e: Event): Promise<boolean> {
    const prefix = `<@${this.botId}>`;
    if (!e.text?.startsWith(prefix)) return false;
    const command = e.text.slice(prefix.length).trim();
    if (!/^(dm\b|confirm\s+dm\b|cancel\s+dm\b)/i.test(command)) return false;
    // Defense in depth: Handler also validates and deduplicates events before dispatch.
    if (this.stopped || !e.channel || !this.cfg.channels.has(e.channel) || !e.user || !e.ts || e.bot_id || e.app_id || e.subtype || e.hidden || e.user === this.botId || (e.channel_type && e.channel_type !== 'channel')) return true;
    const channel = e.channel, requester = e.user, thread = e.thread_ts ?? e.ts;
    const respond = (text: string) => this.post(channel, text, thread);
    let acquired = false;
    try {
      if (!this.cfg.dmEnabled) { await respond('DM messaging is disabled. The operator must enable DM_ENABLED and configure DM_ALLOWED_REQUESTERS first.'); return true; }
      if (!this.cfg.dmRequesters.has(requester)) { await respond('You are not authorized to request DMs from Dottie.'); return true; }
      for (const [code, draft] of this.drafts) if (draft.expires <= this.now()) this.drafts.delete(code);
      for (const [user, time] of this.lastPreview) if (this.now() - time >= 60000) this.lastPreview.delete(user);
      const action = command.match(/^(confirm|cancel)\s+dm\s+([a-f0-9]{12})$/i);
      if (action) {
        const code = action[2].toLowerCase();
        const draft = this.drafts.get(code);
        if (!draft || draft.requester !== requester || draft.channel !== channel || draft.thread !== thread) { await respond('No matching active DM preview. Confirm in its thread as the original requester within five minutes.'); return true; }
        if (action[1].toLowerCase() === 'cancel') { this.drafts.delete(code); await respond('DM preview cancelled. Nothing sent.'); return true; }
        if (this.busy) { await respond('Another DM operation is in progress. Please wait before confirming.'); return true; }
        const day = new Date(this.now()).toISOString().slice(0, 10);
        if (day !== this.day) { this.day = day; this.attempts = 0; }
        if (this.attempts + draft.recipients.length > this.cfg.dmDailyCap) { await respond('The daily DM attempt limit cannot accommodate this batch. Nothing sent.'); return true; }
        this.busy = true; acquired = true;
        // Consume before any I/O: duplicate/replayed confirmations cannot send twice.
        this.drafts.delete(code);
        let sent = 0, failed = 0;
        for (const user of draft.recipients) {
          if (this.stopped) break;
          const currentDay = new Date(this.now()).toISOString().slice(0, 10);
          if (currentDay !== this.day) { this.day = currentDay; this.attempts = 0; }
          if (this.attempts >= this.cfg.dmDailyCap) break;
          this.attempts++;
          try {
            const opened = await this.client.conversations.open({ users: user });
            if (opened.ok !== true || !opened.channel?.id?.startsWith('D')) throw new Error('dm_open_failed');
            await this.post(opened.channel.id, `Dottie (AI teammate) — requested by Slack member ${requester}:\n\n${draft.text}`);
            sent++;
          } catch { failed++; this.log('dm_delivery_failed_no_retry'); }
          if (!this.stopped) await this.pause();
        }
        await respond(`DM batch complete: ${sent} accepted by Slack, ${failed} failed or delivery uncertain, ${draft.recipients.length - sent - failed} not attempted. No automatic retries. This does not confirm that anyone read the message.`);
        return true;
      }
      const request = command.match(/^dm\s+(everyone|<@([UW][A-Z0-9]{8,})>)\s+([\s\S]+)$/i);
      if (!request) { await respond('Use @Dottie DM everyone Good morning, or @Dottie DM @teammate Good morning. Then confirm the preview in its thread.'); return true; }
      const text = request[3].trim();
      if (!text || text.length > 1000) { await respond('DM text must contain 1–1000 characters.'); return true; }
      if (this.busy) { await respond('Another DM operation is in progress. Please wait.'); return true; }
      if (this.lastPreview.has(requester)) { await respond('Please wait one minute between DM preview requests.'); return true; }
      if (this.drafts.size >= 100) { await respond('Too many pending DM previews. Wait for previews to expire.'); return true; }
      this.busy = true; acquired = true; this.lastPreview.set(requester, this.now());
      const members = new Set<string>(); let cursor: string | undefined;
      // Bound membership scans; never silently send to a truncated channel list.
      let complete = false;
      for (let page = 0; page < 5; page++) {
        if (this.stopped) return true;
        const result = await this.client.conversations.members({ channel, cursor, limit: 200 });
        if (result.ok !== true || !result.members) throw new Error('members_failed');
        for (const id of result.members) members.add(id);
        cursor = result.response_metadata?.next_cursor?.trim();
        if (!cursor) { complete = true; break; }
        await this.pause();
      }
      if (!complete) { await respond('Channel membership exceeds the bounded scan. Nothing sent; use a smaller approved channel.'); return true; }
      const selected = request[2] ? [request[2]] : [...members];
      if (selected.length > 100) { await respond('This channel exceeds the 100-member recipient inspection limit. Nothing sent; use a smaller approved channel.'); return true; }
      if (selected.some(id => !members.has(id))) { await respond('Recipients must belong to this approved channel. Nothing sent.'); return true; }
      const recipients: string[] = [];
      for (const user of selected) {
        if (this.stopped) return true;
        if (user === this.botId || user === 'USLACKBOT') continue;
        const result = await this.client.users.info({ user });
        if (result.ok !== true || !result.user) throw new Error('user_lookup_failed');
        const info = result.user;
        if (info.id === user && info.team_id === this.teamId && !info.is_bot && !info.is_app_user && !info.deleted && !info.is_stranger) recipients.push(user);
        if (recipients.length > this.cfg.dmMaxRecipients) { await respond(`This request exceeds DM_MAX_RECIPIENTS (${this.cfg.dmMaxRecipients}). Nothing sent; use a smaller approved channel.`); return true; }
        await this.pause();
      }
      if (this.stopped) return true;
      if (!recipients.length) { await respond('No eligible human teammates found. Nothing sent.'); return true; }
      const code = randomBytes(6).toString('hex');
      const draft: Draft = { requester, channel, thread, recipients, text, expires: this.now() + TTL };
      this.drafts.set(code, draft);
      try { await respond(`DM preview — ${recipients.length} human member(s) of this channel, including you if eligible. Bots, deactivated accounts and external-workspace members are excluded.\nRecipients (Slack IDs): ${recipients.join(', ')}\n\nExact message body (sent as plain text):\n${text}\n\nEach DM will identify Dottie as AI and your Slack member ID as requester. Nothing sent yet. Within five minutes, mention Dottie in THIS thread: confirm dm ${code}\nTo cancel: cancel dm ${code}`); }
      catch { this.drafts.delete(code); throw new Error('preview_post_failed'); }
    } catch {
      this.log('dm_operation_failed_check_scopes');
      try { await respond('DM operation failed. Check im:write, channels:read, users:read and chat:write, then reinstall the Slack app. No automatic retry was made.'); } catch { this.log('dm_status_post_failed'); }
    } finally { if (acquired) this.busy = false; }
    return true;
  }
}
