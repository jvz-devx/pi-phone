# SvelteKit validation for Steps 54-63

This checklist covers the live Pi Phone flows that cannot be fully proven by fixture tests alone. It is designed to validate the SvelteKit frontend against a running `/phone-start` backend without modifying `public/`.

## Environment status from this implementation loop

- The repository contains the Pi extension runtime, but this non-interactive agent did not start a real Pi conversation or `/phone-start` session.
- `pi` is installed on this machine, but invoking `pi --help` exited with a Node `sonic boom is not ready yet` error from an installed extension, so live-device QA was not treated as available in this run.
- Steps 54-63 are therefore covered by automated fixtures plus this manual checklist, and remain pending live `/phone-start` QA before final parity sign-off.

## Automated coverage already in `npm test`

`frontend/src/lib/fixtures/pi-phone-fixture-tests.ts` exercises the protocol/state/action pieces behind the live flows without claiming browser/device success:

| Steps | Fixture coverage |
| --- | --- |
| 54-55 | Token URL parsing, login submission, localStorage token persistence, valid health acceptance, invalid-token rejection, and "invalid token does not open WebSocket" transport behavior. |
| 56-57 | WebSocket open/refresh, network close reconnect scheduling, replacement close banner, idle-timeout close banner, and server lifecycle banner envelopes. |
| 58 | Prompt submission appends an optimistic user message; live assistant `agent_start`, deltas, tool-call deltas, `message_end` replacement, and `agent_end` refresh/quota flags. |
| 59-60 | Abort RPC dispatch, normal streaming follow-up behavior, slash-command follow-up behavior, and steer RPC behavior. |
| 61 | Image-only filtering, inline token insertion/removal/sync, payload image ordering by token occurrences, attachment store ordering, and cleanup hook return values. |
| 62 | Local `/new`, `/compact`, `/reload`, `/refresh`, `/stats`, `/cost`, `/commands`, `/sessions`, `/tree`, `/cd`, `/thinking`, and `/model` dispatch plus attachment rejection. |
| 63 | Remote slash command lookup/dispatch, quota refresh request after extension commands, extension-command image blocking, and streaming behavior for slash commands. |

These fixtures are meaningful regression coverage for transport and adapters, but they do not validate browser rendering, real Pi auth, live WebSocket timing, or device/mobile ergonomics. Use the manual checklist below for that live sign-off.

## Run the SvelteKit UI against a live `/phone-start` server

1. In an interactive Pi session for this package, start the phone backend with a known token:

   ```text
   /phone-start 8787 qa-token --host 127.0.0.1 --idle-mins 10
   ```

2. In this repository, start the SvelteKit dev server with the dev-only proxy enabled:

   ```bash
   PI_PHONE_BACKEND=http://127.0.0.1:8787 npm run frontend:dev
   ```

   `frontend/vite.config.ts` proxies `/api/*` and `/ws` to `PI_PHONE_BACKEND` only when that environment variable is set. This leaves `public/` untouched.

3. Open the Vite URL printed by the command, normally `http://127.0.0.1:5173/`.

4. Use browser devtools Application/Local Storage to inspect `pi-phone-token`, and Network to inspect `/api/health`, `/api/quota`, and `/ws`.

## Checklist

### Step 54: valid token login, storage, WebSocket

- Load the Svelte UI.
- Confirm the login dialog is shown when no token is stored.
- Enter `qa-token`.
- Expected:
  - Login closes.
  - `pi-phone-token` is stored in localStorage.
  - `/api/health?token=qa-token` succeeds.
  - `/ws?token=qa-token` opens.
  - Snapshot, commands, model/status, cwd, and quota/context areas refresh.

### Step 55: invalid token recovery

- Clear `pi-phone-token` in localStorage.
- Reload the Svelte UI.
- Enter an invalid token.
- Expected: login remains open and shows token rejection text.
- Enter `qa-token`.
- Expected: login closes, token is stored, WebSocket opens, no stale auth error remains.

### Step 56: connection loss and reconnect

- With the UI connected, stop the backend temporarily or block the WebSocket in devtools/network tooling.
- Expected: retry banner appears and connection state changes to reconnecting.
- Restart/unblock the backend with the same token.
- Expected: WebSocket reconnects, banner clears or is superseded, snapshot refreshes.

### Step 57: single-client replacement and idle timeout

- Open the Svelte UI in a second browser/tab with the same token.
- Expected in the first tab: replacement banner/message is displayed and the connection closes without retry churn.
- For idle timeout, start `/phone-start` with a short idle setting, for example `--idle-secs 30`, then leave the UI idle.
- Expected: idle-timeout banner says Pi Phone stopped due to inactivity and instructs to run `/phone-start` again.

### Step 58: normal prompt streaming

- Send a normal prompt such as `Say hello in one short sentence.`
- Expected:
  - Optimistic user message appears.
  - Assistant live message streams text deltas.
  - Final `message_end` content replaces the live message without duplication.
  - Quota/context refreshes after `agent_end` for supported models.

### Step 59: stop/abort

- Send a prompt that streams long enough to stop.
- Press Stop.
- Expected: outbound RPC `{ type: "abort" }`, stream settles/stops, stop button disappears, no composer text is lost unless already submitted.

### Step 60: steer/follow-up while streaming

- While a response is streaming, type a follow-up and send normally.
- Expected for supported sources: outbound prompt/slash command includes `streamingBehavior: "followUp"`.
- While streaming and steer is offered, send with Steer.
- Expected: outbound prompt includes `streamingBehavior: "steer"` and UI remains stable if backend rejects unsupported steering.

### Step 61: image attachments and ordering

- Attach one image; verify a `⟦img1⟧` token appears and the tray shows name/size/token.
- Attach multiple images; move tokens in the prompt, duplicate a token, and remove one attachment.
- Expected:
  - Removed attachments also remove their tokens.
  - Payload image order follows inline token occurrence order, with untokened remaining images last.
  - Data URLs/blob previews render safely.
  - Composer clears and object URLs are cleaned after successful submit.

### Step 62: local commands

Run and verify each local command path:

- `/new` starts a new session.
- `/compact` triggers compaction.
- `/reload` is blocked while streaming/compacting and otherwise reloads extensions/skills/prompts/themes.
- `/refresh` refreshes snapshot, commands, models, and quota.
- `/stats` and `/cost` open stats/actions and request session stats.
- `/commands` opens command browser.
- `/sessions` opens saved sessions.
- `/tree` opens session tree.
- `/cd <path>` changes cwd and refreshes.
- `/thinking <level>` sets the level; `/thinking` opens picker.
- `/model <provider/model>` sets the model; `/model` opens picker.

Expected for all local commands: image attachments are rejected with a clear message and are not sent.

### Step 63: remote slash commands and image restrictions

- Load commands, then run an extension command without images.
- Expected: local slash-command dispatch occurs and quota refresh is requested.
- Attach an image and run an extension command.
- Expected: blocked with an "Extension slash commands do not support image attachments" message; nothing is sent.
- Run a skill/prompt slash command while idle and while streaming.
- Expected: idle sends normally; streaming includes follow-up/steer behavior where supported.
