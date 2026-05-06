# SvelteKit validation for Steps 64-69

This checklist covers the validation scope for SvelteKit parity Steps 64-69. Automated fixture tests cover adapters, reducers, and action dispatch where possible; browser rendering and real Pi runtime behavior still need live `/phone-start` QA.

## Environment status from implementation loop 14

- `pi` is present at `/home/jens/.npm-global/bin/pi`.
- `pi --help` returned exit code 0, but still emitted a Node `sonic boom is not ready yet` stack trace from the installed `@ramarivera/pi-goal` extension during process exit.
- This agent session has no interactive browser QA tool and did not start a real `/phone-start` backend or Pi conversation.
- Therefore Steps 64-69 are **not live-validated** in this loop. Treat live Pi/browser QA below as pending before final parity sign-off.

## Automated coverage in `npm run frontend:test:fixtures`

| Step | Automated coverage |
| --- | --- |
| 64 | Slash autocomplete detection; merged local/remote slash suggestions; local run-vs-insert behavior; remote command insertion; `/cd` and `@mention` path context detection; path suggestion request payloads; path replacement for mention and `/cd`; stale/failed path suggestion RPC handling. |
| 65 | `/model` and `/thinking` command dispatch; model lookup by provider/id and display name; unknown model fallback to model picker; quota refresh flag on model change; successful set-model/set-thinking RPC notifications; quick action opening of model and thinking sheets. |
| 66 | Active parent/parallel session grouping and status bits; session select dispatch; new parent dispatch; parallel spawn dispatch; command-context unavailable blocking for new parent with warning and refresh request. |
| 67 | Saved-session grouping into parent and parallel groups; title/subtitle/fork-entry adapters; switch saved session dispatch; fork dispatch; session tree node mapping/current path/branch point/model labels; open branch path dispatch. |
| 68 | Tool preview adapters for bash terminal output, read/code/markdown/image previews, edit diffs and stats, grep grouping/dedup/truncation, find/ls lists, language labels, panel-open state, cancelled/error-ish badges, line limits, truncation notices, and unsafe image rejection. |
| 69 | Extension UI request reducer/action coverage for notify, setStatus, setWidget and widget clearing, setTitle, set_editor_text, select, confirm, input, editor draft persistence/submission/cancel, stale request handling, and active-session ownership checks. |

These tests validate protocol shape and frontend state transitions, not Svelte DOM rendering, focus behavior, or actual server/browser timing.

## Live `/phone-start` setup

Use the same setup as the Steps 54-63 validation document:

```text
/phone-start 8787 qa-token --host 127.0.0.1 --idle-mins 10
```

Then run the Svelte dev UI without touching `public/`:

```bash
PI_PHONE_BACKEND=http://127.0.0.1:8787 npm run frontend:dev
```

Open the Vite URL, usually `http://127.0.0.1:5173/`, log in with `qa-token`, and keep browser devtools Network open for `/ws`, `/api/health`, and outbound RPC/local-command messages.

## Manual checklist

### Step 64: autocomplete and selection behavior

- Type `/` and verify local commands appear with local badges.
- Type a remote command prefix such as `/rev` after commands are loaded and verify extension/prompt/skill commands appear beside local matches.
- Pick a run-style local command such as `/refresh`; expected: command executes immediately and the composer clears.
- Pick insert-style `/cd`; expected: `/cd ` is inserted without execution.
- Type `/cd src/` and wait for suggestions; expected: local command payload `{ type: "path-suggestions", mode: "cd", query: "src/…" }`, directory/file chips render, selecting a directory keeps the cursor in the path, selecting a file inserts a trailing space.
- Type normal text with `@src/`; expected: mention suggestions use `mode: "mention"`, render as `@path`, and do not trigger inside `email@host`.
- Exercise non-collapsed text selections in the composer: replace selected text with image tokens, remove repeated image tokens, and accept autocomplete while the cursor is inside a token.
- Expected: selected text is replaced, cursor/selection remains adjusted after token stripping, and autocomplete replacement affects only the active token.

### Step 65: model and thinking

- Open the model picker from quick actions and `/model`; expected: current model is highlighted, provider/model id is visible, search works, selecting a model sends `{ type: "set_model", provider, modelId }`, closes the sheet, shows a success toast on response, and forces quota/context refresh.
- Run `/model <provider>/<id>` and `/model <display name>`; expected: matching model switches directly using the same payload as the picker.
- Run `/model missing`; expected: model picker opens and an explanatory toast appears.
- Open thinking picker from quick actions and `/thinking`; expected: current level is highlighted.
- Select each supported level where safe and run `/thinking <level>`; expected: `{ type: "set_thinking_level", level }` is sent, the sheet closes, a success toast appears on response, and state refreshes without forcing quota.

### Step 66: parent and parallel sessions

- Open active sessions; expected: parent and parallel groups show current/live/pending/model/message-count bits.
- Click a parallel session; expected: `session-select` is sent, pending UI request/snapshot view clears, and the selected session becomes current after refresh.
- Click New Parent; expected: `session-parent-new` message is sent, stale pending UI/snapshot view clears, and UI follows latest.
- Click New Parallel; expected: `session-spawn` message is sent, stale pending UI/snapshot view clears, and the new worker appears after catalog refresh.
- Force or encounter a parent `commandContextAvailable: false` state via active-session catalog or status-only state; expected: New Parent is disabled or blocked with a fresh-command-context warning, no `session-parent-new` message is sent, and a refresh request is made.

### Step 67: saved sessions and tree

- Open saved sessions; expected: parent sessions are grouped separately from parallel sessions, current session is highlighted, paths and previews are visible.
- Click Switch on a saved session; expected: `{ type: "switch_session", sessionPath }` with a trimmed non-empty path, pending UI/snapshot view clears, and refreshed messages load.
- Click Fork where an entry id is exposed; expected: `{ type: "fork", entryId }` with a trimmed non-empty id, refresh/quota flags are requested, and blank ids send nothing.
- Open the session tree; expected: current path/current leaf/branch points/model-change labels render.
- Click Open path on a branch node; expected: `{ type: "phone_open_branch_path", entryId }` with a trimmed non-empty id, pending UI/snapshot view clears, and a new session/path loads.

### Step 68: tool previews

Run or replay prompts that exercise these tools and inspect the rendered cards:

- `bash`: command label, timeout badge, terminal output, cancelled/error/done state, truncation/full-log notice.
- `read`: code language labels and line ranges for source files, markdown preview for `.md`, image preview for safe image payloads.
- `edit`/diff: added/removed stats, path label, context lines, open/closed panel state.
- `grep`: grouped file matches, duplicate suppression, hidden line/file counts, truncation notice.
- `find`/`ls`: directory/file list badges, line limits, hidden counts.
- Markdown and terminal blocks: verify code/artifact sizing, safe rendering, and no unsafe image/data URL exposure.

### Step 69: extension UI requests

Use an extension or fixture command that can emit UI requests:

- `notify`: toast text and severity render.
- `setStatus`: the Svelte extension status panel shows the footer/status text.
- `setWidget`: widget lines appear in the same status panel and empty lines/payload clear the widget.
- `setTitle`: custom title appears where Svelte UI exposes it.
- `set_editor_text`: composer text is replaced.
- `select`: dialog opens, options are focusable/clickable, submit sends selected value, cancel sends cancelled response.
- `confirm`: AI Elements confirmation renders, Yes/No sends confirmed true/false.
- `input`: prefill/placeholder render, draft persists while open, submit sends value.
- `editor`: mobile uses full-screen editor; wider screens use dialog/panel presentation; Ctrl/Meta+Enter submits; cancel sends cancelled response.
- Switch sessions while a request is pending; expected: request belonging to another session is ignored/cleared and cannot be answered from the wrong active session.
