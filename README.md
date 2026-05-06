# pi-phone

A phone-first remote UI for [Pi](https://pi.dev) that lets you drive a real Pi session from your phone.

`pi-phone` starts a small local web server, mirrors your current live Pi CLI session over WebSocket to a mobile web app, and can spawn dedicated parallel `pi --mode rpc` sessions when you open additional parallel sessions from the phone UI.

## What it gives you

- Phone-friendly chat UI for Pi
- Starts by mirroring the live CLI session, then can open real parallel Pi subprocess sessions on demand
- Preserves much more of your Pi setup than a custom mini-backend would
- Parallel sessions continue to work with extension commands, prompt templates, and skills exposed by Pi RPC
- Model switching and thinking-level switching from the phone UI
- Parent + parallel session browser, saved sessions, tree browser, fork flow, stats, compact, reload, and refresh actions
- Ownership handoff between the CLI and phone when editing the mirrored parent session
- Image upload with inline placement tokens from the phone UI
- Optional Tailscale Serve auto-setup for remote access from your phone
- Single active-client mode for safety and simplicity

## Screenshot

![pi-phone mobile UI screenshot](https://raw.githubusercontent.com/jvz-devx/pi-phone/master/docs/images/pi-phone-screenshot.png)

## Requirements

- Pi installed and working
- Compatible with `@mariozechner/pi-coding-agent` `>=0.58.4 <1.0.0` (including newer Pi `0.73.x` session lifecycle events)
- Node.js available for extension dependencies
- Optional but strongly recommended: Tailscale installed and logged in if you want easy remote phone access

## Install

Install the rolling git package with Pi:

```bash
pi install git:https://github.com/jvz-devx/pi-phone
```

This is the recommended install path while Pi Phone is moving quickly. Leave the git source **unpinned** so Pi can update it later with:

```bash
pi update --extensions
```

Pi treats git refs such as `@master`, `@main`, or `@v1.2.3` as pinned package versions, and pinned refs are skipped by `pi update` / `pi update --extensions`. If you intentionally want to freeze Pi Phone on a commit or branch ref, use a pinned source; otherwise prefer the unpinned source above.

Then either restart Pi or run:

```text
/reload
```

If you want to verify that the package is installed and enabled:

```bash
pi list
pi config
```

You can also check and update from inside Pi:

```text
/phone-version
/phone-update
```

## Development

For local development, install this working tree as a local package or use `pi -e` while testing. For bleeding-edge testing on another machine, use the same unpinned git install shown above.

Git installs use this repository's `.npmrc` to omit development dependencies by default, which avoids nested Pi core packages that can differ from the Pi runtime you are using.

On Nix/NixOS, enter the pinned development shell and install development dependencies explicitly before running verification:

```bash
nix develop path:$PWD -c npm install --include=dev
nix develop path:$PWD -c npm test
```

`npm test` currently runs the TypeScript type check, static fallback guard, and SvelteKit fixture adapter tests.

### SvelteKit frontend workflow

The `svelte` branch contains the in-progress SvelteKit replacement in `frontend/`. The production server still serves the legacy static app from `public/`; keep `public/` untouched until manual parity testing approves a cutover.

Useful root commands:

```bash
npm run frontend:install
npm run frontend:dev
npm run frontend:check
npm run frontend:build
npm run frontend:sync-public:dry-run
npm run frontend:sync-public
```

`npm run frontend:build` writes only to `frontend/build/` and is safe for normal development. `npm run frontend:sync-public:dry-run` builds the SvelteKit app and validates release preconditions without changing `public/`. `npm run frontend:sync-public` is the explicit release cutover command: it refuses to run if `public/` is already dirty, builds `frontend/`, backs up the current `public/` under `.pi-phone-public-backups/`, and then copies `frontend/build/` into `public/`. Do not run or commit the sync until the SvelteKit UI has passed manual parity checks.

The SvelteKit app uses Svelte AI Elements and shadcn-svelte from `frontend/src/lib/components/ai-elements/` and `frontend/src/lib/components/ui/` as UI components only. It does not add Vercel AI SDK/OpenRouter routes; Pi Phone continues to use its internal tooling transport: `GET /api/health`, `GET /api/quota`, and `WS /ws?token=...` envelopes from `PhoneServerRuntime`.

See `docs/sveltekit-migration.md` for the migration status, component mapping, and release-copy checklist.

## Setup guide

### 1. Open Pi in the project you want to control from your phone

```bash
cd /path/to/project
pi
```

`pi-phone` initially mirrors the current live Pi session in your current working directory, so start Pi in the repo you want to work on. If you later open additional parallel sessions from the phone UI, those run as dedicated child Pi RPC sessions.

### 2. Start the phone server

Inside Pi:

```text
/phone-start
```

By default this:

- binds the web server to `127.0.0.1`
- uses port `8787`
- uses the current Pi working directory
- sets a `2 hour` idle auto-stop timeout
- auto-generates a token if you did not provide one
- tries to configure Tailscale Serve automatically

### 3. Open the phone UI

There are two common cases:

#### If Tailscale setup succeeds

Pi will show a Tailscale URL like:

```text
https://your-device.ts.net/
```

Open that URL on your phone.

#### If Tailscale setup does not succeed

Pi will keep the local phone server running and show a fallback command. Since the server binds to localhost by default, the easiest path is usually to fix Tailscale and run `/phone-start` again.

### 4. Enter the token if prompted

If you did not explicitly disable the token, the extension requires the token shown by Pi.

You can view it again at any time with:

```text
/phone-token
```

## Command reference

### `/phone-start`

Examples:

```text
/phone-start
/phone-start 8787
/phone-start 8787 mytoken
/phone-start --port 8787 --token mytoken --host 127.0.0.1
/phone-start --cwd /path/to/project
/phone-start --idle-mins 20
/phone-start --idle-secs 90
```

Behavior:

- default host: `127.0.0.1`
- default port: `8787`
- default cwd: current Pi working directory
- default idle auto-stop: `2 hours`
- auto-generates a random token if you do not provide one
- tries to auto-configure Tailscale Serve

Use `-` to explicitly disable the token for loopback-only local development:

```text
/phone-start 8787 -
```

Token-disabled mode is refused on non-loopback hosts such as `0.0.0.0`. Without a token, all HTTP static/API requests must use a loopback/`localhost` `Host`, and browser WebSocket connections must also include a valid loopback/`localhost` `Origin`. Missing or invalid WebSocket origins are rejected in token-disabled mode, which protects tokenless local development from DNS-rebinding attacks. Use a token for LAN, Tailscale, or other remote access.

### `/phone`

LAN-friendly shortcut for personal setups:

```text
/phone
/phone --token mytoken
/phone --port 8788
```

Behavior:

- first asks whether to show a QR login code
- default host: `PI_PHONE_HOST` or `0.0.0.0`
- default port: `PI_PHONE_PORT` or `8787`
- auto-picks the next free port when no port is provided
- default token: `PI_PHONE_TOKEN`, or a generated token if unset
- default idle timeout: `PI_PHONE_IDLE_MINS` / `PI_PHONE_IDLE_MINUTES`, or `9999` minutes
- any extra args are passed through to `/phone-start`
- when QR is enabled, starts the server, asks which detected address/IP to encode, and prints a terminal QR code

The QR login link includes the active Pi Phone token in the URL fragment (`#token=...`) when token auth is enabled. The web app stores that token locally and strips it from the visible address bar before normal boot.

### `/phone-lan`

Same LAN defaults as `/phone`, but does not auto-pick a free port:

```text
/phone-lan
```

### `/phone-stop`

```text
/phone-stop
```

Stops the phone server and also disables the matching Tailscale Serve route when possible.

### `/phone-status`

```text
/phone-status
```

Shows whether the phone server is running, whether the parent session is currently owned by the CLI or phone, and whether Tailscale Serve is currently pointing at it.

### `/phone-token`

```text
/phone-token
```

Shows the current token, or tells you that token auth is disabled for the current phone server.

### `/phone-version`

```text
/phone-version
```

Shows the Pi Phone package version, detected install path/source, local git HEAD, remote HEAD, and whether an update is available. For git installs, it fetches remote refs before reporting status.

If the detected settings source is pinned, `/phone-version` reminds you that pinned refs such as `@master`, `@main`, and `@v1.2.3` are skipped by `pi update --extensions`.

### `/phone-update`

```text
/phone-update
```

Safely updates a git-installed Pi Phone package from inside Pi:

- verifies Pi Phone is running from a git checkout
- fetches `origin`
- compares local and remote HEADs
- refuses to proceed if the checkout has uncommitted changes
- asks for confirmation before changing code
- fast-forwards when possible
- only offers a hard reset for Pi-managed git clones when fast-forward is not possible
- runs `npm install`
- tells you to run `/reload` or restart Pi after a successful update

Pi Phone does not silently auto-update by default. Set `PI_PHONE_CHECK_UPDATES=1` to make it check once on startup and notify when `/phone-update` is available.

## Typical usage flow

1. Start Pi in your project
2. Run `/phone-start`
3. Open the Tailscale URL on your phone
4. Enter the token once if prompted
5. Work from the phone UI
6. When done, run `/phone-stop`

## Parent and parallel sessions

When Pi Phone is running, the session browser is split into two groups:

- **Parent** — the live CLI session you already have open in Pi. Selecting it mirrors the same session file, messages, model, thinking level, tree, and session switches you see in the terminal.
- **Parallel** — additional child `pi --mode rpc` sessions spawned from the phone UI. Use these when you want separate work in parallel or when you need extension slash commands that are not supported in the mirrored parent session.

Useful actions in the session browser:

- **New Parent** starts a fresh session in the live CLI.
- **New Parallel** spawns a new child Pi RPC session and switches the phone to it.
- **Saved sessions** lets you reopen sessions for the current cwd inside the currently selected session.

Only one side writes to the parent session at a time. If the phone is currently driving the mirrored parent session, typing in the CLI takes control back once the current response is idle. If the CLI is currently busy on the parent session, the phone will ask you to wait before sending more edits there.

In the mirrored parent session, normal prompts, prompt templates, and skills still work. Extension slash commands are intentionally blocked there; open a parallel session when you want to run those from the phone.

## What the phone UI can do

The phone UI starts by mirroring the current CLI session, then uses parallel Pi RPC sessions for additional parallel work. Depending on your current Pi setup, you can:

- send prompts
- attach images
- abort streaming
- steer or queue a follow-up while a response is already streaming
- compact the current session
- start a new parent session or a new parallel session
- switch between the mirrored parent session and parallel sessions
- reload extensions, skills, prompts, and themes
- browse and switch models
- browse and switch thinking levels
- browse prompt templates, skills, and extension commands exposed through Pi RPC
- browse saved sessions
- browse the current session tree and open a branch path as a new active session
- view session stats and cost stats

In the mirrored parent session, prompt templates and skills can still run, but extension slash commands require a parallel session.

Because the extension mirrors the live CLI session first and only falls back to child Pi subprocesses for additional parallel sessions, the phone UI preserves much more of your actual Pi environment than a custom standalone web app would.

## Images and inline placement

When you tap **Attach**, Pi Phone inserts tokens like `⟦img1⟧`, `⟦img2⟧` into the composer.

- Leave the tokens where they were inserted to send the images in that order.
- Move the tokens around in your prompt if you want an image to appear at a specific point in the message.
- Delete a token to remove that image from the outgoing prompt.

This is most useful for normal prompts and non-extension slash commands. Extension slash commands do not accept image attachments.

## Security and runtime behavior

- The phone server binds to localhost by default.
- If you omit the token, Pi generates a random token for you.
- If you set the token to `-`, token auth is disabled.
- Only one active phone client is allowed at a time; a new client replaces the old one.
- The phone starts by mirroring the live CLI session and uses a single ownership model: either the CLI or the phone is the active writer at a time.
- If you open additional parallel sessions from the phone UI, those run as child `pi --mode rpc` sessions.
- The phone server auto-stops after the configured idle timeout.
- The extension removes the matching Tailscale Serve route on idle timeout, `/phone-stop`, and parent Pi shutdown.
- Parallel child Pi processes set `PI_PHONE_CHILD=1` so the extension does not recursively start nested phone servers.
- The phone browser stores the token in local storage for convenience.

## Notes on quota display

The UI includes a quota pill for supported `openai-codex` `gpt-*` models when local Pi auth data makes that information available. If that auth is missing, unsupported, or you are using a different provider, the phone UI still works; the quota pill simply stays hidden.

## Troubleshooting

### Port already in use

If Pi reports that the port is already in use:

```text
/phone-stop
/phone-start
```

### Tailscale did not auto-configure

Make sure Tailscale is installed, logged in, and available on `PATH`, then try again:

```bash
tailscale status
tailscale serve status
```

You can also use the manual fallback command shown by Pi.

### Invalid token on phone

If the phone UI says the token is invalid, run:

```text
/phone-token
```

Then re-enter the latest token. If needed, restart the server with a fresh token:

```text
/phone-stop
/phone-start
```

### Phone cannot edit the parent session right now

If the phone reports that it cannot write to the parent session yet, the live CLI session is still busy or currently owned by the terminal.

Try one of these:

- wait for the current parent response or compaction to finish
- switch the phone to a parallel session and continue there
- stop typing in the CLI until the current parent response is idle, then try again from the phone

Likewise, if the CLI warns that the phone currently owns the parent session, wait for the current phone-driven parent response to finish and then type again in the terminal to take ownership back.

### Extension not showing up in Pi

Try:

```text
/reload
```

Then verify the package is present and enabled:

```bash
pi list
pi config
```

## Repository contents

- `index.ts` — tiny package entry that registers the extension
- `phone-session-pool.ts` — tiny compatibility export for the session pool API
- `src/extension/` — backend modules for extension registration, server runtime, args, paths, quota, runtime control, sessions, static assets, tailscale, theme mapping, and the child inline-image adapter
- `src/session-pool/` — parent-session mirroring plus parallel session worker and session pool internals
- `public/` — current production mobile web app assets; intentionally retained during the SvelteKit migration
- `public/app/` — legacy static frontend modules for state, UI, rendering, transport, commands, autocomplete, sheets, bindings, and attachments
- `frontend/` — in-progress SvelteKit frontend source and static build output directory (`frontend/build/`)
- `scripts/release-sveltekit-public.mjs` — explicit, guarded release-copy script for replacing `public/` after parity approval

## Package name

`pi-phone` is published on npm as:

```text
@malinamnam/pi-phone
```
