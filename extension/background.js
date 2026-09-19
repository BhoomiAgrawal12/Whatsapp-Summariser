// WA Summarizer — background service worker.
//
// Why this exists: a dashboard citation is a plain link to
// `https://web.whatsapp.com/#wasum=<payload>`, so the browser opens it in a NEW
// tab. If WhatsApp Web is already running in another tab, the new one parks on
// "WhatsApp is open in another window" and the content script waits forever for
// a chat list that never renders — the single most common reason jumping
// appeared to do nothing.
//
// So: watch for tabs navigating to a #wasum link, and if another WhatsApp Web
// tab already exists, hand the target to THAT tab and close the duplicate.

'use strict';

const HASH_PREFIX = '#wasum=';
const WA_PREFIX = 'https://web.whatsapp.com/';

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url ?? tab.url ?? '';
  if (!url.startsWith(WA_PREFIX) || !url.includes(HASH_PREFIX)) return;
  void redirectToExistingTab(tabId, url);
});

/**
 * If a WhatsApp Web tab other than `tabId` is already open, deliver the jump
 * target to it, focus it and close the duplicate. Otherwise leave the new tab
 * alone — its own content script will handle the hash.
 */
async function redirectToExistingTab(tabId, url) {
  const target = parseTarget(url);
  if (!target) return;

  const tabs = await chrome.tabs.query({ url: `${WA_PREFIX}*` });
  // Prefer the oldest other WhatsApp tab: that is the one holding the session.
  const existing = tabs
    .filter((t) => t.id !== undefined && t.id !== tabId)
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))[0];
  if (!existing?.id) return;

  try {
    const response = await chrome.tabs.sendMessage(existing.id, { type: 'wasum-jump', target });
    if (!response?.accepted) return; // old content script / not ready — keep the new tab
  } catch {
    return; // no content script listening there yet
  }

  await chrome.tabs.update(existing.id, { active: true });
  if (existing.windowId !== undefined) {
    await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
  }
  await chrome.tabs.remove(tabId).catch(() => {});
}

function parseTarget(url) {
  const at = url.indexOf(HASH_PREFIX);
  if (at === -1) return null;
  try {
    const decoded = JSON.parse(decodeURIComponent(url.slice(at + HASH_PREFIX.length)));
    return typeof decoded?.id === 'string' && typeof decoded?.name === 'string' ? decoded : null;
  } catch {
    return null;
  }
}
