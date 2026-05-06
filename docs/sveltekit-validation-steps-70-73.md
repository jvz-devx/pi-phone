# SvelteKit validation for Steps 70-73

This checklist covers quota/context, responsive layout, and PWA/static serving validation for the SvelteKit frontend without modifying `public/`.

## Live QA availability in this implementation loop

- Browser binary/display check: `google-chrome` is installed and `DISPLAY`/`WAYLAND_DISPLAY` are set.
- Pi CLI check: `pi --help` works.
- Live `/phone-start` QA was not run because this non-interactive implementation loop does not have an active Pi conversation/backend token to start and drive, and this repo does not include Playwright/Puppeteer browser automation scripts for repeatable device validation.
- Therefore Steps 70-73 have automated fixture/static coverage below, but remain pending live browser/device QA before final parity sign-off.

## Automated coverage

Run from the repository root:

```bash
npm test
npm run frontend:check
npm run frontend:build
npm run svelte:validation:check
```

Current automated coverage added/extended for these steps:

| Step | Automated coverage |
| --- | --- |
| 70 | `frontend/src/lib/adapters/quota-context.ts` centralizes supported-model detection (`openai-codex` + `gpt-*`), context usage text, and stale quota hiding. Fixture tests assert supported GPT quota displays/fetches and unsupported models clear/hide quota without calling `/api/quota`. Static checks assert `ComposerMeta` and `PhoneClient` use the same helper. |
| 71 | Static validation checks mobile safe-area CSS, visual viewport/keyboard inset variables, bottom sheet CSS, touch target media query, ChatWorkspace follow-latest thresholds, bottom reserve, and accessible jump-to-latest wiring. |
| 72 | Static validation checks the desktop `1024px` split-workspace breakpoint, persisted left/right rail state, grid template columns, inspector landmark, and quick actions presence. |
| 73 | Static validation checks PWA manifest content, Svelte-specific service worker behavior, `/api/*` and `/ws` service-worker bypass, token query redirect/cache purge, built SvelteKit `index.html` asset references when `frontend/build` exists, and `PhoneServerRuntime` API/static fallback ordering. `scripts/check-phone-static-fallback.mjs` also verifies adapter-static fallback and server MIME/fallback routes. |

These checks are regression coverage; they do not prove real mobile keyboard ergonomics, actual installed-PWA behavior, or live server/browser behavior.

## Manual live checklist

### Step 70: quota/context display

1. Start `/phone-start` against a session using an `openai-codex` GPT model, for example a `gpt-*` Codex model.
2. Open the Svelte UI with a valid token.
3. Confirm near the composer and in the inspector:
   - cwd is shown when known.
   - context pill shows a percentage and context-window label.
   - quota windows appear after `/api/quota` succeeds.
4. Switch to an unsupported model/provider (for example non-`gpt-*` or non-`openai-codex`).
5. Confirm quota pills disappear and no stale previous quota remains visible. Context/cwd may remain visible if provided by the snapshot.

### Step 71: mobile layout

1. Open the Svelte UI in a real mobile browser and in desktop devtools mobile emulation.
2. Verify safe-area behavior on a notched device: top status and bottom composer are not clipped.
3. Focus the composer with the on-screen keyboard open.
4. Confirm the composer remains reachable, sheets sit above the keyboard, and conversation bottom spacing is adequate.
5. Scroll upward during streaming; confirm auto-follow stops and the `Latest` button appears.
6. Tap `Latest`; confirm the conversation scrolls to the newest message and resumes following.
7. Open actions, commands, sessions, models, thinking, tree, inspector, and extension request sheets; confirm close/focus behavior and one-handed reach.

### Step 72: desktop layout

1. Open at widths above and below 1024px.
2. Above 1024px, toggle the session rail and inspector; confirm split columns resize without overlapping the chat.
3. Reload; confirm left/right open preferences persist.
4. Open command/model/thinking/session/tree browsers; confirm they occupy the inspector side on desktop rather than mobile sheets.
5. Confirm inspector usefulness: quota/context/cwd, stats/actions, selected session, and selected tool details update as messages/tools arrive.
6. Below 1024px, confirm the same controls collapse to mobile sheets.

### Step 73: PWA/static serving through Pi Phone server

1. Build SvelteKit without syncing to `public/` during QA:

   ```bash
   npm run frontend:build
   npm run svelte:validation:check
   ```

2. Only after parity approval, use the release sync script to copy `frontend/build` into `public/`.
3. Start the Pi Phone server and load:
   - `/`
   - `/manifest.webmanifest`
   - `/sw.js`
   - `/icon.svg`
   - a deep SPA route such as `/sessions/example`
4. Confirm `/api/health`, `/api/quota`, and `/ws` still route to runtime handlers and are not served by static fallback.
5. In browser devtools Application tab, confirm manifest loads, service worker installs, and tokenized URLs are not cached.
6. Test offline/reload behavior after one successful online load; the app shell should load, while API/WebSocket calls should fail normally until the server is reachable.
