# Upgrade Log

## v1.2 - Council Mode Implementation (Current)

### Completed

- [x] **Council Mode**: Broadcast same message to all AIs simultaneously
  - User inputs one message in sidebar
  - Message sent to all selected AI platforms (ChatGPT, Claude, Gemini, Grok, Perplexity)
  - Responses displayed in grid layout (vertically split):
    - 1 AI: 1 column
    - 2 AI: 2 columns side-by-side
    - 3 AI: 3 columns side-by-side
    - 4 AI: 2x2 grid
    - 5-6 AI: 3x2 grid
  - Max 6 AI sessions at a time

- [x] **Mode Toggle**: Council / Debate toggle in header
  - Council mode active by default
  - Debate config hidden when in Council mode

- [x] **Debate Config**: Collapsed by default (shown only in Debate mode)
  - Max Rounds
  - Max Debate Turns
  - Debate Instruction
  - Consensus Instruction

### TODO [Future]

- [ ] **Debate Mode**: Sequential debate orchestration
  - Send initial message to all AIs
  - Collect responses and feed back to AIs for counter-arguments
  - After max debate turns, switch to consensus phase
  - Reference implementation from original design:
    ```js
    let currentTurn = 0;
    const MAX_TURNS = 4;

    function prepareNextMessage(previousAiMessage) {
        currentTurn++;
        
        if (currentTurn <= MAX_TURNS) {
            // Debate state
            return `[Instruction: Act as a critical debater. Identify flaws and counter the following argument strictly concisely.]\n\n${previousAiMessage}`;
        } else {
            // Consensus state
            return `[Instruction: Stop debating. Synthesize the above arguments and provide the final unified solution strictly concisely.]\n\n${previousAiMessage}`;
        }
    }
    ```

---

## v1.1 - Previous Updates

- Initial multi-AI discussion workspace
- Support for ChatGPT, Claude, Gemini, Grok, Perplexity
- Content script injection for AI interaction
- Syntax highlighting for code blocks
- Dark/light theme toggle
- State persistence via Chrome Storage API
