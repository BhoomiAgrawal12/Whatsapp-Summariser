# WA Summarizer

A **private, silent WhatsApp group summarizer**. It links to your WhatsApp account as a
regular "linked device" (like WhatsApp Web), records your group messages locally, and
produces AI digests delivered to your own **"Message Yourself" chat** — visible on your
phone, tablet and laptop. Nobody in any group ever sees anything.

> Full design, feasibility analysis and market comparison: [PLAN.md](./PLAN.md)
> Developer/agent context: [CLAUDE.md](./CLAUDE.md)

> ⚠️ **Disclaimer:** this uses the unofficial Baileys library, which violates WhatsApp's
> Terms of Service. The read-only + self-messaging usage pattern here is low-risk, but a
> ban is possible. Use a number you accept that risk for (consider testing on a spare SIM).

## Features

- 🤫 **Silent & personal** — no bot in the group, no read receipts, messages stay unread on your phone
- 📱 **Works everywhere** — digests arrive in your own WhatsApp chat (all devices); dashboard in any browser
- 🗓 **Any time window** — unread catch-up, `6h`/`2d`/`today`/`yesterday`, or exact date-time ranges
- 🧵 **Topic digests** — overview, per-topic threads, decisions/action items, with `[n]` citations
- 🎯 **Personal topic profile** — "tech talks, event updates, sticker packs" → dedicated section per digest, changeable anytime
- ⭐ **Permanent star archive** — react ⭐ to any message; it's copied (incl. media) into your own DB and survives chat clearing
- 💾 **Saved summaries** — every digest is stored; citations link to full message context in the dashboard
- ⏰ **Daily digests** — per group at a time you pick
- 🧠 **OpenAI or fully-local Ollama** — one env var to switch

## Setup

Requirements: **Node.js ≥ 22**.

```bash
npm install
cp .env.example .env     # then edit: set OPENAI_API_KEY
npm run dev
```

### First run (pairing)

1. `npm run dev` prints a **QR code** in the terminal.
2. On your phone: **WhatsApp → Settings → Linked devices → Link a device** → scan it.
3. The app reconnects automatically after pairing (expected) and starts recording
   incoming group messages. Recent history is backfilled where WhatsApp provides it.
4. Open WhatsApp, go to your **"Message Yourself"** chat and send `/help`.

Credentials persist in `auth/` — you only pair once. Delete `auth/` to unlink/re-pair.

## Using it — from your phone (self-chat commands)

Send these to yourself in WhatsApp (only you see them):

| Command | What it does |
|---|---|
| `/groups` | List your groups (`#1`, `#2`, …) |
| `/sum family` | Summarize last 24h of the group matching "family" |
| `/sum #2 6h` · `/sum "tech talks" 2d` · `/sum family today` | Relative windows |
| `/sum family 2026-07-01..2026-07-02` | Date range |
| `/sum family 2026-07-01 09:00..2026-07-01 18:00` | Exact date-time range |
| `/unread family` | Catch up since your last catch-up (then advances the marker) |
| `/topics set tech talks, AI tools, event updates` | Set your topic profile |
| `/topics` · `/topics clear` | Show / clear it |
| `/schedule family 20:00` · `/schedule family off` · `/schedule list` | Daily digest |
| `/saved` | List recent saved summaries |
| `/help` | All of the above |

**⭐ Star-to-archive:** react with ⭐ (or 🌟/✨) to any message in any chat — it is
permanently archived (media downloaded too). Remove the reaction to un-archive.

## Using it — dashboard

`npm run dev` also serves **http://127.0.0.1:8790**:

- **Groups** — pick exact from/to datetimes and summarize
- **Summaries** — browse everything ever generated; click any `[n]` citation to open the
  surrounding conversation context
- **Starred** — your permanent archive (images shown inline, other media downloadable)
- **Topics & Schedules** — edit your topic profile and daily digest times

To open the dashboard from your phone, run with `DASHBOARD_HOST=0.0.0.0` understanding
that it is **unauthenticated** — only do this on a trusted home network
(then visit `http://<laptop-ip>:8790`).

## Chrome extension — exact jump-to-message (WhatsApp Web)

WhatsApp has no public per-message deep links, so on phones citations open the
dashboard's context view. On a laptop you can do better: the companion extension in
`extension/` makes "Open in WhatsApp Web ↗" links (in the citation context modal and on
starred messages) open web.whatsapp.com, switch to the right chat, **scroll back until
the exact message loads, and flash-highlight it**.

**Install (once):**
1. Chrome/Edge/Brave → `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select the `extension/` folder
3. Be logged in at https://web.whatsapp.com

**How it works:** the dashboard link carries `#wasum=<chat + message id>` in the URL;
the content script reads it, opens the chat via the sidebar search, and keeps scrolling
up (lazy-loading older history) until the message row appears. A toast shows progress.

**Caveats:** WhatsApp Web's DOM is unofficial and changes occasionally — if jumping
stops working, the selectors at the top of `extension/content.js` are the place to fix.
Very old messages beyond what WhatsApp Web keeps loaded can't be reached and the
extension will say so.

## Configuration (`.env`)

| Var | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `openai` | or `ollama` (free, local, weaker) |
| `OPENAI_API_KEY` | — | required for openai |
| `OPENAI_MODEL` | `gpt-4o-mini` | ~$0.01–0.02 per 1000-message summary |
| `OLLAMA_URL` / `OLLAMA_MODEL` | `http://127.0.0.1:11434` / `llama3.1:8b` | |
| `DASHBOARD_PORT` | `8790` | |
| `DATA_DIR` | `./data` | SQLite DB + starred media |
| `LOG_LEVEL` | `info` | |

## Running 24/7

The service must be running to record messages (it cannot read history it wasn't
present for, beyond WhatsApp's initial sync). Options:

```bash
npm run build
node dist/index.js                          # foreground
# or keep it alive with systemd / pm2, e.g.:
npx pm2 start dist/index.js --name wa-summarizer
```

A Raspberry Pi / small VPS / always-on laptop all work.

## Development

```bash
npm run typecheck   # strict TS, no `any`
npm test            # 34 unit + integration tests (node:test)
npm run build       # compile to dist/
```

Architecture and conventions: see [CLAUDE.md](./CLAUDE.md). Code layout:

```
src/wa         Baileys connection + proto→domain extraction
src/ingest     event → SQLite ingestion, ⭐-reaction archiving
src/store      repositories (messages, summaries, starred, settings)
src/llm        OpenAI / Ollama drivers behind one interface
src/summarize  chunking + map-reduce pipeline + prompts
src/commands   self-chat command parser + handler (delivery to self-chat)
src/web        dashboard HTTP API + single-file UI
src/util       time formatting/parsing
src/scheduler  daily digests
```

## Troubleshooting

- **QR never appears** — delete `auth/` and restart.
- **"logged out by WhatsApp"** — the device was unlinked (from the phone or by WhatsApp);
  delete `auth/` and re-pair.
- **Group shows no messages** — the service only records messages received while running
  (plus initial history sync). Leave it running.
- **Summary command says "no group matching"** — send `/groups` and use the `#n` index.
- **Ollama errors** — make sure `ollama serve` is running and the model is pulled
  (`ollama pull llama3.1:8b`).

## Known limitations

- No per-message deep links on phones (WhatsApp platform limit) — citations open full
  context in the dashboard instead. On a laptop, the bundled Chrome extension
  (`extension/`) provides exact jump-to-message on WhatsApp Web.
- History before the first pairing is only partially available (whatever WhatsApp syncs).
- Unofficial protocol: a WhatsApp update can break the connection until Baileys ships a fix.
