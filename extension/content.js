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
// WhatsApp Web has no stable public selectors — the ones used here are the
// most durable known (data-tab for search, data-id on message rows, #main /
// #pane-side landmarks). If WhatsApp changes its DOM, update SELECTORS below.

'use strict';

(() => {
  const HASH_PREFIX = '#wasum=';

  const SELECTORS = {
    appReady: '#pane-side',
    searchBox: 'div[contenteditable="true"][data-tab="3"]',
    sidebarTitles: '#pane-side span[title]',
    chatHeaderTitle: '#main header span[title]',
    messageRow: '#main [data-id]',
  };

  const MAX_SCROLL_ATTEMPTS = 100;
  const SCROLL_SETTLE_MS = 700;

  let running = false;

  window.addEventListener('hashchange', () => void run());
  void run();

  async function run() {
    const target = parseTarget();
    if (!target || running) return;
    running = true;
    try {
      toast('WA Summarizer: loading WhatsApp Web…');
      await waitFor(() => document.querySelector(SELECTORS.appReady), 60_000);

      // Already visible in the current chat? Done.
      if (jumpIfPresent(target.id)) return finish('Message found ✓');

      toast(`Opening "${target.name}"…`);
      const opened = await openChat(target.name);
      if (!opened) return finish(`Couldn't find a chat named "${target.name}".`, true);

      for (let attempt = 1; attempt <= MAX_SCROLL_ATTEMPTS; attempt++) {
        if (jumpIfPresent(target.id)) return finish('Message found ✓');
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
            return finish(
              'Reached the top of the loaded history without finding the message — it may be deleted or older than WhatsApp Web keeps.',
              true
            );
          }
        } else {
          pane.scrollTop = 0;
          await sleep(SCROLL_SETTLE_MS);
        }
        toast(`Searching older messages… (${attempt}/${MAX_SCROLL_ATTEMPTS})`);
      }
      finish('Gave up searching — the message is too far back.', true);
    } catch (err) {
      finish(`WA Summarizer error: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      running = false;
      // Clear the hash so a manual reload doesn't re-trigger the search.
      history.replaceState(null, '', location.pathname);
    }
  }

  /** @returns {{jid: string, id: string, name: string} | null} */
  function parseTarget() {
    if (!location.hash.startsWith(HASH_PREFIX)) return null;
    try {
      const decoded = JSON.parse(decodeURIComponent(location.hash.slice(HASH_PREFIX.length)));
      if (typeof decoded.id === 'string' && typeof decoded.name === 'string') {
        return { jid: String(decoded.jid ?? ''), id: decoded.id, name: decoded.name };
      }
    } catch {
      /* malformed hash — ignore */
    }
    return null;
  }

  /** Scrolls to + highlights the message if it is in the DOM. */
  function jumpIfPresent(messageId) {
    const row = document.querySelector(`#main [data-id*="${CSS.escape(messageId)}"]`);
    if (!row) return false;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('wasum-flash');
    setTimeout(() => row.classList.add('wasum-fade'), 2500);
    setTimeout(() => row.classList.remove('wasum-flash', 'wasum-fade'), 5000);
    return true;
  }

  /** Opens a chat by title, via the sidebar search. */
  async function openChat(name) {
    if (currentChatTitle() === name) return true;

    const search = document.querySelector(SELECTORS.searchBox);
    if (!search) throw new Error('search box not found (WhatsApp Web DOM changed?)');
    search.focus();
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, name);

    // Wait for a sidebar entry whose title matches (exact first, then contains).
    const entry = await waitFor(() => {
      const titles = [...document.querySelectorAll(SELECTORS.sidebarTitles)];
      return (
        titles.find((s) => s.getAttribute('title') === name) ??
        titles.find((s) => (s.getAttribute('title') ?? '').includes(name)) ??
        null
      );
    }, 8_000).catch(() => null);
    if (!entry) return false;

    click(entry);
    await waitFor(() => currentChatTitle() !== null, 8_000).catch(() => null);
    // Clear the search field so the sidebar returns to the chat list.
    search.focus();
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    await sleep(300);
    return true;
  }

  function currentChatTitle() {
    const el = document.querySelector(SELECTORS.chatHeaderTitle);
    return el ? el.getAttribute('title') : null;
  }

  /** The scrollable ancestor of the message rows (found structurally, not by class). */
  function findScrollContainer() {
    const row = document.querySelector(SELECTORS.messageRow);
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
    let el = document.getElementById('wasum-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wasum-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.toggle('wasum-error', isError);
  }

  function finish(text, isError = false) {
    toast(text, isError);
    setTimeout(() => document.getElementById('wasum-toast')?.remove(), isError ? 8000 : 3500);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Polls `probe` until it returns a truthy value or times out. */
  function waitFor(probe, timeoutMs) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const value = probe();
        if (value) return resolve(value);
        if (Date.now() - started > timeoutMs) return reject(new Error('timed out'));
        setTimeout(tick, 250);
      };
      tick();
    });
  }
})();
