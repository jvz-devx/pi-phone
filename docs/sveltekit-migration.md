# SvelteKit frontend migration prep

This branch (`svelte`) stages a SvelteKit replacement for the current static Pi Phone frontend without changing the runtime assets served from `public/` yet.

## What was backed up

The original frontend is copied to:

```text
frontend-legacy/public/
```

Keep this backup until the SvelteKit app has feature parity with the current static app in `public/`.

## New SvelteKit app

The SvelteKit source lives in:

```text
frontend/
```

Useful commands from the repository root:

```bash
npm run frontend:install
npm run frontend:dev
npm run frontend:check
npm run frontend:build
npm run frontend:preview
```

The build currently writes to `frontend/build/` so it cannot accidentally overwrite the working `public/` app. Once the migration is complete, either copy the build output into `public/` as part of release packaging or switch `frontend/svelte.config.js` to emit directly to `../public`.

## Svelte AI Elements / shadcn-svelte setup

The Svelte AI Elements basic setup guide expects:

- SvelteKit + TypeScript
- Tailwind CSS
- `shadcn-svelte` initialized
- `components.json` aliases for `$lib`, `$lib/components`, `$lib/utils`, `$lib/hooks`, and `$lib/components/ui`

Those are prepared in `frontend/`.

Svelte AI Elements components have been installed under:

```text
frontend/src/lib/components/ai-elements/
```

One-line context for each installed component is in `docs/svelte-ai-elements-components.md`.

Add future Svelte AI Elements components from inside `frontend/` with npm instead of pnpm:

```bash
cd frontend
npm run shadcn:add -- https://svelte-ai-elements.vercel.app/r/message.json
```

## Pi internal tooling instead of Vercel/OpenRouter

Do **not** add the Vercel AI SDK/OpenRouter route from the guide for Pi Phone. Pi Phone already has the server runtime it needs:

- `GET /api/health` for health/session metadata
- `GET /api/quota` for quota metadata
- `WS /ws?token=...` for session snapshots, streamed messages, tool events, and client commands
- existing RPC/local-command payloads for prompts, aborts, model switching, slash commands, tree browsing, etc.

Use Svelte AI Elements as the UI layer and adapt Pi Phone's existing WebSocket envelopes into the component props/stores.

Starter integration files:

- `frontend/src/lib/pi-phone-transport.ts` — typed HTTP/WebSocket helpers for the existing Pi Phone runtime
- `frontend/src/lib/ai-config.ts` — notes documenting the internal transport plan
- `frontend/src/routes/+page.svelte` — staging page that confirms the new app can read Pi Phone health

## Migration order

1. Install the first AI Elements components (`message`, `prompt-input`, `conversation`).
2. Port state from `public/app/state.js` into Svelte stores.
3. Port `public/app/transport.js` into the typed transport layer.
4. Port rendering from `public/app/messages.js` and `public/app/tool-rendering.js` into Svelte components.
5. Port sheets/modals/actions after chat parity is working.
6. Build to `frontend/build/`, compare behavior against `frontend-legacy/public/`, then replace `public/` only after feature parity.
