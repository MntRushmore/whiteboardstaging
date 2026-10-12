# Ask, rebuilt (2026-10-11)

**Goal:** make the board chat a tutor a kid wants to come back to, and that a parent sees is worth $25 a month.

## Where Ask stood on 2026-10-11 (prod)

- **Slow.** The primary model, `gpt-5.4-mini`, timed out at 18 s about once a day, and nothing streamed. A kid stared at "Thinking…" for 2–20 s.
- **Mute.** Replies were capped at 280 characters, and the prompt forbade explaining in the panel. It refused anything that wasn't maths.
- **Blind.** It saw only the LaTeX read from the current screen: no drawings, no pictures, no PDFs.
- **Forgetful.** History lived in tab memory: 6 turns of 400 characters each, gone on reload, and nothing carried between boards.
- **Silent.** It had no voice in or out.
- **Hidden.** On the kid board, Ask was in the grown-up "More" menu.
- **Unreliable on the board.** "I couldn't check that problem, so I didn't write it" showed up 6 times in a week (`live.chat` `note_write_problems`, client side).

Usage that week: 145 asks from 10 subscribers.

## The owner's decisions

- Rebuild Ask.
- The chat may help with **any school subject**: maths, reading, writing, science, history. **The board stays maths**, with the same board actions and the same engine checks.
- Not this time: "Show me" talking lessons, homework photos, and trial emails.

## What it is now

- **Streams.** POST `/api/live/ask` sends Server-Sent Events. The reply's words show as they're written, and the board actions come after the engine has checked them.
- **Model.** Haiku 5.5 is the primary, with GPT-5.4 mini from another provider as the fallback. These are provisional until `eval:ask` picks.
  - A short first-content watchdog (about 5 s) hands over to the fallback.
  - Both models answer within the route's budget.
- **The model's output** is a reply in Markdown-lite: paragraphs, `**bold**`, `-` and `1.` lists, `$…$` and `$$…$$` maths.
  - It may end with ONE `<board>{"actions":[…]}</board>` block. The actions are exactly the old `ChatAction`s.
  - `AskStreamSplitter` (`src/lib/live/ask/splitter.ts`) splits the two as the text streams.
- **Explains like a tutor.** It talks at the kid's grade level and asks before it tells, but never stonewalls. It is kind and short by default, and goes longer when asked to explain.
- **Hears and speaks.**
  - Hold the mic to talk: POST `/api/live/transcribe` (ElevenLabs Scribe), or the browser's recognizer if Scribe isn't available.
  - Replies are read aloud sentence by sentence as they stream, in the Hope voice (`src/lib/speech`).
  - Read-aloud follows the existing setting (on by default for K–2), and the panel has its own speaker toggle.
- **Sees the screen.** A JPEG of the current screen (`captureAskImage`) goes with the LaTeX when the screen isn't empty.
- **Remembers.**
  - Every turn is saved per board (`ask_messages`), so a reload keeps the chat.
  - A short `learner_memory` (up to 12 notes about how this kid learns) carries across boards. A cheap model updates it after each turn (`after()`).
  - A board with no chat opens with a hello built from what the tutor knows: "Welcome back, Maya! Last time you worked on dividing fractions." Chips come with it.
- **Findable.** On the kid board, Ask is a big button in the dock.

## The contract (commit on `feat/ask-v2`)

| File | What |
|---|---|
| `src/lib/live/ask/contracts.ts` | Request, SSE events, saved turns, hello, memory, transcribe, limits, paths |
| `src/lib/live/ask/splitter.ts` | Reply / board-block splitter (done, tested) |
| `src/lib/live/chat/contracts.ts` | New action `help_board {depth: step\|solve}`: Help me / Solve it on the student's OWN work (stubbed in `ChatDesk`; the board part runs it) |
| `src/lib/live/contracts.ts` | `LIVE_MODELS.ask/askFallback/askMemory/askMemoryFallback`, `LIVE_RATE_LIMITS.liveTranscribe`, `LiveController.chatImage?()` |
| `src/lib/env.ts` | `LIVE_MODEL_ASK`, `getLiveModels().ask…` |
| `src/lib/server/ask/store.ts` | STUB: save, load and remember (never throws) |
| `src/lib/server/prompts/ask.ts` | STUB: `buildAskMessages`, `cleanAskReply` |
| `src/lib/live/ask/client.ts` | STUB: `streamAsk` with handlers, and `AskStreamError` |
| `src/lib/live/ask/boardImage.ts` | STUB: `captureAskImage` |
| `src/components/chat/voice/AskMic.tsx`, `useAskSpeech.ts` | STUB: the mic and read-aloud |
| `src/app/api/live/ask/route.ts` | STUB: 501 |

## The parts (one agent each, on its own branch off `feat/ask-v2`)

| Part | Branch | Owns |
|---|---|---|
| Server | `feat/ask2-server` | `src/app/api/live/ask/route.ts`. It moves the old route's engine gates into a shared `src/lib/server/chatGate.ts` that both `/api/live/chat` and `/api/live/ask` use. It also covers: streaming with fallback and watchdogs, the image passed to the model, metering (`live/chat`, 3 ink, refunded as before), saving turns, `after()` memory, events and logs, and route tests. |
| Brain | `feat/ask2-brain` | `src/lib/server/prompts/ask.ts`, `npm run eval:ask` (`src/__eval__/ask`), the model bake-off and `docs/eval/ask.md`, and the `LIVE_MODELS.ask*` values. |
| Memory | `feat/ask2-memory` | Migration `20261011000000_ask_v2.sql`, plus its `verify-rls` checks. `src/lib/server/ask/store.ts` and the memory prompt `src/lib/server/prompts/askMemory.ts`. `GET /api/live/ask/history` (turns and hello), and `GET` and `DELETE /api/live/ask/memory`. The account page's "What Ask remembers". The admin board viewer's Ask tab. The privacy line. |
| Panel | `feat/ask2-panel` | `src/lib/live/ask/client.ts`, the panel rebuilt (`src/components/chat/*`): streaming, rich text with KaTeX, hello and chips, saved history, and mounting the mic, speech and image. The kid dock's Ask button. |
| Voice | `feat/ask2-voice` | `src/components/chat/voice/*` and `POST /api/live/transcribe`. |
| Vision | `feat/ask2-vision` | `src/lib/live/ask/boardImage.ts` and `LiveLoop.chatImage`. |
| Board | `fix/ask2-board` | The engine and board side of the chat's actions: why problems are refused (client vs server verify), K–8 problem kinds, and Help on the student's own problems. |

## Rules for every part

- **Bundle.** The board's first load has about 10 KB left (`docs/BUNDLE.md`). The panel, KaTeX, the mic, speech and image capture all load with a dynamic import, never with the board. Run `npm run build && npm run bundle:check`.
- **Never touch prod.** That means no Management API, no Vercel env, no live Stripe, and no real emails. The local Supabase stack is fine.
- **Design.** Never add a gradient (the owner hates them). Use flat fills and the existing tokens and components (`src/components/ui`). Tap targets are 44 px. Use US English. Copy is kid-simple: a 7-year-old reads the panel. Check at 390×844, 820×1180 and 1180×820.
- **Kids.**
  - Nothing ever asks a kid for personal details. The memory keeps only how they learn, never who they are.
  - Kids never see billing.
  - Anything unsafe gets a kind no and a pointer to a grown-up.
- **Code.**
  - Match the surrounding code: its comment style (why, in plain words), zod at the edges, and pure view logic with unit tests.
  - Run `npx vitest run <your files>` and `npx tsc --noEmit`.
  - Lint with `npx eslint --ignore-pattern '.claude/**' <paths>` (a plain `npm run lint` crawls 40+ worktrees).
- **Commits.** Commit on your branch with a clear message, and don't push. Finish with a short report: what works, how you checked it, and what's left.
