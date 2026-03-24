// =========================================================
// script.js — Main UI Logic for Council of AI
// Communicates with extension via port-based bridge.
// =========================================================

// --- Constants & State ---
const INITIAL_TABS = PLATFORMS.map(p => ({
  id: p.id,
  name: p.name,
  iconSrc: p.iconSrc,
  homeUrl: p.homeUrl,
  connected: false,
  tabId: null
}));

let state = {
  theme: 'dark',
  status: 'idle', // 'idle' | 'running'
  mode: 'council', // 'council' | 'debate'
  tabs: INITIAL_TABS,
  activeMembers: [],
  displayOrder: [], // Dictates UI positions (up to 6 visible, others minimized)
  messages: [],
  config: { 
    responseTimeout: 300,
    maxRounds: 7,
    maxTurns: 5
  },
  sidebarOpen: true,
  extensionAvailable: false,
  msgIdCounter: 0,
  isMock: false
};

// --- DOM Elements ---
const sessionsContainer = document.getElementById('sessions-container');
const tabsList = document.getElementById('tabs-list');
const scanTabsBtn = document.getElementById('scan-tabs-btn');
const noTabsMsg = document.getElementById('no-tabs-msg');
const extStatusDot = document.getElementById('ext-status-dot');
const chatInput = document.getElementById('chat-input');
const chatForm = document.getElementById('chat-form');
const sendButton = document.getElementById('send-button');
const minimizedRow = document.getElementById('minimized-row');
const minimizedTray = document.getElementById('minimized-tray-container');
const checkAllReadyBtn = document.getElementById('check-all-ready-btn');
const checkAllText = document.getElementById('check-all-text');
const checkAllCheckbox = document.getElementById('check-all-checkbox');
const toggleThemeBtn = document.getElementById('toggle-theme');
const themeIcon = document.getElementById('theme-icon');
const clearChatBtn = document.getElementById('clear-chat');
const openSidebarBtn = document.getElementById('open-sidebar');
const closeSidebarBtn = document.getElementById('close-sidebar');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const responseTimeoutSlider = document.getElementById('response-timeout-slider');
const responseTimeoutValue = document.getElementById('response-timeout-value');
const responseTimeoutSection = document.getElementById('response-timeout-section');
const debateConfigSection = document.getElementById('debate-config-section');
const maxRoundsSlider = document.getElementById('max-rounds-slider');
const maxRoundsValue = document.getElementById('max-rounds-value');
const maxDebateTurnsSlider = document.getElementById('max-debate-turns-slider');
const maxDebateTurnsValue = document.getElementById('max-debate-turns-value');
// const councilModeBtn = document.getElementById('council-mode-btn');
// const debateModeBtn = document.getElementById('debate-mode-btn');

// --- Helpers ---
function escHtml(str) { return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function parseMarkdown(text) {
  if (!text) return '';
  const blocks = [];
  let html = text.replace(/```([\w]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const i = blocks.length;
    const highlighted = Highlighter.highlight(code.trim(), lang);
    blocks.push(`<div class="box p-0 mb-4 overflow-hidden" style="border: 1px solid var(--bulma-border);">` +
      `<div class="is-flex is-align-items-center is-justify-content-space-between px-3 py-2 has-background-light" style="border-bottom: 1px solid var(--bulma-border);">` +
      `<span class="is-size-7 font-mono has-text-grey-dark">${escHtml(lang || 'code')}</span>` +
      `<button class="button is-ghost is-small has-text-primary p-0 h-auto" onclick="navigator.clipboard.writeText(\`${code.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)">Copy</button>` +
      `</div><pre class="p-4 is-size-7 font-mono overflow-x-auto has-background-white-ter" style="background: var(--bulma-card-background-color) !important;"><code>${highlighted}</code></pre></div>`);
    return `\x00BLOCK${i}\x00`;
  });
  html = escHtml(html);
  html = html.replace(/`([^`\n]+)`/g, '<code class="tag is-light is-family-monospace is-size-7">$1</code>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/^#{1,3} (.+)$/gm, '<h3 class="title is-6 mt-4 mb-2">$1</h3>');
  html = html.replace(/^[*\-•] (.+)$/gm, '<div class="is-flex gap-2 ml-2 mb-1"><span class="has-text-primary">•</span><span>$1</span></div>');
  html = html.replace(/^(\d+)\. (.+)$/gm, '<div class="is-flex gap-2 ml-2 mb-1"><span class="has-text-primary has-text-weight-bold">$1.</span><span>$2</span></div>');
  html = html.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
  blocks.forEach((b, i) => { html = html.replace(`\x00BLOCK${i}\x00`, b); });
  return html;
}

// --- Extension Bridge ---
const EXTENSION_ID = 'capcgedagknfpheplofhfallbkifjnob';
const isExtensionPage = !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id === EXTENSION_ID);
let extensionPort = null;
const pendingCallbacks = new Map();

function nextId() { return `wui_${Date.now()}_${state.msgIdCounter++}`; }

function connectToExtension() {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.connect) {
    setExtStatus(false);
    return;
  }
  try {
    extensionPort = isExtensionPage
      ? chrome.runtime.connect({ name: 'webui-bridge' })
      : chrome.runtime.connect(EXTENSION_ID, { name: 'webui-bridge' });

    extensionPort.onMessage.addListener((msg) => {
      if (!msg) return;
      if (msg.type === 'pong' || msg.connected) {
        setExtStatus(true);
        return;
      }
      if ((msg.type === 'ack' || msg.type === 'error') && msg.id) {
        const cb = pendingCallbacks.get(msg.id);
        if (cb) {
          if (msg.type === 'ack') cb.resolve({ ok: true });
          else cb.reject(new Error(msg.error || 'Unknown error'));
          pendingCallbacks.delete(msg.id);
        }
        return;
      }
      if (msg.target === 'webui') handleRelayResponse(msg);
    });

    extensionPort.onDisconnect.addListener(() => {
      extensionPort = null;
      setExtStatus(false);
      setTimeout(connectToExtension, 3000);
    });
  } catch (err) {
    console.error('[web-ui] Connect error:', err);
    setExtStatus(false);
    setTimeout(connectToExtension, 5000);
  }
}

function sendToExtension(type, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!extensionPort) { reject(new Error('Extension not connected')); return; }
    const id = nextId();
    pendingCallbacks.set(id, { resolve, reject });
    extensionPort.postMessage({ target: 'background', id, type, payload });
    setTimeout(() => { if (pendingCallbacks.has(id)) { pendingCallbacks.delete(id); reject(new Error('Timeout')); } }, 10000);
  });
}

function handleRelayResponse(msg) {
  const { responseType, data } = msg;

  if (responseType === 'tab_scan') {
    const scanResults = data || [];
    state.tabs.forEach(t => { 
      const found = scanResults.find(r => r.id === t.id);
      t.connected = !!found; 
      t.tabId = found ? found.tabId : null; 
    });
    // Sync display order
    state.displayOrder = state.displayOrder.filter(id => state.activeMembers.includes(id));
    state.activeMembers.forEach(id => { if (!state.displayOrder.includes(id)) state.displayOrder.push(id); });
    renderTabs();
    renderSessions();
    saveState();
  }

  if (responseType === 'ai_waiting') {
    if (!state.messages.find(m => m.id === data.id)) {
      state.messages.push(data);
      renderSessions();
    }
  }

  if (responseType === 'ai_response') {
    // Remove the waiting placeholder for this member
    state.messages = state.messages.filter(m => 
      m.id !== data.id && 
      !(m.senderType === 'system' && m.sender === data.sender && m.text && m.text.includes('Waiting for'))
    );
    
    // Add the actual response
    if (!state.messages.find(m => m.id === data.id)) {
      state.messages.push(data);
    }
    
    renderSessions();
    
    // Check if we are still waiting for others
    const waiting = state.messages.filter(m => m.senderType === 'system' && m.text && m.text.startsWith('Waiting for'));
    if (waiting.length === 0 && state.status === 'running') {
      state.status = 'idle';
      updateInputState();
    }
  }
}

// --- Main Render Functions ---
function render() {
  renderTabs();
  renderSessions();
  // renderModeToggle();
  updateSidebarUI();
  updateTheme();
}

function renderTabs() {
  if (!tabsList) return;
  tabsList.innerHTML = '';
  
  const readyTabs = state.tabs.filter(t => t.connected);
  const allReadySelected = readyTabs.length > 0 && readyTabs.every(t => state.activeMembers.includes(t.id));
  
  if (checkAllCheckbox) {
    checkAllCheckbox.classList.toggle('custom-checkbox-checked', allReadySelected);
    checkAllCheckbox.innerHTML = allReadySelected ? '<i data-lucide="check" style="width: 10px; height: 10px;"></i>' : '';
  }
  if (checkAllText) {
    checkAllText.textContent = allReadySelected ? 'Uncheck all ready' : 'Check all ready';
  }

  const sortedTabs = [...state.tabs].sort((a, b) => b.connected - a.connected);
  
  sortedTabs.forEach(tab => {
    const isActive = tab.connected && state.activeMembers.includes(tab.id);
    const item = document.createElement('div');
    item.className = `box p-3 mb-3 is-clickable transition-all ${isActive ? 'has-background-primary-light border-primary' : ''}`;
    item.style.border = isActive ? '1px solid var(--bulma-primary)' : '1px solid var(--bulma-border)';
    
    item.innerHTML = `
      <div class="is-flex is-align-items-center is-justify-content-space-between">
        <div class="is-flex is-align-items-center gap-3">
          <figure class="image is-32x32 is-flex is-align-items-center is-justify-content-center has-background-white rounded p-1 border shadow-xs ${!tab.connected ? 'is-grayscale' : ''}">
            <img src="${tab.iconSrc}" class="is-square object-contain">
          </figure>
          <div>
            <div class="is-size-7 has-text-weight-bold ${!tab.connected ? 'has-text-grey' : ''}">${tab.name}</div>
            <div class="is-size-7 ${tab.connected ? 'has-text-success' : 'has-text-danger'}">
              <span class="is-flex is-align-items-center gap-1">
                <span class="status-dot ${tab.connected ? 'online' : 'offline'}" style="width: 6px; height: 6px;"></span>
                ${tab.connected ? 'Ready' : 'Not Ready'}
              </span>
            </div>
          </div>
        </div>
        ${tab.connected 
          ? `<div class="custom-checkbox ${isActive ? 'custom-checkbox-checked' : ''}">${isActive ? '<i data-lucide="check" style="width: 12px; height: 12px;"></i>' : ''}</div>`
          : `<button class="button is-small is-primary is-outlined is-rounded" onclick="sendToExtension('create_tab', { url: '${tab.homeUrl}' }); event.stopPropagation();">Open</button>`
        }
      </div>
    `;
    
    if (tab.connected) item.onclick = () => toggleMember(tab.id);
    tabsList.appendChild(item);
  });
  lucide.createIcons();
}

function renderSessions() {
  if (!sessionsContainer) return;
  
  // Enforce uniqueness and sync
  state.activeMembers = [...new Set(state.activeMembers)];
  state.displayOrder = [...new Set(state.displayOrder)].filter(id => state.activeMembers.includes(id));
  state.activeMembers.forEach(id => {
    if (!state.displayOrder.includes(id)) state.displayOrder.push(id);
  });

  const activeTabs = state.tabs.filter(t => state.activeMembers.includes(t.id));
  const count = activeTabs.length;

  if (count === 0) {
    sessionsContainer.innerHTML = `
      <div id="empty-state" class="is-flex is-flex-direction-column is-align-items-center is-justify-content-center h-full has-text-centered p-6 is-user-select-none">
        <i data-lucide="sparkles" class="is-size-1 has-text-grey-lighter mb-4"></i>
        <p class="has-text-weight-semibold has-text-grey">No AI members selected</p>
        <p class="is-size-7 has-text-grey-light">Open the sidebar and scan for AI tabs, then select members to start.</p>
      </div>`;
    minimizedRow.classList.add('is-hidden');
    lucide.createIcons();
    return;
  }

  const visibleIds = state.displayOrder.slice(0, 6);
  const minimizedIds = state.displayOrder.slice(6);

  // Render Minimized Tray
  if (minimizedIds.length > 0) {
    minimizedRow.classList.remove('is-hidden');
    minimizedTray.innerHTML = '';
    minimizedIds.forEach(id => {
      const tab = state.tabs.find(t => t.id === id);
      const mItem = document.createElement('div');
      mItem.className = 'minimized-item is-flex is-align-items-center gap-2 px-3 box shadow-xs border cursor-pointer mb-0';
      mItem.style.background = 'var(--panel-bg)';
      mItem.innerHTML = `
        <img src="${tab.iconSrc}" class="image is-16x16">
        <span class="is-size-7 has-text-weight-bold truncate" style="max-width: 80px;">${tab.name}</span>
        <button class="button is-ghost is-small p-0 h-auto" onclick="expandMember('${id}'); event.stopPropagation();"><i data-lucide="maximize-2" style="width: 12px;"></i></button>
      `;
      mItem.onclick = () => expandMember(id);
      minimizedTray.appendChild(mItem);
    });
  } else {
    minimizedRow.classList.add('is-hidden');
  }

  // Render Grid
  sessionsContainer.className = `is-flex-grow-1 is-overflow-hidden p-4 grid gap-4 bg-light-opacity sessions-grid-${visibleIds.length}`;
  sessionsContainer.innerHTML = '';
  
  visibleIds.forEach(id => {
    const tab = state.tabs.find(t => t.id === id);
    const windowEl = document.createElement('div');
    windowEl.className = 'session-window box p-0 is-shadowless overflow-hidden';
    windowEl.style.background = 'var(--panel-bg)';
    windowEl.style.border = '1px solid var(--bulma-border)';
    windowEl.dataset.id = id;
    windowEl.innerHTML = `
      <div class="px-4 py-2 has-background-light is-flex is-align-items-center is-justify-content-space-between" style="border-bottom: 1px solid var(--bulma-border); background: var(--panel-bg-alt) !important;">
        <div class="is-flex is-align-items-center gap-2">
          <figure class="image is-24x24 p-1 has-background-white border rounded">
            <img src="${tab.iconSrc}" class="is-square object-contain">
          </figure>
          <span class="is-size-7 has-text-weight-bold">${tab.name}</span>
        </div>
        <div class="buttons">
          <button class="button is-ghost is-small has-text-grey p-1 h-auto" onclick="minimizeMember('${id}')"><i data-lucide="minus"></i></button>
          <button class="button is-ghost is-small has-text-danger p-1 h-auto" onclick="toggleMember('${id}')"><i data-lucide="x"></i></button>
        </div>
      </div>
      <div class="chat-messages p-4 is-flex-grow-1 is-overflow-y-auto no-scrollbar"></div>
    `;
    sessionsContainer.appendChild(windowEl);
    renderMessagesForSession(id, tab.name, windowEl.querySelector('.chat-messages'));
  });
  lucide.createIcons();
}

function renderMessagesForSession(memberId, memberName, container) {
  const msgs = state.messages.filter(m => 
    m.senderType === 'human' || 
    (m.senderType === 'ai' && m.sender === memberName) || 
    (m.senderType === 'system' && (m.sender === memberName || m.sender === 'System'))
  );
  
  container.innerHTML = '';
  msgs.forEach(msg => {
    const isHuman = msg.senderType === 'human';
    const isSystem = msg.senderType === 'system';
    
    if (isSystem) {
      const el = document.createElement('div');
      el.className = "has-text-centered my-4";
      el.innerHTML = `<span class="tag is-light is-rounded is-size-7">${escHtml(msg.text)}</span>`;
      container.appendChild(el); return;
    }

    const el = document.createElement('div');
    el.className = `is-flex mb-4 gap-2 ${isHuman ? 'is-justify-content-flex-end' : 'is-justify-content-flex-start'}`;
    const content = isHuman ? escHtml(msg.text) : parseMarkdown(msg.text);
    const bubbleClass = isHuman ? 'has-background-primary has-text-white' : 'has-background-light border';
    
    el.innerHTML = `
      <div class="is-flex is-flex-direction-column ${isHuman ? 'is-align-items-flex-end' : ''}" style="max-width: 90%;">
        <span class="is-size-7 is-uppercase has-text-weight-bold has-text-grey-light mb-1 px-1">${isHuman ? 'You' : msg.sender}</span>
        <div class="p-3 rounded-2xl is-size-6 ${bubbleClass}" style="${isHuman ? 'border-top-right-radius: 4px;' : 'border-top-left-radius: 4px;'}">${content}</div>
      </div>
    `;
    container.appendChild(el);
  });
  container.scrollTop = container.scrollHeight;
}

// --- Interaction Actions ---
function toggleMember(id) {
  if (state.activeMembers.includes(id)) {
    state.activeMembers = state.activeMembers.filter(m => m !== id);
    state.displayOrder = state.displayOrder.filter(m => m !== id);
  } else {
    state.activeMembers.push(id);
    if (!state.displayOrder.includes(id)) state.displayOrder.push(id);
  }
  renderTabs();
  renderSessions();
  saveState();
  updateInputState();
}

function checkAllReady() {
  const readyTabIds = state.tabs.filter(t => t.connected).map(t => t.id);
  if (readyTabIds.length === 0) return;
  
  const allReadySelected = readyTabIds.every(id => state.activeMembers.includes(id));
  
  if (allReadySelected) {
    state.activeMembers = state.activeMembers.filter(id => !readyTabIds.includes(id));
    state.displayOrder = state.displayOrder.filter(id => !readyTabIds.includes(id));
  } else {
    readyTabIds.forEach(id => {
      if (!state.activeMembers.includes(id)) state.activeMembers.push(id);
      if (!state.displayOrder.includes(id)) state.displayOrder.push(id);
    });
  }
  renderTabs();
  renderSessions();
  saveState();
  updateInputState();
}

function minimizeMember(id) {
  state.displayOrder = state.displayOrder.filter(m => m !== id);
  state.displayOrder.push(id); // Move to end of order (minimized)
  renderSessions();
  saveState();
}

function expandMember(id) {
  const idx = state.displayOrder.indexOf(id);
  if (idx > 5) {
    const targetId = state.displayOrder[5];
    state.displayOrder[idx] = targetId;
    state.displayOrder[5] = id;
  }
  renderSessions();
}

function handleClear() {
  if (confirm('Clear chat history?')) {
    state.messages = [];
    state.status = 'idle';
    renderSessions();
    saveState();
  }
}

async function handleSendMessage(e) {
  e?.preventDefault();
  const text = chatInput.value.trim();
  if (!text || state.activeMembers.length === 0 || state.status === 'running') return;
  
  chatInput.value = '';
  chatInput.style.height = 'auto';
  state.status = 'running';
  updateInputState();

  const msgId = nextId();
  state.messages.push({ id: msgId, sender: 'You', senderType: 'human', text, timestamp: Date.now() });
  renderSessions();

  for (const memberId of state.activeMembers) {
    const member = state.tabs.find(t => t.id === memberId);
    if (!member || !member.connected) continue;

    const waitingId = `wait_${memberId}_${Date.now()}`;
    state.messages.push({ id: waitingId, sender: member.name, senderType: 'system', text: `Waiting for ${member.name}...`, timestamp: Date.now() });
    renderSessions();

    const timeout = state.config.responseTimeout;
    sendToExtension('ai_command', { memberId, memberName: member.name, message: text, waitingId, responseTimeout: timeout })
      .catch(err => {
        state.messages = state.messages.filter(m => m.id !== waitingId);
        state.messages.push({ id: nextId(), sender: member.name, senderType: 'system', text: `Error: ${err.message}`, timestamp: Date.now() });
        renderSessions();
      });
  }
}

// --- UI Sync ---
function updateInputState() {
  sendButton.disabled = chatInput.value.trim().length === 0 || state.activeMembers.length === 0 || state.status === 'running';
  sendButton.classList.toggle('is-loading', state.status === 'running');
}

function updateTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  if (themeIcon) themeIcon.setAttribute('data-lucide', state.theme === 'dark' ? 'sun' : 'moon');
  lucide.createIcons();
}

function updateSidebarUI() {
  const isOpen = state.sidebarOpen;
  sidebar.style.marginLeft = isOpen ? '0' : '-320px';
  sidebar.classList.toggle('is-hidden-mobile', !isOpen);
  sidebarOverlay.style.display = (isOpen && window.innerWidth < 1024) ? 'block' : 'none';
  if (openSidebarBtn) openSidebarBtn.style.display = isOpen ? 'none' : 'flex';
}

function renderModeToggle() {
  /*
  councilModeBtn.classList.toggle('is-selected', state.mode === 'council');
  councilModeBtn.classList.toggle('is-primary', state.mode === 'council');
  debateModeBtn.classList.toggle('is-selected', state.mode === 'debate');
  debateModeBtn.classList.toggle('is-primary', state.mode === 'debate');
  debateConfigSection.classList.toggle('is-hidden', state.mode !== 'debate');
  */
}

function setExtStatus(online) {
  state.extensionAvailable = online;
  if (extStatusDot) {
    extStatusDot.className = online ? 'status-dot online' : 'status-dot offline';
  }
}

function saveState() {
  const data = {
    theme: state.theme,
    mode: state.mode,
    activeMembers: state.activeMembers,
    displayOrder: state.displayOrder,
    config: state.config,
    sidebarOpen: state.sidebarOpen
  };
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.set({ ai_workspace_state: data });
  } else {
    localStorage.setItem('ai_workspace_state', JSON.stringify(data));
  }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  // Load State
  const handleLoadedState = (saved) => {
    if (saved) {
      Object.assign(state, saved);
      render();
    }
  };

  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get(['ai_workspace_state'], (res) => handleLoadedState(res.ai_workspace_state));
  } else {
    const local = localStorage.getItem('ai_workspace_state');
    if (local) handleLoadedState(JSON.parse(local));
  }

  // Bind Events
  toggleThemeBtn.onclick = () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; updateTheme(); saveState(); };
  openSidebarBtn.onclick = () => { state.sidebarOpen = true; updateSidebarUI(); saveState(); };
  closeSidebarBtn.onclick = () => { state.sidebarOpen = false; updateSidebarUI(); saveState(); };
  sidebarOverlay.onclick = () => { state.sidebarOpen = false; updateSidebarUI(); saveState(); };
  
  scanTabsBtn.onclick = () => {
    scanTabsBtn.classList.add('is-loading');
    sendToExtension('tab_scan').finally(() => {
      setTimeout(() => scanTabsBtn.classList.remove('is-loading'), 500);
    });
  };

  checkAllReadyBtn.onclick = () => checkAllReady();
  clearChatBtn.onclick = () => handleClear();

  // councilModeBtn.onclick = () => { state.mode = 'council'; renderModeToggle(); saveState(); };
  // debateModeBtn.onclick = () => { state.mode = 'debate'; renderModeToggle(); saveState(); };

  responseTimeoutSlider.oninput = (e) => {
    state.config.responseTimeout = parseInt(e.target.value);
    responseTimeoutValue.textContent = e.target.value;
  };
  responseTimeoutSlider.onchange = () => saveState();

  /*
  maxRoundsSlider.oninput = (e) => {
    state.config.maxRounds = parseInt(e.target.value);
    maxRoundsValue.textContent = e.target.value;
  };
  maxRoundsSlider.onchange = () => saveState();

  maxDebateTurnsSlider.oninput = (e) => {
    state.config.maxTurns = parseInt(e.target.value);
    maxDebateTurnsValue.textContent = e.target.value;
  };
  maxDebateTurnsSlider.onchange = () => saveState();
  */

  chatForm.onsubmit = (e) => handleSendMessage(e);
  chatInput.oninput = () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
    updateInputState();
  };
  chatInput.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.requestSubmit();
    }
  };

  connectToExtension();
  render();
  // Periodic ping
  setInterval(() => { if (extensionPort) extensionPort.postMessage({ type: 'ping' }); }, 30000);
});
