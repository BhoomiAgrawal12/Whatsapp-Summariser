# WA Summarizer

A **private, silent WhatsApp group summarizer**. It links to your WhatsApp account as a
regular "linked device" (like WhatsApp Web), records your group messages locally, and
produces AI digests delivered to your own **"Message Yourself" chat** — visible on your
phone, tablet and laptop. Nobody in any group ever sees anything.

> 👉 **New here? Start with [GETTING_STARTED.md](./GETTING_STARTED.md)** — a step-by-step
> walkthrough for setting it up, trying every feature and verifying each one works.
> This file is the reference: every command, every setting, full troubleshooting.

> Full design, feasibility analysis and market comparison: [PLAN.md](./PLAN.md)
> Developer/agent context: [CLAUDE.md](./CLAUDE.md)

> ⚠️ **Disclaimer:** this uses the unofficial Baileys library, which violates WhatsApp's
> Terms of Service. The read-only + self-messaging usage pattern here is low-risk, but a
> ban is possible. Use a number you accept that risk for (consider testing on a spare SIM).

## Features

- 🤫 **Silent & personal** — no bot in the group, no read receipts, messages stay unread on your phone
- 📱 **Works everywhere** — digests arrive in your own WhatsApp chat (all devices); dashboard in any browser
- 🗓 **Any time window** — unread catch-up, `6h`/`2d`/`3w`, `today`/`yesterday`, `this week`/`last month`,
  a single date (`2026-07-01`, `01/07/2026`, `1 Jul`), or an exact date-time range
- 🗓 **Date-wise digests** — a window covering several days is summarized *day by day*, not blurred together
- 🧵 **Topic digests** — overview, per-topic threads, decisions/action items, with `[n]` citations
- 🎯 **Personal topic profile** — "tech talks, event updates, sticker packs" → dedicated section per digest, changeable anytime
- ⭐ **Permanent star archive** — star a message in WhatsApp (or react ⭐); it's copied (incl. media) into your own DB and survives chat clearing
- 💾 **Saved summaries** — every digest is stored; every `[n]` citation resolves to the exact
  message — full context in the dashboard, and one click into WhatsApp Web via the companion extension
- ⏰ **Daily digests** — per group at a time you pick
- 🧠 **OpenAI or fully-local Ollama** — one env var to switch

## Setup

Requirements: **Node.js ≥ 22**.

```bash
npm install
cp .env.example .env     # then edit: set OPENAI_API_KEY
npm run check-env        # verify the config loaded (prints no secrets)
npm run dev
```

> Walkthrough with a verification checkpoint at every stage:
> [GETTING_STARTED.md](./GETTING_STARTED.md).

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
| `/sum #2 6h` · `/sum "tech talks" 2d` · `/sum family 3w` | Relative windows |
| `/sum family today` · `/sum family yesterday` | Named days |
| `/sum family this week` · `/sum family last week` · `/sum family last month` | Named periods |
| `/sum family 2026-07-01` · `/sum family 01/07/2026` · `/sum family "1 Jul"` | One whole calendar day |
| `/sum family 2026-07-01..2026-07-03` | Date range — digest is broken down **day by day** |
| `/sum family "2026-07-01 09:00..2026-07-01 18:00"` | Exact date-time range |
| `/unread family` | Catch up since your last catch-up (then advances the marker) |
| `/topics set tech talks, AI tools, event updates` | Set your topic profile |
| `/topics` · `/topics clear` | Show / clear it |
| `/schedule family 20:00` · `/schedule family off` · `/schedule list` | Daily digest |
| `/saved` | List recent saved summaries |
| `/help` | All of the above |

Dates are read in **local time**, day-first for ambiguous numeric forms (`03/07` = 3 July).
Every reply states the range it actually used, so you always see what was summarized. If a
window can't be read it is reported — it is never silently treated as part of the group name.
A group whose own name looks like a date can be quoted: `/sum "Batch 2025-26"`.

**⭐ Star-to-archive — two ways, both work:**

1. **WhatsApp's own star** (the normal one): long-press a message → **Star**. On desktop,
   hover → menu → **Star**. WhatsApp syncs this to linked devices, so it archives here too.
2. **React with ⭐** (also 🌟 ✨ 💫) — useful when you want the archive without cluttering
   your WhatsApp Starred list.

Either way the message is copied into your own database with its media downloaded, so it
survives the chat being cleared, the group being deleted, or the sender removing it.
Un-star (or remove the reaction) to drop it from the archive. Messages that were **already
starred** before you set this up are archived as WhatsApp syncs your history.

## Using it — dashboard

`npm run dev` also serves **http://127.0.0.1:8790**:

- **Groups** — one-click presets (Today / Yesterday / Last 24h / Last 3 days / This week /
  Last week), or pick a from–to date range. Dates alone cover the **full** days; tick
  *exact times* to switch the pickers to datetime precision
- **Summaries** — browse everything ever generated. Click any `[n]` citation to open the
  surrounding conversation context; click the `↗` next to it to jump straight to that exact
  message in WhatsApp Web (needs the extension below)
- **Starred** — your permanent archive (images shown inline, other media downloadable)
- **Topics & Schedules** — edit your topic profile and daily digest times

To open the dashboard from your phone, run with `DASHBOARD_HOST=0.0.0.0` understanding
that it is **unauthenticated** — only do this on a trusted home network
(then visit `http://<laptop-ip>:8790`).

**Clickable citations inside WhatsApp:** run with `DASHBOARD_HOST=0.0.0.0` and `PUBLIC_URL`
is filled in from your LAN address automatically — each `[n]` in the digest's `Refs:` footer
then carries a `…/m/<id>` link. Set `PUBLIC_URL` explicitly to override it (different port,
hostname, tunnel). A localhost-bound dashboard deliberately produces **no** links: a
`127.0.0.1` link tapped on a phone points at the phone.

**What a citation link opens — and what it can't.** Tapping `[n]` on your phone opens the
**dashboard's context view** for that message, not the WhatsApp group. That is a WhatsApp
platform limit, not a bug: WhatsApp exposes no per-message (or per-group) deep link on
mobile — `wa.me` addresses individual contacts only, and `chat.whatsapp.com` links are
*invite* links, not "jump to this chat". So on a phone you get sender, timestamp and the
surrounding conversation, which is enough to find the message by scrolling in WhatsApp.
Exact jump-to-message is only possible on a desktop browser, via the Chrome extension below.

## Chrome extension — exact jump-to-message (WhatsApp Web)

WhatsApp has no public per-message deep links, so on phones citations open the
dashboard's context view. On a laptop you can do better: the companion extension in
`extension/` makes the `↗` next to any citation (and "Open in WhatsApp Web ↗" on starred
messages and context rows) open web.whatsapp.com, switch to the right chat, **land on the
exact cited message and flash-highlight it**.

**Install (once):**
1. Chrome/Edge/Brave → `chrome://extensions` → enable **Developer mode** (top-right toggle)
2. **Load unpacked** → select the `extension/` folder itself
   (the folder *containing* `manifest.json` — not the repo root, not `manifest.json`)
3. Be logged in at https://web.whatsapp.com

**Check it installed:** a green magnifier icon appears in the toolbar (click the puzzle-piece
🧩 if Chrome collapsed it, then pin it). Clicking the icon opens a status popup that shows
whether the current tab is WhatsApp Web and what the last jump did. The popup's **"Test it"**
box takes a chat name + message id — or a pasted "Open in WhatsApp Web" link — and runs a
jump directly, so you can verify the extension without waiting for a digest.

**How it works:** the dashboard link carries `#wasum=<chat jid, message id, timestamp,
text snippet, sender>` in the URL. The content script reads it, opens the chat via the
sidebar search, then tries four strategies in order until the exact message is on screen:

| Step | Strategy | Why |
|---|---|---|
| `dom` | the row is already rendered — scroll to it | instant |
| `search` | drive **WhatsApp's own search** with the message text and click the hit | WhatsApp does the jump and highlight itself, and reaches messages far outside the loaded window — this is what makes citations land on the exact message |
| `scroll` | lazy-load older history upwards | stops early once the loaded history is already older than the cited timestamp |
| `nearest` | highlight the row with the same timestamp + sender + text | still shows the right message instead of an error when the id isn't in the DOM |

A toast shows progress and the outcome (including *which* step succeeded) is recorded for
the popup. Message ids are matched on the id **segment** of `data-id`, not as a loose
substring, so a citation can't land on a different message that merely shares a prefix.

If a WhatsApp Web tab is already open, a background service worker hands the jump to
**that** tab and closes the duplicate — otherwise the new tab parks on "WhatsApp is open in
another window" and nothing happens, which used to be the most common failure.

**Caveats:** WhatsApp Web's DOM is unofficial and changes occasionally — if jumping
stops working, the `SELECTORS` table at the top of `extension/content.js` is the place to
fix (each entry is a list of fallback selectors, so add a new candidate rather than
replacing). Very old messages beyond what WhatsApp Web keeps loaded can't be reached and
the extension will say so.

**Troubleshooting:**
- *No icon at all after "Load unpacked"* — you almost certainly selected the wrong folder;
  Chrome needs the one directly containing `manifest.json`.
- *Icon there, nothing happens on click-through* — open the popup and read "Last jump".
  "Not logged in" and "open in another tab — click Use Here" are reported explicitly.
- *"Could not find the WhatsApp Web search box"* — WhatsApp changed its DOM. This no longer
  blocks the jump on its own: the chat is opened from the visible sidebar list first, and the
  search field is located by selector list, by revealing a collapsed search button, and
  finally by scanning the side pane for any editable field. If you still see this message the
  chat also wasn't in the visible list — open it once, or add a selector to
  `SELECTORS.searchBox` in `extension/content.js`.
- *Jump reports "via nearest"* — the exact message id wasn't in the page, so the row at the
  same timestamp/sender/text was highlighted. Usually means the message was re-sent or
  forwarded; the content shown is still the cited one.
- *Duplicate WhatsApp tab opens instead of reusing the existing one* — reload the extension
  after upgrading (the background worker is new in 0.3.0) and make sure the old WhatsApp tab
  has been reloaded once so its content script is the new version.

## Configuration (`.env`)

| Var | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `openai` | or `ollama` (free, local, weaker) |
| `OPENAI_API_KEY` | — | required for openai |
| `OPENAI_MODEL` | `gpt-4o-mini` | ~$0.01–0.02 per 1000-message summary |
| `OLLAMA_URL` / `OLLAMA_MODEL` | `http://127.0.0.1:11434` / `llama3.1:8b` | |
| `DASHBOARD_PORT` | `8790` | |
| `DASHBOARD_HOST` | `127.0.0.1` | `0.0.0.0` exposes the (unauthenticated) dashboard on your LAN |
| `PUBLIC_URL` | — | e.g. `http://192.168.1.20:8790` — makes `[n]` citations clickable inside WhatsApp |
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

A Raspberry Pi / small VPS / always-on laptop all work. **For free 24/7 hosting on
Oracle Cloud (Always Free tier), see [DEPLOY.md](./DEPLOY.md)** — includes one-command
server setup and deploy scripts (`deploy/`).

## Development

```bash
npm run typecheck   # strict TS, no `any`
npm test            # 64 unit + integration tests (node:test)
npm run build       # compile to dist/
npm run check-env   # config doctor — see below
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

## Checking your configuration

```bash
npm run check-env
```

Loads your configuration exactly the way the app does and prints what it got —
**without printing any secret** (API keys are reduced to a type prefix and a character
count). It flags the cases where the value being used is not the one the file appears to
specify: a shell variable shadowing the file, a key defined twice, or a long value an
editor wrapped onto a second line (which truncates it). The output is safe to paste into a
bug report.

Configuration is read **once at startup**. After editing it you must restart the app — a
running process keeps the values it booted with.

## Troubleshooting

- **QR never appears, log loops `connection closed, reconnecting` with `statusCode: 405`** —
  WhatsApp is refusing the handshake because the advertised WhatsApp-Web version is stale,
  so the socket closes before a pairing QR is ever issued. The app fetches a live version
  at startup to prevent this; check the `using WhatsApp Web version` line on boot. If the
  lookup failed (offline / blocked), you'll see `falling back to the WA version bundled
  with baileys` — fix connectivity to `web.whatsapp.com` and restart.
- **QR never appears, no 405** — delete `auth/` and restart.
- **`401 Incorrect API key provided` even though your key is correct** — the running
  process still holds the key it started with; configuration is read once at boot. Restart
  it (`Ctrl-C`, then `npm run dev`). Use `npm run check-env` to confirm what the file now
  contains; the startup log prints the key's type and length and warns if a shell variable
  is shadowing the file.
- **"logged out by WhatsApp"** — the device was unlinked (from the phone or by WhatsApp);
  delete `auth/` and re-pair.
- **Group shows no messages** — the service only records messages received while running
  (plus initial history sync). Leave it running.
- **Summary command says "no group matching"** — send `/groups` and use the `#n` index.
- **Ollama errors** — make sure `ollama serve` is running and the model is pulled
  (`ollama pull llama3.1:8b`).

## Known limitations

- No per-message deep links on phones (WhatsApp platform limit) — citations open full
  context in the dashboard instead (set `PUBLIC_URL` to make them tappable from WhatsApp).
  On a laptop, the bundled Chrome extension (`extension/`) provides exact
  jump-to-message on WhatsApp Web.
- History before the first pairing is only partially available (whatever WhatsApp syncs).
- Unofficial protocol: a WhatsApp update can break the connection until Baileys ships a fix.
