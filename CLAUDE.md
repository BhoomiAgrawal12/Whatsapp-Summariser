# CLAUDE.md — WhatsApp Group Summarizer

## What this is

A private, silent WhatsApp group summarizer running as a **linked device** (Baileys).
It records group messages into SQLite, produces LLM summaries (chunked map-reduce),
and delivers them to the user's own "Message Yourself" chat + a local web dashboard.
No visible bot; group members never see anything. Full plan and feasibility analysis:
see `PLAN.md`. Run/usage instructions: see `README.md`.

## Stack

- **Node.js 22+, TypeScript (strict, NodeNext ESM)** — `"type": "module"`
- **baileys v7 (7.0.0-rc13)** — unofficial WhatsApp Web protocol lib. v7 notes:
  - No `printQRInTerminal` — handle `qr` from the `connection.update` event and render
    with the `qrcode` package.
  - After QR scan WhatsApp force-disconnects with `DisconnectReason.restartRequired` —
    recreate the socket (expected, not an error).
  - `useMultiFileAuthState('auth/')` persists creds; `creds.update` must call `saveCreds`.
- **better-sqlite3** — synchronous SQLite (correct choice here: single process, WAL mode)
- **qrcode** (terminal QR), **pino** (logging)
- No web framework — dashboard uses `node:http` with a small router (`src/web/`)
- LLM: OpenAI (default) or Ollama via `LLM_PROVIDER` env — both drivers use plain `fetch`

## Commands

```bash
npm run dev        # run with tsx (dev)
npm run build      # tsc -> dist/
npm start          # node dist/index.js
npm test           # node:test unit tests via tsx
npm run typecheck  # tsc --noEmit
```

Config via `.env` (see `.env.example`): `OPENAI_API_KEY`, `LLM_PROVIDER=openai|ollama`,
`OPENAI_MODEL`, `OLLAMA_MODEL`, `OLLAMA_URL`, `DASHBOARD_PORT`, `DATA_DIR`.

## Layout

```
src/
  index.ts          # wiring: store + wa + commands + web + scheduler
  config.ts         # env-driven config (single source of truth)
  logger.ts         # pino
  types.ts          # domain types (StoredMessage, SummaryWindow, TopicProfile, ...)
  wa/connection.ts  # socket lifecycle: QR, reconnect, creds persistence
  wa/extract.ts     # proto message -> text/type extraction (pure, tested)
  ingest/ingest.ts  # messages.upsert / history / reactions(⭐→archive) / edits/deletes
  store/            # db.ts (schema) + one repository per table
  llm/              # provider.ts (interface+factory), openai.ts, ollama.ts
  summarize/        # chunk.ts (pure, tested), prompts.ts, summarizer.ts
  commands/         # parser.ts (pure, tested), handler.ts (self-chat commands + delivery)
  util/time.ts      # timestamp formatting/parsing (local time)
  web/server.ts     # dashboard HTTP API (node:http, no framework)
  web/public/index.html  # single-file PWA dashboard
  scheduler.ts      # daily digests per group
tests/              # node:test — pure logic + summarizer integration (temp DB, fake LLM)
extension/          # Chrome MV3 content script: jump-to-message on web.whatsapp.com
                    # (plain JS, no build; dashboard links carry #wasum=<json> in the URL)
deploy/             # Oracle Cloud deployment: oracle-setup.sh (server bootstrap),
                    # deploy.sh (rsync push from laptop; --with-state moves auth/data/.env)
                    # Walkthrough: DEPLOY.md. Rule: the WhatsApp session (auth/) must only
                    # ever run in ONE place at a time.
```

## Conventions (user-requested — keep these)

- **async/await only** — no raw `.then()` chains.
- **No `any`** — use precise types or `unknown` + narrowing. Baileys proto types are
  loose; narrow at the `wa/extract.ts` boundary so the rest of the app sees clean
  domain types from `types.ts`.
- Clean modular code; each module has one job; document non-obvious decisions inline.
- Keep everything documented: update README.md + this file when behavior changes.

## Key design decisions & gotchas

- **Never call `sock.readMessages`** and keep `markOnlineOnConnect: false` — messages
  must stay unread on the phone and phone notifications must not be suppressed.
- **Silence:** the only outbound messages ever sent are to the user's own JID
  (self-chat). Nothing is sent to groups. This is also the ban-risk mitigation.
- **Self-chat is the command channel:** messages from own JID starting with `/` are
  parsed as commands (`/help /groups /sum /unread /topics /schedule /saved`).
  `fromMe && remoteJid === ownJid` identifies them.
- **"Unread" = catch-up marker**, not WhatsApp's real read state (unreliable via
  linked device): each `/unread` summarizes since the last catch-up and advances the
  per-chat marker (`markers` in settings repo).
- **Star-to-archive:** a ⭐ (or any star-emoji) reaction *by the user* on any message
  copies it (+ downloaded media) into `starred_archive` — survives WhatsApp chat clears.
- **No per-message deep links** exist on WhatsApp mobile — digests cite messages as
  `sender HH:MM`; the dashboard expands full context around any cited message. Exact
  jump-to-message would need the future Chrome-extension add-on (PLAN.md Phase 5).
- **Summaries cite messages via `[n]` indices** mapped back to DB message ids
  (`summarize/summarizer.ts`), enabling dashboard context links.
- **DB ids:** messages keyed by `(chat_jid, wa_message_id)`; timestamps stored as unix
  ms integers, UTC.
- Auth state lives in `auth/` (gitignored, per-account secret). Wiping it = re-pair QR.
- `data/` holds `app.db` + downloaded starred media (gitignored).

## Testing

- Unit tests cover pure logic: chunking, command parsing, message extraction.
- WhatsApp connectivity can only be truly tested by pairing a real account (QR) —
  see README "First run". There is no mock of the WA socket; keep side-effectful code
  thin and push logic into pure, tested modules.

## Status / roadmap

Implemented: Phases 0–5 of PLAN.md (ingestion, storage, summarizer, self-chat commands,
dashboard, star-archive, topics, scheduler, jump-to-message Chrome extension).
Not implemented: multi-tenant hardening (PLAN.md Phase 6).
Extension caveat: web.whatsapp.com selectors are unofficial — kept in SELECTORS at the
top of extension/content.js; that's the first place to look when jumping breaks.
