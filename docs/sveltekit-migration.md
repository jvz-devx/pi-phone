# SvelteKit frontend migration

This branch (`svelte`) stages a SvelteKit replacement for the old static Pi Phone frontend. The runtime server now serves `frontend/build/` as the primary UI when that SvelteKit build is present and valid. The legacy `public/` app is deprecated and retained only as a fallback if the Svelte build is missing; `public/` must remain untouched unless a reviewed legacy-fallback sync is explicitly requested.

## Branch status and safety rule

- `frontend/` contains the SvelteKit app, and `frontend/build/` is the default runtime static root after `npm run frontend:build`.
- `public/` contains the deprecated static app and is intentionally retained as a legacy fallback only.
- `frontend-legacy/public/` is a reference backup of the old static app.
- Normal development commands must not write to `public/`.
- The guarded public sync script is now only for maintaining the deprecated fallback copy, not for making Svelte the default runtime UI.

Before any release copy, verify that `git status --short -- public` is empty. If `public/` is dirty, stop and investigate instead of overwriting it.

## SvelteKit development workflow

Install and run from the repository root:

```bash
npm run frontend:install
npm run frontend:dev
npm run frontend:check
npm run frontend:build
npm run frontend:preview
```

`npm run frontend:build` runs Vite/SvelteKit with `@sveltejs/adapter-static` and writes to `frontend/build/`. This is deliberately separate from `public/` so routine checks, tests, and builds cannot replace the deprecated legacy fallback by accident.

The root test flow currently keeps this separation:

```bash
npm test
npm run frontend:check
npm run frontend:build
```

These commands may update ignored frontend build/cache output, but they should not touch `public/`.

## Deprecated fallback sync into `public/`

The root release helper is:

```text
scripts/release-sveltekit-public.mjs
```

It is exposed through two explicit scripts:

```bash
npm run frontend:sync-public:dry-run
npm run frontend:sync-public
```

`frontend:sync-public:dry-run`:

1. refuses to continue if `public/` is dirty in git status;
2. builds the SvelteKit app into `frontend/build/`;
3. validates that static output includes `index.html`, `manifest.webmanifest`, `sw.js`, `icon.svg`, and SvelteKit's `_app/` assets;
4. runs the static fallback and Svelte validation checks so `/api/*`, `/ws`, manifest, service worker, and offline guardrails are verified before any release copy;
5. exits without changing `public/`.

`frontend:sync-public` performs the same checks and build, then:

1. backs up the current `public/` to `.pi-phone-public-backups/public-<timestamp>/`;
2. removes and recreates `public/`;
3. copies `frontend/build/` into `public/`;
4. asks the releaser to review the resulting git diff before committing.

Do not wire this script into `npm test`, `npm run frontend:build`, package install hooks, or any automatic CI/build step. It is a manual legacy-fallback maintenance action only; Svelte is served directly from `frontend/build/` when available.

## Runtime static fallback contract

`PhoneServerRuntime` serves browser assets through `src/extension/phone-static.ts` and `handleHttp(...)` in `src/extension/phone-server-runtime.ts`. The SvelteKit cutover relies on this ordering:

1. Runtime/control and API routes are handled before static serving:
   - the private stop control path;
   - `GET /api/health`;
   - `GET|HEAD /api/quota`;
   - any other `/api/*` path returns JSON `404` instead of falling through to the SPA fallback.
2. WebSocket traffic is unaffected by static serving because upgrades are handled by `server.on("upgrade")`; only `/ws` is accepted, then origin/token checks run before `ws.handleUpgrade(...)`.
3. Static paths are sanitized against the active static root before file reads.
4. The active root is `frontend/build/` when it contains `index.html` and SvelteKit `_app/` assets; otherwise it falls back to deprecated `public/`.
5. Missing static `GET`/`HEAD` paths fall back to the active root's `index.html`, matching the SvelteKit `adapter-static` setting `fallback: 'index.html'`.
6. `mimeTypes` covers the SvelteKit output currently produced in `frontend/build/`, including `_app/immutable` JavaScript/CSS chunks and KaTeX font files (`.woff`, `.woff2`, `.ttf`).

The lightweight checks below verify the source ordering, adapter-static configuration, WebSocket upgrade separation, SPA fallback, MIME coverage, PWA manifest/service-worker behavior, and release-script guardrails. If `frontend/build/` exists, they also scan the built file extensions and app-shell asset references.

```bash
npm run static:fallback:check
npm run svelte:validation:check
```

The current adapter-static build shape is:

```text
frontend/build/
  index.html
  icon.svg
  manifest.webmanifest
  sw.js
  _app/env.js
  _app/version.json
  _app/immutable/assets/*.{css,woff,woff2,ttf}
  _app/immutable/chunks/*.js
  _app/immutable/entry/*.js
  _app/immutable/nodes/*.js
```

## Legacy archive/removal policy

Do not remove files from `public/` while the SvelteKit app is still being validated. `public/` no longer needs to be the runtime UI by default; it remains as a deprecated fallback for installs that have not produced `frontend/build/` yet.

`frontend-legacy/public/` is the tracked archive of the original static frontend and remains the behavioral/visual reference during parity testing. The old static modules under `public/app/`, `public/app.js`, and `public/styles.css` may be removed from `public/` only as part of a later reviewed cleanup that intentionally drops the deprecated fallback. Keep `frontend-legacy/public/` until maintainers decide it is no longer useful for regression comparison.

## Component usage

The SvelteKit app uses Svelte AI Elements and shadcn-svelte as UI building blocks, not as a replacement backend stack.

Prepared component locations:

```text
frontend/src/lib/components/ai-elements/
frontend/src/lib/components/ui/
```

Primary mapping:

- `Conversation` for the chat viewport and follow-latest behavior.
- `Message`, `MessageContent`, `MessageResponse`, and `MessageAttachments` for Pi message rendering.
- `PromptInput` for the composer, attachment controls, send/stop/steer affordances, and autocomplete placement.
- `Suggestion` for slash command, `/cd`, and `@path` suggestions.
- `Tool`, `Code`, and `Artifact` for live tool calls, code previews, diffs, reads, writes, and terminal-like output.
- `Reasoning` or `ChainOfThought` for thinking/reasoning sections.
- shadcn dialog/sheet/card/button/input primitives for login, command browsers, session/model/thinking pickers, extension UI requests, and inspector panels.

One-line context for installed AI Elements components is maintained in `docs/svelte-ai-elements-components.md`.

Add future Svelte AI Elements components from inside `frontend/` with npm:

```bash
cd frontend
npm run shadcn:add -- https://svelte-ai-elements.vercel.app/r/message.json
```

## Pi internal tooling transport

Do not add the Vercel AI SDK/OpenRouter route from the Svelte AI Elements guide. Pi Phone already has the runtime and protocol it needs:

- `GET /api/health` for server, auth, cwd, session, model, thinking, and capability metadata.
- `GET /api/quota` for quota/context metadata when supported by the active GPT model.
- `WS /ws?token=...` for snapshots, session catalog updates, live assistant streaming, tool events, banners/toasts, extension UI requests, RPC responses, and client commands.
- Existing RPC/local-command payloads for prompts, aborts, model switching, thinking switching, slash commands, stats, tree browsing, saved sessions, parent/parallel sessions, and extension command flows.

Frontend transport and state are implemented around these Pi-owned endpoints:

```text
frontend/src/lib/pi-phone-transport.ts
frontend/src/lib/stores/pi-phone-state.ts
frontend/src/lib/actions/
frontend/src/lib/adapters/
```

The SvelteKit UI should adapt Pi envelopes into typed stores and component props. It should not create a second chat backend.

## Migration order

1. Port state from `public/app/state.js` into Svelte stores.
2. Port `public/app/transport.js` into the typed transport layer.
3. Port rendering from `public/app/messages.js` and `public/app/tool-rendering.js` into Svelte components.
4. Port composer, attachments, autocomplete, local commands, remote slash commands, sheets, dialogs, and extension UI requests.
5. Keep building to `frontend/build/`; runtime serving should use that build by default and compare behavior against deprecated `public/` plus `frontend-legacy/public/`.
6. Run the dry-run legacy fallback sync script if fallback maintenance is desired.
7. Only if maintainers still want the deprecated fallback copy refreshed, run `npm run frontend:sync-public`, review the diff, and commit that fallback-maintenance change.

## Manual parity caveat

Automated type checks and fixture tests are useful, but they are not sufficient for parity sign-off. Before relying on the Svelte runtime UI broadly, manually verify token login, WebSocket reconnect, prompt streaming, abort/steer/follow-up, attachments and inline tokens, local and remote slash commands, autocomplete, model/thinking pickers, parent/parallel sessions, saved sessions, tree browsing, tool previews, extension UI requests, quota/context display, mobile safe-area behavior, desktop layout, and static/PWA asset loading through the existing Pi Phone server.

For Steps 54-63, use `docs/sveltekit-validation-steps-54-63.md`. During development, the SvelteKit dev server can exercise the live `/phone-start` backend without touching `public/` by setting `PI_PHONE_BACKEND`, for example:

```bash
PI_PHONE_BACKEND=http://127.0.0.1:8787 npm run frontend:dev
```
