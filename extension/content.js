// WA Summarizer — Jump to Message (content script, plain JS, no build step).
//
// The dashboard (and the background worker) hand this script a target:
//   { jid, id, name, ts, text, sender }
// `id` is the WhatsApp message id — the same value that appears inside a
// message row's `data-id` on web.whatsapp.com.
//
// Locating strategy, in order — each step is more expensive and less exact than
// the last, and the one that succeeded is reported back to the popup:
//   1. "dom"      — the row is already rendered: scroll to it.
//   2. "search"   — drive WhatsApp's own search with the message text. When WA
//                   jumps to a hit it does the scrolling *and* the highlight
//                   itself, and it can reach messages far outside the loaded
//                   window. This is the step that makes citations land on the
//                   exact message instead of "somewhere near it".
//   3. "scroll"   — lazy-load older messages upwards, stopping early once the
//                   loaded history is already older than the target timestamp.
//   4. "nearest"  — no id match, but a row with the same timestamp + sender +
//                   text is there: highlight it and say the match was
//                   approximate rather than reporting failure.
//
// WhatsApp Web has no stable public selectors, so every lookup tries a LIST of
// candidates. When jumping breaks, SELECTORS is the first place to look.
//
// Runs at document_start so the incoming #wasum hash is captured before
// WhatsApp's own router can rewrite or clear it; all DOM work waits for <body>.

'use strict';

(() => {
  const HASH_PREFIX = '#wasum=';

  /** Captured immediately: WhatsApp's SPA router may clear the hash on boot. */
  const INITIAL_HASH = location.hash;

  const SELECTORS = {
    appReady: ['#pane-side', '#side', 'div[data-testid="chat-list"]'],
    // Login screen (QR) — present instead of the chat list when not paired.
    loginQr: ['canvas[aria-label*="scan" i]', 'div[data-ref]', 'canvas[role="img"]'],
    // WhatsApp has shipped several shapes for the search field (contenteditable
    // with data-tab="3", a Lexical editor, and a plain <input>), and the
    // data-tab number has changed between builds. Ordered most- to
    // least-specific; `findSearchBox` adds a structural fallback after these.
    searchBox: [
      'div[contenteditable="true"][data-tab="3"]',
      'div[role="textbox"][data-tab="3"]',
      'div[contenteditable="true"][data-lexical-editor="true"]',
      '#side div[contenteditable="true"]',
      '#side input[type="text"]',
      'div[title="Search input textbox"]',
      '[aria-label="Search input textbox"]',
      '#side [aria-label*="Search" i]',
      '[data-testid="chat-list-search"]',
    ],
    /** Collapsed builds need the search revealed before the field exists. */
    searchTrigger: [
      'button[aria-label*="Search" i]',
      '#side [data-icon="search"]',
      '#side [data-icon="search-refreshed"]',
      'span[data-icon="search"]',
    ],
    /** Root of the chat-list pane; the structural search fallback looks inside it. */
    sidePane: ['#pane-side', '#side'],
    sidebarTitles: ['#pane-side span[title]', '#side span[title]'],
    /** Rows in the sidebar/search results list — a chat hit or a message hit. */
    sidebarRows: [
      '#pane-side div[role="listitem"]',
      '#pane-side div[role="row"]',
      '#side div[role="listitem"]',
    ],
    // Several of these match at once; `currentChatTitles` reads them ALL,
    // because the chat name is not reliably the first one in the header.
    chatHeaderTitle: [
      '#main header span[title]',
      '#main header [data-testid="conversation-info-header-chat-title"]',
      '#main header h1, #main header h2',
      '#main header div[role="button"] span',
    ],
    messageRow: ['#main div[data-id]', '#main [data-id]'],
    /** Carries "[HH:MM, DD/MM/YYYY] Sender: " — our only per-row timestamp. */
    rowMeta: ['[data-pre-plain-text]'],
  };

  const MAX_SCROLL_ATTEMPTS = 60;
  const SCROLL_SETTLE_MS = 700;
  const APP_READY_TIMEOUT_MS = 90_000;
  /** A row this close to the target's timestamp is treated as the same minute. */
  const TIME_MATCH_TOLERANCE_MS = 90_000;

  /** Incremented per run so a superseded run aborts instead of fighting the new one. */
  let generation = 0;

  window.addEventListener('hashchange', () => void run(parseTarget(location.hash)));

  // The background worker reuses an already-open WhatsApp tab and delivers the
  // target here, instead of opening a second tab that WhatsApp would park on
  // "WhatsApp is open in another window".
  chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'wasum-jump' && message.target) {
      void run(message.target);
      sendResponse({ accepted: true });
    }
    return false;
  });

  void run(parseTarget(INITIAL_HASH));

  async function run(target) {
    if (!target) return;

    const myGeneration = ++generation;
    const superseded = () => generation !== myGeneration;

    // Clear the hash up-front: a superseded/reloaded run must not re-trigger.
    stripHash();

    try {
      await waitForBody();
      toast('WA Summarizer: waiting for WhatsApp Web…');

      const ready = await waitFor(() => pick(SELECTORS.appReady), APP_READY_TIMEOUT_MS).catch(
        () => null
      );
      if (superseded()) return;
      if (!ready) {
        if (pick(SELECTORS.loginQr)) {
          return await finish(target, 'Not logged in to WhatsApp Web — scan the QR, then click the citation again.', true);
        }
        return await finish(
          target,
          'WhatsApp Web did not finish loading (is it open in another tab? click "Use Here" there).',
          true
        );
      }

      // 1. Already rendered in the current chat.
      if (jumpIfPresent(target.id)) return await finish(target, 'Message found ✓', false, 'dom');

      toast(`Opening "${target.name}"…`);
      const opened = await openChat(target, superseded);
      if (superseded()) return;
      if (opened !== true) {
        return await finish(target, opened || `Couldn't find a chat named "${target.name}".`, true);
      }
      if (jumpIfPresent(target.id)) return await finish(target, 'Message found ✓', false, 'dom');

      // 2. WhatsApp's own search — exact, and not limited to loaded history.
      if (target.text) {
        toast('Searching WhatsApp for the message…');
        const viaSearch = await jumpViaSearch(target, superseded);
        if (superseded()) return;
        if (viaSearch) return await finish(target, 'Message found via WhatsApp search ✓', false, 'search');
      }

      // 3. Scroll the conversation upwards until the row appears.
      const scrolled = await jumpViaScrolling(target, superseded);
      if (superseded()) return;
      if (scrolled === true) return await finish(target, 'Message found ✓', false, 'scroll');

      // 4. Same minute, same sender, same text — good enough to show the reader.
      const nearest = findApproximateRow(target);
      if (nearest) {
        highlight(nearest);
        return await finish(
          target,
          'Exact message id not in view — highlighted the matching message at the same time.',
          false,
          'nearest'
        );
      }
      return await finish(target, scrolled || 'Could not locate the message.', true);
    } catch (err) {
      if (superseded()) return;
      await finish(target, `WA Summarizer error: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  /** First element matching any candidate selector, or null. */
  function pick(candidates) {
    for (const selector of candidates) {
      const el = queryAll(selector)[0];
      if (el) return el;
    }
    return null;
  }

  /**
   * Every element matching the FIRST candidate that matches anything.
   * The old code used `candidates[0]` directly, which quietly defeated the whole
   * point of keeping fallback selectors.
   */
  function pickAll(candidates) {
    for (const selector of candidates) {
      const all = queryAll(selector);
      if (all.length) return all;
    }
    return [];
  }

  function queryAll(selector, root = document) {
    try {
      return [...root.querySelectorAll(selector)];
    } catch {
      return []; // unsupported selector syntax (e.g. old Chrome + the `i` flag)
    }
  }

  /** @returns {{jid,id,name,ts,text,sender}|null} */
  function parseTarget(hash) {
    if (typeof hash !== 'string' || !hash.startsWith(HASH_PREFIX)) return null;
    try {
      return normalizeTarget(JSON.parse(decodeURIComponent(hash.slice(HASH_PREFIX.length))));
    } catch {
      return null; // malformed hash — ignore
    }
  }

  function normalizeTarget(decoded) {
    if (!decoded || typeof decoded.id !== 'string' || typeof decoded.name !== 'string') return null;
    return {
      jid: String(decoded.jid ?? ''),
      id: decoded.id,
      name: decoded.name,
      ts: Number(decoded.ts) || 0,
      text: typeof decoded.text === 'string' ? decoded.text : '',
      sender: typeof decoded.sender === 'string' ? decoded.sender : '',
    };
  }

  function stripHash() {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }

  /** All rendered message rows in the open conversation. */
  function messageRows() {
    return pickAll(SELECTORS.messageRow);
  }

  /**
   * Scrolls to + highlights the message if it is in the DOM.
   * Matches on the id *segment* of data-id (`false_<jid>_<id>[_<participant>]`)
   * rather than a loose substring, so a short id can't match inside another.
   */
  function jumpIfPresent(messageId) {
    const row = messageRows().find((node) => rowMatchesId(node, messageId));
    if (!row) return false;
    highlight(row);
    return true;
  }

  function rowMatchesId(node, messageId) {
    const dataId = node.getAttribute('data-id') ?? '';
    return dataId.split('_').includes(messageId) || dataId === messageId;
  }

  function highlight(row) {
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('wasum-flash');
    setTimeout(() => row.classList.add('wasum-fade'), 2500);
    setTimeout(() => row.classList.remove('wasum-flash', 'wasum-fade'), 5000);
  }

  /**
   * Opens a chat. Prefers an exact title match, then a normalized one (WhatsApp
   * renders emoji in titles as <img>, so `textContent` and the stored group name
   * can differ by invisible characters).
   * @returns {Promise<true|string|null>} true, or a failure reason (null = "no such chat").
   */
  async function openChat(target, superseded) {
    const name = target.name;
    if (inChat(name)) return true;

    // 1. Already in the visible chat list? Click it directly. This needs no
    //    search box at all, so a stale search selector no longer blocks every
    //    jump — which is what "could not find the search box" used to do.
    let entry = sidebarEntryFor(name);
    let search = null;

    if (!entry) {
      // 2. Otherwise drive the search field to surface it.
      search = await findSearchBox();
      if (!search) {
        return (
          'Could not find the WhatsApp Web search box, and "' + name + '" is not in the ' +
          'visible chat list. Open that chat once (or scroll to it in the sidebar) and click ' +
          'the citation again. If this keeps happening, WhatsApp changed its DOM — add a ' +
          'selector to SELECTORS.searchBox in content.js.'
        );
      }
      if (!setSearchText(search, name)) {
        return 'Could not type into the WhatsApp Web search box (its editor changed).';
      }
      entry = await waitFor(() => sidebarEntryFor(name), 8_000).catch(() => null);
    }

    if (superseded()) return true;
    if (!entry) {
      if (search) clearSearchText(search);
      return null; // caller reports "couldn't find a chat named X"
    }

    // Remember the header before clicking, so "it changed" is usable evidence.
    // Waiting merely for "a chat is open" was already true for the PREVIOUS chat
    // and resolved instantly, which sent the script scrolling the wrong
    // conversation; requiring an exact title match was the opposite failure,
    // reporting "never opened" for chats that had opened fine.
    const before = currentChatTitles().join('|');
    click(entry);

    const switched = await waitFor(() => {
      if (inChat(name)) return 'title';
      const now = currentChatTitles().join('|');
      if (now && now !== before && messageRows().length > 0) return 'changed';
      return null;
    }, 8_000).catch(() => null);

    if (search) clearSearchText(search);
    await sleep(300);

    // A changed-but-unmatched header is treated as success on purpose: locating
    // the message is the real test, and a wrong chat simply won't contain it.
    if (!switched && !inChat(name) && messageRows().length === 0) {
      return `Clicked "${name}" in the sidebar but no conversation opened.`;
    }
    return true;
  }

  /** A sidebar chat entry whose title matches `name`, exact match preferred. */
  function sidebarEntryFor(name) {
    const titles = pickAll(SELECTORS.sidebarTitles);
    return (
      titles.find((s) => (s.getAttribute('title') ?? '') === name) ??
      titles.find((s) => titleMatches(s.getAttribute('title'), name)) ??
      null
    );
  }

  /**
   * Locate the search field, revealing it first if the build keeps it collapsed.
   *
   * Beyond the selector list this falls back to a STRUCTURAL scan of the side
   * pane for anything editable, because the exact attributes WhatsApp puts on
   * that field keep changing and a hardcoded list goes stale silently.
   */
  async function findSearchBox() {
    const direct = pick(SELECTORS.searchBox);
    if (direct && isVisible(direct)) return direct;

    // Some builds only mount the field after the search affordance is clicked.
    const trigger = pick(SELECTORS.searchTrigger);
    if (trigger) {
      click(trigger);
      const revealed = await waitFor(() => {
        const el = pick(SELECTORS.searchBox) ?? scanForEditable();
        return el && isVisible(el) ? el : null;
      }, 2_500).catch(() => null);
      if (revealed) return revealed;
    }

    const scanned = scanForEditable();
    return scanned && isVisible(scanned) ? scanned : null;
  }

  /** Any visible editable field inside the chat-list pane, best candidate first. */
  function scanForEditable() {
    const pane = pick(SELECTORS.sidePane) ?? document.body;
    const candidates = [
      ...queryAll('[contenteditable="true"]', pane),
      ...queryAll('input:not([type="hidden"]):not([type="checkbox"])', pane),
    ].filter(isVisible);
    // Prefer one that advertises itself as search in any of the usual places.
    const labelled = candidates.find((el) =>
      ['aria-label', 'title', 'placeholder', 'aria-placeholder'].some((attr) =>
        /search/i.test(el.getAttribute(attr) ?? '')
      )
    );
    return labelled ?? candidates[0] ?? null;
  }

  function isVisible(el) {
    if (!el || !el.getClientRects) return false;
    return el.getClientRects().length > 0;
  }

  /**
   * Drives WhatsApp's own search with the message text and clicks the message
   * hit belonging to the target chat. WhatsApp then jumps to that exact message
   * itself — including messages far older than the loaded window.
   * @returns {Promise<boolean>} whether the target row ended up on screen.
   */
  async function jumpViaSearch(target, superseded) {
    const search = await findSearchBox();
    if (!search) return false;
    // WhatsApp's search is literal; a trimmed phrase matches more reliably than
    // a long snippet that may have been cut mid-word.
    const query = searchQuery(target.text);
    if (!query) return false;
    if (!setSearchText(search, query)) return false;

    const hit = await waitFor(() => findSearchHit(query, target), 8_000).catch(() => null);
    if (superseded() || !hit) {
      clearSearchText(search);
      return false;
    }

    click(hit);
    clearSearchText(search);

    // WhatsApp scrolls to the hit itself; confirm by id, and accept a
    // same-minute match when the id is absent (e.g. a forwarded copy).
    const landed = await waitFor(() => {
      if (jumpIfPresent(target.id)) return 'exact';
      return findApproximateRow(target) ? 'near' : null;
    }, 6_000).catch(() => null);

    if (landed === 'near') {
      const row = findApproximateRow(target);
      if (row) highlight(row);
    }
    return landed !== null;
  }

  /** Longest whitespace-safe prefix of the snippet, capped so WA still matches it. */
  function searchQuery(text) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length < 3) return '';
    if (clean.length <= 48) return clean;
    const cut = clean.slice(0, 48);
    const lastSpace = cut.lastIndexOf(' ');
    return lastSpace > 12 ? cut.slice(0, lastSpace) : cut;
  }

  /** A search-result row that is a message hit in the target chat. */
  function findSearchHit(query, target) {
    const needle = normalize(query);
    const rows = pickAll(SELECTORS.sidebarRows);
    const inChat = rows.filter((row) => {
      const text = normalize(row.textContent ?? '');
      return text.includes(needle) && text.includes(normalize(target.name));
    });
    // Prefer a row that also shows the sender, when we know it.
    const bySender = target.sender
      ? inChat.find((row) => normalize(row.textContent ?? '').includes(normalize(target.sender)))
      : null;
    return bySender ?? inChat[0] ?? null;
  }

  /**
   * Lazy-loads older messages until the row appears.
   * Stops early once the oldest loaded message predates the target — scrolling
   * further can only move away from it.
   * @returns {Promise<true|string>} true, or a human-readable reason it stopped.
   */
  async function jumpViaScrolling(target, superseded) {
    for (let attempt = 1; attempt <= MAX_SCROLL_ATTEMPTS; attempt++) {
      if (superseded()) return 'superseded';
      if (jumpIfPresent(target.id)) return true;

      const pane = findScrollContainer();
      if (!pane) {
        await sleep(SCROLL_SETTLE_MS);
        continue;
      }

      if (target.ts && oldestLoadedTs() && oldestLoadedTs() < target.ts - TIME_MATCH_TOLERANCE_MS) {
        return 'Scrolled past the message’s date without finding it — it may have been deleted.';
      }

      if (pane.scrollTop === 0) {
        // Give lazy-loading a chance; if nothing new arrives we are at the top.
        const before = pane.scrollHeight;
        await sleep(SCROLL_SETTLE_MS * 2);
        if (pane.scrollHeight === before && !jumpIfPresent(target.id)) {
          return 'Reached the top of the loaded history without finding the message — it may be deleted, or older than WhatsApp Web keeps.';
        }
      } else {
        pane.scrollTop = 0;
        await sleep(SCROLL_SETTLE_MS);
      }
      toast(`Searching older messages… (${attempt}/${MAX_SCROLL_ATTEMPTS})`);
    }
    return 'Gave up searching — the message is too far back.';
  }

  /**
   * A rendered row whose timestamp (and, when known, sender and text) matches
   * the target. Used when the id is not in the DOM, so the reader still lands on
   * the right message rather than on an error.
   */
  function findApproximateRow(target) {
    if (!target.ts) return null;
    const needle = normalize(target.text).slice(0, 40);
    let best = null;
    let bestDelta = TIME_MATCH_TOLERANCE_MS;

    for (const row of messageRows()) {
      const ts = rowTimestamp(row);
      if (ts === null) continue;
      const delta = Math.abs(ts - target.ts);
      if (delta > bestDelta) continue;
      if (needle && !normalize(row.textContent ?? '').includes(needle)) continue;
      best = row;
      bestDelta = delta;
    }
    return best;
  }

  /** Unix ms of a rendered row, read from `data-pre-plain-text` ("[14:32, 01/07/2026] A: "). */
  function rowTimestamp(row) {
    const meta = row.matches('[data-pre-plain-text]')
      ? row
      : row.querySelector(SELECTORS.rowMeta[0]);
    const raw = meta?.getAttribute('data-pre-plain-text') ?? '';
    const match = /\[(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?,\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\]/i.exec(raw);
    if (!match) return null;
    let hours = Number(match[1]);
    const meridiem = match[4]?.toLowerCase();
    if (meridiem === 'pm' && hours !== 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    const year = Number(match[7]) < 100 ? 2000 + Number(match[7]) : Number(match[7]);
    // WhatsApp renders day/month in the locale order; day-first is by far the
    // most common, and a swapped pair still lands inside the same day.
    return new Date(year, Number(match[6]) - 1, Number(match[5]), hours, Number(match[2]), Number(match[3] ?? 0)).getTime();
  }

  /** Timestamp of the oldest currently-rendered message, or null. */
  function oldestLoadedTs() {
    for (const row of messageRows()) {
      const ts = rowTimestamp(row);
      if (ts !== null) return ts;
    }
    return null;
  }

  /**
   * Types into WhatsApp's contenteditable search box.
   * execCommand is deprecated and silently returns false on some editors, so
   * check it and fall back to a synthetic beforeinput/input pair, which the
   * React/Lexical-based editor also accepts.
   */
  function setSearchText(box, text) {
    box.focus();
    // A real <input> needs its value set through the native setter, otherwise
    // React's synthetic onChange never fires and WhatsApp ignores the text.
    if (box.tagName === 'INPUT' || box.tagName === 'TEXTAREA') {
      return setNativeValue(box, text) && box.value === text;
    }
    try {
      document.execCommand('selectAll', false);
      if (document.execCommand('insertText', false, text)) return true;
    } catch {
      /* fall through to the synthetic path */
    }
    try {
      box.dispatchEvent(
        new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text })
      );
      // Some builds only read textContent; set it before firing `input`.
      if (!box.textContent) box.textContent = text;
      box.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })
      );
      return (box.textContent ?? '').includes(text);
    } catch {
      return false;
    }
  }

  /**
   * Set an <input>/<textarea> value the way React notices: assign through the
   * prototype's native setter (React patches the instance property to track
   * changes), then dispatch `input`.
   */
  function setNativeValue(el, value) {
    try {
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }

  function clearSearchText(box) {
    box.focus();
    if (box.tagName === 'INPUT' || box.tagName === 'TEXTAREA') {
      setNativeValue(box, '');
      return;
    }
    try {
      document.execCommand('selectAll', false);
      if (document.execCommand('delete', false)) return;
    } catch {
      /* ignore */
    }
    box.textContent = '';
    box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  }

  /**
   * Every title-ish string in the open conversation's header.
   *
   * Returns a LIST, not the first hit: WhatsApp's header holds several
   * `span[title]` elements — the chat name, the participant list, the online
   * status — in an order that is not stable. Reading only the first one meant
   * comparing the group name against the participant list and concluding the
   * chat had not opened when it plainly had.
   */
  function currentChatTitles() {
    return pickAll(SELECTORS.chatHeaderTitle)
      .map((el) => el.getAttribute('title') ?? el.textContent ?? '')
      .filter(Boolean);
  }

  /** Best guess at the open chat's name, for messages shown to the user. */
  function currentChatTitle() {
    return currentChatTitles()[0] ?? null;
  }

  /** True when any header title corresponds to `name`. */
  function inChat(name) {
    return currentChatTitles().some((title) => titleMatches(title, name));
  }

  /** Titles compared with emoji/whitespace noise removed, either way round. */
  function titleMatches(title, name) {
    if (!title) return false;
    const a = normalize(title);
    const b = normalize(name);
    if (!a || !b) return false;
    return a === b || a.includes(b) || b.includes(a);
  }

  /** Lowercase, collapse whitespace and drop zero-width/bidi marks WhatsApp injects. */
  function normalize(text) {
    return text
      .toLowerCase()
      .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** The scrollable ancestor of the message rows (found structurally, not by class). */
  function findScrollContainer() {
    const row = messageRows()[0];
    for (let el = row?.parentElement; el; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 50) return el;
    }
    return null;
  }

  /**
   * Synthesizes a full click. Pointer events are included because newer
   * WhatsApp builds listen for those and ignore bare mouse events.
   */
  function click(el) {
    const options = { bubbles: true, cancelable: true, view: window };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const Ctor = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(type, options));
    }
  }

  function toast(text, isError = false) {
    if (!document.body) return;
    let el = document.getElementById('wasum-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wasum-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.toggle('wasum-error', isError);
  }

  /** Shows the outcome and records it so the toolbar popup can display it. */
  async function finish(target, text, isError = false, via = '') {
    toast(text, isError);
    setTimeout(() => document.getElementById('wasum-toast')?.remove(), isError ? 8000 : 3500);
    try {
      await chrome.storage.local.set({
        lastJump: {
          at: Date.now(),
          chatName: target?.name ?? '',
          messageId: target?.id ?? '',
          message: text,
          ok: !isError,
          via,
        },
      });
    } catch {
      /* storage unavailable (extension reloaded mid-run) — the toast still showed */
    }
  }

  function waitForBody() {
    if (document.body) return Promise.resolve();
    return new Promise((resolve) => {
      if (document.readyState !== 'loading') return resolve();
      document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Polls `probe` until it returns a truthy value or times out. */
  function waitFor(probe, timeoutMs) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        let value = null;
        try {
          value = probe();
        } catch {
          value = null;
        }
        if (value) return resolve(value);
        if (Date.now() - started > timeoutMs) return reject(new Error('timed out'));
        setTimeout(tick, 250);
      };
      tick();
    });
  }
})();
