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

Only allowlisted public channels are supported. Replies always go into threads. Proactive participation is OFF by default. Both Slack event types share one processing path keyed by channel/message timestamp. Bot/app messages, edits, deletions and unsupported events are ignored. No Slack history API is used; context consists only of events observed since startup.

Architecture: `config.ts` validates settings; `persona.ts` defines behavior; `agent.ts` wraps Responses with no tools; `slack.ts` filters and handles events; `policy.ts` reserves API/proactive capacity; `store.ts` bounds memory; `lifecycle.ts` guards one local instance; `index.ts` wires SDKs and shutdown.

Limits: 12 messages/12,000 characters per conversation, 3,000 characters per input message, 1,000 conversations, 10,000 dedupe entries and one-hour memory retention. Input is minimized by channel and thread; unrelated threads are never combined. Up to 600 output tokens and 1,800 posted characters. Default model timeout is 30 seconds, concurrent calls 2 and daily calls 100. No model retries. A Slack posting failure is logged without retry because an ambiguous network failure may already have delivered the message. Mention generation failures receive one safe fallback; proactive failures remain silent. Logs contain fixed status codes only.

Privacy/cost: inform channel members before operation. Observed conversation context for a selected reply is sent to OpenAI. `store:false` disables response storage, but does not replace the provider's applicable data retention policies. OpenAI API billing is separate from a ChatGPT subscription. Daily caps count attempted model calls, not tokens or dollars; configure provider-side spend limits too. Do not paste secrets into Slack. `.env` is ignored and must never be shared.

Known limitations: memory, deduplication and daily budgets reset on restart. Dedupe eviction can allow very old retries; do not run multiple machines. Busy conversations and requests exceeding concurrency/budget are skipped with a local log rather than queued. Proactive eligibility is a conservative English keyword heuristic; exact normalized repeated ideas are suppressed, but semantic repetition is possible. The first mention in an existing thread cannot include messages Dottie never observed. Persona-based refusal cannot guarantee model wording; structural safety comes from exposing no tools, credentials or filesystem content. Perform the manual refusal smoke test. No autonomous verification of facts or URLs. Model availability depends on the API account.

The local instance guard binds loopback TCP port 47741 and immediately closes any incoming connection; it provides no HTTP or command endpoint. Shutdown stops new processing, drains bounded pending work, then disconnects Slack. A deadline exits if SDK shutdown hangs. Future cloud deployment requires coordinated durable dedupe, budgets, history/privacy controls and a distributed lock; it is outside this version.

Implementation references: [OpenAI Responses text generation](https://developers.openai.com/api/docs/guides/text), [Slack Bolt Socket Mode](https://docs.slack.dev/tools/bolt-js/concepts/socket-mode/). The supplied specification conflicts on the model default (`gpt-5.6-luna` versus its environment sample `gpt-6-luna`); the explicit technology requirement is used: `gpt-5.6-luna`, configurable with `OPENAI_MODEL`.
