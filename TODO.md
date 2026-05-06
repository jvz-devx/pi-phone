# TODO / Status - SvelteKit Pi Phone Redesign

## Current branch and goal

- Branch: `svelte` (baseline before loop 17 review: `origin/svelte` at `3a03b6c`).
- High-level goal: replace the legacy static Pi Phone UI with the SvelteKit/shadcn/AI Elements implementation while preserving protocol parity, mobile usability, and existing server `/ws` and `/api/*` behavior.
- `public/` remains untouched until manual parity testing and cutover approval.

## Baseline pushed commits observed on `origin/svelte` before loop 17 review

- `dac3787` - `feat: build sveltekit pi phone redesign foundation`
- `02ade0e` - `Implement Svelte extension UI and login dialogs`
- `461e176` - `Polish SvelteKit theme and accessibility`
- `67f7aa8` - `Add guarded SvelteKit static cutover workflow`
- `0a8f277` - `Validate SvelteKit live-flow fixtures`
- `7ddc453` - `Validate SvelteKit QA coverage`
- `f61bca9` - `Fix authenticated phone health status`
- `3a03b6c` - `Fix Svelte UI boot update loops`

## Completed implementation milestones

- Steps 1-4: typed protocol/state foundation, `PhoneClient` transport, Svelte stores, envelope/RPC handling without DOM manipulation.
- Steps 5 and 53: representative adapter/fixture coverage added where practical for snapshots, tools, commands, message transforms, autocomplete, and attachment ordering.
- Steps 6-17: message rendering, scroll/follow behavior, markdown/reasoning/images/streaming/custom messages, tool normalization, rich tool previews, code/artifact rendering, truncation/stat/panel-state parity.
- Steps 18-24: `ComposerBar`/`PromptInput`, image attachment lifecycle/tray, prompt submission rules, slash/path autocomplete, stop/steer controls, and quota/context/cwd placement.
- Steps 25-38: responsive `AppShell`, top status, session rail, inspector, mobile sheets/actions, command browser, model/thinking pickers, session/tree views, extension UI dialogs/editor, and login token flow.
- Steps 39-44: shadcn token/theme conversion, neutral dark styling, safe keyboard shortcuts, mobile safe-area/keyboard handling, accessibility/focus improvements, loading/error states.
- Steps 45-49: legacy `public/` intentionally preserved; guarded frontend build/copy script and static fallback documentation/workflow added; old static modules not removed.
- Steps 50-52: `npm test`, `npm run frontend:check`, and `npm run frontend:build` were covered by pushed validation commits.
- Steps 64-73: static, fixture, and QA documentation coverage exists where practical, but full live-device parity is not complete; remaining live-device gaps are listed below.

## Loop17 writer/review outcomes

- `$effect` audit completed.
  - Remaining effects were reviewed and kept only where needed for UI synchronization/lifecycle integration.
  - Boot/update loop fixes were pushed in `3a03b6c`.
- Live Svelte UI QA for Steps 54-73 was reattempted.
  - Token login, WebSocket connection, streaming, reconnect-oriented flows, follow-up prompt behavior, UI navigation, fixture-backed previews, and documented QA coverage were exercised.
  - This is not a full live-device parity completion claim; remaining live QA gaps are tracked below.
- Loop 17 review validation completed:
  - `npm test` passed.
  - `npm run frontend:check` passed with existing Svelte/CSS warnings.
  - `npm run frontend:build` passed with existing Svelte/chunk-size warnings.
  - `public/` remained untouched.

## Loop 18 subagent findings / fixes

- Worker A fixed Step 55 code path: auth-related login error toasts are now scoped and cleared after a later successful token login while unrelated toasts remain.
  - Files: `frontend/src/lib/actions/auth.ts`, `frontend/src/lib/stores/pi-phone-state.ts`, `frontend/src/lib/fixtures/pi-phone-fixture-tests.ts`.
  - Fixture coverage added for invalid-token recovery clearing stale auth toasts.
- Worker B partially completed despite an interrupted child run; resulting diff fixes Step 63 code path: known remote slash commands route through the local `slash-command` payload and unresolved slash commands with an empty command catalog are blocked with a command refresh/toast instead of falling through to prompt RPC.
  - Files: `frontend/src/lib/actions/phone-commands.ts`, `frontend/src/lib/fixtures/pi-phone-fixture-tests.ts`.
  - Fixture coverage added for known extension command routing and catalog-empty unresolved slash blocking.
- Reviewer pass found no blockers for Step 55 or Step 63 changes.
- Validation after the loop:
  - `cd frontend && npm run test:fixtures` passed.
  - `cd frontend && npm run check` passed with existing Svelte/CSS warnings only.
  - `public/` remained untouched.
- Live-device parity is still not fully reverified for these fixes; Step 63 especially should be rechecked in a real parallel session after spawn.

## Loop 19 subagent findings / fixes

- Worker A strengthened fixture coverage for Step 60/61 composer behavior.
  - Added `canSteer` assertions for streaming/not-submitting vs submitting state.
  - Added steered non-extension slash command coverage proving `streamingBehavior: 'steer'`.
  - Added submit-level image payload coverage proving image data order follows inline token occurrences, including repeated image tokens, and successful image submit clears attachments/records image count.
  - Files: `frontend/src/lib/fixtures/pi-phone-fixture-tests.ts`.
- Worker B hardened Step 69 extension UI response handling.
  - Stale/mismatched responses no longer clear a newer pending UI request.
  - Added fixture coverage for stale response preservation and explicit confirm `false` payloads.
  - Files: `frontend/src/lib/actions/extension-ui.ts`, `frontend/src/lib/fixtures/pi-phone-fixture-tests.ts`.
- Reviewer found one typecheck blocker in the new fixture coverage and one test-strengthening note; fix-worker applied both.
- Validation after the loop:
  - `cd frontend && npm run test:fixtures` passed.
  - `cd frontend && npm run check` passed with existing Svelte/CSS warnings only.
  - `public/` remained untouched.
- Live-device parity is still pending for Step 60/61/69; this loop improved code/fixture confidence only.

## Loop 20 subagent findings / fixes

- Worker A strengthened Step 65/70 model, thinking, and quota behavior.
  - Centralized model switch and thinking-level switch actions for picker and command reuse.
  - `set_model` RPC success now requests a forced quota refresh; `set_thinking_level` refreshes without forcing quota.
  - Fixture coverage asserts model/thinking payloads, success toasts/refresh behavior, and unsupported-model quota hiding behavior.
  - Files: `frontend/src/lib/actions/phone-commands.ts`, `frontend/src/lib/actions/envelope-handlers.ts`, `frontend/src/lib/components/app/sheets/ModelPicker.svelte`, `frontend/src/lib/components/app/sheets/ThinkingPicker.svelte`, `frontend/src/lib/fixtures/pi-phone-fixture-tests.ts`.
- Worker B strengthened Step 66/67 session-control behavior.
  - `startNewParentSession()` clears stale pending UI requests and snapshot/messages before loading the new parent session.
  - Fixture coverage added for New Parent allowed cleanup, active-session and status-only command-context-unavailable blocking, no blocked `session-parent-new` send, refresh/toast behavior, and saved session/tree action trimming/blank no-ops.
  - Files: `frontend/src/lib/actions/phone-commands.ts`, `frontend/src/lib/fixtures/pi-phone-fixture-tests.ts`.
- Reviewer found no blockers. Follow-up risk noted: unresolved slash-command blocking still treats an empty command catalog as “loading”; if Pi can legitimately return zero commands, retry behavior may need a loaded/empty distinction.
- Validation after the loop:
  - `cd frontend && npm run test:fixtures` passed.
  - `cd frontend && npm run check` passed with existing Svelte/CSS warnings only.
  - `public/` remained untouched.
- Live-device parity is still pending for Step 65/66/67/70; this loop improved code/fixture confidence only.

## Loop 21 subagent findings / fixes

- Worker A strengthened Step 62 local/mutating command coverage and closed the Step 63 loaded-empty command catalog risk.
  - Command catalog state now distinguishes unknown/loading from loaded-empty, so unresolved slash commands are blocked only while the remote catalog is unknown; after a successful empty command response, slash-looking prompts can proceed normally.
  - Fixture coverage strengthened for local/mutating command dispatch and blocked image-attachment cases.
  - Files: `frontend/src/lib/stores/pi-phone-state.ts`, `frontend/src/lib/actions/envelope-handlers.ts`, `frontend/src/lib/actions/phone-commands.ts`, `frontend/src/lib/fixtures/pi-phone-fixture-tests.ts`.
- Worker B strengthened Step 64/68 selection and preview coverage.
  - Attachment token stripping/insertion selection handling was tightened and covered for repeated tokens and non-collapsed selections.
  - Autocomplete mid-token replacement coverage was added.
  - Edit/diff/image/markdown preview fixture coverage was expanded.
  - Files: `frontend/src/lib/actions/attachments.ts`, `frontend/src/lib/fixtures/pi-phone-fixture-tests.ts`.
- Reviewer found no blockers.
- Validation after the loop:
  - `cd frontend && npm run test:fixtures` passed.
  - `cd frontend && npm run check` passed with existing Svelte/CSS warnings only.
  - `public/` remained untouched.
- Live-device parity is still pending for Step 62/64/68 and the Step 63 retry behavior; this loop improved code/fixture confidence only.

## Loop 22 subagent findings / fixes

- Worker A strengthened Step 71/72 mobile and panel behavior.
  - Added mobile layout helpers for keyboard inset math, jump-latest visibility, and desktop panel reconciliation.
  - AppShell now updates viewport CSS vars/dispatches viewport changes; ChatWorkspace re-scrolls when following latest across viewport changes.
  - Desktop resize reconciliation reopens the appropriate rail/panel after mobile sheet use.
  - Files: `frontend/src/lib/actions/mobile-layout.ts`, `frontend/src/lib/components/app/AppShell.svelte`, `frontend/src/lib/components/chat/ChatWorkspace.svelte`, `frontend/src/lib/fixtures/pi-phone-fixture-tests.ts`.
- Worker B strengthened Step 73 static cutover/PWA guardrails.
  - Dry-run/confirm release flow now validates required PWA build files: `manifest.webmanifest`, `sw.js`, and `icon.svg`.
  - Release flow runs `static:fallback:check` and `svelte:validation:check` before any public copy.
  - Validation coverage checks now ensure routine scripts do not invoke public cutover and that release ordering preserves `/api/*` + `/ws` checks before copy.
  - Files: `scripts/release-sveltekit-public.mjs`, `scripts/check-svelte-validation-coverage.mjs`, `docs/sveltekit-migration.md`, `docs/sveltekit-validation-steps-70-73.md`.
- Reviewer found no blockers.
- Validation after the loop:
  - `cd frontend && npm run test:fixtures` passed.
  - `cd frontend && npm run check` passed with existing Svelte/CSS warnings only.
  - `npm run static:fallback:check` passed.
  - `npm run svelte:validation:check` passed.
  - `npm run frontend:sync-public:dry-run` passed and did not modify `public/`.
  - `public/` remained untouched.
- Live-device/browser parity is still pending for Step 71/72/73; this loop improved code/fixture/guardrail confidence only.

## Loop 23 subagent findings / final non-live audit

- Worker A audited remaining Steps 60-67 for any feasible non-live code/fixture/guardrail gaps.
  - Tightened live validation checklist docs for interaction/composer/session items.
  - Files: `docs/sveltekit-validation-steps-54-63.md`, `docs/sveltekit-validation-steps-64-69.md`.
  - Reported Steps 60-67 appear to be live-only parity blockers after checklist tightening.
- Worker B audited remaining Steps 68-73.
  - Found no additional safe non-live code/fixture/guardrail gaps for preview/dialog/mobile/static/PWA items.
  - No files changed by Worker B.
- Reviewer found one blocker before stopping code loops:
  - Step 69 was not fully live-only because extension `setStatus`/`setWidget` state was reduced but not visibly rendered in Svelte UI.
  - Reviewer also found inaccurate Step 61 docs that implied untokened attachments submit last, while current code removes tokenless attachments before payload build.
- Fix-worker resolved reviewer findings.
  - Added visible Svelte UI for extension footer/status/widgets in `ExtensionUiDialog`.
  - Corrected image submission checklist wording to match tokenized behavior: only inline token occurrences are submitted, including duplicates, and tokenless attachments are removed before payload build.
  - Files: `frontend/src/lib/components/app/ExtensionUiDialog.svelte`, `docs/sveltekit-validation-steps-54-63.md`, `docs/sveltekit-validation-steps-64-69.md`.
- Final reviewer found no blockers.
- Validation after the loop:
  - `cd frontend && npm run test:fixtures` passed.
  - `cd frontend && npm run check` passed with existing Svelte/CSS warnings only.
  - `npm run static:fallback:check` passed.
  - `npm run svelte:validation:check` passed.
  - `npm run frontend:sync-public:dry-run` passed and did not modify `public/`.
  - `public/` remained untouched.
- Conclusion: no further safe non-live code/fixture/guardrail gaps were found for Steps 60-73. Remaining work is live-device/browser/PWA parity verification and explicit cutover approval only.

## Ad hoc desktop right panel controls fix

- Finding: desktop right panel visibility is forced by `appState.sheets.open`, so controls that only toggled `rightOpen` could appear inert while the Pi Browser sheet was active.
- Fix: AppShell now uses a sheet-aware right-panel collapse handler for the desktop header and desktop SheetBrowser close, switches the desktop Inspector action from Pi Browser to Inspector by clearing the active sheet and opening the right panel, and keeps the desktop Actions action opening the Actions sheet/right panel.
- Coverage: lightweight fixture/static assertions cover the AppShell/SheetBrowser right-panel control wiring.
- Validation:
  - `cd frontend && npm run test:fixtures` passed.
  - `npm run static:fallback:check` passed.
  - `cd frontend && npm run check` passed with existing Svelte/CSS warnings only.
  - `git diff --check` passed.
- `public/` remained untouched.

## Explicit remaining TODOs from live QA

- Step 60: steer button code/fixture coverage strengthened; live visibility/use still pending.
- Step 61: image payload submission/order fixture/docs coverage strengthened; live image submission still pending.
- Step 62: local/mutating command coverage strengthened; live mutating-command matrix still pending.
- Step 63: code/fixture fix added for parallel remote slash command routing and loaded-empty catalog behavior; live parallel-session retest still pending.
- Step 64: selection behavior fixture coverage strengthened; live selection behavior still pending.
- Step 65: model/thinking switch actions have stronger code/fixture coverage; live picker/command execution still pending.
- Step 66: New Parent and command-context-unavailable behavior has stronger code/fixture coverage; live forced-state check still pending.
- Step 67: saved session switch/fork/open branch actions have stronger code/fixture coverage; live execution still pending.
- Step 68: edit/diff/image/markdown preview matrix fixture coverage strengthened; live preview matrix still pending.
- Step 69: select/confirm/input/editor/status/widget dialog actions have stronger code/fixture/UI coverage; live dialog matrix still pending.
- Step 70: unsupported-model quota hiding has stronger code/fixture coverage; live unsupported-model check still pending.
- Step 71: mobile keyboard/safe-area/jump-latest behavior has stronger code/fixture coverage; real mobile device/browser check still pending.
- Step 72: panel persistence/resizing behavior has stronger code/fixture coverage; below-breakpoint live resize check still pending.
- Step 73: static cutover/PWA/offline guardrails and dry-run validation strengthened; confirmed cutover/PWA install/offline live check still pending.

## Next recommended loop

1. Stop code/fixture loops unless live testing finds a concrete regression; current remaining Step 60-73 items are live-device/browser/PWA parity checks.
2. Rerun targeted live QA for the remaining Step 60-73 gaps, including live confirmation of all fixture-backed fixes from loops 18-23.
3. For Step 73, perform only the guarded dry-run until parity/cutover approval is explicit.
4. After parity/cutover approval, run the guarded Svelte static export/copy workflow and then verify the existing Pi Phone server still serves Svelte static output while `/ws` and `/api/*` remain unaffected.
