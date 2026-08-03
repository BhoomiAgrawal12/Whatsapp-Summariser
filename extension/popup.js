// Toolbar popup: shows whether the extension is live on WhatsApp Web, what the
// last jump did, and lets you trigger a jump by hand to test the whole path.
// (The content script itself needs no UI — this exists so the extension is
// visible and diagnosable instead of silently doing nothing.)

'use strict';

const HASH_PREFIX = '#wasum=';
const WA_ORIGIN = 'https://web.whatsapp.com/';
/** Matches DASHBOARD_PORT's default in src/config.ts. */
const DASHBOARD_URL = 'http://127.0.0.1:8790';

const $ = (id) => document.getElementById(id);

function jumpUrl(chatName, messageId) {
  const payload = encodeURIComponent(JSON.stringify({ jid: '', id: messageId, name: chatName }));
  return `${WA_ORIGIN}${HASH_PREFIX}${payload}`;
}

/** Pulls {name, id} back out of a dashboard "Open in WhatsApp Web" link. */
function parseLink(raw) {
  const at = raw.indexOf(HASH_PREFIX);
  if (at === -1) return null;
  try {
    const decoded = JSON.parse(decodeURIComponent(raw.slice(at + HASH_PREFIX.length)));
    if (typeof decoded.id === 'string' && typeof decoded.name === 'string') return decoded;
  } catch {
    /* not a usable link */
  }
  return null;
}

function showTabStatus(tab) {
  const el = $('tabStatus');
  const url = tab?.url ?? '';
  if (url.startsWith(WA_ORIGIN)) {
    el.textContent = 'Active on this WhatsApp Web tab — ready to jump.';
    el.className = 'pill ok';
  } else {
    el.textContent = 'Installed. Open web.whatsapp.com (or use "Test it" below) to jump.';
    el.className = 'pill warn';
  }
}

function showLastJump(lastJump) {
  if (!lastJump) return;
  const when = new Date(lastJump.at).toLocaleString();
  const el = $('lastJump');
  el.className = 'pill ' + (lastJump.ok ? 'ok' : 'warn');
  el.textContent = `${lastJump.ok ? '✓' : '✕'} ${lastJump.message}` +
    (lastJump.chatName ? ` — "${lastJump.chatName}"` : '') + ` · ${when}`;
}

async function main() {
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;
  $('dash').href = DASHBOARD_URL;
  $('dash').addEventListener('click', (e) => {
    e.preventDefault();
    void chrome.tabs.create({ url: DASHBOARD_URL });
  });
  $('waLink').addEventListener('click', (e) => {
    e.preventDefault();
    void chrome.tabs.create({ url: WA_ORIGIN });
  });

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    showTabStatus(tab);
  } catch {
    showTabStatus(null);
  }

  try {
    const { lastJump } = await chrome.storage.local.get('lastJump');
    showLastJump(lastJump);
  } catch {
    /* nothing recorded yet */
  }

  // Paste a full dashboard link -> split it into the two fields.
  $('link').addEventListener('input', () => {
    const parsed = parseLink($('link').value.trim());
    if (parsed) {
      $('chat').value = parsed.name;
      $('mid').value = parsed.id;
    }
  });

  $('go').addEventListener('click', async () => {
    const err = $('err');
    err.hidden = true;

    const pasted = parseLink($('link').value.trim());
    const chatName = pasted?.name ?? $('chat').value.trim();
    const messageId = pasted?.id ?? $('mid').value.trim();

    if (!chatName || !messageId) {
      err.textContent = 'Need both a chat name and a message id (or a full dashboard link).';
      err.hidden = false;
      return;
    }
    await chrome.tabs.create({ url: jumpUrl(chatName, messageId) });
    window.close();
  });
}

void main();
