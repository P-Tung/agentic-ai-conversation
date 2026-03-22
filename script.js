// --- Constants & State ---
// Tabs are derived from PLATFORMS config (defined in platforms.js)
const INITIAL_TABS = PLATFORMS.map(p => ({ id: p.id, name: p.name, iconSrc: p.iconSrc, homeUrl: p.homeUrl, connected: false, tabId: null }));

let state = {
  theme: 'dark',
  status: 'idle', // 'idle' | 'running' | 'paused'
  mode: 'council', // 'council' | 'debate'
  tabs: INITIAL_TABS,
  activeMembers: [], // Initially empty, will be loaded from storage
  // Order of members for display (handles which 6 are shown)
  displayOrder: [], 
  messages: [
    {
      id: 'sys-1',
      sender: 'System',
      senderType: 'system',
      text: 'Workspace initialized. Select AI members and configure the prompt to begin.',
      timestamp: Date.now()
    }
  ],
  config: {
    maxLength: 1000,
    responseTimeout: 30,
  },
  sidebarOpen: window.innerWidth > window.innerHeight,
  isLandscape: window.innerWidth > window.innerHeight,
  bridgeReady: false,
  bridgeSessionId: null,
};

// --- DOM Elements ---
const sessionsContainer = document.getElementById('sessions-container');
const tabsList = document.getElementById('tabs-list');
const maxLengthSlider = document.getElementById('max-length-slider');
const maxLengthValue = document.getElementById('max-length-value');
const scanTabsBtn = document.getElementById('scan-tabs-btn');
const noTabsMsg = document.getElementById('no-tabs-msg');
const responseTimeoutSlider = document.getElementById('response-timeout-slider');
const responseTimeoutValue = document.getElementById('response-timeout-value');
const responseTimeoutSection = document.getElementById('response-timeout-section');
const statusPing = document.getElementById('status-ping');
const controlsContainer = document.getElementById('controls-container');
const statusDot = document.getElementById('status-dot');
const chatInput = document.getElementById('chat-input');
const chatForm = document.getElementById('chat-form');
const sendButton = document.getElementById('send-button');
const toggleThemeBtn = document.getElementById('toggle-theme');
const themeIcon = document.getElementById('theme-icon');
const clearChatBtn = document.getElementById('clear-chat');
const openSidebarBtn = document.getElementById('open-sidebar');
const closeSidebarBtn = document.getElementById('close-sidebar');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const howtoModal = document.getElementById('howto-modal');
const howtoBtn = document.getElementById('howto-btn');
const howtoClose = document.getElementById('howto-close');
const howtoGotIt = document.getElementById('howto-got-it');
const howtoOverlay = document.getElementById('howto-overlay');
const modeToggleContainer = document.getElementById('mode-toggle');
const debateConfigSection = document.getElementById('debate-config-section');
const debateRoundsConfig = document.getElementById('debate-rounds-config');
const shareBtn = document.getElementById('share-btn');
const shareIndicator = document.getElementById('share-indicator');
const minimizedTrayContainer = document.getElementById('minimized-tray-container');
const minimizedRow = document.getElementById('minimized-row');

// --- Initialization ---
async function init() {
  // Load from storage if available (Chrome Extension API)
  if (typeof chrome !== 'undefined' && chrome.storage) {
    const data = await chrome.storage.local.get(['ai_workspace_state']);
    if (data.ai_workspace_state) {
      const savedState = data.ai_workspace_state;
      state.theme = savedState.theme || state.theme;
      state.activeMembers = savedState.activeMembers || [];
      state.displayOrder = savedState.displayOrder || [];
      state.config = { ...state.config, ...savedState.config };
      // Convert saved timestamps back to Date objects
      state.messages = (savedState.messages || state.messages).map(m => ({
        ...m,
        timestamp: new Date(m.timestamp)
      }));
    }
  }

  // Set initial values
  maxLengthSlider.value = state.config.maxLength;
  maxLengthValue.textContent = state.config.maxLength;
  responseTimeoutSlider.value = state.config.responseTimeout;
  responseTimeoutValue.textContent = state.config.responseTimeout;
  
  updateTheme();
  updateSidebarUI();
  await scanTabs();
  setupEventListeners();
  // Final render with correct state
  render();
  refreshIcons();
}



function refreshIcons() {
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

// --- Markdown Helpers ---
function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseMarkdown(text) {
  if (!text) return '';
  const blocks = [];

  // Extract fenced code blocks first to protect them; capture language for syntax highlighting
  let html = text.replace(/```([\w]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const i = blocks.length;
    const trimmed = code.trim();
    const highlighted = Highlighter.highlight(trimmed, lang);
    const langLabel = escHtml(lang || 'code');
    blocks.push(
      `<div class="code-block my-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">` +
      `<div class="flex items-center justify-between px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 select-none">` +
      `<span class="text-[10px] font-mono text-gray-500 dark:text-gray-400">${langLabel}</span>` +
      `<button class="copy-btn text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors cursor-pointer">Copy</button>` +
      `</div>` +
      `<pre class="bg-gray-50 dark:bg-gray-900 p-3 text-xs font-mono overflow-x-auto leading-relaxed whitespace-pre"><code>${highlighted}</code></pre>` +
      `</div>`
    );
    return `\x00BLOCK${i}\x00`;
  });

  // Escape remaining HTML
  html = escHtml(html);

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code class="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs font-mono">$1</code>');
  // Bold
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  // Headers → bold block
  html = html.replace(/^#{1,3} (.+)$/gm, '<div class="font-semibold mt-1.5 mb-0.5">$1</div>');
  // Unordered list items
  html = html.replace(/^[*\-•] (.+)$/gm, '<div class="flex gap-1.5 ml-2"><span>•</span><span>$1</span></div>');
  // Ordered list items
  html = html.replace(/^(\d+)\. (.+)$/gm, '<div class="flex gap-1.5 ml-2"><span>$1.</span><span>$2</span></div>');
  // Newlines → line breaks
  html = html.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');

  // Restore code blocks
  blocks.forEach((b, i) => { html = html.replace(`\x00BLOCK${i}\x00`, b); });
  return html;
}

// --- Render Logic ---
function render() {
  renderTabs();
  renderSessions();
  renderControls();
  renderModeToggle();
  updateStatusUI();
  updateSidebarUI();
  updateDebateConfigVisibility();
  updateResponseTimeoutVisibility();
  renderTooltips();
}

function renderTabs() {
  tabsList.innerHTML = '';
  
  noTabsMsg.classList.add('hidden');

  const sortedTabs = [...state.tabs].sort((a, b) => {
    if (a.connected && !b.connected) return -1;
    if (!a.connected && b.connected) return 1;
    return 0; // maintain original order
  });

  sortedTabs.forEach(tab => {
    const isActive = tab.connected && state.activeMembers.includes(tab.id);
    const tabEl = document.createElement('div');
    
    if (tab.connected) {
      tabEl.className = `
        flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all mb-2
        ${isActive 
            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 shadow-sm' 
            : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700'}
      `;
      
      tabEl.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-white dark:bg-gray-800 shadow-sm overflow-hidden p-1 border border-gray-100 dark:border-gray-700">
            <img src="${tab.iconSrc}" alt="${tab.name}" class="w-5 h-5 object-contain">
          </div>
          <div>
            <div class="font-medium text-sm">${tab.name}</div>
            <div class="text-xs text-emerald-600 dark:text-emerald-400">
              Ready
            </div>
          </div>
        </div>
        <div class="w-5 h-5 rounded-md flex items-center justify-center border ${
          isActive 
            ? 'bg-indigo-500 border-indigo-500 text-white' 
            : 'border-gray-300 dark:border-gray-600 text-transparent'
        }">
          <i data-lucide="check" class="w-3.5 h-3.5"></i>
        </div>
      `;
      tabEl.onclick = () => toggleMember(tab.id);
    } else {
      tabEl.className = `
        flex items-center justify-between p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 opacity-75 mb-2
      `;
      tabEl.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-white dark:bg-gray-800 shadow-sm overflow-hidden p-1 border border-gray-100 dark:border-gray-700 grayscale">
            <img src="${tab.iconSrc}" alt="${tab.name}" class="w-5 h-5 object-contain">
          </div>
          <div>
            <div class="font-medium text-sm text-gray-500 dark:text-gray-400">${tab.name}</div>
            <div class="text-xs text-red-500 dark:text-red-400">
              Not Ready
            </div>
          </div>
        </div>
        <button class="px-3 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm" onclick="chrome.tabs.create({url: '${tab.homeUrl}', active: false}); if(!state.activeMembers.includes('${tab.id}')) toggleMember('${tab.id}'); event.stopPropagation();">
          Open
        </button>
      `;
    }
    
    tabsList.appendChild(tabEl);
  });
  
  refreshIcons();
  renderTooltips();
}

function renderTooltips() {
  // Simple check to ensure we don't overkill
  const tooltips = document.querySelectorAll('[title]');
  // Native tooltips are fine, but for premium feel we can style them or just leave as is since we are using Lucide
}

function renderSessions() {
  const activeTabs = state.tabs.filter(t => state.activeMembers.includes(t.id));
  const count = activeTabs.length;

  if (count === 0) {
    sessionsContainer.innerHTML = `
      <div id="empty-state" class="col-span-full row-span-full flex flex-col items-center justify-center h-full text-center px-6 gap-4 select-none">
        <div class="w-14 h-14 rounded-2xl flex items-center justify-center">
          <i data-lucide="sparkles" class="w-7 h-7 text-indigo-500"></i>
        </div>
        <div class="space-y-1">
          <p class="text-sm font-semibold text-gray-700 dark:text-gray-300">No active sessions</p>
          <p class="text-xs text-gray-400 dark:text-gray-500 leading-relaxed max-w-[220px]">Select AI agents from the sidebar to start parallel conversations.</p>
        </div>
        <button class="howto-open-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
          <i data-lucide="circle-help" class="w-3.5 h-3.5"></i>
          How to use
        </button>
      </div>
    `;
    refreshIcons();
    return;
  }

  // Logic for display order: ensure activeMembers are in displayOrder
  state.activeMembers.forEach(id => {
    if (!state.displayOrder.includes(id)) {
      state.displayOrder.push(id);
    }
  });
  // Remove those not in activeMembers anymore
  state.displayOrder = state.displayOrder.filter(id => state.activeMembers.includes(id));

  const visibleIds = state.displayOrder.slice(0, 6);
  const minimizedIds = state.displayOrder.slice(6);

  // Clear container before rendering (or remove empty state)
  const emptyState = sessionsContainer.querySelector('#empty-state');
  if (emptyState) emptyState.remove();

  // Update container grid class
  const visibleCount = visibleIds.length;
  sessionsContainer.className = '';
  sessionsContainer.classList.add(
    'flex-1', 'overflow-hidden', 'p-3', 'sm:p-4', 'grid', 'gap-4',
    'bg-gray-50/50', 'dark:bg-gray-950/50', 'transition-all', 'duration-500',
    `sessions-grid-${Math.min(visibleCount, 6)}`
  );
  
  // Create or update session windows
  const existingWindows = Array.from(sessionsContainer.querySelectorAll('.session-window'));
  
  // Remove windows that shouldn't be visible
  existingWindows.forEach(w => {
    if (!visibleIds.includes(w.dataset.id)) w.remove();
  });

  // Re-sort or create windows in order
  visibleIds.forEach((id, index) => {
    const tab = state.tabs.find(t => t.id === id);
    if (!tab) return;

    let windowEl = sessionsContainer.querySelector(`.session-window[data-id="${id}"]`);
    if (!windowEl) {
      windowEl = document.createElement('div');
      windowEl.className = 'session-window';
      windowEl.dataset.id = id;
      windowEl.innerHTML = `
        <div class="flex-shrink-0 px-4 py-3 border-b border-gray-200/50 dark:border-gray-800/50 flex items-center gap-2.5 bg-white/50 dark:bg-gray-900/50 transition-all hover:bg-white/80 dark:hover:bg-gray-900/80">
          <div class="w-7 h-7 rounded-lg bg-white dark:bg-gray-800 shadow-sm overflow-hidden p-1 border border-gray-100 dark:border-gray-700 flex items-center justify-center">
            <img src="${tab.iconSrc}" class="w-4 h-4 object-contain">
          </div>
          <span class="text-xs font-bold tracking-tight text-gray-700 dark:text-gray-300 truncate max-w-[120px]">${tab.name}</span>
          <div class="ml-auto flex items-center gap-2">
            <div class="flex items-center gap-1.5 mr-1">
              <span class="w-1.5 h-1.5 rounded-full ${tab.connected ? 'bg-emerald-500' : 'bg-red-500'}"></span>
              <span class="text-[10px] text-gray-400 uppercase font-bold tracking-wider">${tab.connected ? 'Session' : 'Not Ready'}</span>
            </div>
            <button onclick="minimizeMember('${id}'); event.stopPropagation();" class="w-5 h-5 rounded-md flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all shadow-sm active:scale-90" title="Minimize Session">
              <i data-lucide="minus" class="w-3 h-3"></i>
            </button>
            <button onclick="toggleMember('${id}'); event.stopPropagation();" class="w-5 h-5 rounded-md flex items-center justify-center bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500 hover:text-white transition-all shadow-sm active:scale-90" title="Close Session">
              <i data-lucide="x" class="w-3 h-3"></i>
            </button>
          </div>
        </div>
        <div class="chat-messages flex-1 overflow-y-auto p-4 space-y-4"></div>
      `;
      sessionsContainer.appendChild(windowEl);
    }
    
    // Maintain DOM order if needed (though grid handles it mostly)
    windowEl.style.order = index;

    if (tab.connected) {
      renderMessagesForSession(tab.id, windowEl.querySelector('.chat-messages'));
    } else {
      windowEl.querySelector('.chat-messages').innerHTML = `
        <div class="flex flex-col items-center justify-center h-full text-center p-6 gap-3">
          <div class="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
            <i data-lucide="alert-circle" class="w-5 h-5 text-red-500"></i>
          </div>
          <p class="text-xs font-medium text-gray-500">This AI tab is not open or ready.</p>
          <button class="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors shadow-sm" onclick="chrome.tabs.create({url: '${tab.homeUrl}', active: false}); event.stopPropagation();">
            Open ${tab.name}
          </button>
        </div>
      `;
    }
  });

  // Render minimized tray in the dedicated row above the grid
  minimizedTrayContainer.innerHTML = '';
  if (minimizedIds.length > 0) {
    minimizedRow.classList.remove('hidden');
    minimizedIds.forEach(id => {
      const tab = state.tabs.find(t => t.id === id);
      if (!tab) return;
      
      const itemEl = document.createElement('div');
      // Red border, Title, Close - matching the bold "red box" request
      itemEl.className = 'minimized-item flex-shrink-0 flex items-center justify-between gap-3 px-4 py-1.5 bg-white dark:bg-gray-950 rounded-lg shadow-sm cursor-pointer min-w-[120px]';
      itemEl.onclick = (e) => {
        if (!e.target.closest('button')) expandMember(id);
      };
      itemEl.innerHTML = `
        <span class="text-[12px] font-black text-gray-800 dark:text-gray-100 uppercase tracking-widest truncate max-w-[100px]">${tab.name}</span>
        <div class="flex items-center gap-1.5">
          <button onclick="toggleMember('${id}'); event.stopPropagation();" class="w-6 h-6 flex items-center justify-center rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all active:scale-90" title="Close Session">
            <i data-lucide="x" class="w-4 h-4 text-red-600 dark:text-red-400 group-hover:text-white"></i>
          </button>
        </div>
      `;
      minimizedTrayContainer.appendChild(itemEl);
    });
  } else {
    minimizedRow.classList.add('hidden');
  }

  refreshIcons();
}

function renderMessagesForSession(memberId, container) {
  const member = state.tabs.find(t => t.id === memberId);
  if (!member) return;

  // Council mode: Each session shows only user input + this AI's response
  // (Not other AIs' responses)
  const sessionMessages = state.messages.filter(m => {
    if (m.senderType === 'human') return true; // Show all user inputs
    if (m.senderType === 'ai' && m.sender === member.name) return true; // Show this AI's response only
    return false;
  });
  
  container.innerHTML = '';
  sessionMessages.forEach(msg => {
    const isHuman = msg.senderType === 'human';
    const isSystem = msg.senderType === 'system';
    
    if (isSystem) {
      const sysEl = document.createElement('div');
      sysEl.className = "flex justify-center my-3";
      sysEl.innerHTML = `
        <div class="bg-gray-100/50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-[10px] px-2.5 py-0.5 rounded-full font-medium border border-gray-200/50 dark:border-gray-700/30 text-center">
          ${msg.text}
        </div>
      `;
      container.appendChild(sysEl);
      return;
    }

    const isAi = msg.senderType === 'ai';
    const hasThought = isAi && msg.thought && msg.thought.trim().length > 0;

    const msgEl = document.createElement('div');
    msgEl.className = `flex gap-2.5 max-w-[95%] ${isHuman ? 'ml-auto flex-row-reverse' : 'mr-auto'}`;
    
    const bubbleContent = isHuman ? escHtml(msg.text) : parseMarkdown(msg.text);
    const bubbleColor = isHuman 
      ? 'bg-indigo-600 text-white rounded-tr-sm' 
      : 'bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 text-gray-800 dark:text-gray-200 rounded-tl-sm';

    let thoughtHtml = '';
    if (hasThought) {
      const thoughtId = `thought-${msg.id}`;
      thoughtHtml = `
        <div class="thought-container mb-2 overflow-hidden border border-gray-100 dark:border-gray-800 rounded-xl bg-gray-50/50 dark:bg-gray-800/30 transition-all duration-300">
          <button class="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors uppercase tracking-wider text-left" 
                  onclick="const el = document.getElementById('${thoughtId}'); el.classList.toggle('hidden'); this.querySelector('.chevron-icon').classList.toggle('rotate-180')">
            <i data-lucide="brain" class="w-3.5 h-3.5"></i>
            Thought Process
            <i data-lucide="chevron-down" class="chevron-icon w-3 h-3 ml-auto transition-transform"></i>
          </button>
          <div id="${thoughtId}" class="thought-content hidden px-3 pb-3 text-[11px] text-gray-500 dark:text-gray-400 border-t border-gray-100/50 dark:border-gray-700/30 pt-2 leading-relaxed italic">
            ${msg.thought}
          </div>
        </div>
      `;
    }

    msgEl.innerHTML = `
      <div class="flex flex-col ${isHuman ? 'items-end' : 'items-start'}">
        <div class="flex items-baseline gap-1.5 mb-0.5 px-0.5">
          <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-tight">${isHuman ? 'You' : msg.sender}</span>
        </div>
        <div class="px-3 py-2 rounded-2xl text-[13px] leading-relaxed shadow-sm ${bubbleColor}">
          ${thoughtHtml}
          ${bubbleContent}
        </div>
      </div>
    `;
    container.appendChild(msgEl);
  });
  
  container.scrollTop = container.scrollHeight;
}

function renderControls() {
  controlsContainer.innerHTML = '';
  if (state.status === 'idle') {
    const startBtn = document.createElement('button');
    startBtn.className = "flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium transition-colors shadow-sm";
    startBtn.innerHTML = '<i data-lucide="play" class="w-3.5 h-3.5"></i> Start';
    startBtn.onclick = handleStart;
    controlsContainer.appendChild(startBtn);
  } else {
    const playPauseBtn = document.createElement('button');
    playPauseBtn.className = `flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors shadow-sm ${state.status === 'paused' ? 'bg-emerald-500 hover:bg-emerald-600 text-white' : 'btn-amber'}`;
    playPauseBtn.innerHTML = state.status === 'paused' ? '<i data-lucide="play" class="w-3.5 h-3.5"></i>' : '<i data-lucide="pause" class="w-3.5 h-3.5"></i>';
    playPauseBtn.onclick = state.status === 'paused' ? () => setStatus('running') : () => setStatus('paused');

    const stopBtn = document.createElement('button');
    stopBtn.className = "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors shadow-sm btn-red";
    stopBtn.innerHTML = '<i data-lucide="square" class="w-3.5 h-3.5"></i>';
    stopBtn.onclick = handleStop;
    
    controlsContainer.appendChild(playPauseBtn);
    controlsContainer.appendChild(stopBtn);
  }
  refreshIcons();
}

function updateStatusUI() {
  if (state.status === 'running') {
    statusPing.classList.remove('hidden');
    statusDot.className = 'relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500';
  } else if (state.status === 'paused') {
    statusPing.classList.add('hidden');
    statusDot.className = 'relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500';
  } else {
    statusPing.classList.add('hidden');
    statusDot.className = 'relative inline-flex rounded-full h-2.5 w-2.5 bg-gray-400';
  }
}

function updateSidebarUI() {
  const isLandscape = state.isLandscape;
  const sidebarOpen = state.sidebarOpen;

  // Update sidebar classes
  sidebar.className = `
    ${isLandscape ? 'relative' : 'absolute top-0 left-0 bottom-0 z-30 shadow-2xl'}
    ${sidebarOpen ? (isLandscape ? 'w-80' : 'translate-x-0 w-[85%] max-w-[320px]') : (isLandscape ? 'w-0' : '-translate-x-full w-[85%] max-w-[320px]')} 
    flex-shrink-0 border-r border-gray-200 dark:border-gray-800 
    bg-gray-50 dark:bg-gray-900 transition-all duration-300 ease-in-out
    flex flex-col overflow-hidden
  `;

  // Update overlay
  if (!isLandscape && sidebarOpen) {
    sidebarOverlay.classList.remove('hidden');
  } else {
    sidebarOverlay.classList.add('hidden');
  }

  // Update close button visibility
  if (!isLandscape) {
    closeSidebarBtn.classList.remove('hidden');
  } else {
    closeSidebarBtn.classList.add('hidden');
  }

  // Update open button visibility
  if (isLandscape) {
    openSidebarBtn.classList.remove('hidden');
  } else {
    openSidebarBtn.classList.remove('hidden');
  }
}

function updateTheme() {
  if (state.theme === 'dark') {
    document.documentElement.classList.add('dark');
    themeIcon.setAttribute('data-lucide', 'sun');
  } else {
    document.documentElement.classList.remove('dark');
    themeIcon.setAttribute('data-lucide', 'moon');
  }
  refreshIcons();
}

function renderModeToggle() {
  modeToggleContainer.innerHTML = `
    <div class="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
      <button id="council-mode-btn" class="mode-btn px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        state.mode === 'council'
          ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
      }">
        Council
      </button>
      <button id="debate-mode-btn" class="mode-btn px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        state.mode === 'debate'
          ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
      }">
        Debate
      </button>
    </div>
  `;
  
  document.getElementById('council-mode-btn').onclick = () => setMode('council');
  document.getElementById('debate-mode-btn').onclick = () => setMode('debate');
}

function setMode(mode) {
  state.mode = mode;
  saveState();
  renderModeToggle();
  updateDebateConfigVisibility();
  updateResponseTimeoutVisibility();
}

function updateDebateConfigVisibility() {
  const isDebateMode = state.mode === 'debate';
  
  if (debateConfigSection) {
    debateConfigSection.classList.toggle('hidden', !isDebateMode);
  }
  
  if (debateRoundsConfig) {
    debateRoundsConfig.classList.toggle('hidden', !isDebateMode);
  }
}

function updateResponseTimeoutVisibility() {
  const isDebateMode = state.mode === 'debate';
  if (responseTimeoutSection) {
    responseTimeoutSection.classList.toggle('hidden', !isDebateMode);
  }
}

// --- Storage Logic ---
function saveState() {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.set({ ai_workspace_state: state });
  }
}

// --- Tab Scanning ---
async function scanTabs() {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;

  // Reset connections
  state.tabs.forEach(t => { t.connected = false; t.tabId = null; });

  // Use PLATFORMS config (platforms.js) — no hardcoded list needed here
  for (const platform of PLATFORMS) {
    for (const urlPattern of platform.urlPatterns) {
      const tabs = await chrome.tabs.query({ url: urlPattern });
      if (tabs && tabs.length > 0) {
        const tabObj = state.tabs.find(t => t.id === platform.id);
        if (tabObj && !tabObj.connected) {
          tabObj.connected = true;
          tabObj.tabId = tabs[0].id;
          break; // first matching URL pattern wins
        }
      }
    }
  }

  // DO NOT filter activeMembers here!
  // Filtering out 'Not Ready' tabs on reload causes them to disappear.
  // We should keep them so they can be re-detected or manually re-opened.
  // state.activeMembers = state.activeMembers.filter(id => state.tabs.find(t => t.id === id)?.connected);

  saveState();
  render();

  // Relay scan results to web-ui.html via background service worker
  const results = state.tabs
    .filter(t => t.connected)
    .map(t => ({ id: t.id, name: t.name, tabId: t.tabId }));
  chrome.runtime.sendMessage({
    target: 'webui',
    type: 'tab_scan',
    data: results
  }).catch(() => {});
}

// --- AI Interaction via Content Scripts ---
async function getAIResponse(member, userMessage) {
  if (!member.tabId) return "[System]: Tab not found.";

  const platform = PLATFORMS.find(p => p.id === member.id);
  if (!platform) return `[Error]: No platform config for ${member.name}.`;

  // Background tabs have throttled JS and may block DOM interactions, 
  // but we try to avoid stealing focus. 
  // We'll update the tab WITHOUT making it active.
  try {
    await chrome.tabs.update(member.tabId, { active: false });
    await new Promise(r => setTimeout(r, 100));
  } catch { /* proceed anyway if tab fails to update */ }

  return new Promise((resolve) => {
    chrome.scripting.executeScript({
      target: { tabId: member.tabId },
      func: interactWithAI,
      args: [member.id, userMessage, platform.selectors, state.mode === 'debate' ? (state.config.responseTimeout || 30) : 0]
    }, (results) => {
      if (chrome.runtime.lastError) {
        resolve(`[Error]: Could not communicate with ${member.name} tab.`);
        return;
      }
      resolve(results?.[0]?.result || `[Error]: No response from ${member.name}.`);
    });
  });
}

// This function runs in the context of the AI's web page (injected via executeScript)
// selectors: { input: string[], sendBtn: string[], response: string[] } — from platforms.js config
async function interactWithAI(platformId, message, selectors, responseTimeout) {
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

          // 4. Polling for Response (Robust 1-for-all)
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
                this.console?.log('[Extension] New message element detected.');
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

// --- Orchestration Logic ---
// TODO [Future]: Implement debate mode orchestration
// - Council Mode (current): Broadcast same message to all AIs simultaneously
// - Debate Mode (future): Sequential debate with turn-based responses
async function runBroadcast(text, parentMsgId = null) {
  if (state.activeMembers.length === 0) return;

  // TODO [Future]: When state.mode === 'debate', implement debate orchestration
  // - Send initial message to all AIs
  // - Collect responses and feed back to AIs for counter-arguments
  // - After max debate turns, switch to consensus phase
  
  setStatus('running');

  const broadcastPromises = state.activeMembers.map(async (memberId) => {
    const member = state.tabs.find(t => t.id === memberId);
    if (!member || !member.connected) return;

    // Use a unique ID for the waiting message
    const waitingId = `wait-${memberId}-${Date.now()}`;
    state.messages.push({
      id: waitingId,
      sender: member.name,
      senderType: 'system',
      text: `Waiting for ${member.name}...`,
      timestamp: Date.now(),
      inReplyTo: parentMsgId,
    });
    render();

    try {
      const response = await getAIResponse(member, text);
      // Remove the waiting message
      state.messages = state.messages.filter(m => m.id !== waitingId);
      
      // Add to local state and relay to web-ui
      const msgId = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const isStruct = typeof response === 'object' && response !== null;
      
      const aiMsg = {
        id: msgId,
        sender: member.name,
        senderType: 'ai',
        text: isStruct ? response.answer : response,
        thought: isStruct ? response.thought : null,
        timestamp: Date.now(),
        inReplyTo: parentMsgId,
      };
      state.messages.push(aiMsg);
      saveState();
      chrome.runtime.sendMessage({ target: 'webui', type: 'ai_response', data: aiMsg }).catch(() => {});
      render();
    } catch (err) {
      state.messages = state.messages.filter(m => m.id !== waitingId);
      const msgId = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const aiMsg = {
        id: msgId,
        sender: member.name,
        senderType: 'ai',
        text: `[Error]: ${err.message}`,
        timestamp: Date.now(),
        inReplyTo: parentMsgId,
      };
      state.messages.push(aiMsg);
      saveState();
      chrome.runtime.sendMessage({ target: 'webui', type: 'ai_response', data: aiMsg }).catch(() => {});
      render();
    }
  });

  await Promise.all(broadcastPromises);
  setStatus('idle');
}

// --- Actions ---
function toggleMember(id) {
  if (state.activeMembers.includes(id)) {
    state.activeMembers = state.activeMembers.filter(m => m !== id);
    state.displayOrder = state.displayOrder.filter(m => m !== id);
  } else {
    state.activeMembers.push(id);
    if (!state.displayOrder.includes(id)) {
      state.displayOrder.push(id);
    }
  }
  saveState();
  render();
}

function minimizeMember(id) {
  // Move to end of displayOrder (which effectively minimizes it if there are >6)
  state.displayOrder = state.displayOrder.filter(m => m !== id);
  state.displayOrder.push(id);
  saveState();
  render();
}

function expandMember(id) {
  const index = state.displayOrder.indexOf(id);
  if (index >= 6) {
    // Requirements: Replace the last (6th) chat box
    // Index 5 is the 6th position
    const sixthId = state.displayOrder[5];
    
    // Swap them in the displayOrder
    state.displayOrder[index] = sixthId;
    state.displayOrder[5] = id;

    saveState();
    render();
  }
}

function setStatus(status) {
  state.status = status;
  render();
}

function handleStart() {
  const text = chatInput.value.trim();
  if (text) {
    handleSendMessage();
  }
}

function handleStop() {
  setStatus('idle');
  addMessage('System', 'system', 'Stopped.');
}

function handleClear() {
  if (confirm('Are you sure you want to clear the conversation?')) {
    state.messages = [{
      id: Date.now().toString(),
      sender: 'System',
      senderType: 'system',
      text: 'Conversation cleared.',
      timestamp: new Date()
    }];
    state.status = 'idle';
    saveState();
    render();
  }
}

function addMessage(sender, senderType, text, inReplyTo = null) {
  const msgId = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  state.messages.push({
    id: msgId,
    sender,
    senderType,
    text,
    timestamp: Date.now(),
    inReplyTo,
  });
  saveState();
  render();
}

async function handleSendMessage(e) {
  e?.preventDefault();
  const text = chatInput.value.trim();
  if (!text || state.activeMembers.length === 0) return;
  
  chatInput.value = '';
  sendButton.disabled = true;

  // Add to local state
  addMessage('You', 'human', text, null);
  
  await runBroadcast(text, null);
  
  sendButton.disabled = false;
}

// --- Event Listeners ---
function setupEventListeners() {
  chatInput.oninput = () => {
    sendButton.disabled = !chatInput.value.trim();
  };
  
  chatInput.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };
  
  chatForm.onsubmit = handleSendMessage;
  
  toggleThemeBtn.onclick = () => {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    updateTheme();
    saveState();
  };
  
  clearChatBtn.onclick = handleClear;
  
  openSidebarBtn.onclick = () => {
    state.sidebarOpen = true;
    updateSidebarUI();
  };
  
  closeSidebarBtn.onclick = () => {
    state.sidebarOpen = false;
    updateSidebarUI();
  };
  
  sidebarOverlay.onclick = () => {
    state.sidebarOpen = false;
    updateSidebarUI();
  };
  
  maxLengthSlider.oninput = (e) => {
    state.config.maxLength = parseInt(e.target.value);
    maxLengthValue.textContent = state.config.maxLength;
  };
  
  maxLengthSlider.onchange = () => {
    saveState();
  };

  responseTimeoutSlider.oninput = (e) => {
    state.config.responseTimeout = parseInt(e.target.value);
    responseTimeoutValue.textContent = state.config.responseTimeout;
  };
  responseTimeoutSlider.onchange = () => { saveState(); };

  if (scanTabsBtn) {
    scanTabsBtn.onclick = async () => {
      scanTabsBtn.disabled = true;
      scanTabsBtn.classList.add('scanning');
      await scanTabs();
      scanTabsBtn.classList.remove('scanning');
      scanTabsBtn.disabled = false;
    };
  }

  // Share button — open web UI in new tab
  if (shareBtn) {
    shareBtn.onclick = () => {
      const base = window.location.origin + window.location.pathname.replace(/\/$/, '');
      window.open(`${base}/web-ui.html`, '_blank');
    };
    shareBtn.title = 'Open full-screen view in new tab';
  }

  // How to Use modal open/close
  const openHowTo = () => { howtoModal.classList.remove('hidden'); refreshIcons(); };
  const closeHowTo = () => howtoModal.classList.add('hidden');
  howtoBtn.onclick = openHowTo;
  howtoClose.onclick = closeHowTo;
  howtoGotIt.onclick = closeHowTo;
  howtoOverlay.onclick = closeHowTo;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHowTo(); });

  // Delegated clicks inside sessions container (copy button + how-to button in empty state)
  sessionsContainer.addEventListener('click', e => {
    if (e.target.closest('.howto-open-btn')) { openHowTo(); return; }
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    const codeEl = btn.closest('.code-block')?.querySelector('pre > code');
    if (!codeEl) return;
    const text = codeEl.textContent || '';
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    }).catch(() => {
      // Fallback for environments without Clipboard API
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* silent */ }
      document.body.removeChild(ta);
    });
  });

  window.onresize = () => {
    const landscape = window.innerWidth > window.innerHeight;
    if (landscape !== state.isLandscape) {
      state.isLandscape = landscape;
      state.sidebarOpen = landscape;
      updateSidebarUI();
    }
  };
}

// --- Start App ---
init();

if (typeof chrome !== 'undefined' && chrome.tabs) {
  let scanTimeout = null;
  const triggerLocalAutoScan = () => {
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
      scanTabs();
    }, 200);
  };
  
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
      triggerLocalAutoScan();
    }
  });

  chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    triggerLocalAutoScan();
  });
}
