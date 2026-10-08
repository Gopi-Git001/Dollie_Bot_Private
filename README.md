# Dottie — AI Slack teammate

Discussion-only Node.js/TypeScript application using Slack Socket Mode and the OpenAI Responses API. Dottie challenges assumptions, suggests alternatives and identifies evidence gaps. It considers the next 35 years while emphasizing opportunities to validate in 3–5 years. No execution tools, browsing, file access through Slack, coding agent or cloud infrastructure is included.

See [SETUP_GUIDE.md](SETUP_GUIDE.md) for Windows setup and the live acceptance checklist. Automated tests are offline; they do not prove token validity or live integration.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run check
npm.cmd run build
npm.cmd start
```

Discussion requests are accepted in allowlisted public channels and, optionally, one-to-one DMs from allowlisted users. Channel replies go into threads; ordinary DM replies appear in the main DM conversation. Optional incoming DM replies and confirmed outbound messaging are described below. Proactive participation, outbound DMs and incoming DM replies are OFF by default in the template. Slack messages share one processing path keyed by channel/message timestamp. Bot/app messages, edits, deletions and unsupported events are ignored. No Slack history API is used; context consists only of events observed since startup.

Architecture: `config.ts` validates settings; `persona.ts` defines behavior; `agent.ts` wraps Responses with no tools; `slack.ts` filters and handles events; `dm.ts` handles explicit messaging commands without invoking the model; `policy.ts` reserves API/proactive capacity; `store.ts` bounds memory; `lifecycle.ts` guards one local instance; `index.ts` wires SDKs and shutdown.

Limits: 12 messages/12,000 characters per conversation, 3,000 characters per input message, 1,000 conversations, 10,000 dedupe entries and one-hour memory retention. Input is minimized by channel and thread; unrelated threads are never combined. Up to 600 output tokens and 1,800 posted characters. Default model timeout is 30 seconds, concurrent calls 2 and daily calls 100. No model retries. A Slack posting failure is logged without retry because an ambiguous network failure may already have delivered the message. Mention generation failures receive one safe fallback; proactive failures remain silent. Logs contain fixed status codes only.

Privacy/cost: inform channel members before operation. Observed conversation context for a selected reply is sent to OpenAI. `store:false` disables response storage, but does not replace the provider's applicable data retention policies. OpenAI API billing is separate from a ChatGPT subscription. Daily caps count attempted model calls, not tokens or dollars; configure provider-side spend limits too. Do not paste secrets into Slack. `.env` is ignored and must never be shared.

Known limitations: memory, deduplication and daily budgets reset on restart. Dedupe eviction can allow very old retries; do not run multiple machines. Busy conversations and requests exceeding concurrency/budget are skipped with a local log rather than queued. Proactive eligibility is a conservative English keyword heuristic; exact normalized repeated ideas are suppressed, but semantic repetition is possible. The first mention in an existing thread cannot include messages Dottie never observed. Persona-based refusal cannot guarantee model wording; structural safety comes from exposing no tools, credentials or filesystem content. Perform the manual refusal smoke test. No autonomous verification of facts or URLs. Model availability depends on the API account.

The local instance guard binds loopback TCP port 47741 and immediately closes any incoming connection; it provides no HTTP or command endpoint. Shutdown stops new processing, drains bounded pending work, then disconnects Slack. A deadline exits if SDK shutdown hangs. Future cloud deployment requires coordinated durable dedupe, budgets, history/privacy controls and a distributed lock; it is outside this version.

Implementation references: [OpenAI Responses text generation](https://developers.openai.com/api/docs/guides/text), [Slack Bolt Socket Mode](https://docs.slack.dev/tools/bolt-js/concepts/socket-mode/). The supplied specification conflicts on the model default (`gpt-5.6-luna` versus its environment sample `gpt-6-luna`); the explicit technology requirement is used: `gpt-5.6-luna`, configurable with `OPENAI_MODEL`.

## Optional explicit DMs

Added at the owner's request after the discussion-only MVP. `@Dottie DM everyone Good morning` prepares a preview for eligible human members of the approved source channel (including the requester). `@Dottie DM @teammate Good morning` prepares one DM; select the actual teammate using Slack autocomplete. The command must start with the real Dottie mention. The model never interprets, authorizes, rewrites or sends these commands. Channel history is not included in DMs and DM commands are not sent to OpenAI.

Only IDs configured in `DM_ALLOWED_REQUESTERS` can request or confirm sends. The original requester must mention Dottie with `confirm dm CODE` in the preview's thread within five minutes; `cancel dm CODE` deletes it. Nothing is sent before confirmation. Messages are plain text, with an AI/requester attribution added, so user mentions and mass mentions in the body do not ping people. Slack itself may notify recipients according to their preferences; accepted delivery does not prove notification or reading.

Requires `im:write`, `channels:read`, `users:read`, and existing `chat:write`; reinstall the Slack app after adding scopes. Defaults: `DM_ENABLED=false`, `DM_MAX_RECIPIENTS=25` (maximum 50), `DM_MAX_DAILY_SENDS=100` (attempts, UTC). Recipient inspection is bounded to 100 source-channel members and five membership pages. Recipient membership/eligibility is a preview-time snapshot: users joining later are not added; users leaving before confirmation may remain in that short-lived snapshot. Bots, app users, inactive users and users whose workspace differs from the bot's are excluded. This is not a workspace-wide broadcast.

One DM operation runs at a time; previews have a one-minute per-requester cooldown and a cap of 100 pending previews. API inspection and delivery are paced at 1.25-second intervals. Failed and uncertain deliveries are counted as attempts and never automatically retried. Partial batches report counts; confirm tokens are consumed before sending and cannot replay. Pending previews and daily DM counters reset on restart. Shutdown cancels pending previews and stops new recipients after the current request; do not restart to bypass limits. No live DMs were used for verification. See SETUP_GUIDE.md for activation and manual tests.

## Optional incoming DM conversations

Set `DM_REPLIES_ENABLED=true` and subscribe to `message.im` with `im:history` permission, then reinstall Slack. Enable App Home's Messages tab and its user messaging checkbox. `DM_ALLOWED_USERS` is a comma-separated list of authorized Slack member IDs; if omitted, it defaults to `DM_ALLOWED_REQUESTERS`. This is a separate permission from authorizing outbound messages: adding a user to `DM_ALLOWED_USERS` does not let them broadcast. The current local environment enables replies for the owner's configured member ID. Others must be explicitly added to chat privately.

Allowed users can send plain `Hi` directly to Dottie without mentioning it. Replies stay in that DM, or the existing DM thread when used. Recent context is isolated by DM channel, sender and thread and shares the bounded store and global model-call budget. DMs from unauthorized users, group DMs, bots and edits are ignored. There is no proactive DM behavior. DM content used to respond is sent to OpenAI; notify users and keep secrets out of messages. These are discussion-only conversations; outbound send/confirm/cancel commands still belong in the approved public channel. Channel history and private conversation history are never combined. Automated verification is mocked; operator live reply testing remains necessary.
