// WA Summarizer — Jump to Message (content script, plain JS, no build step).
//
// The dashboard opens links like:
//   https://web.whatsapp.com/#wasum=<urlencoded JSON {"jid","id","name"}>
// where `id` is the WhatsApp message id and `name` the chat title.
//
// Strategy: wait for WhatsApp Web to load, open the target chat via the
// sidebar search, then repeatedly scroll the conversation up (which lazy-loads
// older messages) until a row whose data-id contains the message id appears,
// then scroll it into view and flash-highlight it.
//
// WhatsApp Web has no stable public selectors. Every lookup below therefore
// tries a LIST of candidates (most specific first) instead of a single string,
// so one DOM rename does not break the whole flow. If jumping stops working,
// SELECTORS is the first place to look.
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
    searchBox: [
      'div[contenteditable="true"][data-tab="3"]',
      'div[role="textbox"][data-tab="3"]',
      '#side div[contenteditable="true"]',
      'div[title="Search input textbox"]',
    ],
    sidebarTitles: ['#pane-side span[title]', '#side span[title]'],
    chatHeaderTitle: ['#main header span[title]', '#main header div[role="button"] span'],
    messageRow: ['#main [data-id]'],
  };

  const MAX_SCROLL_ATTEMPTS = 100;
  const SCROLL_SETTLE_MS = 700;
  const APP_READY_TIMEOUT_MS = 90_000;

  /** Incremented per run so a superseded run aborts instead of fighting the new one. */
  let generation = 0;

  window.addEventListener('hashchange', () => void run(location.hash));
  void run(INITIAL_HASH);

  async function run(hash) {
    const target = parseTarget(hash);
    if (!target) return;

    const myGeneration = ++generation;
    const superseded = () => generation !== myGeneration;

    // Clear the hash up-front: a superseded/reloaded run must not re-trigger,
    // and the old code did this only at the very end.
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
        return await finish(target, 'WhatsApp Web did not finish loading (is it open in another tab? click "Use Here" there).', true);
      }

      // Already visible in the current chat? Done.
      if (jumpIfPresent(target.id)) return await finish(target, 'Message found ✓');

      toast(`Opening "${target.name}"…`);
      const opened = await openChat(target.name, superseded);
      if (superseded()) return;
      if (opened !== true) {
        return await finish(target, opened || `Couldn't find a chat named "${target.name}".`, true);
      }

      for (let attempt = 1; attempt <= MAX_SCROLL_ATTEMPTS; attempt++) {
        if (superseded()) return;
        if (jumpIfPresent(target.id)) return await finish(target, 'Message found ✓');

        const pane = findScrollContainer();
        if (!pane) {
          await sleep(SCROLL_SETTLE_MS);
          continue;
        }
        if (pane.scrollTop === 0) {
          // Give lazy-loading a chance; if nothing new arrives we are at the top.
          const before = pane.scrollHeight;
          await sleep(SCROLL_SETTLE_MS * 2);
          if (pane.scrollHeight === before && !jumpIfPresent(target.id)) {
            return await finish(
              target,
              'Reached the top of the loaded history without finding the message — it may be deleted, or older than WhatsApp Web keeps.',
              true
            );
          }
        } else {
          pane.scrollTop = 0;
          await sleep(SCROLL_SETTLE_MS);
        }
        toast(`Searching older messages… (${attempt}/${MAX_SCROLL_ATTEMPTS})`);
      }
      await finish(target, 'Gave up searching — the message is too far back.', true);
    } catch (err) {
      if (superseded()) return;
      await finish(target, `WA Summarizer error: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  /** First element matching any candidate selector, or null. */
  function pick(candidates) {
    for (const selector of candidates) {
      let el = null;
      try {
        el = document.querySelector(selector);
      } catch {
        continue; // unsupported selector syntax (e.g. old Chrome + `i` flag)
      }
      if (el) return el;
    }
    return null;
  }

  /** @returns {{jid: string, id: string, name: string} | null} */
  function parseTarget(hash) {
    if (typeof hash !== 'string' || !hash.startsWith(HASH_PREFIX)) return null;
    try {
      const decoded = JSON.parse(decodeURIComponent(hash.slice(HASH_PREFIX.length)));
      if (typeof decoded.id === 'string' && typeof decoded.name === 'string') {
        return { jid: String(decoded.jid ?? ''), id: decoded.id, name: decoded.name };
      }
    } catch {
      /* malformed hash — ignore */
    }
    return null;
  }

  function stripHash() {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }

  /**
   * Scrolls to + highlights the message if it is in the DOM.
   * Matches by substring on data-id, which looks like
   * `false_<jid>_<messageId>[_<participant>]`. Plain string matching avoids
   * relying on CSS escaping of ids that often start with a digit.
   */
  function jumpIfPresent(messageId) {
    const row = [...document.querySelectorAll(SELECTORS.messageRow[0])].find((node) =>
      (node.getAttribute('data-id') ?? '').includes(messageId)
    );
    if (!row) return false;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('wasum-flash');
    setTimeout(() => row.classList.add('wasum-fade'), 2500);
    setTimeout(() => row.classList.remove('wasum-flash', 'wasum-fade'), 5000);
    return true;
  }

  /**
   * Opens a chat by title via the sidebar search.
   * @returns {Promise<true|string>} true, or a human-readable failure reason.
   */
  async function openChat(name, superseded) {
    if (currentChatTitle() === name) return true;

    const search = pick(SELECTORS.searchBox);
    if (!search) return 'Could not find the WhatsApp Web search box (its DOM changed) — update SELECTORS in content.js.';

    if (!setSearchText(search, name)) {
      return 'Could not type into the WhatsApp Web search box (its editor changed).';
    }

    // Wait for a sidebar entry whose title matches (exact first, then contains).
    const entry = await waitFor(() => {
      const titles = [...document.querySelectorAll(SELECTORS.sidebarTitles[0])];
      return (
        titles.find((s) => s.getAttribute('title') === name) ??
        titles.find((s) => (s.getAttribute('title') ?? '').includes(name)) ??
        null
      );
    }, 8_000).catch(() => null);
    if (superseded()) return true;
    if (!entry) return null; // caller reports "couldn't find a chat named X"

    click(entry);

    // Wait for the header to actually show the target chat. The previous version
    // waited for `currentChatTitle() !== null`, which was already true for the
    // PREVIOUS chat and so resolved instantly — the script then scrolled the
    // wrong conversation and blamed a missing message.
    const switched = await waitFor(() => {
      const title = currentChatTitle();
      return title !== null && (title === name || title.includes(name)) ? title : null;
    }, 10_000).catch(() => null);

    clearSearchText(search);
    await sleep(300);
    if (!switched) return `Clicked "${name}" in the sidebar but the conversation never opened.`;
    return true;
  }

  /**
   * Types into WhatsApp's contenteditable search box.
   * execCommand is deprecated and silently returns false on some editors, so
   * check it and fall back to a synthetic beforeinput/input pair, which the
   * React/Lexical-based editor also accepts.
   */
  function setSearchText(box, text) {
    box.focus();
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

  function clearSearchText(box) {
    box.focus();
    try {
      document.execCommand('selectAll', false);
      if (document.execCommand('delete', false)) return;
    } catch {
      /* ignore */
    }
    box.textContent = '';
    box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  }

  function currentChatTitle() {
    const el = pick(SELECTORS.chatHeaderTitle);
    if (!el) return null;
    return el.getAttribute('title') ?? el.textContent ?? null;
  }

  /** The scrollable ancestor of the message rows (found structurally, not by class). */
  function findScrollContainer() {
    const row = document.querySelector(SELECTORS.messageRow[0]);
    for (let el = row?.parentElement; el; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 50) return el;
    }
    return null;
  }

  function click(el) {
    for (const type of ['mousedown', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
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
  async function finish(target, text, isError = false) {
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
