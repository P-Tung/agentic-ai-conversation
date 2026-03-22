// background.js — Manifest V3 Service Worker
// Acts as central hub: relays commands between web-ui ↔ side panel (relay.js)

let sidePanelPort = null;
let webuiPort = null;

console.log('[SW] Service worker starting...');

// Allow toolbar icon to open the side panel
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .then(() => console.log('[SW] setPanelBehavior success'))
  .catch((error) => console.error('[SW] setPanelBehavior error:', error));

// Open side panel when toolbar icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  console.log('[SW] Action clicked, tab:', tab.id);
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
    console.log('[SW] Side panel opened');
  } catch (error) {
    console.error('[SW] sidePanel.open error:', error);
  }
});

// Shared handler for port connections (works for both internal and external)
function handlePortConnection(port) {
  console.log('[SW] Port connected:', port.name, 'sender:', JSON.stringify(port.sender?.origin || port.sender?.url || 'extension'));

  if (port.name === 'sidepanel-bridge') {
    sidePanelPort = port;
    console.log('[SW] Side panel connected');

    // Receive responses from side panel relay → forward to web-ui
    port.onMessage.addListener((msg) => {
      console.log('[SW] Side panel message:', JSON.stringify(msg));
      if (msg.type === 'response' && msg.data) {
        const fwd = {
          target: 'webui',
          responseType: msg.data.responseType,
          id: msg.data.id,
          data: msg.data.data
        };
        // Forward to web-ui via port (primary)
        if (webuiPort) {
          try { webuiPort.postMessage(fwd); } catch (e) { console.error('[SW] webuiPort send error:', e); }
        }
        // Also broadcast via sendMessage as fallback
        chrome.runtime.sendMessage(fwd).catch(() => {});
      }
    });

    port.onDisconnect.addListener(() => {
      sidePanelPort = null;
      console.log('[SW] Side panel disconnected');
    });

  } else if (port.name === 'webui-bridge') {
    webuiPort = port;
    console.log('[SW] Web UI connected via port');

    // Confirm connection immediately
    port.postMessage({ target: 'webui', type: 'pong', connected: true });

    // Receive commands from web-ui
    port.onMessage.addListener((msg) => {
      console.log('[SW] Web UI port message:', JSON.stringify(msg));

      if (msg.type === 'ping') {
        port.postMessage({ target: 'webui', type: 'pong' });
        return;
      }

      // Forward command to side panel relay
      if (sidePanelPort) {
        sidePanelPort.postMessage(msg);
        port.postMessage({ target: 'webui', type: 'ack', id: msg.id, ok: true });
      } else {
        port.postMessage({
          target: 'webui',
          type: 'error',
          id: msg.id,
          error: 'Extension side panel is not open. Please click the extension icon to open the panel first.'
        });
      }
    });

    port.onDisconnect.addListener(() => {
      webuiPort = null;
      console.log('[SW] Web UI disconnected');
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

  if (sidePanelPort) {
    sidePanelPort.postMessage(msg);
    sendResponse({ ok: true });
  } else {
    sendResponse({ error: 'Extension side panel is not open. Please click the extension icon to open the panel first.' });
  }
});
