// Platform configurations
// Add or update platforms here without touching core logic in script.js
const PLATFORMS = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    iconSrc: 'assets/chatgpt-icon.svg',
    urlPatterns: ['*://chatgpt.com/*'],
    homeUrl: 'https://chatgpt.com/',
    selectors: {
      // Tried in order; first match wins
      input: ['#prompt-textarea', 'div[contenteditable="true"]'],
      sendBtn: ['button[data-testid="send-button"]'],
      response: ['.markdown'],
      exclude: ['.thought-block', 'details']
    },
  },
  {
    id: 'claude',
    name: 'Claude',
    iconSrc: 'assets/claude-ai-icon.svg',
    urlPatterns: ['*://claude.ai/*', '*://*.claude.ai/*'],
    homeUrl: 'https://claude.ai/',
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
      exclude: ['details']
    },
  },
  {
    id: 'gemini',
    name: 'Gemini',
    iconSrc: 'assets/google-gemini-icon.svg',
    urlPatterns: ['*://gemini.google.com/*'],
    homeUrl: 'https://gemini.google.com/',
    selectors: {
      input: ['div.ql-editor', 'textarea'],
      sendBtn: ['.send-button', 'button[aria-label="Send message"]'],
      response: ['message-content'],
      exclude: []
    },
  },
  {
    id: 'grok',
    name: 'Grok',
    iconSrc: 'assets/grok-icon.svg',
    urlPatterns: ['*://grok.com/*', '*://*.grok.com/*', '*://x.com/i/grok*', '*://twitter.com/i/grok*'],
    homeUrl: 'https://grok.com/',
    selectors: {
      input: ['div[contenteditable="true"]', 'textarea'],
      sendBtn: [
        'button[aria-label="Send message"]',
        'button[type="submit"]',
        'button[aria-label="Grok something"]',
      ],
      response: ['.response-content-markdown', '.message-content', '.message-text'],
      exclude: ['.thought']
    },
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    iconSrc: 'assets/perplexity-ai-icon.svg',
    urlPatterns: ['*://www.perplexity.ai/*'],
    homeUrl: 'https://www.perplexity.ai/',
    selectors: {
      input: ['div[contenteditable="true"]', 'textarea[placeholder*="Ask"]', 'textarea'],
      sendBtn: ['button[aria-label="Submit"]', 'button[type="submit"]'],
      response: ['.prose', '[class*="answer"]'],
      exclude: []
    },
  },
  {
    id: 'kimi',
    name: 'Kimi',
    iconSrc: 'assets/kimi-icon.png',
    urlPatterns: ['*://www.kimi.com/*', '*://*.kimi.com/*'],
    homeUrl: 'https://www.kimi.com/',
    selectors: {
      input: ['.chat-input-editor', 'div[role="textbox"]'],
      sendBtn: ['.send-button-container', 'button:has(svg[class*="send"])'],
      response: ['.markdown-container'],
      exclude: []
    },
  },
  {
    id: 'zai',
    name: 'Z.ai',
    iconSrc: 'assets/zai-icon.png',
    urlPatterns: ['*://chat.z.ai/*'],
    homeUrl: 'https://chat.z.ai/',
    selectors: {
      input: ['#chat-input'],
      sendBtn: ['#send-message-button'],
      response: ['.markdown-prose'],
      exclude: [
        '.thought-process', 
        '.thinking-block', 
        '.thinking-process', 
        '.thought-container',
        '.thought-block',
        'details',
        '[class*="thought"]',
        '[class*="thinking"]'
      ]
    },
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    iconSrc: 'assets/minimax-icon.png',
    urlPatterns: ['*://agent.minimax.io/*'],
    homeUrl: 'https://agent.minimax.io/',
    selectors: {
      input: ['.tiptap-editor', 'div[contenteditable="true"]'],
      sendBtn: ['button:has(svg)', 'div:has(svg)'],
      response: ['.content_wrap', '.markdown-body'],
      exclude: []
    },
  },
];
