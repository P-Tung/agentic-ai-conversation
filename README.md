# Agentic AI Conversation

A system for sending a single message to **multiple AI chatbots** (ChatGPT, Claude, Gemini, Grok, Perplexity, Kimi, Z.ai, MiniMax, GenSpark) simultaneously and viewing their responses side-by-side. The Chrome extension acts as an **invisible bridge** between a full-screen web UI and the AI chat tabs.

## Core Design Philosophy

> **The extension is NOT the UI. The extension is the bridge.**

- The **Web UI** (`web-ui.html`) is the primary user interface, served from `localhost:8080`
- The **Chrome Extension** runs silently in the background as a relay/bridge
- The extension scans for open AI tabs, injects messages into them, captures responses, and sends them back to the web UI
- The user never needs to interact with the extension UI directly
- **No side panel required.** The bridge logic runs entirely in the background service worker.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Web UI (localhost:8080/web-ui.html)             │
│  Full-screen primary interface                   │
│                                                  │
│  chrome.runtime.connect(EXTENSION_ID) ───────────┼──┐
│  port.onMessage ◄────────────────────────────────┼──┘
└──────────────────────────────────────────────────┘
              ▲                              │
              │ Port: 'webui-bridge'         │
              │ (externally_connectable)     │
              │                              ▼
┌──────────────────────────────────────────────────┐
│  background.js (Service Worker)                  │
│                                                  │
│  Central hub + relay logic combined:             │
│  • Receives commands from Web UI                 │
│  • Scans browser tabs for AI chat pages          │
│  • Injects messages via chrome.scripting API     │
│  • Polls for AI responses                        │
│  • Sends responses back to Web UI via port       │
└──────────────────────────────────────────────────┘
              │
              │ chrome.tabs.query()
              │ chrome.scripting.executeScript()
              ▼
┌──────────────────────────────────────────────────┐
│  AI Tabs (ChatGPT, Claude, Gemini, Grok, etc.)  │
│  Open in regular browser tabs                    │
└──────────────────────────────────────────────────┘
```

## Message Flow

### 1. User sends a message (Web UI → AI tabs)

```
Web UI:  user types message, clicks Send
  → port.postMessage({ type: 'ai_command', payload: { memberId, message, ... } })
    → background.js receives on webui-bridge port
      → executes directly: injects message into AI tab via executeScript
        → AI tab: types message, clicks send button
```

### 2. AI responds (AI tabs → Web UI)

```
AI tab:  generates response text
  → background.js: polls response selector, detects stable text
    → port.postMessage to webui-bridge port
      → Web UI: displays response in session window
```

### 3. Tab scanning (discover which AI tabs are open)

```
Web UI:  user clicks "Scan for AI Tabs"
  → background.js: chrome.tabs.query() for each platform's URL patterns
    → returns list of detected AI tabs
      → Web UI: renders available AI members in sidebar
```

## File Reference

| File | Role | Key Responsibility |
|------|------|-------------------|
| `web-ui.html` | **Primary UI** | Full-screen interface served from localhost. User interacts here. |
| `background.js` | **Service Worker + Relay** | Central message hub + bridge logic. Scans tabs, injects messages, captures responses. |
| `platforms.js` | **Platform Config** | URL patterns and CSS selectors for each AI chatbot (used by web-ui). |
| `manifest.json` | **Extension Config** | Permissions, externally_connectable, service worker registration. |
| `syntax-highlight.js` | **Utility** | Code block syntax highlighting for AI responses. |
| `index.html` | **Legacy Side Panel** | Extension panel (no longer required for bridge to work). |
| `script.js` | **Legacy Side Panel UI** | UI logic for the extension's own side panel (secondary, optional). |

## Supported AI Platforms

| Platform | URL Pattern | Status |
|----------|------------|--------|
| ChatGPT | `chatgpt.com` | ✅ Supported |
| Claude | `claude.ai` | ✅ Supported |
| Gemini | `gemini.google.com` | ✅ Supported |
| Grok | `grok.com`, `x.com/i/grok` | ✅ Supported |
| Perplexity | `perplexity.ai` | ✅ Supported |
| Kimi | `kimi.com` | ✅ Supported |
| Z.ai | `chat.z.ai` | ✅ Supported |
| MiniMax | `agent.minimax.io` | ✅ Supported |
| GenSpark | `genspark.ai` | ✅ Supported |

Adding a new platform requires only adding an entry to `platforms.js` with URL patterns and CSS selectors.

## Communication Protocol

All communication uses **Chrome port-based messaging** (`chrome.runtime.connect`).

### Port Types

| Port Name | Direction | Purpose |
|-----------|-----------|---------|
| `webui-bridge` | Web UI ↔ Background | Commands from UI, responses back to UI |

### Message Formats

**Web UI → Background:**
```js
{ target: 'background', id: 'wui_123_0', type: 'ping' | 'scan_tabs' | 'ai_command', payload: {...} }
```

**Background → Web UI:**
```js
{ target: 'webui', id: 'wui_123_0', responseType: 'tab_scan' | 'ai_response', data: ... }
```

## Key Concepts

- **`externally_connectable`**: Manifest setting that allows the localhost web page to connect to the extension using `chrome.runtime.connect(EXTENSION_ID)`
- **`onConnect` vs `onConnectExternal`**: Internal extension pages use `onConnect`, external pages (localhost) use `onConnectExternal`. Both are handled by the same `handlePortConnection` function in `background.js`
- **`chrome.scripting.executeScript`**: Used by background.js to inject JavaScript into AI chat tabs to type messages and read responses
- **Platform selectors**: Each AI platform has CSS selectors for its input box, send button, and response container defined in `platforms.js`

## Setup & Usage

### Prerequisites

- Google Chrome browser
- AI chat accounts (ChatGPT, Claude, etc.)
- Local web server on port 8080

### Install Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this project folder
4. Note the **Extension ID** from the extensions page

### Run Web UI

1. Serve this folder on localhost:8080 (e.g. `npx serve -l 8080`)
2. Open `http://localhost:8080/web-ui.html`

### Use

1. **Open AI tabs**: Open ChatGPT, Claude, Gemini, Grok, or Perplexity in separate tabs
2. **Scan**: Click "Scan for AI Tabs" in the web UI sidebar
3. **Select**: Toggle which AIs to include in the conversation
4. **Send**: Type a message and hit Send. All selected AIs receive it simultaneously.
5. **View**: Responses appear in side-by-side session windows

### Important Notes

- AI tabs must be **open and logged in** before scanning
- The extension ID is hardcoded in `web-ui.html` as `EXTENSION_ID` constant
- If the extension is reloaded, the ID may change, requiring an update in `web-ui.html`
- **No side panel needed.** The bridge runs entirely in the background service worker.

## For Developers / Agents

### Adding a New AI Platform

Add an entry to `platforms.js`:

```js
{
  id: 'newai',
  name: 'New AI',
  iconSrc: 'assets/newai-icon.svg',
  urlPatterns: ['*://newai.com/*'],
  selectors: {
    input: ['textarea', 'div[contenteditable="true"]'],
    sendBtn: ['button[type="submit"]'],
    response: ['.response-text'],
  },
}
```

### Debugging

- **Service Worker console**: `chrome://extensions` → click "Inspect views: service worker"
- **Web UI console**: Standard browser DevTools (F12)
- Look for `[SW]` prefixed logs in service worker

### Architecture Rules

- **Never put primary UI logic in the extension.** The extension is purely a bridge.
- **All user-facing features go in `web-ui.html`.** The extension is secondary.
- **Communication is port-based.** Do not use `chrome.runtime.sendMessage` for web UI communication, use ports (`chrome.runtime.connect`).
- **Platform configs are data, not code.** Adding a new AI should only require updating `platforms.js`.
- **The bridge runs in the background.** No side panel or popup is required for the extension to work.
