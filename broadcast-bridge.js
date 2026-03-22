// BroadcastChannel Bridge — same-device real-time messaging
// web-ui.html ↔ index.html (extension bridge) ↔ AI tabs

class BroadcastBridge {
  constructor(prefix = 'council') {
    this._prefix = prefix;
    this._channel = null;
    this._listeners = [];
    this._messages = [];
    this._config = {};
    this._sessionId = null;
    this._initialized = false;
    this._extensionOnline = false;
    this._pendingPings = [];
  }

  init() {
    if (this._initialized) return;
    this._sessionId = this._getOrCreateSessionId();
    this._channel = new BroadcastChannel(`${this._prefix}_${this._sessionId}`);

    this._channel.onmessage = (event) => {
      const { type, data } = event.data || {};

      if (type === 'pong') {
        this._extensionOnline = true;
        this._pendingPings.forEach(cb => cb(true));
        this._pendingPings = [];
      }

      if (type === 'tab_scan') {
        this._listeners.forEach(cb => cb({ type: 'tab_scan', data }));
      } else if (type === 'ai_response') {
        this._messages.push(data);
        this._listeners.forEach(cb => cb({ type: 'message', data }));
      } else if (type === 'human_message') {
        this._messages.push(data);
        this._listeners.forEach(cb => cb({ type: 'message', data }));
      } else if (type === 'ai_waiting') {
        this._messages.push(data);
        this._listeners.forEach(cb => cb({ type: 'message', data }));
      } else if (type === 'ai_done') {
        // Remove waiting message
        this._messages = this._messages.filter(m => m.id !== data.waitingId);
        this._listeners.forEach(cb => cb({ type: 'message', data: { id: '__removed__', waitingId: data.waitingId } }));
        // Add actual response
        this._messages.push(data.response);
        this._listeners.forEach(cb => cb({ type: 'message', data: data.response }));
      } else if (type === 'config') {
        this._config = { ...this._config, ...data };
        this._configListeners.forEach(cb => cb(this._config));
      } else if (type === 'status') {
        this._statusListeners.forEach(cb => cb(data));
      }
    };

    this._initialized = true;
    console.log('[BroadcastBridge] Initialized. Session:', this._sessionId);
  }

  _getOrCreateSessionId() {
    let sessionId = sessionStorage.getItem('council_session_id');
    if (!sessionId) {
      sessionId = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem('council_session_id', sessionId);
    }
    return sessionId;
  }

  // --- Ping to discover extension ---
  pingExtension(callback) {
    this._broadcast({ type: 'ping' });
    if (callback) {
      if (this._extensionOnline) {
        callback(true);
      } else {
        this._pendingPings.push(callback);
        setTimeout(() => {
          const idx = this._pendingPings.indexOf(callback);
          if (idx !== -1) {
            this._pendingPings.splice(idx, 1);
            callback(false);
          }
        }, 2000);
      }
    }
  }

  isExtensionOnline() { return this._extensionOnline; }

  // --- Config ---
  setConfig(config) {
    this._config = { ...this._config, ...config };
    this._broadcast({ type: 'config', data: this._config });
  }

  getConfig() { return this._config; }

  _configListeners = [];
  onConfigChange(callback) {
    this._configListeners.push(callback);
    return () => { this._configListeners = this._configListeners.filter(cb => cb !== callback); };
  }

  // --- Status ---
  _statusListeners = [];
  onStatusChange(callback) {
    this._statusListeners.push(callback);
    return () => { this._statusListeners = this._statusListeners.filter(cb => cb !== callback); };
  }

  // --- Messages ---
  sendHumanMessage(sender, text, id) {
    const msgData = { id, sender, senderType: 'human', text, timestamp: Date.now(), inReplyTo: null };
    this._messages.push(msgData);
    this._broadcast({ type: 'human_message', data: msgData });
    this._listeners.forEach(cb => cb({ type: 'message', data: msgData }));
    return id;
  }

  sendToAI(memberId, memberName, message, waitingId, responseTimeout) {
    this._broadcast({
      type: 'ai_command',
      data: { memberId, memberName, message, waitingId, responseTimeout }
    });
  }

  clearMessages() {
    this._messages = [];
    this._broadcast({ type: 'clear_messages' });
  }

  onMessages(callback) {
    this._listeners.push(callback);
    return () => { this._listeners = this._listeners.filter(cb => cb !== callback); };
  }

  getMessages() { return [...this._messages]; }

  // --- Sharing ---
  getShareUrl() {
    const base = window.location.origin + window.location.pathname.replace(/\/$/, '');
    return `${base}/web-ui.html?session=${encodeURIComponent(this._sessionId)}`;
  }

  async joinSession(sessionId) {
    if (sessionId && sessionId !== this._sessionId) {
      sessionStorage.setItem('council_session_id', sessionId);
      this._sessionId = sessionId;
      if (this._channel) this._channel.close();
      this._channel = new BroadcastChannel(`${this._prefix}_${this._sessionId}`);
      this._messages = [];
      this._channel.onmessage = (event) => {
        const { type, data } = event.data || {};
        if (type === 'pong') { this._extensionOnline = true; }
        if (type === 'tab_scan') this._listeners.forEach(cb => cb({ type: 'tab_scan', data }));
        else if (type === 'ai_response') { this._messages.push(data); this._listeners.forEach(cb => cb({ type: 'message', data })); }
        else if (type === 'human_message') { this._messages.push(data); this._listeners.forEach(cb => cb({ type: 'message', data })); }
        else if (type === 'ai_waiting') { this._messages.push(data); this._listeners.forEach(cb => cb({ type: 'message', data })); }
        else if (type === 'ai_done') {
          this._messages = this._messages.filter(m => m.id !== data.waitingId);
          this._listeners.forEach(cb => cb({ type: 'message', data: { id: '__removed__', waitingId: data.waitingId } }));
          this._messages.push(data.response);
          this._listeners.forEach(cb => cb({ type: 'message', data: data.response }));
        } else if (type === 'config') { this._config = { ...this._config, ...data }; this._configListeners.forEach(cb => cb(this._config)); }
        else if (type === 'status') { this._statusListeners.forEach(cb => cb(data)); }
      };
    }
  }

  getConversationId() { return this._sessionId; }

  _broadcast(payload) {
    if (this._channel) this._channel.postMessage(payload);
  }

  destroy() {
    if (this._channel) this._channel.close();
    this._listeners = [];
    this._configListeners = [];
    this._statusListeners = [];
  }
}

const bcBridge = new BroadcastBridge();
