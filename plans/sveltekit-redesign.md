# SvelteKit Pi Phone Redesign Plan

## Context

Pi Phone already has a feature-complete static frontend in `public/` and a backed-up copy in `frontend-legacy/public/`. The `svelte` branch now has a SvelteKit app in `frontend/` plus the Svelte AI Elements/shadcn-svelte component set in `frontend/src/lib/components/ai-elements/`.

The goal is to rebuild the frontend in SvelteKit while preserving every current Pi Phone capability, improving placement and visual polish, and using Svelte AI Elements where they fit. User preferences from planning questions:

- Main layout: **split workspace** — desktop/tablet gets chat plus side panels; mobile collapses panels into sheets/drawers.
- Composer: **AI input bar** — use Svelte AI Elements `PromptInput` as the central composer while preserving attach, commands, `/cd`, steer/follow-up, stop/send, autocomplete, quota, and inline image tokens.
- Visual direction: **neutral shadcn** — calmer dark shadcn styling instead of heavy glow, while keeping Pi Phone identity and phone-first usability.
- First priority after transport/state parity: **chat rendering** — messages, markdown, tool calls, reasoning/thinking, live streaming, attachments, and scroll behavior first.

## Approach

Build the SvelteKit app as a typed, componentized replacement for the current static frontend, but keep the backend/API/WebSocket protocol unchanged. Do not introduce Vercel/OpenRouter server routes; adapt Pi Phone's existing `/api/health`, `/api/quota`, and `/ws` envelopes into Svelte stores and Svelte AI Elements components.

Recommended product shape:

- **Desktop/tablet split workspace**
  - Center chat is dominant by default.
  - Left session rail and right inspector are both collapsible by default and opened from clear toolbar controls.
  - Left rail/sidebar: active sessions, parent/parallel status, saved sessions shortcut.
  - Right inspector panel: context/quota, model/thinking, tree, stats, selected tool/artifact details.
- **Mobile layout**
  - Chat-first single column.
  - Top compact status bar with connection/session/model state.
  - Bottom AI input bar.
  - Sessions/actions/models/tree/stats as shadcn drawers/sheets or command dialogs.
- **Feature parity first, polish second**
  - Port data/state/protocol faithfully before changing flows.
  - Keep `public/` serving the old frontend until the Svelte build reaches parity.
  - Use `frontend-legacy/public/` as visual/behavior reference.

## Files to modify

Primary SvelteKit files:

- `frontend/src/routes/+page.svelte` — replace staging page with the new app shell.
- `frontend/src/routes/+layout.svelte` and `frontend/src/routes/layout.css` — global theme, safe-area, responsive shell, shadcn tokens.
- `frontend/src/lib/pi-phone-transport.ts` — expand typed transport for health, quota, WebSocket lifecycle, reconnect, auth, RPC/local commands.
- `frontend/src/lib/ai-config.ts` — keep as internal tooling notes or fold into transport docs.
- `frontend/src/lib/utils.ts` and `frontend/src/lib/hooks/use-clipboard.svelte.ts` — maintain shadcn/Svelte AI Elements compatibility helpers.

New Svelte app modules to add:

- `frontend/src/lib/stores/phone-state.svelte.ts` — canonical Svelte state replacing `public/app/state.js`.
- `frontend/src/lib/stores/derived.ts` — derived connection/session/model/quota/composer/chat state.
- `frontend/src/lib/types/pi-phone.ts` — typed envelopes, snapshots, messages, sessions, commands, tools, quota, UI requests.
- `frontend/src/lib/actions/phone-commands.ts` — prompt submission, local commands, slash commands, abort/reload/compact/model/thinking/session commands.
- `frontend/src/lib/actions/attachments.ts` — image attachment records, inline token ordering, base64 conversion, cleanup.
- `frontend/src/lib/actions/autocomplete.ts` — slash command, `/cd`, and `@path` autocomplete detection and application.
- `frontend/src/lib/adapters/message-adapter.ts` — transform Pi message payloads into renderable chat items.
- `frontend/src/lib/adapters/tool-adapter.ts` — transform tool events/results into `Tool`, `Code`, `Artifact`, or terminal previews.
- `frontend/src/lib/adapters/sheet-adapter.ts` — group models, thinking levels, commands, sessions, stats, and tree nodes.
- `frontend/src/lib/components/app/AppShell.svelte` — responsive split workspace shell.
- `frontend/src/lib/components/app/TopStatusBar.svelte` — connection, cwd, session, model, thinking, streaming, server.
- `frontend/src/lib/components/app/SessionRail.svelte` — parent/parallel sessions and saved-session entry points.
- `frontend/src/lib/components/app/InspectorPanel.svelte` — quota/context, stats, selected details, tree/model actions.
- `frontend/src/lib/components/chat/ChatWorkspace.svelte` — conversation area plus jump-to-latest behavior.
- `frontend/src/lib/components/chat/ChatMessage.svelte` — role-aware message wrapper using AI Elements `Message`/`Response`.
- `frontend/src/lib/components/chat/ToolCallCard.svelte` — tool display using AI Elements `Tool`, `Code`, `Artifact`, `Task`, `Loader`.
- `frontend/src/lib/components/chat/ComposerBar.svelte` — AI Elements `PromptInput` implementation.
- `frontend/src/lib/components/chat/AttachmentTray.svelte` — attachment previews and inline token management.
- `frontend/src/lib/components/chat/AutocompleteStrip.svelte` — slash/path suggestions using `Suggestion` and command metadata.
- `frontend/src/lib/components/sheets/*.svelte` — actions, commands, models, thinking, sessions, tree, stats, login, and extension UI requests.
- `frontend/src/lib/components/feedback/ToastHost.svelte` and `Banner.svelte` — replace imperative DOM toasts/banners.

Packaging/release files once parity is reached:

- `frontend/svelte.config.js` — optionally switch build output toward `../public` or keep copy step.
- `package.json` — add a release script to build SvelteKit and sync output to `public/`.
- `src/extension/phone-static.ts` — only if final asset path/SPA fallback handling needs adjustment.
- `README.md` and `docs/sveltekit-migration.md` — update after final migration.

## Reuse

Existing frontend behavior to port, not redesign from scratch:

- `public/app/transport.js`
  - Reuse WebSocket URL/token handling, reconnect timing, health validation, auth failure behavior, `refreshAll`, `refreshQuota`, `sendRpc`, and `sendLocalCommand` semantics.
- `public/app/handlers.js`
  - Reuse all envelope handling: session catalog, snapshots, RPC responses, live assistant updates, live tool start/update/end, extension UI requests, server banners/toasts, and auth failure.
- `public/app/messages.js`
  - Reuse `transformMessage` behavior for user/assistant/tool/custom/summary messages, inline image rendering rules, live assistant handling, and message metadata.
- `public/app/tool-rendering.js`
  - Reuse tool preview logic for bash terminal output, file reads, grep/find listings, diffs, markdown previews, code previews, images, and truncation notices.
- `public/app/attachments.js`
  - Reuse inline image token behavior (`⟦imgN⟧`), attachment ordering by token position, image-only filtering, object URL cleanup, and base64 payload shape.
- `public/app/autocomplete.js` and `public/app/autocomplete-controller.js`
  - Reuse slash command, `/cd`, and `@path` context detection plus 90ms remote path suggestion debounce.
- `public/app/commands.js`
  - Reuse local command behavior: `/new`, `/compact`, `/reload`, `/refresh`, `/stats`, `/cost`, `/commands`, `/sessions`, `/tree`, `/cd`, `/thinking`, `/model`, remote slash command dispatch, steer/follow-up rules, and extension-command image restrictions.
- `public/app/sheets-view.js` and `public/app/sheet-actions.js`
  - Reuse all sheet data and actions for quick actions, active sessions, saved sessions, commands, models, thinking, stats, and tree branch opening.
- `public/app/ui.js`
  - Reuse theme palette mapping, quota/context pill logic, follow-latest/jump-to-bottom thresholds, composer reserve/safe-area concerns, token storage, token modal semantics, and extension UI modal behavior.
- `frontend/src/lib/components/ai-elements/`
  - Use `Conversation`, `Message`, `Response`, `PromptInput`, `Tool`, `Code`, `Artifact`, `Reasoning`, `Sources`, `Task`, `Queue`, `ModelSelector`, `Suggestion`, `Confirmation`, `Context`, `Loader`, `Shimmer`, `Actions`, and workflow components where appropriate.

## Feature parity checklist

The SvelteKit frontend must preserve:

- Token login, QR/link token bootstrap already supported by old boot flow, token storage, invalid-token recovery, and token modal.
- Health/status display: cwd, session, model, thinking, streaming/idle, server host/port, connection state, control owner, command-context availability.
- Single active-client replacement and idle-timeout messaging.
- Parent session mirroring and parallel session spawning/selection.
- Saved sessions list, switching/forking, new parent, new parallel.
- Session tree browsing and opening a branch path as a new session.
- Prompt submission, abort/stop, steer while streaming, follow-up behavior while streaming.
- Image attachment upload, inline placement tokens, previews, removal, and correct image ordering.
- Slash command autocomplete, local command autocomplete, path autocomplete for `/cd` and `@mentions`.
- Local phone commands and remote Pi slash commands, including extension-command image restriction.
- Model picker and thinking-level picker.
- Extension UI requests: notify, setStatus, setWidget, setTitle, set_editor_text, select, confirm, input, editor.
- Live assistant streaming, message_end replacement, agent_start/agent_end state, auto retry banners.
- Tool execution start/update/end with running/done/error/cancelled states and rich previews.
- Markdown rendering, code blocks, summaries, custom messages, branch summaries, compaction summaries.
- Quota and context display for supported `openai-codex` `gpt-*` models.
- Scroll/follow-latest behavior, jump-to-latest button, mobile safe-area composer spacing.
- PWA/static serving compatibility.

## Svelte AI Elements mapping

- `Conversation` — main scrollable chat viewport with stick-to-bottom behavior adapted to current follow-latest rules.
- `Message`, `MessageContent`, `MessageResponse`, `MessageAttachments` — user/assistant/system/custom/summary rendering.
- `PromptInput` — bottom AI input bar with attachment action menu, toolbar, send/stop/steer controls.
- `Suggestion` — slash command/path suggestion chips near the composer.
- `Tool` — primary wrapper for live and completed tool calls.
- `Code` and `Artifact` — code, read-file, edit/diff, markdown, and generated output previews.
- `Reasoning` or `ChainOfThought` — assistant thinking sections from `assistantParts(message.content).thinking`.
- `Task` and `Plan` — optional rendering for planning/checklist-like custom messages or future structured tool outputs.
- `Context` — context usage and token/cost display in inspector/status areas.
- `ModelSelector` — model picker replacing model sheet list.
- `Confirmation` — extension confirm/select/input/editor requests where it improves clarity; keep generic dialogs for unsupported/custom cases.
- `Queue` — pending follow-up/steer queue if the backend exposes queued prompts or if the UI adds visible pending follow-ups.
- `Sources` and `InlineCitation` — reserved for future source/citation messages if Pi outputs structured citations.
- `Workflow` components — reserved for a richer visual session tree/branch graph after list-based tree parity is complete.

## Steps

### Phase 1 — Protocol and state parity

- [ ] Define TypeScript types for health, status, session catalog, snapshot, RPC responses, messages, tools, commands, models, stats, tree, quota, and extension UI requests.
- [ ] Replace staging transport with a `PhoneClient` service that owns health loading, token validation, socket connect/reconnect/close, RPC/local command senders, refresh, and quota fetch.
- [ ] Build Svelte state stores mirroring old `state.js`, with explicit sections for connection, auth, sessions, snapshot, messages, live tools, commands, models, sheets, composer, attachments, autocomplete, quota, and UI requests.
- [ ] Port `handleEnvelope` and RPC response handling into store actions with no DOM manipulation.
- [ ] Add unit-level fixture tests or small adapter tests for representative snapshot, tool, and command payloads if test infrastructure is practical; otherwise keep a manual fixture page during development.

### Phase 2 — Chat rendering first

- [ ] Port `transformMessage` into `message-adapter.ts` and render all old message kinds through `ChatMessage.svelte`.
- [ ] Implement `Conversation`-based scroll/follow-latest behavior matching current thresholds and jump-to-latest behavior.
- [ ] Render assistant markdown through AI Elements `MessageResponse`/`Response` and `svelte-streamdown` as the canonical renderer, adding compatibility tweaks for Pi-specific content where needed.
- [ ] Render thinking/reasoning content with `Reasoning` or `ChainOfThought`.
- [ ] Render user inline images with `MessageAttachments`/`Image`, preserving `data:` and preview URL safety rules.
- [ ] Port live assistant streaming and message_end replacement behavior.
- [ ] Port custom messages, branch summaries, compaction summaries, usage/stopReason detail disclosure.

### Phase 3 — Tool rendering and artifacts

- [ ] Port tool normalization and rich preview helpers from `tool-rendering.js` into typed adapter functions.
- [ ] Render tool calls with AI Elements `Tool` states: running, done, error, cancelled.
- [ ] Use `Code` for source/code previews and terminal blocks where appropriate.
- [ ] Use `Artifact` for read/edit/write outputs that deserve a larger structured preview.
- [ ] Preserve diff stats, file path labels, language labels, line limits, truncation notices, image previews, markdown previews, grep/find grouped output, and open/closed panel state.

### Phase 4 — AI input bar and autocomplete

- [ ] Replace the staging controls with `ComposerBar.svelte` using AI Elements `PromptInput`.
- [ ] Port image attachment lifecycle from `attachments.js`, including object URL cleanup and `⟦imgN⟧` inline tokens.
- [ ] Add an attachment tray with image cards, token badges, size/name metadata, and remove actions.
- [ ] Port prompt submission rules: empty prompt guard, local command handling, remote slash command handling, image restrictions, steer/follow-up behavior, clear-on-submit, and refresh quota after extension commands.
- [ ] Port slash command, `/cd`, and `@path` autocomplete with `Suggestion` chips and keyboard/tap selection.
- [ ] Preserve stop/abort button behavior and show steer button only while appropriate.
- [ ] Place quota/context/cwd info near the input bar on mobile and in the inspector on wider screens.

### Phase 5 — Split workspace shell and panels

- [x] Build `AppShell` with responsive breakpoints: split workspace on larger screens, chat-first sheets on mobile.
- [x] Build `TopStatusBar` for connection/session/model/thinking/server state and important warning banners.
- [ ] Build `SessionRail` for parent/parallel active sessions, current/live/pending indicators, new parent/new parallel, and saved sessions shortcut.
- [ ] Build `InspectorPanel` for context/quota, stats summary, selected session details, selected tool details, and quick actions.
- [ ] Keep mobile actions accessible through bottom sheets/drawers and a compact top actions menu.

### Phase 6 — Sheets, dialogs, and commands

- [ ] Rebuild quick actions with shadcn buttons/cards and preserve refresh, new session, compact, stats, models, thinking, commands, sessions, and tree actions.
- [ ] Rebuild command browser with grouped categories and command insertion/run behavior.
- [ ] Rebuild model picker with `ModelSelector`, including current model highlighting and provider/model id display.
- [ ] Rebuild thinking picker with current-level highlighting.
- [ ] Rebuild active sessions and saved sessions views with parent/parallel grouping and all current status bits.
- [ ] Rebuild session tree browser as a polished list first for reliable parity, then optionally enhance with workflow canvas components later.
- [ ] Rebuild extension UI request dialogs with `Confirmation`, selects, and inputs while preserving draft persistence and session ownership checks.
- [ ] Render extension editor requests as a full-screen editor on mobile, with a dialog/panel presentation on wider screens.
- [ ] Rebuild login modal/token flow with shadcn dialog/input/button, preserving auth failure behavior.

### Phase 7 — Theme, polish, accessibility

- [x] Convert current Pi theme payload variables into shadcn CSS tokens where possible.
- [x] Implement neutral dark shadcn visual style: quieter borders, cleaner cards, less glow, larger touch targets, consistent spacing.
- [x] Add desktop keyboard shortcuts for actions where safe: send, stop, open commands, open sessions, jump latest.
- [x] Ensure mobile safe-area support, keyboard viewport handling, bottom composer spacing, and one-handed reach.
- [x] Add accessible labels and focus management for sheets/dialogs/autocomplete/composer/tool panels.
- [x] Tune empty/loading/error states with `Loader` and `Shimmer`.

### Phase 8 — Build integration and cutover

- [ ] Keep old `public/` untouched until manual parity testing passes.
- [ ] Add a root script that builds `frontend/` and copies static output into `public/` for release when approved.
- [ ] Confirm `PhoneServerRuntime` static fallback still serves SvelteKit static output and `/ws`/`/api/*` are unaffected.
- [ ] Update README and migration docs.
- [ ] Remove or archive old static modules only after the SvelteKit build fully replaces them.

## Verification

Automated checks:

- [ ] `npm test`
- [ ] `npm run frontend:check`
- [ ] `npm run frontend:build`
- [ ] Add adapter tests/fixtures for message transform, tool transform, autocomplete detection, and attachment ordering if feasible.

Manual end-to-end checks against `frontend-legacy/public/`:

- [ ] Start `/phone-start`, open Svelte UI, token login succeeds, token is stored, WebSocket connects.
- [ ] Invalid token shows login and recovers after valid token.
- [ ] Connection loss shows retry banner and reconnects.
- [ ] Single-client replacement and idle timeout messages display correctly.
- [ ] Send normal prompt and receive streaming assistant updates.
- [ ] Stop/abort streaming response.
- [ ] Send steer/follow-up while streaming where supported.
- [ ] Attach one and multiple images, move inline tokens, remove attachments, submit, and verify ordering.
- [ ] Run local commands: `/new`, `/compact`, `/reload`, `/refresh`, `/stats`, `/commands`, `/sessions`, `/tree`, `/cd`, `/thinking`, `/model`.
- [ ] Run remote slash commands, including image restriction for extension commands.
- [ ] Path autocomplete works for `/cd` and `@mentions`; slash autocomplete shows local and remote commands.
- [ ] Switch model and thinking level.
- [ ] Parent and parallel sessions: new parent, new parallel, switch active sessions, command-context unavailable warning.
- [ ] Saved sessions list, switch/fork, and branch tree open path.
- [ ] Tool previews: bash, read, edit/diff, grep/find, image, markdown, terminal output, truncated output.
- [ ] Extension UI requests: notify, status widget, select, confirm, input, editor, set editor text.
- [ ] Quota/context display updates for supported GPT models and hides for unsupported models.
- [ ] Mobile layout: safe-area, keyboard, composer, sheets, scroll/jump-to-latest.
- [ ] Desktop layout: split workspace panels, resizing/breakpoints, inspector usefulness.
- [ ] PWA/static assets load correctly through existing Pi Phone server.

## Decisions captured

- Desktop split workspace starts with both side panels collapsible by default, keeping chat dominant while still making sessions/inspector easy to open.
- The first SvelteKit version should implement the session tree as a polished list for parity; workflow graph can come later.
- Assistant markdown should use Svelte AI Elements/`svelte-streamdown` as canonical renderer with Pi-specific compatibility tweaks.
- Extension editor requests should use a full-screen editor experience on mobile.
