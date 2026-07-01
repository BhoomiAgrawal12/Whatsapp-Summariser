# WhatsApp Group Summarizer — Complete Plan

A private, silent, per-user summarizer for busy WhatsApp groups (1000s of messages/day),
working across Android, iPhone, and laptop — without any visible bot in the group.

---

## 1. The Fundamental Constraint

WhatsApp has **no official API for personal accounts** and **no plugin system** in its
mobile apps. Everything in this space uses one of three approaches:

| Approach | How it works | Risk | Coverage |
|---|---|---|---|
| **A. Chrome extension on WhatsApp Web** | Reads the DOM of the official web client | ~Zero ban risk | Laptop only, only while browser is open |
| **B. Linked-device service (Baileys)** | App links as a "device" (like WhatsApp Web) via QR scan, receives all messages 24/7 | **ToS violation, real ban risk** — mitigated heavily by read-only usage | All chats, all the time |
| **C. Official WhatsApp Business Cloud API** | Meta-approved bot | Zero risk | Useless here — the bot must be a visible group member (the "Meta AI" experience we don't want) |

**Chosen: Approach B (Baileys linked-device service)** as the core, with Approach A
(extension) as an optional later add-on for exact jump-to-message on WhatsApp Web.

**Ban-risk mitigation:** the service is ~99% read-only, sends messages only to *yourself*
("Message Yourself" chat), and mimics a normal linked laptop. WhatsApp's ban signals
(mass outbound messaging, robotic sending patterns, messaging strangers) don't apply to
a read-only summarizer — but the risk is **not zero**. Use on a number you accept the
risk for; don't offer as a hosted service without disclosing this.

## 2. Can it run inside the WhatsApp app on Android/iPhone?

**No — on both platforms.** Apps are sandboxed; no extension/plugin mechanism exists.
**But it doesn't need to.** The linked-device service runs on a laptop/server/Raspberry Pi
24/7 and delivers summaries where every device can see them:

1. **Your "Message Yourself" chat** — summaries arrive as WhatsApp messages to your own
   number: visible on phone (Android + iPhone), tablet, and WhatsApp Web. Nobody in the
   group sees anything. The self-chat is also the *remote control*: send yourself
   `/sum <group> 2d` from your phone to trigger a summary.
2. **A private web dashboard (PWA)** — any browser, installable to home screen. Hosts the
   interactive features (date pickers, topic settings, starred archive, saved summaries).

So it *effectively* works on all phones and laptop — just not *inside* the WhatsApp
mobile UI (impossible for everyone, including competitors).

## 3. Market Analysis

- **WhatsApp's own Meta AI "Private Message Summaries"** — rolled out 2025 using Private
  Processing (TEE-based; genuinely private, group members do NOT see you summarized).
  Now testing multi-chat unread summaries. **Limitations:** unread messages only, no date
  ranges, no topic filters, no saving, no permanent archive, no model control.
- **Chrome extensions for WhatsApp Web:** GistGem (summaries + Q&A), WhatsApp Chat
  Summarizer, AI Chat Summarizer, open-source `summarizer-guy` (Gemini). **Limitations:**
  laptop-only, only messages loaded in the visible DOM (scrolling 1000s back is flaky),
  nothing persists, no phone delivery.
- **Manual:** export chat → paste into ChatGPT. Clunky, no automation.

**Our differentiators** (nothing on the market does all of these): 24/7 background
operation with phone delivery, date-range summaries over full recorded history, per-user
topic subscriptions, permanent message archive that survives chat clearing, saved
summaries with links back to context.

## 4. Feature Feasibility Verdict

| # | Feature | Verdict | Notes |
|---|---|---|---|
| 1 | Summarize 1000s of msgs/day per group | ✅ | Chunked map-reduce pipeline |
| 2 | Silent, no visible bot, per-user | ✅ | Linked device is invisible; never marks messages read |
| 3 | Auto-detect unread & summarize recent | ✅ | Per-chat catch-up marker: "summarize since I last caught up" |
| 4 | Summary from date/time X to Y | ✅ | All messages stored in own DB — arbitrary ranges |
| 5 | Works on Android + iPhone + laptop | ✅* | Via self-chat delivery + PWA dashboard, not inside the mobile WhatsApp UI (impossible) |
| 6 | Permanently star messages, survive chat clearing | ✅ | React ⭐ to any message → copied (incl. media) into our own DB |
| 7 | Save summaries | ✅ | Stored in DB, browsable/searchable in dashboard |
| 8 | Hyperlinks in summary to the exact message | ⚠️ Partial | WhatsApp has **no public per-message deep link** (`wa.me` opens a chat, not a message). We provide: dashboard links that expand full surrounding context inline; exact scroll-to-message is only possible via a future Chrome-extension add-on on WhatsApp Web |
| 9 | Per-user topic subscriptions, changeable anytime | ✅ | Interest profile applied in the summarization prompt; dedicated "your topics" section per digest |
| 10 | Multiple customers, each separate | ⚠️ | Each customer runs/links their own instance (own QR, own DB). Commercial multi-tenant SaaS needs legal/privacy framing + carries ban risk on customer numbers |

**Bottom line:** everything is buildable except "tap a link on the phone and WhatsApp
scrolls to that exact message" — a hard platform limit for all vendors.

## 5. Architecture

```
                       ┌─────────────────────────────────────────────┐
                       │         Node.js / TypeScript service         │
 WhatsApp servers ◄────┤  Baileys client (linked device, read-only)   │
   (QR-pair once)      │        │                                     │
                       │        ▼                                     │
                       │  Ingestion worker ──► SQLite DB              │
                       │   (normalize msgs)    • messages             │
                       │                       • chats                │
                       │                       • starred_archive      │
                       │                       • summaries            │
                       │                       • topic_profiles       │
                       │                       • settings/markers     │
                       │        ▼                                     │
                       │  Summarizer engine                           │
                       │   1. select window (catch-up / date range)   │
                       │   2. chunk ~150 msgs with overlap            │
                       │   3. map: per-chunk topic extraction         │
                       │   4. reduce: merge into final digest         │
                       │   5. topic-profile section per user          │
                       │        ▼                                     │
                       │  Delivery                                    │
                       │   ├─► "Message Yourself" WhatsApp chat       │
                       │   └─► Dashboard (HTTP + PWA)                 │
                       └─────────────────────────────────────────────┘
      Optional later: Chrome extension on web.whatsapp.com
      (adds exact jump-to-message from dashboard links)
```

**Language: TypeScript (Node.js).** The only maintained unofficial libraries (Baileys,
whatsapp-web.js) are Node; dashboard and future extension are JS anyway. One typed
language across every component.

**LLM strategy — hybrid, cost-optimized:**
- **Summarization: OpenAI small-tier model** (default `gpt-4o-mini`-class). 1,000 messages
  ≈ 25–40k tokens ≈ well under $0.01–0.02 per summary. 20 groups daily ≈ a few $/month.
- **Fully-local option: Ollama** (free, private, weaker) behind the same provider
  interface — switch with one env var. Also usable per-task.
- **Privacy note:** WhatsApp is E2E-encrypted; the linked device holds decrypted messages.
  Sending them to OpenAI moves them outside the E2E boundary. For personal use, your
  call; the Ollama mode keeps everything on-machine.

## 6. Build Phases

- **Phase 0 — POC (½ day):** Baileys setup, QR pairing, print incoming group messages,
  confirm messages stay unread on the phone. *Go/no-go gate.*
- **Phase 1 — Ingestion + storage (1–2 days):** normalize all group messages into SQLite;
  edits/deletes/replies/media; backfill from history sync; per-chat markers.
- **Phase 2 — Summarization engine (2–3 days):** chunked map-reduce; structured digests
  (topics → bullets → decisions/actions → notable quotes); window selectors (catch-up,
  last N hours/days, date range); provider abstraction OpenAI + Ollama.
- **Phase 3 — Delivery (1–2 days):** formatted digest to self-chat; self-chat command
  interface (`/sum`, `/unread`, `/groups`, `/topics`, …) — the phone becomes the remote.
- **Phase 4 — Differentiators (3–5 days):** dashboard PWA (date-range picker, saved
  summaries, message-context expansion, starred archive, topic editor); star-to-archive
  via ⭐ reaction; scheduled daily digests.
- **Phase 5 — Optional Chrome extension (2–3 days):** exact jump-to-message on
  WhatsApp Web from dashboard links.
- **Phase 6 — Multi-user hardening (only if productizing):** per-customer QR onboarding,
  isolated DBs, encryption at rest, disclosures.

## 7. Risks

1. **Account ban (Baileys)** — low probability for read-only + self-messaging, but real;
   Meta protocol updates can break the library for days until patched. Consider testing
   on a secondary number first.
2. **No per-message deep links on mobile** — platform limit; mitigated by inline context
   in the dashboard (+ optional extension on Web).
3. **History backfill is limited** — the linked device only receives what WhatsApp syncs
   (recent history); complete date-range coverage starts from the day the service starts
   recording.
4. **Meta is commoditizing basic unread summaries** inside WhatsApp — durable value here
   is date ranges, topics, permanent archive, and saved summaries.

## 8. Market/Reference Sources

- WhatsApp Private Message Summaries: https://blog.whatsapp.com/catch-up-on-conversations-with-private-message-summaries
- Private Processing: https://faq.whatsapp.com/2089630958184255 and whitepaper: https://ai.meta.com/static-resource/private-processing-technical-whitepaper
- Multi-chat unread summaries test: https://wabetainfo.com/whatsapp-is-testing-private-summaries-of-multiple-unread-chats/
- GistGem: https://www.gistgem.com/ · WhatsApp Chat Summarizer: https://chromewebstore.google.com/detail/whatsapp-chat-summarizer/cbpokicceodhdkbbmcbjncaokpdckpfk · summarizer-guy: https://github.com/PiyushDuggal-source/summarizer-guy
- Ban-risk analyses: https://blog.kraya-ai.com/whatsapp-automation-ban-risk · https://achiya-automation.com/en/blog/whatsapp-spam-detection-2026/
- Baileys docs: https://baileys.wiki/docs/intro/
