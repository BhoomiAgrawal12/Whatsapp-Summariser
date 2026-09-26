# Getting started — try it and test it

A hands-on walkthrough, in order, with a **checkpoint** after each step so you always know
whether it worked before moving on. About 15 minutes end to end.

For the feature reference (every command, every config var, full troubleshooting) see
[README.md](./README.md). This file is the *doing* guide.

> ⚠️ Before you start: this links to your real WhatsApp account through the unofficial
> Baileys library, which is against WhatsApp's Terms of Service. The usage pattern here
> (read-only, only ever messaging yourself) is low-risk, but a ban is possible. Use a number
> whose loss you'd accept — a spare SIM is ideal for testing.

**Quick smoke test** — the short version, if you just want the happy path:

| # | Do | Expect |
|---|---|---|
| 1 | `npm install` | no errors |
| 2 | `npm run check-env` | `✓ No configuration problems detected` |
| 3 | `npm run dev` | QR code in the terminal |
| 4 | Scan it from your phone | `connected to WhatsApp` in the log |
| 5 | Send yourself `/help` in WhatsApp | command list replies |
| 6 | Send yourself `/groups` | numbered list of your groups |
| 7 | Send yourself `/sum #1 today` | a digest with `[n]` citations |
| 8 | Open http://127.0.0.1:8790 | dashboard with your groups |

Everything below is the same path with verification and the less obvious features.

---

## 1. Install and configure

Requires **Node.js ≥ 22**.

```bash
cd /Users/bhoomi/workspace/Trailheads/Whatsapp-Summariser
npm install
```

If this is a fresh clone, create your config from the template and set your OpenAI key:

```bash
cp .env.example .env
```

Then edit it and set `OPENAI_API_KEY=sk-...`. Three rules that cause almost every
"invalid API key" problem:

- the whole key on **one line** — if your editor soft-wraps that's fine, a real newline is not
- **no quotes** around it
- define it **once** (don't paste a new key below an old one)

### ✅ Checkpoint

```bash
npm run check-env
```

You want:

```
  LLM provider     openai
  OpenAI key       type "sk-proj-", 164 characters
✓ No configuration problems detected.
```

This prints **no secrets** — keys are reduced to a type prefix and a character count, so the
output is safe to paste anywhere. If the length looks far short of ~51 (`sk-…`) or ~164
(`sk-proj-…`) the key is truncated. Any warning it prints tells you exactly what to fix.

> **Prefer free and fully local?** Set `LLM_PROVIDER=ollama` instead, run `ollama serve`, and
> `ollama pull llama3.1:8b`. No API key needed; summaries are noticeably weaker.

## 2. Start it and pair your phone

```bash
npm run dev
```

1. A **QR code** prints in the terminal.
2. On your phone: **WhatsApp → Settings → Linked devices → Link a device** → scan it.
3. It disconnects and reconnects immediately after pairing. **This is expected** — the log
   says `connection closed, reconnecting` with `restartRequired`. Not an error.

### ✅ Checkpoint

Look for these three lines in the log:

```
using WhatsApp Web version      ← version lookup succeeded
connected to WhatsApp           ← paired and online
dashboard running               ← http://127.0.0.1:8790
```

You pair **once** — credentials live in `auth/`. Nothing appears in any group, and your
phone keeps its unread badges and notifications; the app never marks anything read.

> **If no QR appears** and the log loops with `statusCode: 405`, WhatsApp is rejecting a
> stale Web version. Check the `using WhatsApp Web version` line — if it says *falling back to
> the WA version bundled with baileys*, fix connectivity to `web.whatsapp.com` and restart.

## 3. Let it record for a bit

The app can only summarise messages it was **running** to receive. WhatsApp backfills some
recent history on first pairing, but from here on: no process = no recording.

Give it a few minutes of live group chatter before expecting much.

### ✅ Checkpoint

Confirm messages are actually landing in the database (safe to run while the app is
running — the DB is in WAL mode, and `-readonly` guarantees you can't disturb it):

```bash
sqlite3 -readonly data/app.db "select count(*) from messages;"
sqlite3 -readonly data/app.db "select count(*) from chats where is_group = 1;"

# how many minutes ago was the newest message recorded?
sqlite3 -readonly data/app.db \
  "select cast((strftime('%s','now')*1000 - max(timestamp))/60000 as int) from messages;"
```

The message count should grow as your groups chat, and the newest message should be recent.

## 4. First digest, from your phone

Open WhatsApp → your own **"Message Yourself"** chat. Everything is driven from here, and
only you can see any of it.

```
/help        → the full command list
/groups      → your groups, numbered #1, #2, #3 …
/sum #1      → last 24h of group #1
```

### ✅ Checkpoint

`/sum #1` should reply with:

1. `⏳ Summarizing *Group Name* (last 24h (…))…` — note it states the **exact range** used
2. then a digest: `📌 Overview`, `🧵 Topics`, `✅ Action items`, with `[n]` citations
3. then a `_Refs:_` footer mapping each `[n]` to a sender and timestamp
4. then `_Saved as summary #N_`

If it says *no group matching*, use the `#n` index from `/groups` — group names with emoji
are easier to address by number.

## 5. Test the date windows

This is the part worth exercising deliberately, because it's where the interesting behaviour
lives. Try each of these:

```
/sum #1 6h                          relative hours
/sum #1 2d                          relative days
/sum #1 3w                          relative weeks
/sum #1 today
/sum #1 yesterday
/sum #1 this week
/sum #1 last week
/sum #1 last month
/sum #1 2026-09-24                  ONE whole calendar day (00:00–23:59)
/sum #1 24/09/2026                  day-first numeric
/sum #1 "24 Sep"                    month name (quote it — it has a space)
/sum #1 2026-09-22..2026-09-24      range → day-by-day digest
/sum #1 "2026-09-24 09:00..2026-09-24 18:00"    exact times
```

### ✅ What to verify

- **Every reply names the range it used.** `/sum #1 2026-09-24` should echo
  `24 Sep 2026`, and `/sum #1 2026-09-22..2026-09-24` should echo `22 Sep → 24 Sep 2026`.
  If the echoed range isn't what you meant, the window was misread — that's the bug to report.
- **A bare date covers the whole day**, not from midnight to "now".
- **A multi-day range comes back day-by-day** — a `🗓 Day by day` section with one block per
  date, in order. A single-day window keeps the `🧵 Topics` layout instead.
- **A range's end day is included in full.** `22..24` includes all of the 24th.
- **A bad date is reported, not ignored.** Try `/sum #1 2026-13-45` — you should get
  `Couldn't read "2026-13-45" as a date or time window` plus the list of accepted formats.
  It must **not** silently summarise the last 24h or complain about a missing group.
- **Empty windows say so**, and tell you what they searched: try a date before you paired.

Dates are **local time**, and ambiguous numeric forms are **day-first** (`03/07` = 3 July).
A group whose own name looks like a date needs quoting: `/sum "Batch 2025-26"`.

## 6. Test the catch-up marker

```
/unread #1
```

Summarises everything since your last catch-up, then **advances the marker**. So:

### ✅ Checkpoint

Run `/unread #1` twice in a row. The second run should report *no messages* (or only what
arrived in between) — proving the marker moved. Note this is the app's own marker, not
WhatsApp's real read state, which isn't reliable from a linked device.

## 7. Test the dashboard

It's already running — `npm run dev` serves it. Nothing to enable.

Open **http://127.0.0.1:8790**

- **Groups** — click a preset (**Today**, **Yesterday**, **Last 24h**, **Last 3 days**,
  **This week**, **Last week**), or pick a from–to **date** range and hit *Summarize range*.
  Dates alone cover the **full** days; tick **exact times** to switch both pickers to
  datetime precision.
- **Summaries** — every digest ever made.
- **Starred** — your ⭐ archive.
- **Topics & Schedules** — topic profile and per-group digest times.

### ✅ Checkpoint — citations resolve to the exact message

In **Summaries**, on any digest:

1. Click a **`[n]`** → a modal opens showing the surrounding conversation, with the cited
   message outlined. That's the citation resolving to a specific message.
2. Note the **`↗`** right after it — that's the WhatsApp Web jump, tested in step 8.

Also verify the preset flow: clicking **Yesterday** should produce a digest whose header
range is yesterday's date, not today's.

## 8. Install and test the Chrome extension

This is what makes a citation land on the **exact** message in WhatsApp Web.

**Install (once):**

1. Chrome/Edge/Brave → `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. **Load unpacked** → select the **`extension/` folder itself** — the folder *containing*
   `manifest.json`, not the repo root and not the file. This is the #1 install mistake.
4. Be logged in at https://web.whatsapp.com

It requests access to `web.whatsapp.com` only.

### ✅ Checkpoint 1 — it's alive

A toolbar icon appears. If Chrome collapsed it, click the 🧩 puzzle piece and **pin** it.
Click the icon: the popup tells you whether the current tab is WhatsApp Web, and shows the
result of the last jump.

### ✅ Checkpoint 2 — a real jump

1. Open https://web.whatsapp.com in a tab and let it load fully.
2. In the dashboard → **Summaries**, click the **`↗`** beside any citation.
3. WhatsApp Web should switch to the right chat, land on the cited message, and **flash a
   green outline** around it. A toast reports progress while it searches.

Then click the extension icon and read **Last jump**. It reports which strategy won:

| `via` | Meaning |
|---|---|
| `dom` | the message was already on screen — instant |
| `search` | found through WhatsApp's own search — works for messages far back in history |
| `scroll` | found by lazy-loading older history upwards |
| `nearest` | exact id wasn't in the page, so the message at the same time/sender/text was highlighted — the content is still the cited one |

Any of those four is a success. An error tells you what failed and why.

### ✅ Checkpoint 3 — no duplicate tab

With WhatsApp Web **already open**, click a `↗`. The jump should happen in that existing tab
— you should *not* end up with a second tab stuck on "WhatsApp is open in another window".

> Upgrading from an older version? Hit **Reload** on the extension card in
> `chrome://extensions`, **and** reload your WhatsApp Web tab once so it picks up the new
> content script.

You can also test without a digest: the popup's **"Test it"** box accepts a chat name plus a
message id, or a pasted "Open in WhatsApp Web ↗" link copied from the dashboard.

## 9. Read digests on your phone, with tappable citations

Two settings in your config file:

```
DASHBOARD_HOST=0.0.0.0
PUBLIC_URL=http://<your-laptop-ip>:8790
```

Find your IP with `ipconfig getifaddr en0` (macOS Wi-Fi). Then **restart the app** —
configuration is only read at startup.

### ✅ Checkpoint

1. From your phone's browser, open `http://<your-laptop-ip>:8790` — the dashboard loads.
2. Run a fresh `/sum #1 today`. Each `[n]` in the `_Refs:_` footer now ends with a
   `…/m/<id>` link.
3. Tap one on your phone → the dashboard opens with that message's context already showing.

> ⚠️ The dashboard is **unauthenticated by design**. `0.0.0.0` exposes it to everyone on your
> network — only do this on your own trusted Wi-Fi. Leave both settings unset to keep it
> localhost-only (digests then simply carry no links). Your IP changes when you switch
> networks, so `PUBLIC_URL` needs updating if you move.

## 10. Test the remaining features

**Topic profile** — a section in every digest just for what you care about:

```
/topics set tech talks, AI tools, event updates
/topics
/sum #1 today
```

✅ The digest should now end with a `🎯 Your topics` section — containing only matching items,
or "nothing this time". Clear it with `/topics clear`.

**⭐ Star-to-archive** — survives the group being cleared or deleted:

1. React with ⭐ (also 🌟 ✨ 💫) to any message in any chat, from your phone.
2. ✅ It appears in the dashboard's **Starred** tab within seconds. Images render inline;
   other media gets a download link. Verify with
   `sqlite3 -readonly data/app.db "select count(*) from starred_archive;"`
3. Remove the reaction → it disappears from the archive.

**Scheduled daily digest** — testable in under two minutes:

1. Pick a time **2 minutes in the future** today, e.g. if it's 14:30, use `14:32`:
   ```
   /schedule #1 14:32
   ```
2. ✅ Wait. The scheduler checks every 30 seconds, so the digest arrives within ~30s of
   14:32, titled `⏰ Daily digest — <group>`.
3. `/schedule list` shows it; `/schedule #1 off` removes it.

Two behaviours worth knowing: a time **already past today** waits until tomorrow rather than
firing immediately, and if the app was busy or restarting at the scheduled minute it still
fires when it next gets a chance — it won't silently skip the day, and it won't send twice.

**Saved history:**

```
/saved          → recent digests with their #ids
/saved 10
```

✅ Every `/sum` is saved automatically; the dashboard's **Summaries** tab has the full text.

## 11. Run the test suite

Nothing here touches WhatsApp or spends API credits — the tests use a temporary database and
a fake LLM.

```bash
npm test          # 64 unit + integration tests
npm run typecheck # strict TS
npm run build     # compile to dist/
```

✅ Expect `pass 64`, `fail 0`, and no compiler output.

Coverage: the whole date-window grammar, command parsing, message extraction, chunking,
config loading/validation, scheduler due-and-fired logic, and the summarizer end to end
against a temp DB.

## 12. Keep it running

Recording only happens while the process is alive, so for real use:

```bash
npm run build
npx pm2 start dist/index.js --name wa-summarizer
```

A Raspberry Pi, small VPS or always-on laptop all work. For free 24/7 hosting on Oracle
Cloud's Always Free tier, see [DEPLOY.md](./DEPLOY.md).

> **One hard rule:** the WhatsApp session in `auth/` must only ever run in **one place at a
> time**. Running it on your laptop and a server simultaneously will break the pairing.

## Starting over

```bash
# unlink and re-pair (also unlink the device from your phone)
rm -rf auth/

# wipe everything recorded — INCLUDING your ⭐ archive and saved digests
rm -rf data/
```

## When something's wrong

| Symptom | First thing to check |
|---|---|
| `401 Incorrect API key provided` but the key looks right | **Restart the app.** Config is read once at startup, so a running process keeps the key it booted with. Then `npm run check-env`. |
| No QR, log loops with `statusCode: 405` | Stale WhatsApp-Web version — see step 2 |
| No QR, no 405 | `rm -rf auth/` and restart |
| `logged out by WhatsApp` | Device was unlinked — `rm -rf auth/` and re-pair |
| Group shows no messages | It only records while running; it can't see what it missed |
| `no group matching …` | Use the `#n` index from `/groups` |
| Extension does nothing | Open the popup, read **Last jump** — it names the failure |
| Jump reports `via nearest` | Not a failure; exact id wasn't in the page but the right message was highlighted |
| Ollama errors | `ollama serve` running, and `ollama pull llama3.1:8b` done |

Full troubleshooting, all config variables, and the extension's internals:
[README.md](./README.md).
