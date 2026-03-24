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
    const response = await getAIResponseRelay(memberTab, message, responseTimeout);
    
    // Handle structured response (thought + answer)
    const isStruct = typeof response === 'object' && response !== null;
    const responseText = isStruct ? response.answer : response;
    const thoughtText = isStruct ? response.thought : '';

    postResponse({ 
      id, 
      responseType: 'ai_response', 
      data: { 
        id: waitingId || `msg_${Date.now()}`, 
        sender: memberName, 
        senderType: 'ai', 
        text: responseText, 
        thought: thoughtText,
        timestamp: Date.now() 
      } 
    });
  } catch (err) {
    postResponse({ id, responseType: 'ai_response', data: { id: waitingId || `msg_err_${Date.now()}`, sender: memberName, senderType: 'ai', text: `[Error] ${err.message}`, timestamp: Date.now() } });
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

      // 1. Snapshot initial response count to detect NEW messages
      let initialCount = 0;
      for (const sel of (selectors.response || [])) {
        initialCount += document.querySelectorAll(sel).length;
      }

      // 2. Clear then Set Input
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

      // 3. Click Send
      setTimeout(() => {
        const isBtnReady = (btn) => btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
        const attemptSend = (retries = 0) => {
          const btn = (selectors.sendBtn || []).map(s => document.querySelector(s)).find(el => el !== null);
          if (isBtnReady(btn)) {
            btn.click();
          } else if (btn && retries < 20) {
            setTimeout(() => attemptSend(retries + 1), 100);
            return;
          } else {
            inputEl.focus();
            inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
          }

          // 4. Polling for Response
          const POLL_INTERVAL_MS = 500;
          const maxWaitSeconds = responseTimeout > 0 ? responseTimeout : 30;
          const startTimestamp = Date.now();
          let stabilityCount = 0;
          let previousText = '';
          let newMessageDetected = false;

          const checkResponse = setInterval(() => {
            const elapsed = (Date.now() - startTimestamp) / 1000;
            
            // Collect all potential responses
            let currentResponses = [];
            for (const sel of (selectors.response || [])) {
              const els = document.querySelectorAll(sel);
              currentResponses = currentResponses.concat(Array.from(els));
            }

            // Step A: Wait for a NEW element to appear (increment in count)
            if (!newMessageDetected) {
              if (currentResponses.length > initialCount) {
                newMessageDetected = true;
                this.console?.log('[Relay] New message element detected.');
              }
              if (elapsed > 10 && !newMessageDetected) {
                // Fallback: If no new element after 10s, maybe it appended to an old one or we missed the count
                newMessageDetected = true;
              }
              if (elapsed > maxWaitSeconds) {
                clearInterval(checkResponse);
                resolve('[Error] Timeout waiting for AI to start responding.');
              }
              return;
            }

            // Step B: Polling the LATEST element for stability
            const latestEl = currentResponses[currentResponses.length - 1];
            if (!latestEl) {
              if (elapsed > maxWaitSeconds) { clearInterval(checkResponse); resolve('[Error] No response element found.'); }
              return;
            }

            // Extract content, separating thoughts if present
            const clone = latestEl.cloneNode(true);
            
            // Remove excluded elements (like citations or copy buttons)
            if (selectors.exclude && Array.isArray(selectors.exclude)) {
              selectors.exclude.forEach(exSel => {
                clone.querySelectorAll(exSel).forEach(exEl => exEl.remove());
              });
            }

            // Extract Thought Process
            let thoughtHTML = '';
            const thoughtSelectors = [
              'details', '.thought', '.thinking', '.reasoning', 
              '.thought-process', '.thinking-block', '.thinking-process', 
              '.thought-container', '.thought-block', '.thinking-chain-container',
              '[class*="thought"]', '[class*="thinking"]', '[class*="reasoning"]'
            ];
            const allThoughtSels = [...new Set([...thoughtSelectors, ...(selectors.exclude || [])])];
            
            allThoughtSels.forEach(s => {
              clone.querySelectorAll(s).forEach(t => {
                thoughtHTML += t.innerHTML + '<br>';
                t.remove();
              });
            });

            // Also check for "Thought Process" text headings
            const headings = Array.from(clone.querySelectorAll('*')).filter(el => 
              el.innerText?.toLowerCase().includes('thought process') && el.children.length === 0
            );
            headings.forEach(h => {
              thoughtHTML += h.outerHTML;
              let next = h.nextElementSibling;
              while (next && !next.innerText?.includes('\n')) {
                thoughtHTML += next.outerHTML;
                const toRemove = next;
                next = next.nextElementSibling;
                toRemove.remove();
              }
              h.remove();
            });

            const currentText = clone.innerText.trim();

            // Stability check: text must remain the same for non-zero length
            if (currentText && currentText === previousText) {
              stabilityCount++;
            } else {
              stabilityCount = 0;
            }

            // If stable for 3 cycles (1.5s), consider it done
            if (stabilityCount >= 3) {
              clearInterval(checkResponse);
              resolve({ thought: thoughtHTML.trim(), answer: currentText });
            } else if (elapsed > maxWaitSeconds) {
              clearInterval(checkResponse);
              resolve({ thought: thoughtHTML.trim(), answer: currentText || `[Error] Response timed out.` });
            }

            previousText = currentText;
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
