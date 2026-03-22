// background.js — Manifest V3 Service Worker
// Handles everything: web-ui communication + AI tab interactions (no side panel needed)

let webuiPort = null;

console.log('[SW] Service worker starting...');

// =========================================================
// Platform configurations (embedded so service worker is self-contained)
// =========================================================
const PLATFORMS = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    urlPatterns: ['*://chatgpt.com/*'],
    selectors: {
      input: ['#prompt-textarea', 'div[contenteditable="true"]'],
      sendBtn: ['button[data-testid="send-button"]'],
      response: ['.markdown'],
    },
  },
  {
    id: 'claude',
    name: 'Claude',
    urlPatterns: ['*://claude.ai/*', '*://*.claude.ai/*'],
    selectors: {
      input: [
        'div.ProseMirror[contenteditable="true"]',
        'fieldset div[contenteditable="true"]',
        'div[contenteditable="true"]',
      ],
      sendBtn: [
        'button[aria-label="Send message"]',
        'button[data-testid="send-button"]',
      ],
      response: [
        '[data-testid="assistant-message"] .contents',
        '.standard-markdown',
        '.font-claude-message',
        'div[class*="prose"]',
      ],
    },
  },
  {
    id: 'gemini',
    name: 'Gemini',
    urlPatterns: ['*://gemini.google.com/*'],
    selectors: {
      input: ['div.ql-editor', 'textarea'],
      sendBtn: ['.send-button', 'button[aria-label="Send message"]'],
      response: ['message-content'],
    },
  },
  {
    id: 'grok',
    name: 'Grok',
    urlPatterns: ['*://grok.com/*', '*://*.grok.com/*', '*://x.com/i/grok*', '*://twitter.com/i/grok*'],
    selectors: {
      input: ['div[contenteditable="true"]', 'textarea'],
      sendBtn: [
        'button[aria-label="Send message"]',
        'button[type="submit"]',
        'button[aria-label="Grok something"]',
      ],
      response: ['.response-content-markdown', '.message-content', '.message-text'],
    },
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    urlPatterns: ['*://www.perplexity.ai/*'],
    selectors: {
      input: ['div[contenteditable="true"]', 'textarea[placeholder*="Ask"]', 'textarea'],
      sendBtn: ['button[aria-label="Submit"]', 'button[type="submit"]'],
      response: ['.prose', '[class*="answer"]'],
    },
  },
];

// =========================================================
// Relay logic (previously in relay.js, now runs in service worker)
// =========================================================

function postResponseToWebUI(msg) {
  if (!webuiPort) return;
  const fwd = {
    target: 'webui',
    responseType: msg.responseType,
    id: msg.id,
    data: msg.data,
  };
  try { webuiPort.postMessage(fwd); } catch (e) { console.error('[SW] webuiPort send error:', e); }
}

async function scanTabsRelay() {
  const results = [];
  for (const platform of PLATFORMS) {
    for (const urlPattern of platform.urlPatterns) {
      try {
        const tabs = await chrome.tabs.query({ url: urlPattern });
        if (tabs?.length > 0) {
          results.push({ id: platform.id, name: platform.name, tabId: tabs[0].id });
          break;
        }
      } catch (e) {
        console.warn('[SW] Tab query error for', urlPattern, e);
      }
    }
  }
  return results;
}

async function handleAICommand(id, { memberId, memberName, message, waitingId, responseTimeout }) {
  try {
    const tabs = await scanTabsRelay();
    const memberTab = tabs.find(t => t.id === memberId);
    if (!memberTab) {
      postResponseToWebUI({ id, responseType: 'ai_response', data: { id: waitingId, sender: memberName, senderType: 'system', text: `[Error] ${memberName} tab not found.`, timestamp: Date.now() } });
      return;
    }
    postResponseToWebUI({ id, responseType: 'ai_waiting', data: { id: waitingId, sender: memberName, senderType: 'system', text: `Waiting for ${memberName}...`, timestamp: Date.now() } });
    const responseText = await getAIResponseRelay(memberTab, message, responseTimeout);
    postResponseToWebUI({ id, responseType: 'ai_response', data: { id: `msg_${Date.now()}`, sender: memberName, senderType: 'ai', text: responseText, timestamp: Date.now() } });
  } catch (err) {
    postResponseToWebUI({ id, responseType: 'ai_response', data: { id: `msg_err_${Date.now()}`, sender: memberName, senderType: 'ai', text: `[Error] ${err.message}`, timestamp: Date.now() } });
  }
}

async function getAIResponseRelay(member, message, responseTimeout = 30) {
  if (!member.tabId) return '[Error] Tab not found.';
  const platform = PLATFORMS.find(p => p.id === member.id);
  if (!platform) return `[Error] No platform config for ${member.id}.`;
  try { await chrome.tabs.update(member.tabId, { active: true }); await new Promise(r => setTimeout(r, 300)); } catch { /* proceed */ }
  return new Promise((resolve) => {
    chrome.scripting.executeScript({
      target: { tabId: member.tabId },
      func: interactWithAIRelay,
      args: [member.id, message, platform.selectors, responseTimeout || 20]
    }, (results) => {
      if (chrome.runtime.lastError) { resolve(`[Error] Could not communicate with ${member.name} tab.`); return; }
      resolve(results?.[0]?.result || `[Error] No response from ${member.name}.`);
    });
  });
}

// This function is injected into AI tabs via chrome.scripting.executeScript
function interactWithAIRelay(platformId, message, selectors, responseTimeout) {
  return new Promise((resolve) => {
    try {
      const inputEl = (selectors.input || []).map(s => document.querySelector(s)).find(el => el !== null);
      if (!inputEl) return resolve('[Error] Could not find input box.');
      if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeSetter) nativeSetter.call(inputEl, message); else inputEl.value = message;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (inputEl.isContentEditable) {
        inputEl.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, message);
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
      setTimeout(() => {
        const isBtnReady = (btn) => btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
        const attemptSend = (retries = 0) => {
          const btn = (selectors.sendBtn || []).map(s => document.querySelector(s)).find(el => el !== null);
          if (isBtnReady(btn)) { btn.click(); }
          else if (btn && retries < 20) { setTimeout(() => attemptSend(retries + 1), 100); return; }
          else { inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); }
          const POLL_INTERVAL_MS = 500;
          const maxAttempts = (responseTimeout || 20) * (1000 / POLL_INTERVAL_MS);
          let attempts = 0, previousText = '';
          const checkResponse = setInterval(() => {
            attempts++;
            let responseText = '';
            for (const sel of (selectors.response || [])) {
              const els = document.querySelectorAll(sel);
              if (els.length > 0) { responseText = els[els.length - 1].innerText; break; }
            }
            if (responseText && responseText === previousText && attempts > 4) {
              clearInterval(checkResponse); resolve(responseText);
            } else if (attempts > maxAttempts) {
              clearInterval(checkResponse); resolve(responseText || `[Error] No response from ${platformId}.`);
            }
            previousText = responseText;
          }, POLL_INTERVAL_MS);
        };
        attemptSend();
      }, 500);
    } catch (err) { resolve(`[Error] ${err.message}`); }
  });
}

// =========================================================
// Command handler (replaces the side panel relay hop)
// =========================================================

function handleCommand(msg) {
  const { id, type, payload } = msg;
  if (type === 'scan_tabs') {
    scanTabsRelay().then(tabs => postResponseToWebUI({ id, responseType: 'tab_scan', data: tabs }));
  } else if (type === 'ai_command') {
    handleAICommand(id, payload);
  }
}

// =========================================================
// Port connection handler (web UI only, no side panel needed)
// =========================================================

function handlePortConnection(port) {
  console.log('[SW] Port connected:', port.name, 'sender:', JSON.stringify(port.sender?.origin || port.sender?.url || 'extension'));

  if (port.name === 'webui-bridge') {
    webuiPort = port;
    console.log('[SW] Web UI connected via port');

    // Confirm connection immediately
    port.postMessage({ target: 'webui', type: 'pong', connected: true });

    // Receive commands from web-ui and handle directly (no side panel hop)
    port.onMessage.addListener((msg) => {
      console.log('[SW] Web UI port message:', JSON.stringify(msg));

      if (msg.type === 'ping') {
        port.postMessage({ target: 'webui', type: 'pong' });
        return;
      }

      // Execute the command directly in the service worker
      handleCommand(msg);
      port.postMessage({ target: 'webui', type: 'ack', id: msg.id, ok: true });
    });

    port.onDisconnect.addListener(() => {
      webuiPort = null;
      console.log('[SW] Web UI disconnected');
    });

  } else if (port.name === 'sidepanel-bridge') {
    // Keep backward compat: if old side panel connects, just log it
    console.log('[SW] Side panel connected (legacy, not required)');
    port.onDisconnect.addListener(() => {
      console.log('[SW] Side panel disconnected (legacy)');
    });
  }
}

// Internal connections (from extension pages like side panel or chrome-extension:// web-ui)
chrome.runtime.onConnect.addListener(handlePortConnection);

// External connections (from localhost web-ui via externally_connectable)
chrome.runtime.onConnectExternal.addListener(handlePortConnection);

// Fallback: handle sendMessage-based communication (backward compat)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'background') return;

  if (msg.type === 'ping') {
    console.log('[SW] Ping from web-ui (sendMessage)');
    sendResponse({ ok: true, pong: true });
    return;
  }

  // Execute the command directly
  handleCommand(msg);
  sendResponse({ ok: true });
});
