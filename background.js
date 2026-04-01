/**
 * background.js — Service worker for XML Stream Parser
 * - Opens parser UI in a dedicated tab
 * - Proxies Telegram messages
 * - Manages supporter status
 */
const PROXY_URL = 'https://xmlworker-production.up.railway.app';

let parserTabId = null;

// ── Tab management ───────────────────────────────────────────────
chrome.action.onClicked.addListener(async () => {
  if (parserTabId !== null) {
    try {
      const tab = await chrome.tabs.get(parserTabId);
      if (tab) {
        await chrome.tabs.update(parserTabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return;
      }
    } catch { parserTabId = null; }
  }
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
  parserTabId = tab.id;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === parserTabId) parserTabId = null;
});

// ── Message handler ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'sendTelegram') {
    fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: msg.text })
    }).then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true; // async
  }

  if (msg.action === 'getSupporter') {
    chrome.storage.local.get('supporter', (d) => sendResponse({ supporter: d.supporter === true }));
    return true;
  }

  if (msg.action === 'setSupporter') {
    chrome.storage.local.set({ supporter: true }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action === 'getLang') {
    chrome.storage.local.get('lang', (d) => sendResponse({ lang: d.lang || null }));
    return true;
  }

  if (msg.action === 'setLang') {
    chrome.storage.local.set({ lang: msg.lang }, () => sendResponse({ ok: true }));
    return true;
  }
});
