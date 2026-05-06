# Pi Phone compact UI and QR login plan

## Context

The current Pi Phone UI is feature-complete but feels oversized. The `/phone` shortcut currently starts immediately with LAN-friendly defaults; the desired flow is interactive: ask whether to show a QR code, ask/select which IP/address to use, then show a QR code URL that opens the phone UI already logged in.

## Findings so far

- `/phone`, `/phone-start`, `/phone-lan`, `/phone-stop`, `/phone-status`, and `/phone-token` are registered in `src/extension/register-phone-extension.ts`.
- `/phone` currently builds args with `phoneShortcutDefaults()`, `findFreePort()`, and `buildPhoneArgs()`, then delegates to `runtime.handlePhoneStart(...)`.
- Startup/token generation and Tailscale notifications are handled in `src/extension/phone-server-runtime.ts` inside `handlePhoneStartOnce(...)`.
- Token auth already uses `?token=...` for HTTP/WebSocket calls in `public/app/transport.js`, and the token is persisted in `localStorage` via `public/app/ui.js` / `public/app/state.js`.
- The oversized UI is primarily CSS-driven in `public/styles.css` through large `rem` padding, radii, gaps, fixed composer reserve, and mobile composer min heights.
- Pi extension command contexts expose `ctx.ui.select(...)`, `ctx.ui.confirm(...)`, and `ctx.ui.input(...)`, so `/phone` can use native terminal prompts for yes/no, address selection, and manual address entry if needed.
- There is no QR rendering dependency in `package.json`; implementing terminal QR output will require either adding a small runtime dependency or vendoring a tiny renderer.
- The service worker cache is versioned in `public/sw.js`; static asset query strings in `public/index.html` are manually bumped, so CSS/JS changes should include cache/version bumps.

## Approach

Recommended implementation: keep the existing UI and server architecture, but make the default visual density compact and add a QR helper around the existing `/phone` startup path. The QR URL should be a session login link containing the current token as a query parameter. On the web side, read the token once, store it, and remove it from the visible URL.

## Files to modify

- `public/styles.css`
- `public/app/main.js` or `public/app/transport.js`
- `public/index.html` and `public/sw.js` for static asset/cache version bumps
- `src/extension/register-phone-extension.ts`
- `src/extension/phone-server-runtime.ts`
- `src/extension/types.ts`
- `README.md`
- `package.json` / `package-lock.json` only if a QR dependency is chosen

## Reuse

- Reuse `phoneShortcutDefaults()`, `hasExplicitPort()`, `findFreePort()`, and `buildPhoneArgs()` in `src/extension/register-phone-extension.ts` for the `/phone` startup defaults.
- Reuse `PhoneServerRuntime.handlePhoneStart(...)` instead of creating a second startup path.
- Reuse `PhoneServerRuntime.config.token`, `config.host`, and `config.port` after startup for QR URL construction.
- Reuse `getTailscaleServeInfo(...)` / Tailscale URL handling from `src/extension/phone-tailscale.ts` when offering address choices.
- Reuse existing browser token storage through `TOKEN_STORAGE_KEY`, `state.token`, `storeToken(...)`, and `validateToken(...)`.

## Steps

- [ ] Add compact CSS defaults: reduce core padding, button/input sizes, card/message spacing, composer reserve, composer height, modal/sheet spacing, and excessive top hero spacing while preserving the current layout. Target the current oversized hotspots: `--composer-reserve`, `.app-shell` top padding, button/input padding, `.status-card`/`.message` padding, `.messages` gap, `.composer` padding/radius, composer textarea/button min heights, modal/sheet spacing, and the mobile sidebar button.
- [ ] Add a small web boot helper that reads `token` from `window.location.search`, stores it in `localStorage`, updates `state.token`, and removes the token from the visible URL with `history.replaceState(...)` before normal boot.
- [ ] Add address detection helpers for `/phone`: use Node `os.networkInterfaces()` to list usable IPv4 LAN addresses, include `localhost`, and include Tailscale URL when available.
- [ ] Change `/phone` to prompt with `ctx.ui.select(...)`: first ask whether to show a QR code; if yes, start the server, then prompt for the address/IP to encode.
- [ ] Add a runtime helper that returns the current phone URL and token after `handlePhoneStart(...)` completes, so command registration does not reach into private runtime internals.
- [ ] Render a terminal QR code for the selected login URL. Prefer adding `qrcode` as a runtime dependency and using `QRCode.toString(url, { type: "terminal" })`; if package size is a concern, use a smaller terminal-only dependency instead.
- [ ] Bump `public/index.html` asset query strings and `public/sw.js` cache name so installed/PWA clients pick up the compact UI and token-link bootstrap changes.
- [ ] Keep `/phone-start` and `/phone-lan` behavior unchanged except for any shared URL helper needed by `/phone`.
- [ ] Update README command reference with the new interactive `/phone` QR flow and note that QR login links contain the active token.

## Verification

- [ ] Run `npm test` / `npm run typecheck`.
- [ ] Manually run `/phone` and choose no QR: verify existing LAN-friendly startup behavior remains intact.
- [ ] Manually run `/phone` and choose QR: verify address choices include localhost and LAN IPs, server starts, QR is printed, and the displayed URL contains a token when token auth is enabled.
- [ ] Scan QR/open URL on phone: verify the UI opens without the token modal, stores the token, strips `?token=...` from the address bar, and connects over WebSocket.
- [ ] Verify token-disabled loopback mode still behaves safely and does not offer unsafe LAN tokenless login.
- [ ] Check the UI on phone-width and desktop-width screens to confirm the compact density improves usability without clipping composer/actions/modals.
