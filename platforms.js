// Platform configurations
// Add or update platforms here without touching core logic in script.js
const PLATFORMS = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    iconSrc: 'assets/chatgpt-icon.svg',
    urlPatterns: ['*://chatgpt.com/*'],
    selectors: {
      // Tried in order; first match wins
      input: ['#prompt-textarea', 'div[contenteditable="true"]'],
      sendBtn: ['button[data-testid="send-button"]'],
      response: ['.markdown'],
    },
  },
  {
    id: 'claude',
    name: 'Claude',
    iconSrc: 'assets/claude-ai-icon.svg',
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
    iconSrc: 'assets/google-gemini-icon.svg',
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
    iconSrc: 'assets/grok-icon.svg',
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
    iconSrc: 'assets/perplexity-ai-icon.svg',
    urlPatterns: ['*://www.perplexity.ai/*'],
    selectors: {
      input: ['div[contenteditable="true"]', 'textarea[placeholder*="Ask"]', 'textarea'],
      sendBtn: ['button[aria-label="Submit"]', 'button[type="submit"]'],
      response: ['.prose', '[class*="answer"]'],
    },
  },
];
