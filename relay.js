// relay.js — Side panel command relay
// Receives commands from web-ui.html via background.js MessagePort, executes, responds back
let port = null;

function postResponse(msg) {
  if (port) port.postMessage({ type: 'response', data: msg });
}

function handleCommand(msg) {
  const { id, type, payload } = msg;
  if (type === 'scan_tabs') {
    scanTabsRelay().then(tabs => postResponse({ id, responseType: 'tab_scan', data: tabs }));
  } else if (type === 'ai_command') {
    handleAICommand(id, payload);
  }
}

async function scanTabsRelay() {
  if (!chrome?.tabs) return [];
  const results = [];
  for (const platform of PLATFORMS) {
    for (const urlPattern of platform.urlPatterns) {
      const tabs = await chrome.tabs.query({ url: urlPattern });
      if (tabs?.length > 0) {
        results.push({ id: platform.id, name: platform.name, tabId: tabs[0].id });
        break;
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
      postResponse({ id, responseType: 'ai_response', data: { id: waitingId, sender: memberName, senderType: 'system', text: `[Error] ${memberName} tab not found.`, timestamp: Date.now() } });
      return;
    }
    postResponse({ id, responseType: 'ai_waiting', data: { id: waitingId, sender: memberName, senderType: 'system', text: `Waiting for ${memberName}...`, timestamp: Date.now() } });
    const responseText = await getAIResponseRelay(memberTab, message, responseTimeout);
    postResponse({ id, responseType: 'ai_response', data: { id: `msg_${Date.now()}`, sender: memberName, senderType: 'ai', text: responseText, timestamp: Date.now() } });
  } catch (err) {
    postResponse({ id, responseType: 'ai_response', data: { id: `msg_err_${Date.now()}`, sender: memberName, senderType: 'ai', text: `[Error] ${err.message}`, timestamp: Date.now() } });
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

port = chrome.runtime.connect({ name: 'sidepanel-bridge' });
port.onMessage.addListener(handleCommand);
port.onDisconnect.addListener(() => {
  port = null;
  console.log('[Bridge] Disconnected from background');
});
