import assert, { AssertionError } from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  activeAutocompleteContext,
  applyAutocompleteItem,
  detectCdAutocompleteContext,
  detectMentionAutocompleteContext,
  detectSlashCommandAutocompleteContext,
  requestPathSuggestions,
  slashCommandItems,
  updateAutocomplete,
} from '$lib/actions/autocomplete';
import { consumeLoginTokenFromUrl, consumeTokenFromFragment, submitLoginToken } from '$lib/actions/auth';
import {
  cancelExtensionUiRequest,
  extensionUiDraftValue,
  persistExtensionUiDraft,
  sendExtensionUiResponse,
} from '$lib/actions/extension-ui';
import {
  addImageAttachments,
  attachmentOccurrences,
  buildPromptPayload,
  buildTokenInsertion,
  filterImageFiles,
  insertTokensAtSelection,
  orderedAttachments,
  removeAttachmentAndToken,
  stripTokenFromPrompt,
  syncAttachmentRecordsWithPrompt,
} from '$lib/actions/attachments';
import { handleEnvelope, handleRpcPayload } from '$lib/actions/envelope-handlers';
import { computeViewportCssVars, reconcileMobilePanelForDesktop, shouldShowJumpToLatest } from '$lib/actions/mobile-layout';
import {
  findRemoteSlashCommand,
  forkSessionEntry,
  abortGeneration,
  canSteer,
  openBranchPath,
  parentCommandControlsAvailable,
  treeBelongsToCurrentSession,
  requestModelSwitch,
  requestThinkingLevelSwitch,
  runPhoneQuickAction,
  isAmbiguousRemoteSlashCommand,
  selectActiveSession,
  sendRemoteSlashCommand,
  spawnParallelSession,
  startNewParentSession,
  submitPrompt,
  switchSavedSession,
  tryHandleLocalCommand,
  type PhoneCommandActionClient,
  type PhoneSessionActionClient,
} from '$lib/actions/phone-commands';
import {
  contentToText,
  conversationItems,
  imageSource,
  renderableUserContent,
  transformPhoneMessage,
  transformPhoneMessages,
} from '$lib/adapters/message-adapter';
import {
  activeSessionStatusBits,
  groupActiveSessions,
  groupSavedSessions,
  mapTreeNodes,
  savedSessionForkEntryId,
  savedSessionSubtitle,
  savedSessionTitle,
  treeFileLabel,
} from '$lib/adapters/sheet-adapter';
import {
  buildEditPreviewLines,
  buildGrepPreview,
  buildToolPreview,
  detectLanguageLabel,
  parseNumberedDiffLines,
  splitToolNotice,
} from '$lib/adapters/tool-adapter';
import { quotaContextDisplay, supportsPiQuotaForModel } from '$lib/adapters/quota-context';
import { PhoneAuthError, PhoneClient, readStoredToken, storeToken } from '$lib/pi-phone-transport';
import { createPiPhoneStateStore, piPhoneState } from '$lib/stores/pi-phone-state';
import type {
  PhoneAttachmentRecord,
  PhoneExtensionUiResponse,
  PhoneHealth,
  PhoneRawMessage,
  PhoneRpcResponse,
  PhoneSavedSession,
  PhoneTree,
  PhoneUiToolMessage,
} from '$lib/types/pi-phone';

import {
  fixtureCommands,
  fixtureCommandsResponse,
  fixtureMessages,
  fixturePathSuggestionResponse,
  fixtureSnapshotEnvelope,
  fixtureToolEnd,
  fixtureToolStart,
  fixtureToolUpdate,
} from './pi-phone-fixtures';

function resetGlobalState() {
  piPhoneState.reset();
}

function attachment(id: string, tokenOrder: number, token: string): PhoneAttachmentRecord {
  return {
    id,
    file: new File(['fixture'], `${id}.png`, { type: 'image/png' }),
    name: `${id}.png`,
    size: 7,
    type: 'image/png',
    url: `blob:${id}`,
    token,
    tokenOrder,
  };
}

class FixtureLocalStorage {
  private items = new Map<string, string>();

  get length() {
    return this.items.size;
  }

  key(index: number) {
    return [...this.items.keys()][index] || null;
  }

  getItem(key: string) {
    return this.items.has(key) ? this.items.get(key) || '' : null;
  }

  setItem(key: string, value: string) {
    this.items.set(key, String(value));
  }

  removeItem(key: string) {
    this.items.delete(key);
  }

  clear() {
    this.items.clear();
  }
}

class FixtureWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FixtureWebSocket[] = [];

  readyState = FixtureWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(readonly url: string) {
    FixtureWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }

  send(data: string) {
    this.sent.push(String(data));
  }

  close(code = 1000, reason = 'fixture-close') {
    this.closeWith(code, reason, true);
  }

  open() {
    this.readyState = FixtureWebSocket.OPEN;
    this.dispatch('open', { type: 'open' });
  }

  receive(data: unknown) {
    this.dispatch('message', { data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  closeWith(code: number, reason = '', wasClean = false) {
    this.readyState = FixtureWebSocket.CLOSED;
    this.dispatch('close', { code, reason, wasClean });
  }

  private dispatch(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

function installBrowserTransportFixtures() {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previousWindow = globals.window;
  const previousLocalStorage = globals.localStorage;
  const previousWebSocket = globalThis.WebSocket;
  const previousFetch = globalThis.fetch;

  FixtureWebSocket.instances = [];
  globals.window = {
    location: {
      origin: 'http://phone.test',
      protocol: 'http:',
      host: 'phone.test',
    },
  };
  globals.localStorage = new FixtureLocalStorage();
  globalThis.WebSocket = FixtureWebSocket as unknown as typeof WebSocket;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/health') && url.includes('bad-token')) {
      return new Response(JSON.stringify({ error: 'bad token' }), { status: 403, statusText: 'Forbidden' });
    }
    if (url.includes('/api/health')) {
      const health: PhoneHealth = {
        cwd: '/repo',
        hasToken: true,
        isRunning: true,
        childRunning: true,
        isStreaming: false,
        isCompacting: false,
        host: '127.0.0.1',
        port: 8787,
        connectedClients: 1,
        sessionCount: 1,
        controlOwner: 'phone',
        commandContextAvailable: true,
      };
      return Response.json(health);
    }
    if (url.includes('/api/quota')) return Response.json({ visible: false });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  return () => {
    if (previousWindow === undefined) delete globals.window;
    else globals.window = previousWindow;
    if (previousLocalStorage === undefined) delete globals.localStorage;
    else globals.localStorage = previousLocalStorage;
    globalThis.WebSocket = previousWebSocket;
    globalThis.fetch = previousFetch;
  };
}

function testMessageAdapterFixtures() {
  const messages = transformPhoneMessages(fixtureMessages);

  assert.equal(messages.length, 8, 'all displayable fixture messages are transformed and hidden custom messages are skipped');
  assert.deepEqual(
    messages.map((message) => message.kind),
    ['user', 'assistant', 'tool', 'tool', 'user', 'custom', 'summary', 'summary'],
  );

  const user = messages[0];
  assert.equal(user.kind, 'user');
  assert.equal(user.imageCount, 2, 'user image content is counted');
  assert.match(user.text || '', /Review these screenshots/);
  assert.deepEqual(
    renderableUserContent(user.rawContent).map((part) => part.type === 'image' ? [part.type, part.src, part.alt] : [part.type, part.text]),
    [
      ['text', 'Review these screenshots and run tests: '],
      ['image', 'data:image/png;base64,iVBORw0KGgo=', 'before.png'],
      ['image', 'blob:after', 'after.png'],
    ],
    'user text and safe image parts preserve display order',
  );
  assert.equal(imageSource({ type: 'image', url: 'https://example.test/image.png', mimeType: 'image/png' }), 'https://example.test/image.png');
  assert.equal(imageSource({ type: 'image', url: 'http://example.test/image.png', mimeType: 'image/png' }), 'http://example.test/image.png');
  assert.equal(imageSource({ type: 'image', url: 'blob:after', mimeType: 'image/png' }), 'blob:after');
  assert.equal(
    imageSource({ type: 'image', previewUrl: 'javascript:alert(1)', url: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' }),
    'data:image/png;base64,aGVsbG8=',
    'safe data:image fallback is used when an unsafe preview URL is rejected',
  );
  assert.equal(imageSource({ type: 'image', url: 'javascript:alert(1)', mimeType: 'image/png' }), '', 'unsafe image urls are ignored');
  assert.equal(imageSource({ type: 'image', url: 'ftp://example.test/image.png', mimeType: 'image/png' }), '', 'unsupported image protocols are ignored');
  assert.equal(imageSource({ type: 'image', url: 'data:text/html;base64,PHNjcmlwdD4=', mimeType: 'image/png' }), '', 'non-image data urls are ignored');

  const assistant = messages[1];
  assert.equal(assistant.kind, 'assistant');
  assert.match(assistant.text || '', /focused fixture test/);
  assert.equal(assistant.thinking, 'Need inspect state first.', 'terminal control sequences are stripped from thinking');
  assert.equal(assistant.toolCalls?.[0]?.name, 'read');
  assert.equal(assistant.toolCalls?.[0]?.arguments.path, 'frontend/src/lib/stores/pi-phone-state.ts');
  assert.deepEqual(assistant.usage, fixtureMessages[1].role === 'assistant' ? fixtureMessages[1].usage : undefined);
  assert.equal(assistant.stopReason, 'tool-calls');
  assert.deepEqual(assistant.details, { latencyMs: 250, providerRequestId: 'req-fixture-1' });

  const bash = messages[3];
  assert.equal(bash.kind, 'tool');
  assert.equal(bash.status, 'done');
  assert.equal(contentToText([{ type: 'text', text: '\u001b[32mclean\u001b[0m output' }]), 'clean output');

  const inlineCustom = messages[4];
  assert.equal(inlineCustom.kind, 'user', 'phone-inline-user-message custom records render as user messages');
  assert.equal(inlineCustom.text, 'Follow-up from extension UI');

  const genericCustom = messages[5];
  assert.equal(genericCustom.kind, 'custom');
  assert.equal(genericCustom.title, 'review-status');
  assert.equal(genericCustom.customType, 'review-status');
  assert.equal(genericCustom.text, 'Fixture review status message');
  assert.deepEqual(genericCustom.rawContent, fixtureMessages[5].role === 'custom' ? fixtureMessages[5].content : undefined);
  assert.deepEqual(genericCustom.details, { severity: 'info' });

  const [customPreview] = transformPhoneMessage({
    role: 'custom',
    customType: 'markdown-image-preview',
    timestamp: 1_700_000_015_000,
    content: [
      { type: 'text', text: '# Preview\n\n![inline](attachment)\n' },
      { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png', name: 'preview.png' },
    ],
    details: { source: 'fixture' },
  });
  assert.equal(customPreview.kind, 'custom');
  assert.equal(customPreview.text, '# Preview\n\n![inline](attachment)\n [image]', 'custom markdown-like messages preserve text and image placeholders for PiMarkdown rendering');
  assert.equal(customPreview.imageCount, 1, 'custom markdown-like messages retain image-count metadata');
  assert.deepEqual(customPreview.details, { source: 'fixture' });

  const branchSummary = messages[6];
  assert.equal(branchSummary.kind, 'summary');
  assert.equal(branchSummary.summaryKind, 'branch');
  assert.equal(branchSummary.title, 'Branch summary');
  assert.equal(branchSummary.fromId, 'entry-1');
  assert.deepEqual(branchSummary.details, { fromId: 'entry-1' });

  const compactionSummary = messages[7];
  assert.equal(compactionSummary.kind, 'summary');
  assert.equal(compactionSummary.summaryKind, 'compaction');
  assert.equal(compactionSummary.tokensBefore, 42_000);
  assert.match(compactionSummary.title || '', /42,000 tokens/);
  assert.deepEqual(compactionSummary.details, { tokensBefore: 42_000 });
}

function testSnapshotEnvelopeReducer() {
  resetGlobalState();
  handleEnvelope(fixtureSnapshotEnvelope);
  const state = piPhoneState.snapshot();

  assert.equal(state.snapshot.workerId, 'worker-parent');
  assert.equal(state.snapshot.state?.sessionId, 'session-123');
  assert.equal(state.status?.isStreaming, true);
  assert.equal(state.commands.available.length, fixtureCommands.length);
  assert.equal(state.commands.loaded, true, 'snapshot envelopes with command catalogs mark commands as loaded');
  assert.equal(state.messages.items.length, 8);
  assert.equal(state.messages.liveAssistant?.id, 'assistant-live');
  assert.equal(state.messages.liveAssistant?.live, true);
  assert.equal(state.tools.live.size, 2);
  assert.equal(state.tools.live.get('tool-bash-live')?.status, 'running');
  assert.equal(state.tools.live.get('tool-read-done')?.status, 'done');
  assert.equal(state.quota.refreshNeeded, true, 'snapshot requests a quota refresh');
}

function testCommandAndPathSuggestionResponses() {
  resetGlobalState();
  handleRpcPayload(fixtureCommandsResponse);
  assert.equal(piPhoneState.snapshot().commands.available.at(-1)?.name, 'plan');
  assert.equal(piPhoneState.snapshot().commands.loaded, true, 'get_commands responses mark the command catalog as loaded');

  piPhoneState.setAutocompleteContext({ type: 'path', mode: 'mention', query: 'src', replaceStart: 10, replaceEnd: 14 });
  piPhoneState.setAutocompleteRemoteRequestId(7);
  handleRpcPayload(fixturePathSuggestionResponse);

  const suggestions = piPhoneState.snapshot().autocomplete.items;
  assert.equal(suggestions.length, 3);
  assert.deepEqual(
    suggestions.map((suggestion) => [suggestion.label, suggestion.badge]),
    [
      ['@src/lib/', 'dir'],
      ['@src/routes/+page.svelte', 'file'],
      ['@README.md', 'recent'],
    ],
  );

  const staleResponse: PhoneRpcResponse<'path_suggestions'> = {
    type: 'response',
    command: 'path_suggestions',
    success: true,
    data: {
      mode: 'mention',
      query: 'src',
      cwd: '/repo/frontend',
      requestId: 6,
      suggestions: [],
    },
  };
  handleRpcPayload(staleResponse);
  assert.equal(piPhoneState.snapshot().autocomplete.items.length, 3, 'stale path suggestion responses are ignored');

  const failedResponse: PhoneRpcResponse<'path_suggestions'> = {
    type: 'response',
    command: 'path_suggestions',
    success: false,
    error: 'no cwd',
  };
  handleRpcPayload(failedResponse);
  assert.equal(piPhoneState.snapshot().autocomplete.items.length, 0, 'failed path suggestions clear current items');
}

function testLiveToolReducers() {
  resetGlobalState();
  handleRpcPayload(fixtureToolStart);
  let tool = piPhoneState.snapshot().tools.live.get('tool-bash-42');
  assert.equal(tool?.status, 'running');
  assert.equal(tool?.command, 'npm test');
  assert.match(tool?.text || '', /npm test/);

  handleRpcPayload(fixtureToolUpdate);
  tool = piPhoneState.snapshot().tools.live.get('tool-bash-42');
  assert.equal(tool?.status, 'running');
  assert.equal(tool?.text, 'typecheck running');
  assert.deepEqual(tool?.details, { lineCount: 1 });

  handleRpcPayload(fixtureToolEnd);
  tool = piPhoneState.snapshot().tools.live.get('tool-bash-42');
  assert.equal(tool?.status, 'done');
  assert.equal(tool?.live, false);
  assert.equal(tool?.text, 'PASS npm test');
  assert.deepEqual(tool?.details, { exitCode: 0 });
}

function testToolPreviewAdapterFixtures() {
  assert.equal(detectLanguageLabel('src/lib/adapters/tool-adapter.ts'), 'TypeScript');
  assert.equal(detectLanguageLabel('README.md'), 'Markdown');
  assert.equal(detectLanguageLabel('component.svelte'), 'SVELTE', 'unknown extensions fall back to upper-case labels');
  assert.deepEqual(splitToolNotice('line 1\n[Output truncated. Use offset=10]').notice, '[Output truncated. Use offset=10]');

  assert.deepEqual(
    parseNumberedDiffLines('+ 12 next\n- 13 old\n  14 keep').map((line) => [line.kind, line.lineNumber, line.text]),
    [
      ['added', '12', 'next'],
      ['removed', '13', 'old'],
      ['context', '14', 'keep'],
    ],
    'numbered diff output is parsed into structured lines',
  );
  assert.deepEqual(
    buildEditPreviewLines('alpha\nbeta\ngamma', 'alpha\nBETTER\ngamma').map((line) => [line.kind, line.lineNumber, line.text]),
    [
      ['context', '1', 'alpha'],
      ['removed', '2', 'beta'],
      ['added', '2', 'BETTER'],
      ['context', '3', 'gamma'],
    ],
    'replacement block previews retain context and changed line numbers',
  );

  const editPreview = buildToolPreview({
    id: 'tool-edit-fixture',
    kind: 'tool',
    toolName: 'edit',
    status: 'done',
    args: { path: 'src/app.ts', oldText: 'const a = 1;', newText: 'const a = 2;' },
  });
  assert.equal(editPreview.normalizedName, 'edit');
  assert.equal(editPreview.subject, 'src/app.ts');
  assert.equal(editPreview.defaultOpen, true);
  assert.deepEqual(editPreview.badges.map((item) => item.label), ['+1', '-1']);
  const editSection = editPreview.sections[0];
  assert.equal(editSection?.type, 'diff');
  if (editSection?.type !== 'diff') throw new AssertionError({ message: 'edit preview should be a diff' });
  assert.deepEqual(editSection.stats, { added: 1, removed: 1 });

  const detailedEditPreview = buildToolPreview({
    id: 'tool-edit-detailed-fixture',
    kind: 'tool',
    toolName: 'edit',
    status: 'done',
    args: { path: 'src/app.ts' },
    details: { diff: '+ 10 next\n- 11 old\n  12 keep', firstChangedLine: 10, replacementCount: 1 },
  });
  assert.deepEqual(detailedEditPreview.badges.map((item) => item.label), ['+1', '-1', 'L10']);
  assert.equal(detailedEditPreview.note, undefined, 'server-provided edit diffs are not labeled as replacement-block guesses');
  const detailedEditSection = detailedEditPreview.sections[0];
  assert.equal(detailedEditSection?.type, 'diff');
  if (detailedEditSection?.type !== 'diff') throw new AssertionError({ message: 'server edit preview should be a diff' });
  assert.deepEqual(
    detailedEditSection.lines.map((line) => [line.kind, line.lineNumber, line.text]),
    [['added', '10', 'next'], ['removed', '11', 'old'], ['context', '12', 'keep']],
    'server-provided edit diffs preserve numbered added/removed/context rows',
  );

  const writePreview = buildToolPreview({
    id: 'tool-write-fixture',
    kind: 'tool',
    toolName: 'write',
    status: 'running',
    live: true,
    args: { path: 'frontend/src/app.ts', content: 'export const answer = 42;\n' },
  });
  assert.equal(writePreview.normalizedName, 'write');
  assert.equal(writePreview.open, true, 'live write previews default open');
  assert.ok(writePreview.badges.some((item) => item.label === 'TypeScript'));
  const writeSection = writePreview.sections[0];
  assert.equal(writeSection?.type, 'code');
  if (writeSection?.type !== 'code') throw new AssertionError({ message: 'write preview should be code' });
  assert.equal(writeSection.startLine, 1);
  assert.equal(writeSection.lang, 'typescript');

  const readMarkdownPreview = buildToolPreview({
    id: 'tool-read-md-fixture',
    kind: 'tool',
    toolName: 'read',
    status: 'done',
    args: { path: 'README.md', offset: 5 },
    text: '# Title\n\nBody\n[File truncated. Use offset=8]',
  });
  assert.equal(readMarkdownPreview.normalizedName, 'read');
  const markdownSection = readMarkdownPreview.sections[0];
  assert.equal(markdownSection?.type, 'markdown');
  if (markdownSection?.type !== 'markdown') throw new AssertionError({ message: 'read markdown preview should be markdown' });
  assert.equal(markdownSection.markdown, '# Title\n\nBody');
  assert.match(markdownSection.notice || '', /Use offset=8/);
  assert.ok(readMarkdownPreview.badges.some((item) => item.label === '5-7'), 'read previews preserve line ranges');

  const longMarkdownPreview = buildToolPreview({
    id: 'tool-read-long-md-fixture',
    kind: 'tool',
    toolName: 'read',
    status: 'done',
    args: { path: 'docs/preview.md' },
    text: Array.from({ length: 92 }, (_, index) => `markdown line ${index + 1}`).join('\n'),
  });
  const longMarkdownSection = longMarkdownPreview.sections[0];
  assert.equal(longMarkdownSection?.type, 'markdown');
  if (longMarkdownSection?.type !== 'markdown') throw new AssertionError({ message: 'long markdown read preview should be markdown' });
  assert.equal(longMarkdownSection.hiddenCount, 2, 'markdown previews preserve hidden line counts beyond the preview limit');
  assert.match(longMarkdownSection.markdown, /markdown line 90$/);

  const imagePreview = buildToolPreview({
    id: 'tool-read-image-fixture',
    kind: 'tool',
    toolName: 'read',
    status: 'done',
    args: { path: 'image.png' },
    rawContent: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }],
  });
  const imageSection = imagePreview.sections[0];
  assert.equal(imageSection?.type, 'image');
  if (imageSection?.type !== 'image') throw new AssertionError({ message: 'read image preview should be image' });
  assert.equal(imageSection.src, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(imagePreview.open, true);

  const unsafeImagePreview = buildToolPreview({
    id: 'tool-read-unsafe-image-fixture',
    kind: 'tool',
    toolName: 'read',
    status: 'done',
    args: { path: 'image.png' },
    rawContent: [{ type: 'image', data: '<svg onload=alert(1)>', mimeType: 'image/svg+xml' }],
  });
  assert.notEqual(unsafeImagePreview.sections[0]?.type, 'image', 'unsafe image data is not exposed as a preview src');

  const bashOutput = Array.from({ length: 102 }, (_, index) => `line ${index + 1}`).join('\n')
    + '\n[Output truncated. Full output saved to temp file]';
  const bashPreview = buildToolPreview({
    id: 'tool-bash-fixture',
    kind: 'tool',
    toolName: 'bash',
    title: 'bash · npm test',
    command: 'npm test',
    status: 'cancelled',
    args: { command: 'npm test', timeout: 30 },
    text: bashOutput,
    details: { fullOutputPath: '/tmp/pi-phone.log' },
  }, { panelOpen: new Map([['tool-bash-fixture', false]]) });
  assert.equal(bashPreview.normalizedName, 'bash');
  assert.equal(bashPreview.open, false, 'stored panel-open state overrides default open');
  assert.deepEqual(bashPreview.badges.map((item) => item.label), ['cancelled', '30s timeout', 'full log saved']);
  const bashSection = bashPreview.sections[0];
  assert.equal(bashSection?.type, 'terminal');
  if (bashSection?.type !== 'terminal') throw new AssertionError({ message: 'bash preview should be terminal output' });
  assert.equal(bashSection.hiddenCount, 2);
  assert.match(bashSection.notice || '', /Full output saved/);

  const grepPreview = buildToolPreview({
    id: 'tool-grep-fixture',
    kind: 'tool',
    toolName: 'grep',
    status: 'done',
    args: { pattern: 'createPiPhoneStateStore', path: 'frontend/src' },
    text: 'src/a.ts:10:export function createPiPhoneStateStore() {}\nsrc/a.ts:10:export function createPiPhoneStateStore() {}\nsrc/a.ts-11-}\nsrc/b.ts:4:createPiPhoneStateStore();',
  });
  const grepSection = grepPreview.sections[0];
  assert.equal(grepSection?.type, 'grep');
  if (grepSection?.type !== 'grep') throw new AssertionError({ message: 'grep preview should be grouped matches' });
  assert.equal(grepSection.matchCount, 2, 'adjacent duplicate grep rows are deduped before counting');
  assert.equal(grepSection.fileCount, 2);
  assert.deepEqual(grepSection.groups.map((group) => [group.path, group.entries.length]), [['src/a.ts', 2], ['src/b.ts', 1]]);

  const directGrep = buildGrepPreview('raw output without grep coordinates');
  assert.equal(directGrep.groups.length, 0);
  assert.equal(directGrep.fallback, 'raw output without grep coordinates');

  const limitedGrep = buildGrepPreview('a.ts:1:one\na.ts:2:two\nb.ts:1:three\nc.ts:1:four\n[Output truncated. Full output saved to temp file]', {
    limitFiles: 2,
    limitLinesPerFile: 1,
  });
  assert.equal(limitedGrep.groups[0]?.hiddenCount, 1, 'grep previews preserve per-file truncation counts');
  assert.equal(limitedGrep.hiddenFileCount, 1, 'grep previews preserve hidden file counts');
  assert.match(limitedGrep.notice || '', /Full output saved/, 'grep previews preserve truncation notices');

  const findPreview = buildToolPreview({
    id: 'tool-find-fixture',
    kind: 'tool',
    toolName: 'find',
    status: 'done',
    args: { pattern: '*.ts', path: 'src' },
    text: 'src/lib/\nsrc/app.ts\n[limit reached]',
  });
  const findSection = findPreview.sections[0];
  assert.equal(findSection?.type, 'list');
  if (findSection?.type !== 'list') throw new AssertionError({ message: 'find preview should be a list' });
  assert.deepEqual(findSection.entries.map((entry) => [entry.kind, entry.text]), [['directory', 'src/lib/'], ['file', 'src/app.ts']]);
  assert.equal(findSection.notice, '[limit reached]');

  const lsPreview = buildToolPreview({
    id: 'tool-ls-fixture',
    kind: 'tool',
    toolName: 'ls',
    status: 'done',
    args: { path: 'src' },
    text: Array.from({ length: 82 }, (_, index) => (index % 3 === 0 ? `dir-${index}/` : `file-${index}.ts`)).join('\n') + '\n[limit reached]',
  });
  assert.equal(lsPreview.subject, 'src');
  assert.ok(lsPreview.badges.some((item) => /dir/.test(item.label)), 'ls previews preserve directory count badges');
  const lsSection = lsPreview.sections[0];
  assert.equal(lsSection?.type, 'list');
  if (lsSection?.type !== 'list') throw new AssertionError({ message: 'ls preview should be a list' });
  assert.equal(lsSection.entries.length, 80, 'ls previews apply the old line limit');
  assert.equal(lsSection.hiddenCount, 2, 'ls previews preserve list truncation counts');
  assert.equal(lsSection.notice, '[limit reached]');
}

function testMobileLayoutAndPanelPersistenceFixtures() {
  assert.deepEqual(
    computeViewportCssVars(844, { height: 520.4, offsetTop: 24.2 }),
    { visualHeight: 520, keyboardInset: 300 },
    'mobile keyboard inset accounts for visual viewport height and offset',
  );
  assert.deepEqual(
    computeViewportCssVars(844, null),
    { visualHeight: 844, keyboardInset: 0 },
    'desktop/no-visualViewport layout does not invent a keyboard inset',
  );

  assert.equal(shouldShowJumpToLatest(true, false, false), true, 'jump-latest shows only when content exists and user is away from latest');
  assert.equal(shouldShowJumpToLatest(true, true, false), false, 'jump-latest hides while following latest');
  assert.equal(shouldShowJumpToLatest(true, false, true), false, 'jump-latest hides near the bottom');
  assert.equal(shouldShowJumpToLatest(false, false, false), false, 'jump-latest hides for empty conversations');

  assert.deepEqual(reconcileMobilePanelForDesktop(null, false), null, 'desktop reconciliation is a no-op without a mobile panel or sheet');
  assert.deepEqual(reconcileMobilePanelForDesktop('inspector', false), { mobilePanel: null, rightOpen: true }, 'mobile inspector reopens as the desktop right panel');
  assert.deepEqual(reconcileMobilePanelForDesktop('active-sessions', false), { mobilePanel: null, leftOpen: true }, 'mobile active sessions reopen as the desktop session rail');
  assert.deepEqual(reconcileMobilePanelForDesktop('commands', true), { mobilePanel: null, rightOpen: true }, 'mobile sheets remain visible in the desktop right panel after resize');

  const store = createPiPhoneStateStore();
  store.setToolPanelOpen('tool-a', false);
  store.setToolPanelOpen('tool-b', true);
  assert.equal(store.snapshot().tools.panelOpen.get('tool-a'), false);
  assert.equal(store.snapshot().tools.panelOpen.get('tool-b'), true);

  store.clearTransientState();
  assert.equal(store.snapshot().tools.panelOpen.get('tool-a'), false, 'transient stream cleanup preserves explicit tool panel collapse state');

  store.clearSnapshotView();
  assert.equal(store.snapshot().tools.panelOpen.get('tool-b'), true, 'session-view cleanup preserves explicit tool panel expansion state for remounts/resizes');

  const collapsedPreview = buildToolPreview({ id: 'tool-a', kind: 'tool', toolName: 'bash', status: 'done', text: 'ok' }, { panelOpen: store.snapshot().tools.panelOpen });
  assert.equal(collapsedPreview.open, false, 'tool preview honors persisted collapsed panel state after remount');
}

function testDesktopRightPanelControlStaticCoverage() {
  const appShellSource = readFileSync('src/lib/components/app/AppShell.svelte', 'utf8');
  const sheetBrowserSource = readFileSync('src/lib/components/sheets/SheetBrowser.svelte', 'utf8');

  assert.match(
    appShellSource,
    /function collapseRightPanel\(\) \{[\s\S]*stateStore\.setSheetOpen\(false\);[\s\S]*setRightOpen\(false\);[\s\S]*\}/,
    'desktop right-panel collapse closes active sheets and collapses the persisted inspector panel',
  );
  assert.match(
    appShellSource,
    /function toggleInspector\(\) \{[\s\S]*if \(appState\.sheets\.open\) \{[\s\S]*stateStore\.setSheetOpen\(false\);[\s\S]*setRightOpen\(true\);[\s\S]*return;/,
    'desktop Inspector action switches from Pi Browser to Inspector instead of only toggling rightOpen',
  );
  assert.match(
    appShellSource,
    /function openActions\(\) \{[\s\S]*stateStore\.setSheetMode\('actions', \{ open: true \}\);[\s\S]*if \(isDesktopLayout\(\)\) \{[\s\S]*setRightOpen\(true\);/,
    'desktop Actions action always opens the Actions sheet and the right panel',
  );
  assert.match(appShellSource, /onToggleRight=\{toggleInspector\}/, 'top-bar desktop Inspector button uses the sheet-aware inspector toggle');
  assert.match(appShellSource, /onclick=\{collapseRightPanel\}/, 'desktop right-panel header collapse button uses the full collapse handler');
  assert.match(appShellSource, /<SheetBrowser[\s\S]*onClose=\{collapseRightPanel\}/, 'desktop SheetBrowser close collapses the whole right panel');
  assert.match(
    sheetBrowserSource,
    /function close\(\) \{[\s\S]*stateStore\.setSheetOpen\(false\);[\s\S]*onClose\?\.\(\);[\s\S]*\}/,
    'SheetBrowser still clears sheet state and delegates optional desktop panel collapse through onClose',
  );
}

function testLiveAssistantStreamingReducers() {
  resetGlobalState();

  handleRpcPayload({ type: 'agent_start', sessionWorkerId: 'worker-parent' });
  assert.equal(piPhoneState.snapshot().status?.isStreaming, true, 'agent_start marks the session as streaming');

  handleRpcPayload({
    type: 'message_update',
    sessionWorkerId: 'worker-parent',
    assistantMessageEvent: { type: 'thinking_delta', delta: 'Need\u001b[31m caution. ' },
  });
  handleRpcPayload({
    type: 'message_update',
    sessionWorkerId: 'worker-parent',
    assistantMessageEvent: { type: 'text_delta', delta: 'Hello\u001b[0m ' },
  });
  handleRpcPayload({
    type: 'message_update',
    sessionWorkerId: 'worker-parent',
    assistantMessageEvent: { type: 'text_delta', delta: 'world' },
  });
  handleRpcPayload({
    type: 'message_update',
    sessionWorkerId: 'worker-parent',
    assistantMessageEvent: {
      type: 'toolcall_end',
      toolCall: { id: 'tool-live-read', name: 'read', arguments: { path: 'README.md' } },
    },
  });

  let liveAssistant = piPhoneState.snapshot().messages.liveAssistant;
  assert.equal(liveAssistant?.id, 'assistant-live');
  assert.equal(liveAssistant?.live, true);
  if (!liveAssistant || liveAssistant.kind !== 'assistant') throw new AssertionError({ message: 'live assistant should be an assistant message' });
  assert.equal(liveAssistant.text, 'Hello world');
  assert.equal(liveAssistant.thinking, 'Need caution. ');
  assert.equal(liveAssistant.toolCalls?.[0]?.id, 'tool-live-read');
  assert.equal(liveAssistant.toolCalls?.[0]?.arguments.path, 'README.md');

  const canonicalUser = transformPhoneMessage(fixtureMessages[0], 0)[0];
  assert.ok(canonicalUser);
  const liveTool: PhoneUiToolMessage = {
    id: 'tool-live-order',
    kind: 'tool',
    toolCallId: 'tool-live-order',
    toolName: 'bash',
    status: 'running',
    live: true,
    text: 'running',
  };
  assert.deepEqual(
    conversationItems([canonicalUser], new Map([[liveTool.toolCallId || '', liveTool]]), liveAssistant).map((item) => item.id),
    [canonicalUser.id, liveTool.id, liveAssistant.id],
    'canonical messages render before live tools, and the live assistant remains last',
  );

  const finalAssistant: PhoneRawMessage = {
    role: 'assistant',
    timestamp: 1_700_000_200_000,
    model: 'gpt-5-codex',
    content: [
      { type: 'thinking', thinking: 'Final private notes.' },
      { type: 'text', text: 'Final answer from message_end.' },
      { type: 'toolCall', id: 'tool-live-read', name: 'read', arguments: { path: 'README.md' } },
    ],
    usage: { input: 10, output: 5 },
    stopReason: 'stop',
  };

  handleRpcPayload({ type: 'message_end', sessionWorkerId: 'worker-parent', message: finalAssistant });
  liveAssistant = piPhoneState.snapshot().messages.liveAssistant;
  assert.equal(liveAssistant?.id, 'assistant-1700000200000', 'message_end replaces the stable live id with the final message id');
  assert.equal(liveAssistant?.live, false, 'message_end settles the live stream');
  if (!liveAssistant || liveAssistant.kind !== 'assistant') throw new AssertionError({ message: 'final live assistant should be an assistant message' });
  assert.equal(liveAssistant.text, 'Final answer from message_end.', 'message_end replaces delta text with final transformed content');
  assert.equal(liveAssistant.thinking, 'Final private notes.');
  assert.deepEqual(liveAssistant.usage, { input: 10, output: 5 });
  assert.equal(liveAssistant.stopReason, 'stop');
  assert.equal(liveAssistant.details, undefined);

  handleRpcPayload({ type: 'agent_end', sessionWorkerId: 'worker-parent' });
  const stateAfterEnd = piPhoneState.snapshot();
  assert.equal(stateAfterEnd.status?.isStreaming, false, 'agent_end marks the session as idle');
  assert.equal(stateAfterEnd.connection.refreshRequested, true, 'agent_end requests a full refresh');
  assert.equal(stateAfterEnd.quota.forceRefresh, true, 'agent_end requests a forced quota refresh');

  const finalUiMessage = transformPhoneMessage(finalAssistant, 0)[0];
  assert.ok(finalUiMessage);
  assert.equal(
    conversationItems([finalUiMessage], new Map(), { ...finalUiMessage, live: false }).length,
    1,
    'settled live assistant is not rendered twice when the canonical messages already contain the final assistant',
  );
  assert.equal(
    conversationItems([], new Map(), { ...finalUiMessage, live: false }).length,
    1,
    'settled live assistant remains renderable before get_messages refresh arrives',
  );

  resetGlobalState();
  piPhoneState.setMessages([finalUiMessage]);
  handleRpcPayload({ type: 'message_end', sessionWorkerId: 'worker-parent', message: finalAssistant });
  assert.equal(
    piPhoneState.snapshot().messages.liveAssistant,
    null,
    'message_end clears the transient assistant when get_messages already installed the same final assistant',
  );
}

function testLateAssistantEventPreservesSettledMessage() {
  resetGlobalState();
  const finalAssistant: PhoneRawMessage = {
    role: 'assistant',
    timestamp: 1_700_000_220_000,
    model: 'gpt-5-codex',
    content: [{ type: 'text', text: 'Already settled.' }],
  };

  handleRpcPayload({ type: 'message_end', sessionWorkerId: 'worker-parent', message: finalAssistant });
  handleRpcPayload({
    type: 'message_update',
    sessionWorkerId: 'worker-parent',
    assistantMessageEvent: { type: 'error', message: 'late stream error' },
  });

  const state = piPhoneState.snapshot();
  assert.equal(state.messages.liveAssistant?.id, 'assistant-1700000220000', 'late assistant events do not replace a settled final message');
  assert.equal(state.messages.liveAssistant?.live, false, 'late assistant events keep the final assistant settled');
  assert.equal(state.messages.liveAssistant?.text, 'Already settled.');
  assert.equal(state.feedback.toasts.at(-1)?.text, 'late stream error');
}

function testMessageUpdateWholeAssistantFallback() {
  resetGlobalState();
  const partialAssistant: PhoneRawMessage = {
    role: 'assistant',
    timestamp: 1_700_000_210_000,
    model: 'gpt-5-codex',
    content: [{ type: 'text', text: 'Whole partial update' }],
  };

  handleRpcPayload({ type: 'message_update', sessionWorkerId: 'worker-parent', message: partialAssistant });
  const liveAssistant = piPhoneState.snapshot().messages.liveAssistant;
  assert.equal(liveAssistant?.id, 'assistant-live', 'whole-message updates still use the stable live assistant id');
  assert.equal(liveAssistant?.live, true);
  assert.equal(liveAssistant?.text, 'Whole partial update');
}

async function testAttachmentOrderingRemovalAndPayload() {
  const first = attachment('first', 1, '⟦img1⟧');
  const second = attachment('second', 2, '⟦img2⟧');
  const third = attachment('third', 3, '⟦img3⟧');

  assert.deepEqual(
    orderedAttachments([first, second, third], 'Use ⟦img2⟧ then ⟦img1⟧').map((item) => item.token),
    ['⟦img2⟧', '⟦img1⟧', '⟦img3⟧'],
    'attachments are displayed by inline token position, with missing tokens last',
  );
  assert.deepEqual(
    attachmentOccurrences([first, second, third], 'A ⟦img2⟧ B ⟦img1⟧ C ⟦img2⟧').map((item) => item.token),
    ['⟦img2⟧', '⟦img1⟧', '⟦img2⟧'],
    'payload image ordering follows every inline token occurrence',
  );
  assert.equal(buildTokenInsertion('hello', 5, 5, ['⟦img1⟧']), ' ⟦img1⟧ ', 'token insertion pads adjacent words');
  assert.deepEqual(
    insertTokensAtSelection({ text: 'hello world', selectionStart: 6, selectionEnd: 11 }, ['⟦img1⟧', '⟦img2⟧']),
    { text: 'hello ⟦img1⟧ ⟦img2⟧ ', selectionStart: 20, selectionEnd: 20, insertion: '⟦img1⟧ ⟦img2⟧ ' },
    'token insertion replaces the current selection and preserves trailing whitespace rules',
  );
  assert.deepEqual(
    stripTokenFromPrompt('⟦img1⟧', { text: 'a ⟦img1⟧ b ⟦img1⟧', selectionStart: 20, selectionEnd: 20 }),
    { text: 'a  b ', selectionStart: 5, selectionEnd: 5, changed: true },
    'removing an attachment strips all token occurrences and adjusts the cursor',
  );

  const selectedTokenText = 'start ⟦img1⟧ middle ⟦img1⟧ end';
  const selectedTokenEdit = stripTokenFromPrompt('⟦img1⟧', {
    text: selectedTokenText,
    selectionStart: selectedTokenText.indexOf('middle'),
    selectionEnd: selectedTokenText.indexOf(' end'),
  });
  assert.deepEqual(
    selectedTokenEdit,
    {
      text: 'start  middle  end',
      selectionStart: 'start  '.length,
      selectionEnd: 'start  middle '.length,
      changed: true,
    },
    'removing repeated attachment tokens preserves an adjusted non-collapsed text selection',
  );

  const editStore = createPiPhoneStateStore();
  const addResult = addImageAttachments([new File(['selected'], 'selected.png', { type: 'image/png' })], {
    store: editStore,
    text: 'replace this text',
    selection: { start: 8, end: 12 },
  });
  assert.equal(addResult.text, 'replace ⟦img1⟧ text');
  assert.deepEqual(
    { selectionStart: addResult.selectionStart, selectionEnd: addResult.selectionEnd, composer: editStore.snapshot().composer.text },
    { selectionStart: 'replace ⟦img1⟧'.length, selectionEnd: 'replace ⟦img1⟧'.length, composer: 'replace ⟦img1⟧ text' },
    'attachment insertion replaces the active selection and returns the cursor after the inserted token',
  );

  const removeResult = removeAttachmentAndToken(addResult.added[0]?.id || '', {
    store: editStore,
    text: addResult.text,
    selection: { start: addResult.text.indexOf('text'), end: addResult.text.length },
  });
  assert.equal(removeResult.text, 'replace  text');
  assert.deepEqual(
    { selectionStart: removeResult.selectionStart, selectionEnd: removeResult.selectionEnd, remainingAttachments: editStore.snapshot().attachments.items.length },
    { selectionStart: 'replace  '.length, selectionEnd: 'replace  text'.length, remainingAttachments: 0 },
    'attachment removal updates the store and shifts the active selection after the stripped token',
  );

  assert.deepEqual(
    syncAttachmentRecordsWithPrompt([first, second], 'keep ⟦img2⟧'),
    { kept: [second], removed: [first] },
    'prompt sync removes attachments whose inline token was deleted',
  );

  const payload = await buildPromptPayload('second ⟦img2⟧ first ⟦img1⟧', [first, second]);
  assert.equal(payload.images.length, 2);
  assert.deepEqual(payload.images.map((image) => image.mimeType), ['image/png', 'image/png']);
  assert.equal(payload.images[0]?.data, 'Zml4dHVyZQ==', 'base64 payload uses inline image order');

  const { accepted, rejected } = filterImageFiles([
    new File(['ok'], 'ok.png', { type: 'image/png' }),
    new File(['no'], 'no.txt', { type: 'text/plain' }),
  ]);
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 1);
}

function createMockClient() {
  const rpc: unknown[] = [];
  const local: unknown[] = [];
  const client: PhoneCommandActionClient = {
    sendRpc(command) {
      rpc.push(command);
      return true;
    },
    sendLocalCommand(command) {
      local.push(command);
      return true;
    },
    requestReload() {
      local.push('reload');
      return true;
    },
    refreshAll(options) {
      local.push({ kind: 'refreshAll', options });
    },
    async refreshQuota() {
      return null;
    },
  };
  return { client, rpc, local };
}

function createMockSessionClient() {
  const base = createMockClient();
  const session: unknown[] = [];
  const client: PhoneSessionActionClient = {
    ...base.client,
    sendSessionSelect(sessionId) {
      session.push({ kind: 'session-select', sessionId });
      return true;
    },
    sendParentSessionNew() {
      session.push({ kind: 'session-parent-new' });
      return true;
    },
    sendSessionSpawn() {
      session.push({ kind: 'session-spawn' });
      return true;
    },
  };
  return { ...base, client, session };
}

function testAutocompleteActions() {
  assert.deepEqual(detectSlashCommandAutocompleteContext('/mo', 3), { type: 'slash-command', query: 'mo' });
  assert.equal(detectSlashCommandAutocompleteContext('/model gpt', 10), null, 'slash autocomplete stops once arguments begin');
  assert.deepEqual(detectCdAutocompleteContext('/cd src/lib', 11), {
    type: 'path',
    mode: 'cd',
    query: 'src/lib',
    replaceStart: 4,
    replaceEnd: 11,
  });
  assert.deepEqual(detectMentionAutocompleteContext('open @src/fi', 12), {
    type: 'path',
    mode: 'mention',
    query: 'src/fi',
    replaceStart: 5,
    replaceEnd: 12,
  });
  assert.deepEqual(detectMentionAutocompleteContext('open @src/fixture now', 9), {
    type: 'path',
    mode: 'mention',
    query: 'src',
    replaceStart: 5,
    replaceEnd: 17,
  }, 'mention autocomplete expands replacement to the full token when the cursor is mid-token');
  assert.equal(activeAutocompleteContext('email@host', 10), null, 'mentions require a delimiter before @');

  assert.deepEqual(
    slashCommandItems('r', fixtureCommands).map((item) => [item.label, item.kind, item.badge]),
    [
      ['/reload', 'local-command-run', 'local'],
      ['/refresh', 'local-command-run', 'local'],
      ['/review', 'remote-command-insert', 'extension'],
    ],
    'slash autocomplete merges local commands and remote extension commands',
  );

  const store = createPiPhoneStateStore();
  const { client, local, rpc } = createMockClient();
  store.setCommands([{ name: 'plan', source: 'extension', description: 'Plan work' }]);
  updateAutocomplete('/p', 2, { store, client, scheduleRemote: false });
  assert.deepEqual(store.snapshot().autocomplete.items.map((item) => item.label), ['/plan']);

  store.setCommands(fixtureCommands);
  updateAutocomplete('/c', 2, { store, client, scheduleRemote: false });
  assert.ok(store.snapshot().autocomplete.items.some((item) => item.label === '/cd' && item.kind === 'local-command-insert'));
  assert.ok(store.snapshot().autocomplete.items.some((item) => item.label === '/compact' && item.kind === 'local-command-run'));

  const localRun = applyAutocompleteItem(
    { kind: 'local-command-run', label: '/refresh', name: 'refresh' },
    { store, client, text: '/ref', cursor: 4 },
  );
  assert.equal(localRun.commandResult, 'handled');
  assert.equal(localRun.text, '');
  assert.deepEqual(local.at(-1), { kind: 'refreshAll', options: undefined }, 'run-style local command suggestions execute immediately');

  const remoteInsert = applyAutocompleteItem(
    { kind: 'remote-command-insert', label: '/review', name: 'review' },
    { store, client, text: '/rev', cursor: 4 },
  );
  assert.equal(remoteInsert.text, '/review ');
  assert.equal(rpc.length, 0, 'remote slash command suggestions insert text instead of executing');

  store.setAutocompleteContext({ type: 'path', mode: 'mention', query: 'src', replaceStart: 5, replaceEnd: 10 });
  const appliedMention = applyAutocompleteItem(
    { kind: 'path', label: '@src/lib/', value: 'src/lib/', isDirectory: true },
    { store, text: 'open @src', cursor: 10 },
  );
  assert.equal(appliedMention.text, 'open @src/lib/');
  assert.equal(appliedMention.cursor, 'open @src/lib/'.length);

  const cdContext = { type: 'path' as const, mode: 'cd' as const, query: 'src/fi', replaceStart: 4, replaceEnd: 10 };
  store.setAutocompleteContext(cdContext);
  assert.equal(requestPathSuggestions(cdContext, { store, client }), true);
  assert.deepEqual(local.at(-1), { type: 'path-suggestions', mode: 'cd', query: 'src/fi', requestId: 1 });
  const appliedCd = applyAutocompleteItem(
    { kind: 'path', label: 'src/fixtures.ts', value: 'src/fixtures.ts', isDirectory: false },
    { store, text: '/cd src/fi', cursor: 10 },
  );
  assert.equal(appliedCd.text, '/cd src/fixtures.ts ');
  assert.equal(appliedCd.cursor, '/cd src/fixtures.ts '.length);
}

function testCommandDispatchActions() {
  const store = createPiPhoneStateStore();
  const { client, rpc, local } = createMockClient();

  assert.equal(tryHandleLocalCommand('/new', { store, client }), 'handled');
  assert.deepEqual(rpc.at(-1), { type: 'new_session' });

  assert.equal(tryHandleLocalCommand('/compact', { store, client }), 'handled');
  assert.deepEqual(rpc.at(-1), { type: 'compact' });

  assert.equal(tryHandleLocalCommand('/reload', { store, client }), 'handled');
  assert.equal(local.at(-1), 'reload');

  assert.equal(tryHandleLocalCommand('/refresh', { store, client }), 'handled');
  assert.deepEqual(local.at(-1), { kind: 'refreshAll', options: undefined });
  assert.equal(store.snapshot().connection.refreshRequested, true);

  assert.equal(tryHandleLocalCommand('/stats', { store, client }), 'handled');
  assert.equal(store.snapshot().sheets.mode, 'actions');
  assert.deepEqual(rpc.at(-1), { type: 'get_session_stats' });

  assert.equal(tryHandleLocalCommand('/cost', { store, client }), 'handled');
  assert.equal(store.snapshot().sheets.mode, 'actions');
  assert.deepEqual(rpc.at(-1), { type: 'get_session_stats' });

  assert.equal(tryHandleLocalCommand('/commands', { store, client }), 'handled');
  assert.equal(store.snapshot().sheets.mode, 'commands');
  assert.deepEqual(rpc.at(-1), { type: 'get_commands' });

  assert.equal(tryHandleLocalCommand('/sessions', { store, client }), 'handled');
  assert.equal(store.snapshot().sheets.mode, 'sessions');
  assert.deepEqual(rpc.at(-1), { type: 'phone_list_sessions' });

  assert.equal(tryHandleLocalCommand('/tree', { store, client }), 'handled');
  assert.equal(store.snapshot().sheets.mode, 'tree');
  assert.deepEqual(rpc.at(-1), { type: 'phone_get_tree' });

  assert.equal(tryHandleLocalCommand('/thinking high', { store, client }), 'handled');
  assert.deepEqual(rpc.at(-1), { type: 'set_thinking_level', level: 'high' });

  const thinkingPickerStore = createPiPhoneStateStore();
  thinkingPickerStore.setSheetMode('thinking', { open: true });
  assert.equal(requestThinkingLevelSwitch('medium', { store: thinkingPickerStore, client }), 'handled');
  assert.deepEqual(rpc.at(-1), { type: 'set_thinking_level', level: 'medium' });
  assert.equal(thinkingPickerStore.snapshot().sheets.open, true, 'thinking picker stays open while the backend confirms the change');
  assert.match(thinkingPickerStore.snapshot().feedback.toasts.at(-1)?.text || '', /Thinking level change requested/);

  store.setModels([{ provider: 'openai-codex', id: 'gpt-5-codex', name: 'GPT 5 Codex' }]);
  assert.equal(tryHandleLocalCommand('/model openai-codex/gpt-5-codex', { store, client }), 'handled');
  assert.deepEqual(rpc.at(-1), { type: 'set_model', provider: 'openai-codex', modelId: 'gpt-5-codex' });
  assert.equal(store.snapshot().quota.forceRefresh, true, 'model changes force quota refresh for supported model displays');

  assert.equal(tryHandleLocalCommand('/model GPT 5 Codex', { store, client }), 'handled');
  assert.deepEqual(rpc.at(-1), { type: 'set_model', provider: 'openai-codex', modelId: 'gpt-5-codex' }, 'model command can switch by display name');

  const modelPickerStore = createPiPhoneStateStore();
  modelPickerStore.setSheetMode('models', { open: true });
  assert.equal(
    requestModelSwitch({ provider: 'openai-codex', id: 'gpt-5-codex', name: 'GPT 5 Codex', contextWindow: 200_000 }, { store: modelPickerStore, client }),
    'handled',
  );
  assert.deepEqual(rpc.at(-1), { type: 'set_model', provider: 'openai-codex', modelId: 'gpt-5-codex' });
  assert.equal(modelPickerStore.snapshot().sheets.open, true, 'model picker stays open while the backend confirms the change');
  assert.match(modelPickerStore.snapshot().feedback.toasts.at(-1)?.text || '', /Model change requested/);
  assert.equal(modelPickerStore.snapshot().quota.forceRefresh, true, 'model picker action requests forced quota refresh');
  assert.equal(modelPickerStore.snapshot().connection.forceQuotaRefreshRequested, true, 'model picker action marks transport quota refresh');

  assert.equal(tryHandleLocalCommand('/model missing-model', { store, client }), 'handled');
  assert.equal(store.snapshot().sheets.mode, 'models', 'unknown model names fall back to opening the model picker');
  assert.match(store.snapshot().feedback.toasts.at(-1)?.text || '', /Model not found locally/);

  resetGlobalState();
  piPhoneState.setSheetMode('models', { open: true });
  handleRpcPayload({ type: 'response', command: 'set_model', success: true, data: { provider: 'openai-codex', id: 'gpt-5-codex', name: 'GPT 5 Codex' } });
  assert.match(piPhoneState.snapshot().feedback.toasts.at(-1)?.text || '', /Model updated/);
  assert.equal(piPhoneState.snapshot().sheets.open, false, 'model picker closes once the backend confirms success');
  assert.equal(piPhoneState.snapshot().quota.forceRefresh, true, 'model update responses force quota refresh');
  assert.equal(piPhoneState.snapshot().connection.forceQuotaRefreshRequested, true, 'model update responses mark transport quota refresh');

  resetGlobalState();
  piPhoneState.setSheetMode('thinking', { open: true });
  handleRpcPayload({ type: 'response', command: 'set_thinking_level', success: true });
  assert.match(piPhoneState.snapshot().feedback.toasts.at(-1)?.text || '', /Thinking level updated/);
  assert.equal(piPhoneState.snapshot().sheets.open, false, 'thinking picker closes once the backend confirms success');
  assert.equal(piPhoneState.snapshot().quota.forceRefresh, false, 'thinking-level updates refresh state without forcing quota');

  assert.equal(tryHandleLocalCommand('/cd /tmp', { store, client }), 'handled');
  assert.deepEqual(local.at(-1), { type: 'cd', args: '/tmp' });

  assert.equal(tryHandleLocalCommand('/new', { store, client, hasAttachments: true }), 'blocked');
  assert.match(store.snapshot().feedback.toasts.at(-1)?.text || '', /do not support image attachments/);
}

function testQuickActionAndSessionDispatchActions() {
  const store = createPiPhoneStateStore();
  const { client, rpc, local, session } = createMockSessionClient();

  assert.equal(runPhoneQuickAction('refresh', { store, client }), true);
  assert.deepEqual(local.at(-1), { kind: 'refreshAll', options: undefined });
  assert.equal(store.snapshot().connection.refreshRequested, true);

  assert.equal(runPhoneQuickAction('new-session', { store, client }), true);
  assert.deepEqual(rpc.at(-1), { type: 'new_session' });

  assert.equal(runPhoneQuickAction('compact', { store, client }), true);
  assert.deepEqual(rpc.at(-1), { type: 'compact' });

  assert.equal(runPhoneQuickAction('stats', { store, client }), true);
  assert.equal(store.snapshot().sheets.mode, 'actions');
  assert.deepEqual(rpc.at(-1), { type: 'get_session_stats' });

  assert.equal(runPhoneQuickAction('models', { store, client }), true);
  assert.equal(store.snapshot().sheets.mode, 'models');
  assert.deepEqual(rpc.at(-1), { type: 'get_available_models' });

  assert.equal(runPhoneQuickAction('thinking', { store, client }), true);
  assert.equal(store.snapshot().sheets.mode, 'thinking');

  assert.equal(runPhoneQuickAction('commands', { store, client }), true);
  assert.equal(store.snapshot().sheets.mode, 'commands');
  assert.deepEqual(rpc.at(-1), { type: 'get_commands' });

  assert.equal(runPhoneQuickAction('sessions', { store, client }), true);
  assert.equal(store.snapshot().sheets.mode, 'sessions');
  assert.deepEqual(rpc.at(-1), { type: 'phone_list_sessions' });

  assert.equal(runPhoneQuickAction('active-sessions', { store, client }), true);
  assert.equal(store.snapshot().sheets.mode, 'active-sessions');

  assert.equal(runPhoneQuickAction('tree', { store, client }), true);
  assert.equal(store.snapshot().sheets.mode, 'tree');
  assert.deepEqual(rpc.at(-1), { type: 'phone_get_tree' });

  store.setActiveSessions([
    {
      id: 'parent-1',
      kind: 'parent',
      sessionId: 'session-1',
      sessionFile: null,
      sessionName: 'Parent',
      label: 'Parent',
      secondaryLabel: '',
      firstUserPreview: null,
      lastUserPreview: null,
      model: null,
      isRunning: true,
      isStreaming: false,
      isCompacting: false,
      messageCount: 0,
      pendingMessageCount: 0,
      hasPendingUiRequest: false,
      lastError: '',
      lastActivityAt: Date.now(),
      childPid: null,
      commandContextAvailable: true,
    },
    {
      id: 'parallel-1',
      kind: 'parallel',
      sessionId: 'session-2',
      sessionFile: null,
      sessionName: 'Parallel',
      label: 'Parallel',
      secondaryLabel: 'side quest',
      firstUserPreview: 'Start side quest',
      lastUserPreview: 'Continue side quest',
      model: { provider: 'openai-codex', id: 'gpt-5-codex', name: 'GPT 5 Codex' },
      isRunning: true,
      isStreaming: true,
      isCompacting: false,
      messageCount: 3,
      pendingMessageCount: 1,
      hasPendingUiRequest: true,
      lastError: '',
      lastActivityAt: Date.now(),
      childPid: 1234,
      commandContextAvailable: true,
    },
  ], 'parent-1');

  const activeGroups = groupActiveSessions(store.snapshot());
  assert.deepEqual(activeGroups.map((group) => [group.kind, group.sessions.map((item) => item.id)]), [
    ['parent', ['parent-1']],
    ['parallel', ['parallel-1']],
  ]);
  assert.deepEqual(
    activeSessionStatusBits(store.snapshot().sessions.active[1], store.snapshot()).slice(0, 5),
    ['parallel', 'live', 'needs input', 'GPT 5 Codex', '3 messages'],
    'active session status bits preserve live, pending, model, and count labels',
  );

  assert.equal(selectActiveSession('parallel-1', { store, client }), true);
  assert.deepEqual(session.at(-1), { kind: 'session-select', sessionId: 'parallel-1' });

  store.setPendingUiRequest({ type: 'extension_ui_request', method: 'input', id: 'stale-ui', sessionWorkerId: 'parallel-1', prompt: 'stale' });
  store.setMessages([{ id: 'stale-message', kind: 'assistant', text: 'stale', meta: '' }]);
  assert.equal(startNewParentSession({ store, client }), true);
  assert.deepEqual(session.at(-1), { kind: 'session-parent-new' });
  assert.equal(store.snapshot().uiRequests.pending, null, 'new parent clears stale pending UI from the previous session');
  assert.equal(store.snapshot().messages.items.length, 0, 'new parent clears stale snapshot messages while the new parent loads');

  assert.equal(spawnParallelSession({ store, client }), true);
  assert.deepEqual(session.at(-1), { kind: 'session-spawn' });

  const statusOnlyUnavailableStore = createPiPhoneStateStore();
  statusOnlyUnavailableStore.setStatus({ cwd: '/repo', hasToken: false, isRunning: true, host: '127.0.0.1', port: 3000, childRunning: true, isStreaming: false, isCompacting: false, lastError: '', childPid: null, sessionWorkerId: 'parent-status', sessionKind: 'parent', commandContextAvailable: false });
  assert.equal(parentCommandControlsAvailable(statusOnlyUnavailableStore.snapshot()), false, 'status-only parent command-context outage disables new parent');

  store.setActiveSessions([{ ...store.snapshot().sessions.active[0], commandContextAvailable: false }], 'parent-1');
  store.setStatus({ cwd: '/repo', hasToken: false, isRunning: true, host: '127.0.0.1', port: 3000, childRunning: true, isStreaming: false, isCompacting: false, lastError: '', childPid: null, sessionWorkerId: 'parent-1', sessionKind: 'parent', commandContextAvailable: false });
  assert.equal(parentCommandControlsAvailable(store.snapshot()), false);
  const sessionCountBeforeBlockedParent = session.length;
  assert.equal(startNewParentSession({ store, client }), false, 'new parent is blocked when Pi reports command context unavailable');
  assert.equal(session.length, sessionCountBeforeBlockedParent, 'blocked new parent does not send a session-parent-new command');
  assert.match(store.snapshot().feedback.toasts.at(-1)?.text || '', /fresh command context/);
  assert.deepEqual(local.at(-1), { kind: 'refreshAll', options: undefined });
  assert.equal(store.snapshot().connection.refreshRequested, true);

  const rpcCountBeforeUnavailableActions = rpc.length;
  assert.equal(runPhoneQuickAction('new-session', { store, client }), false, 'quick New session is blocked without parent command context');
  assert.equal(switchSavedSession('  /tmp/session.jsonl  ', { store, client }), false, 'saved session switch is blocked without parent command context');
  assert.equal(forkSessionEntry('entry-1', { store, client }), false, 'tree fork is blocked without parent command context');
  assert.equal(openBranchPath('entry-2', { store, client }), false, 'tree open path is blocked without parent command context');
  assert.equal(rpc.length, rpcCountBeforeUnavailableActions, 'blocked parent-replacement actions do not send RPC payloads');

  store.setActiveSessions([{ ...store.snapshot().sessions.active[0], commandContextAvailable: true }], 'parent-1');
  store.setStatus({ cwd: '/repo', hasToken: false, isRunning: true, host: '127.0.0.1', port: 3000, childRunning: true, isStreaming: false, isCompacting: false, lastError: '', childPid: null, sessionWorkerId: 'parent-1', sessionKind: 'parent', commandContextAvailable: true });
  assert.equal(parentCommandControlsAvailable(store.snapshot()), true);

  assert.equal(switchSavedSession('  /tmp/session.jsonl  ', { store, client }), true);
  assert.deepEqual(rpc.at(-1), { type: 'switch_session', sessionPath: '/tmp/session.jsonl' }, 'saved session switch trims the selected session path');
  assert.equal(store.snapshot().tree, null, 'saved session switch clears stale tree state');
  assert.equal(store.snapshot().stats, null, 'saved session switch clears stale stats');

  const rpcCountBeforeBlankSessionAction = rpc.length;
  assert.equal(switchSavedSession('   ', { store, client }), false);
  assert.equal(forkSessionEntry('', { store, client }), false);
  assert.equal(openBranchPath('   ', { store, client }), false);
  assert.equal(rpc.length, rpcCountBeforeBlankSessionAction, 'blank saved-session/tree actions do not send RPC payloads');

  store.setSnapshot({ model: null, isStreaming: false, isCompacting: false, sessionFile: '/repo/session-a.jsonl', sessionId: 'session-a', messageCount: 1, pendingMessageCount: 0 }, 'parent-1');
  store.setTree({ sessionFile: '/repo/session-b.jsonl', currentLeafId: 'entry-stale', currentPathIds: ['entry-stale'], nodes: [] });
  assert.equal(treeBelongsToCurrentSession(store.snapshot()), false);
  const rpcCountBeforeStaleTreeAction = rpc.length;
  assert.equal(openBranchPath('entry-stale', { store, client }), false, 'stale tree action is blocked and refreshed');
  assert.deepEqual(rpc.at(-1), { type: 'phone_get_tree' }, 'stale tree action requests a fresh tree');
  assert.equal(rpc.length, rpcCountBeforeStaleTreeAction + 1);

  store.setTree({ sessionFile: '/repo/session-a.jsonl', currentLeafId: 'entry-2', currentPathIds: ['entry-1', 'entry-2'], nodes: [] });
  assert.equal(treeBelongsToCurrentSession(store.snapshot()), true);
  assert.equal(forkSessionEntry('  entry-1  ', { store, client }), true);
  assert.deepEqual(rpc.at(-1), { type: 'fork', entryId: 'entry-1' }, 'fork trims the tree entry id');

  store.setTree({ sessionFile: '/repo/session-a.jsonl', currentLeafId: 'entry-2', currentPathIds: ['entry-1', 'entry-2'], nodes: [] });
  assert.equal(openBranchPath('  entry-2  ', { store, client }), true);
  assert.deepEqual(rpc.at(-1), { type: 'phone_open_branch_path', entryId: 'entry-2' }, 'open branch path trims the tree entry id');
}

function testSavedSessionAndTreeAdapters() {
  const sessions: Array<PhoneSavedSession & { forkEntryId?: string }> = [
    {
      path: '/repo/.pi/sessions/parent-a.jsonl',
      id: 'parent-a',
      cwd: '/repo',
      name: 'Parent A',
      created: '2026-01-01T10:00:00Z',
      modified: '2026-01-01T11:00:00Z',
      messageCount: 4,
      firstMessage: 'Build feature A',
      forkEntryId: 'entry-parent-a',
    },
    {
      path: '/repo/.pi/sessions/parallel-a.jsonl',
      id: 'parallel-a',
      cwd: '/repo',
      parentSessionPath: '/repo/.pi/sessions/parent-a.jsonl',
      created: '2026-01-01T10:30:00Z',
      modified: '2026-01-01T10:45:00Z',
      messageCount: 2,
      firstMessage: 'Parallel follow-up',
    },
    {
      path: '/repo/.pi/sessions/parent-b.jsonl',
      id: 'parent-b',
      cwd: '/repo',
      created: '2026-01-02T10:00:00Z',
      modified: '2026-01-02T11:00:00Z',
      messageCount: 1,
      firstMessage: 'Newest parent',
    },
  ];

  const groups = groupSavedSessions(sessions);
  assert.deepEqual(groups.map((group) => [group.title, group.sessions.map((session) => session.id)]), [
    ['Parent sessions', ['parent-b', 'parent-a']],
    ['Parallel from Parent A', ['parallel-a']],
  ]);
  assert.equal(savedSessionTitle(sessions[0]), 'Parent A');
  assert.match(savedSessionSubtitle(sessions[0]), /4 messages · \/repo/);
  assert.equal(savedSessionForkEntryId(sessions[0]), 'entry-parent-a');
  assert.equal(savedSessionForkEntryId(sessions[1]), null, 'fork buttons stay hidden when no entry id is exposed');

  const tree: PhoneTree = {
    sessionFile: '/repo/.pi/sessions/parent-a.jsonl',
    currentLeafId: 'entry-3',
    currentPathIds: ['entry-1', 'entry-3'],
    nodes: [
      {
        id: 'entry-1',
        type: 'message',
        depth: 0,
        timestamp: '2026-01-01T10:00:00Z',
        childCount: 2,
        summary: { kind: 'message', role: 'user', preview: 'Start here' },
      },
      {
        id: 'entry-2',
        parentId: 'entry-1',
        type: 'model_change',
        depth: 1,
        timestamp: '2026-01-01T10:05:00Z',
        childCount: 0,
        summary: { kind: 'model', preview: 'gpt-5-codex' },
      },
      {
        id: 'entry-3',
        parentId: 'entry-1',
        type: 'message',
        depth: 1,
        timestamp: '2026-01-01T10:10:00Z',
        childCount: 0,
        summary: { kind: 'message', role: 'assistant', preview: 'Current answer' },
      },
    ],
  };

  assert.equal(treeFileLabel(tree), 'parent-a.jsonl');
  const nodes = mapTreeNodes(tree);
  assert.equal(nodes[0]?.isBranchPoint, true);
  assert.equal(nodes[0]?.isOnActivePath, true);
  assert.equal(nodes[1]?.modelLabel, 'gpt-5-codex');
  assert.equal(nodes[2]?.isCurrent, true);
  assert.equal(nodes[2]?.preview, 'Current answer');
}

async function testPromptSubmissionRules() {
  const store = createPiPhoneStateStore();
  const { client, rpc, local } = createMockClient();

  assert.deepEqual(await submitPrompt({ store, client }), { status: 'empty' }, 'empty prompts are ignored');

  const localSubmitStore = createPiPhoneStateStore();
  localSubmitStore.setComposerText('/compact');
  const messageCountBeforeLocalCommand = localSubmitStore.snapshot().messages.items.length;
  assert.equal((await submitPrompt({ store: localSubmitStore, client })).status, 'handled');
  assert.deepEqual(rpc.at(-1), { type: 'compact' }, 'submitPrompt dispatches mutating local commands instead of prompt RPC');
  assert.equal(localSubmitStore.snapshot().composer.text, '', 'handled local commands clear the composer after submit');
  assert.equal(localSubmitStore.snapshot().messages.items.length, messageCountBeforeLocalCommand, 'handled local commands do not append optimistic prompt messages');

  const blockedLocalCommandStore = createPiPhoneStateStore();
  blockedLocalCommandStore.addAttachments([attachment('blocked-local-image', 1, '⟦img1⟧')]);
  blockedLocalCommandStore.setComposerText('/compact ⟦img1⟧');
  const rpcCountBeforeBlockedLocalCommand = rpc.length;
  assert.equal((await submitPrompt({ store: blockedLocalCommandStore, client })).status, 'blocked');
  assert.equal(rpc.length, rpcCountBeforeBlockedLocalCommand, 'local commands with image attachments do not send mutating RPC payloads');
  assert.match(blockedLocalCommandStore.snapshot().feedback.toasts.at(-1)?.text || '', /do not support image attachments/);

  store.setComposerText('hello pi');
  assert.equal((await submitPrompt({ store, client })).status, 'sent');
  assert.deepEqual(rpc.at(-1), { type: 'prompt', message: 'hello pi' });
  assert.equal(store.snapshot().composer.text, '', 'successful normal prompt submission clears the composer');
  assert.match(store.snapshot().messages.items.at(-1)?.text || '', /hello pi/, 'normal prompt submission appends an optimistic user message');

  store.setCommands([{ name: 'ext', source: 'extension' }]);
  const remote = findRemoteSlashCommand('/ext run', store.snapshot().commands.available);
  assert.ok(remote);
  assert.equal(sendRemoteSlashCommand(remote, { store, client, images: [{ type: 'image', data: 'a', mimeType: 'image/png' }] }), 'blocked');
  assert.equal(local.length, 0, 'extension slash commands with images are not sent');
  assert.equal(sendRemoteSlashCommand(remote, { store, client }), 'handled');
  assert.deepEqual(local.at(-1), { type: 'slash-command', text: '/ext run', source: 'extension' });
  assert.equal(store.snapshot().quota.forceRefresh, true, 'extension slash commands request a quota refresh');

  store.setComposerText('/ext from composer');
  const rpcCountBeforeExtensionSubmit = rpc.length;
  assert.equal((await submitPrompt({ store, client })).status, 'handled');
  assert.deepEqual(local.at(-1), { type: 'slash-command', text: '/ext from composer', source: 'extension' });
  assert.equal(rpc.length, rpcCountBeforeExtensionSubmit, 'known extension slash commands never fall through to prompt RPC');

  const duplicateCommands = [
    { name: 'dup', source: 'extension' as const, path: '/repo/ext-a.ts' },
    { name: 'dup', source: 'skill' as const, sourceInfo: { path: '/repo/skill-b.md' } },
  ];
  assert.equal(isAmbiguousRemoteSlashCommand('/dup run', duplicateCommands), true);
  assert.equal(findRemoteSlashCommand('/dup run', duplicateCommands), null, 'plain composer lookup refuses ambiguous duplicate command names');
  store.setCommands(duplicateCommands);
  store.setComposerText('/dup run');
  const localCountBeforeAmbiguous = local.length;
  assert.equal((await submitPrompt({ store, client })).status, 'blocked');
  assert.equal(local.length, localCountBeforeAmbiguous, 'ambiguous duplicate slash commands do not dispatch an arbitrary source');
  assert.match(store.snapshot().feedback.toasts.at(-1)?.text || '', /Multiple slash commands/);

  const duplicateRun = findRemoteSlashCommand('/dup run', [duplicateCommands[0]]);
  assert.ok(duplicateRun);
  assert.equal(sendRemoteSlashCommand({ ...duplicateRun, path: '/repo/ext-a.ts' }, { store, client }), 'handled');
  assert.deepEqual(
    local.at(-1),
    { type: 'slash-command', text: '/dup run', source: 'extension', path: '/repo/ext-a.ts' },
    'command browser run payload preserves command source identity for duplicate names',
  );

  const unknownCatalogStore = createPiPhoneStateStore();
  unknownCatalogStore.setStatus({ cwd: '/repo', hasToken: false, isRunning: true, host: '127.0.0.1', port: 3000, childRunning: true, isStreaming: false, isCompacting: false, lastError: '', childPid: null, sessionWorkerId: 'worker', sessionKind: 'parallel' });
  unknownCatalogStore.setComposerText('/ext run');
  const rpcCountBeforeUnresolved = rpc.length;
  const localCountBeforeUnresolved = local.length;
  assert.equal((await submitPrompt({ store: unknownCatalogStore, client })).status, 'blocked');
  assert.deepEqual(rpc.at(-1), { type: 'get_commands' }, 'unresolved slash commands refresh the unknown command catalog instead of prompting');
  assert.equal(rpc.length, rpcCountBeforeUnresolved + 1);
  assert.equal(local.length, localCountBeforeUnresolved, 'unresolved slash commands are not sent as local slash commands without catalog confirmation');
  assert.match(unknownCatalogStore.snapshot().feedback.toasts.at(-1)?.text || '', /Slash commands are still loading/);
  assert.equal(unknownCatalogStore.snapshot().composer.text, '/ext run', 'blocked unresolved slash commands stay in the composer for retry');

  const emptyCatalogStore = createPiPhoneStateStore();
  emptyCatalogStore.setCommands([]);
  emptyCatalogStore.setComposerText('/not-a-command but valid prompt text');
  const rpcCountBeforeEmptyCatalogPrompt = rpc.length;
  assert.equal((await submitPrompt({ store: emptyCatalogStore, client })).status, 'sent');
  assert.deepEqual(
    rpc.at(-1),
    { type: 'prompt', message: '/not-a-command but valid prompt text' },
    'slash-looking prompts are allowed after the command catalog is loaded empty',
  );
  assert.equal(rpc.length, rpcCountBeforeEmptyCatalogPrompt + 1);

  store.setCommands([{ name: 'skill', source: 'skill' }]);
  store.setStatus({ cwd: '/repo', hasToken: false, isRunning: true, host: '127.0.0.1', port: 3000, childRunning: true, isStreaming: true, isCompacting: false, lastError: '', childPid: null, sessionWorkerId: 'worker', sessionKind: 'parallel' });
  assert.equal(canSteer(store.snapshot()), true, 'composer can expose Steer while a response is streaming and no submit is active');
  store.updateComposer({ isSubmitting: true });
  assert.equal(canSteer(store.snapshot()), false, 'composer hides Steer while a submission is already in progress');
  store.updateComposer({ isSubmitting: false });

  store.setComposerText('/skill arg');
  assert.equal((await submitPrompt({ store, client })).status, 'handled');
  assert.deepEqual(local.at(-1), { type: 'slash-command', text: '/skill arg', source: 'skill', streamingBehavior: 'followUp' });

  store.setComposerText('/skill steer');
  assert.equal((await submitPrompt({ store, client, steer: true })).status, 'handled');
  assert.deepEqual(local.at(-1), { type: 'slash-command', text: '/skill steer', source: 'skill', streamingBehavior: 'steer' }, 'steered non-extension slash commands use steer streaming behavior');

  store.updateComposer({ isSubmitting: true });
  const rpcCountBeforeDoubleSubmit = rpc.length;
  assert.equal((await submitPrompt({ store, client })).status, 'blocked', 'prompt submission is blocked while a submit is already in flight');
  assert.equal(rpc.length, rpcCountBeforeDoubleSubmit, 'in-flight submit guard prevents duplicate RPC sends');
  store.updateComposer({ isSubmitting: false });

  store.setComposerText('follow up');
  assert.equal((await submitPrompt({ store, client })).status, 'sent');
  assert.deepEqual(rpc.at(-1), { type: 'prompt', message: 'follow up', streamingBehavior: 'followUp' });

  store.setComposerText('steer this');
  assert.equal((await submitPrompt({ store, client, steer: true })).status, 'sent');
  assert.deepEqual(rpc.at(-1), { type: 'prompt', message: 'steer this', streamingBehavior: 'steer' });

  const imageStore = createPiPhoneStateStore();
  const firstImage = { ...attachment('prompt-first', 1, '⟦img1⟧'), file: new File(['one'], 'one.png', { type: 'image/png' }), size: 3 };
  const secondImage = { ...attachment('prompt-second', 2, '⟦img2⟧'), file: new File(['two'], 'two.png', { type: 'image/png' }), size: 3 };
  imageStore.addAttachments([firstImage, secondImage]);
  imageStore.setComposerText('Compare ⟦img2⟧ then ⟦img1⟧ and repeat ⟦img2⟧');
  assert.equal((await submitPrompt({ store: imageStore, client })).status, 'sent');
  const imagePrompt = rpc.at(-1) as { type?: string; message?: string; images?: Array<{ data: string; mimeType: string }> };
  assert.equal(imagePrompt.type, 'prompt');
  assert.equal(imagePrompt.message, 'Compare ⟦img2⟧ then ⟦img1⟧ and repeat ⟦img2⟧');
  assert.deepEqual(
    imagePrompt.images?.map((image) => image.data),
    ['dHdv', 'b25l', 'dHdv'],
    'submitted prompt image payload follows every inline token occurrence',
  );
  assert.deepEqual(imagePrompt.images?.map((image) => image.mimeType), ['image/png', 'image/png', 'image/png']);
  assert.equal(imageStore.snapshot().attachments.items.length, 0, 'successful image prompt submission clears attachments');
  const submittedImageMessage = imageStore.snapshot().messages.items.at(-1);
  assert.equal(submittedImageMessage?.kind, 'user', 'optimistic image prompt records a local user message');
  assert.equal(
    submittedImageMessage?.kind === 'user' ? submittedImageMessage.imageCount : undefined,
    3,
    'optimistic image prompt records submitted image count',
  );

  store.updateComposer({ steerAvailable: true });
  assert.equal(abortGeneration({ store, client }), true);
  assert.deepEqual(rpc.at(-1), { type: 'abort' });
  assert.equal(store.snapshot().composer.steerAvailable, false, 'abort clears steer availability');
}

function testAttachmentStoreOrderingAndCleanupHooks() {
  const store = createPiPhoneStateStore();
  assert.equal(store.allocateAttachmentTokenId(), 1);
  assert.equal(store.allocateAttachmentTokenId(), 2);

  const first = attachment('first', 1, '⟦img1⟧');
  const second = attachment('second', 2, '⟦img2⟧');
  store.addAttachments([first, second]);
  assert.deepEqual(
    store.snapshot().attachments.items.map((item) => item.token),
    ['⟦img1⟧', '⟦img2⟧'],
    'attachment store preserves insertion/token ordering supplied by attachment actions',
  );

  const removed = store.removeAttachment('first');
  assert.equal(removed?.token, '⟦img1⟧');
  assert.deepEqual(store.clearAttachments().map((item) => item.id), ['second']);
}

function testExtensionUiRequestActions() {
  const store = createPiPhoneStateStore();
  const sent: PhoneExtensionUiResponse[] = [];
  const client = {
    sendRpc(command: PhoneExtensionUiResponse) {
      sent.push(command);
      return true;
    },
  };

  resetGlobalState();
  piPhoneState.setActiveSessionId('worker-a');
  handleRpcPayload({
    type: 'extension_ui_request',
    method: 'input',
    id: 'ignored',
    sessionWorkerId: 'worker-b',
    title: 'Other session',
  });
  assert.equal(piPhoneState.snapshot().uiRequests.pending, null, 'UI requests owned by another active session are ignored');

  handleRpcPayload({ type: 'extension_ui_request', method: 'notify', message: 'Extension warning', level: 'warning' });
  handleRpcPayload({ type: 'extension_ui_request', method: 'setStatus', statusText: 'Extension busy' });
  handleRpcPayload({ type: 'extension_ui_request', method: 'setWidget', widgetKey: 'review', widgetLines: ['line one'] });
  handleRpcPayload({ type: 'extension_ui_request', method: 'setTitle', title: 'Custom Pi Title' });
  handleRpcPayload({ type: 'extension_ui_request', method: 'set_editor_text', text: '/plan next' });
  handleRpcPayload({ type: 'extension_ui_request', method: 'select', id: 'select-global', sessionWorkerId: 'worker-a', title: 'Pick one', options: ['A', 'B'] });
  const globalUiState = piPhoneState.snapshot();
  assert.equal(globalUiState.feedback.toasts.at(-1)?.kind, 'warning');
  assert.equal(globalUiState.feedback.toasts.at(-1)?.text, 'Extension warning');
  assert.equal(globalUiState.uiRequests.footerStatus, 'Extension busy');
  assert.deepEqual(globalUiState.uiRequests.widgets.get('review'), ['line one']);
  assert.equal(globalUiState.uiRequests.title, 'Custom Pi Title');
  assert.equal(globalUiState.composer.text, '/plan next');
  assert.equal(globalUiState.uiRequests.pending?.method, 'select');
  handleRpcPayload({ type: 'extension_ui_request', method: 'setWidget', widgetKey: 'review', widgetLines: [] });
  assert.equal(piPhoneState.snapshot().uiRequests.widgets.has('review'), false, 'empty widget payload clears the status widget');

  store.setActiveSessionId('worker-a');
  store.setPendingUiRequest({
    type: 'extension_ui_request',
    method: 'input',
    id: 'input-1',
    sessionWorkerId: 'worker-a',
    title: 'Name',
    prefill: 'prefill value',
  });
  let pending = store.snapshot().uiRequests.pending;
  assert.equal(extensionUiDraftValue(store.snapshot(), pending), 'prefill value', 'input requests use prefill when no draft exists');

  persistExtensionUiDraft(pending, 'draft value', { store });
  assert.equal(extensionUiDraftValue(store.snapshot(), pending), 'draft value', 'input/editor drafts are persisted by session request key');

  assert.equal(sendExtensionUiResponse({ id: 'input-1', value: 'draft value' }, { store, client }), true);
  assert.deepEqual(sent.at(-1), {
    type: 'extension_ui_response',
    sessionWorkerId: 'worker-a',
    id: 'input-1',
    value: 'draft value',
  });
  assert.equal(store.snapshot().uiRequests.pending, null, 'successful UI responses clear the pending request');
  assert.equal(extensionUiDraftValue(store.snapshot(), pending), 'prefill value', 'successful submit forgets the saved draft');

  assert.equal(sendExtensionUiResponse({ id: 'input-1', value: 'stale' }, { store, client }), false);
  assert.match(store.snapshot().feedback.toasts.at(-1)?.text || '', /no longer pending/i, 'stale responses show an error toast');

  store.setPendingUiRequest({ type: 'extension_ui_request', method: 'input', id: 'input-2', sessionWorkerId: 'worker-a', prefill: 'second prefill' });
  assert.equal(sendExtensionUiResponse({ id: 'input-1', value: 'stale' }, { store, client }), false);
  assert.equal(store.snapshot().uiRequests.pending?.id, 'input-2', 'stale responses do not clear a newer pending UI request');
  assert.equal(extensionUiDraftValue(store.snapshot(), store.snapshot().uiRequests.pending), 'second prefill', 'new pending input remains actionable after stale response');

  store.setPendingUiRequest({ type: 'extension_ui_request', method: 'select', id: 'select-1', sessionWorkerId: 'worker-a', options: ['alpha', 'beta'] });
  assert.equal(sendExtensionUiResponse({ id: 'select-1', value: 'beta' }, { store, client }), true);
  assert.deepEqual(sent.at(-1), {
    type: 'extension_ui_response',
    sessionWorkerId: 'worker-a',
    id: 'select-1',
    value: 'beta',
  });

  store.setPendingUiRequest({ type: 'extension_ui_request', method: 'editor', id: 'editor-1', sessionWorkerId: 'worker-a', title: 'Edit', prefill: 'draft start' });
  pending = store.snapshot().uiRequests.pending;
  assert.equal(extensionUiDraftValue(store.snapshot(), pending), 'draft start', 'editor requests use prefill as their initial draft');
  persistExtensionUiDraft(pending, 'edited body', { store });
  assert.equal(sendExtensionUiResponse({ id: 'editor-1', value: 'edited body' }, { store, client }), true);
  assert.deepEqual(sent.at(-1), {
    type: 'extension_ui_response',
    sessionWorkerId: 'worker-a',
    id: 'editor-1',
    value: 'edited body',
  });

  store.setPendingUiRequest({ type: 'extension_ui_request', method: 'confirm', id: 'confirm-1', sessionWorkerId: 'worker-a' });
  assert.equal(sendExtensionUiResponse({ id: 'confirm-1', confirmed: false }, { store, client }), true);
  assert.deepEqual(sent.at(-1), {
    type: 'extension_ui_response',
    sessionWorkerId: 'worker-a',
    id: 'confirm-1',
    confirmed: false,
  });

  store.setPendingUiRequest({ type: 'extension_ui_request', method: 'confirm', id: 'confirm-ownership', sessionWorkerId: 'worker-a' });
  store.setActiveSessionId('worker-b');
  assert.equal(sendExtensionUiResponse({ id: 'confirm-ownership', confirmed: true }, { store, client }), false);
  assert.match(store.snapshot().feedback.toasts.at(-1)?.text || '', /another session/i, 'ownership is rechecked before response send');

  store.setActiveSessionId('worker-a');
  const confirmRequest = { type: 'extension_ui_request' as const, method: 'confirm' as const, id: 'confirm-2', sessionWorkerId: 'worker-a' };
  store.setPendingUiRequest(confirmRequest);
  assert.equal(cancelExtensionUiRequest(confirmRequest, { store, client }), true);
  assert.deepEqual(sent.at(-1), {
    type: 'extension_ui_response',
    sessionWorkerId: 'worker-a',
    id: 'confirm-2',
    cancelled: true,
  });
}

function testLoginTokenUrlConsumption() {
  assert.deepEqual(consumeTokenFromFragment('#token=abc123&panel=sessions'), {
    token: 'abc123',
    nextHash: '#panel=sessions',
    stripped: true,
  });
  assert.deepEqual(consumeTokenFromFragment('#panel=sessions'), {
    token: null,
    nextHash: '#panel=sessions',
    stripped: false,
  });

  const fragmentResult = consumeLoginTokenFromUrl('https://phone.test/?fixture=0&token=query-token#token=fragment-token&panel=tree');
  assert.equal(fragmentResult.token, 'fragment-token', 'fragment tokens take precedence over query tokens');
  assert.equal(fragmentResult.nextPath, '/?fixture=0#panel=tree');
  assert.equal(fragmentResult.stripped, true);

  const queryResult = consumeLoginTokenFromUrl('https://phone.test/path?token=query+token&x=1#panel=tree');
  assert.equal(queryResult.token, 'query token');
  assert.equal(queryResult.nextPath, '/path?x=1#panel=tree');
  assert.equal(queryResult.stripped, true);
}

async function testLoginTokenSubmissionAction() {
  const health: PhoneHealth = {
    cwd: '/repo',
    hasToken: true,
    isRunning: true,
    childRunning: true,
    isStreaming: false,
    isCompacting: false,
    host: '127.0.0.1',
    port: 8765,
    connectedClients: 1,
    sessionCount: 1,
    controlOwner: 'phone',
    commandContextAvailable: true,
  };

  const store = createPiPhoneStateStore();
  const accepted: Array<{ token: string; connect?: boolean; store?: boolean }> = [];
  const okClient = {
    async acceptToken(token: string, options?: { connect?: boolean; store?: boolean }) {
      accepted.push({ token, ...options });
      return health;
    },
  };

  const success = await submitLoginToken('  valid-token  ', { client: okClient, stateStore: store });
  assert.equal(success.ok, true);
  assert.deepEqual(accepted, [{ token: 'valid-token', connect: true, store: undefined }]);
  assert.equal(store.snapshot().auth.token, 'valid-token');
  assert.equal(store.snapshot().auth.loginOpen, false);
  assert.equal(store.snapshot().auth.authError, '');
  assert.equal(store.snapshot().auth.health?.cwd, '/repo');

  const invalidStore = createPiPhoneStateStore();
  const rejected = await submitLoginToken('bad-token', {
    stateStore: invalidStore,
    client: {
      async acceptToken() {
        throw new PhoneAuthError();
      },
    },
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /token was rejected/i);
  assert.equal(invalidStore.snapshot().auth.loginOpen, true);
  assert.match(invalidStore.snapshot().auth.authError, /token was rejected/i);
  assert.match(invalidStore.snapshot().feedback.toasts.at(-1)?.text || '', /token was rejected/i);

  invalidStore.pushToast('Extension warning', 'warning');
  const recovered = await submitLoginToken('valid-token', { client: okClient, stateStore: invalidStore });
  assert.equal(recovered.ok, true);
  assert.equal(invalidStore.snapshot().auth.loginOpen, false);
  assert.equal(invalidStore.snapshot().auth.authError, '');
  assert.equal(
    invalidStore.snapshot().feedback.toasts.some((toast) => /token was rejected/i.test(toast.text)),
    false,
    'successful login clears stale auth-error toasts',
  );
  assert.equal(
    invalidStore.snapshot().feedback.toasts.some((toast) => toast.text === 'Extension warning'),
    true,
    'successful login preserves unrelated non-auth toasts',
  );

  const emptyStore = createPiPhoneStateStore();
  const empty = await submitLoginToken('   ', { client: okClient, stateStore: emptyStore });
  assert.equal(empty.ok, false);
  assert.equal(emptyStore.snapshot().auth.loginOpen, true);
  assert.equal(emptyStore.snapshot().auth.authError, 'Enter the current /phone-start token.');
}

async function testQuotaContextVisibilityAndTransportFetch() {
  assert.equal(supportsPiQuotaForModel({ provider: 'openai-codex', id: 'gpt-5-codex' }), true);
  assert.equal(supportsPiQuotaForModel({ provider: 'openai-codex', modelId: 'gpt-4.1' }), true);
  assert.equal(supportsPiQuotaForModel({ provider: 'openai-codex', id: 'o3' }), false);
  assert.equal(supportsPiQuotaForModel({ provider: 'anthropic', id: 'gpt-fake' }), false);

  const supportedDisplay = quotaContextDisplay({
    cwd: '/repo',
    snapshot: {
      model: { provider: 'openai-codex', id: 'gpt-5-codex', name: 'GPT-5 Codex', contextWindow: 200_000 },
      isStreaming: false,
      isCompacting: false,
      sessionFile: null,
      sessionId: null,
      messageCount: 4,
      pendingMessageCount: 0,
      contextUsage: { tokens: 64_000, contextWindow: 200_000, percent: 32 },
    },
    quota: {
      visible: true,
      limited: false,
      primaryWindow: { label: '5h', text: '90%', resetAfterSeconds: null, usedPercent: 10, leftPercent: 90 },
      secondaryWindow: { label: '7d', text: '60%', resetAfterSeconds: null, usedPercent: 40, leftPercent: 60 },
    },
  });
  assert.equal(supportedDisplay.visible, true, 'composer meta is visible when cwd/context/quota is available');
  assert.equal(supportedDisplay.quotaSupported, true, 'supported openai-codex gpt models opt into quota display');
  assert.equal(supportedDisplay.contextUsage?.text, '32.0%/200k');
  assert.equal(supportedDisplay.primary?.label, '5h');
  assert.equal(supportedDisplay.secondary?.label, '7d');

  const unsupportedDisplay = quotaContextDisplay({
    cwd: '',
    snapshot: {
      model: { provider: 'anthropic', id: 'claude-sonnet-4.5', name: 'Claude Sonnet' },
      isStreaming: false,
      isCompacting: false,
      sessionFile: null,
      sessionId: null,
      messageCount: 4,
      pendingMessageCount: 0,
    },
    quota: {
      visible: true,
      limited: false,
      primaryWindow: { label: '5h', text: '90%', resetAfterSeconds: null, usedPercent: 10, leftPercent: 90 },
      secondaryWindow: null,
    },
  });
  assert.equal(unsupportedDisplay.quotaSupported, false, 'unsupported providers do not expose Pi quota windows');
  assert.equal(unsupportedDisplay.primary, null, 'stale quota is hidden for unsupported models');
  assert.equal(unsupportedDisplay.visible, false, 'meta hides completely when unsupported model has no cwd/context to show');

  const unsupportedWithContext = quotaContextDisplay({
    cwd: '',
    snapshot: {
      model: { provider: 'openai-codex', id: 'o3', name: 'O3', contextWindow: 128_000 },
      isStreaming: false,
      isCompacting: false,
      sessionFile: null,
      sessionId: null,
      messageCount: 1,
      pendingMessageCount: 0,
      contextUsage: { tokens: 32_000, contextWindow: 128_000, percent: 25 },
    },
    quota: {
      visible: true,
      limited: false,
      primaryWindow: { label: '5h', text: '20%', resetAfterSeconds: null, usedPercent: 80, leftPercent: 20 },
      secondaryWindow: null,
    },
  });
  assert.equal(unsupportedWithContext.primary, null, 'unsupported models hide stale quota even when context usage remains visible');
  assert.equal(unsupportedWithContext.contextUsage?.text, '25.0%/128k');
  assert.equal(unsupportedWithContext.visible, true, 'unsupported models may still show non-quota composer context');

  const globals = globalThis as unknown as Record<string, unknown>;
  const previousWindow = globals.window;
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  globals.window = { location: { origin: 'http://phone.test', protocol: 'http:', host: 'phone.test' } };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return Response.json({
      visible: true,
      limited: false,
      primaryWindow: { label: '5h', text: '75%', resetAfterSeconds: null, usedPercent: 25, leftPercent: 75 },
      secondaryWindow: null,
    });
  }) as typeof fetch;

  try {
    const client = new PhoneClient({ token: 'quota-token' });
    const firstQuota = await client.refreshQuota({ model: { provider: 'openai-codex', id: 'gpt-5-codex' }, force: true });
    assert.equal(firstQuota?.primaryWindow?.text, '75%');
    assert.equal(requests.length, 1, 'supported GPT model fetches quota');
    assert.match(requests[0], /\/api\/quota\?token=quota-token/);
    assert.match(requests[0], /provider=openai-codex/);
    assert.match(requests[0], /modelId=gpt-5-codex/);
    assert.match(requests[0], /force=1/);

    const unsupportedQuota = await client.refreshQuota({ model: { provider: 'openai-codex', id: 'o3' } });
    assert.equal(unsupportedQuota, null, 'unsupported models clear quota state');
    assert.equal(client.snapshot().quota, null, 'client quota is hidden after switching to an unsupported model');
    assert.equal(requests.length, 1, 'unsupported models do not call /api/quota');
  } finally {
    if (previousWindow === undefined) delete globals.window;
    else globals.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
}

async function testPhoneClientTransportLifecycleFixtures() {
  const restore = installBrowserTransportFixtures();
  try {
    storeToken('');
    assert.equal(readStoredToken(), '', 'empty stored token starts clear');
    storeToken('stored-token');
    assert.equal(readStoredToken(), 'stored-token', 'transport token helper persists accepted tokens');
    storeToken('');
    assert.equal(readStoredToken(), '', 'clearing token removes it from storage');

    const banners: string[] = [];
    const envelopes: unknown[] = [];
    const client = new PhoneClient({ reconnectDelayMs: 1, onEnvelope: (envelope) => envelopes.push(envelope) });
    client.on('banner', (notice) => {
      if (notice.message) banners.push(notice.message);
    });

    await assert.rejects(() => client.acceptToken('bad-token'), PhoneAuthError);
    assert.equal(FixtureWebSocket.instances.length, 0, 'invalid token recovery does not open a WebSocket');

    const health = await client.acceptToken('valid-token');
    assert.equal(health.cwd, '/repo');
    assert.equal(readStoredToken(), 'valid-token', 'valid login token is stored');

    const firstSocket = FixtureWebSocket.instances.at(-1);
    assert.ok(firstSocket, 'valid token login opens a WebSocket');
    assert.match(String(firstSocket.url), /\/ws\?token=valid-token/, 'WebSocket URL carries the token for the Pi server');
    firstSocket.open();
    assert.equal(client.snapshot().connectionState, 'open');
    assert.deepEqual(
      firstSocket.sent.slice(0, 3).map((message) => JSON.parse(message)),
      [
        { kind: 'refresh' },
        { kind: 'rpc', command: { type: 'get_commands' } },
        { kind: 'rpc', command: { type: 'get_available_models' } },
      ],
      'socket open refreshes snapshot, commands, and models',
    );

    firstSocket.receive({ channel: 'server', event: 'status', data: { isStreaming: false } });
    assert.deepEqual(envelopes.at(-1), { channel: 'server', event: 'status', data: { isStreaming: false } });

    assert.equal(client.sendRpc({ type: 'abort' }), true);
    assert.deepEqual(JSON.parse(firstSocket.sent.at(-1) || ''), { kind: 'rpc', command: { type: 'abort' } });

    firstSocket.closeWith(1006, 'network lost', false);
    assert.equal(client.snapshot().connectionState, 'reconnecting');
    assert.ok(banners.some((message) => /Connection lost\. Retrying/i.test(message)), 'network close shows retry banner');

    await new Promise((resolve) => setTimeout(resolve, 10));
    const retrySocket = FixtureWebSocket.instances.at(-1);
    assert.ok(retrySocket && retrySocket !== firstSocket, 'connection loss schedules a reconnect socket');
    retrySocket.open();
    assert.equal(client.snapshot().connectionState, 'open', 'reconnect socket can return to open state');

    retrySocket.closeWith(4009, 'replaced', false);
    assert.equal(client.snapshot().connectionState, 'closed');
    assert.ok(banners.some((message) => /another device or tab/i.test(message)), 'single-client replacement close shows the replacement banner');

    client.connect();
    const idleSocket = FixtureWebSocket.instances.at(-1);
    assert.ok(idleSocket && idleSocket !== retrySocket);
    idleSocket.open();
    idleSocket.closeWith(4010, 'idle', false);
    assert.equal(client.snapshot().connectionState, 'closed');
    assert.ok(banners.some((message) => /inactivity/i.test(message)), 'idle-timeout close shows the idle banner');
  } finally {
    restore();
  }
}

function testServerLifecycleEnvelopeNotices() {
  resetGlobalState();
  handleEnvelope({ channel: 'server', event: 'single-client-replaced', data: { message: 'Replaced by another browser.' } });
  assert.equal(piPhoneState.snapshot().feedback.banner?.text, 'Replaced by another browser.');

  handleEnvelope({ channel: 'server', event: 'idle-timeout', data: { message: 'Idle timeout stopped the server.' } });
  assert.equal(piPhoneState.snapshot().feedback.banner?.text, 'Idle timeout stopped the server.');

  handleRpcPayload({ type: 'auto_retry_start', errorMessage: 'temporary disconnect' });
  assert.match(piPhoneState.snapshot().feedback.banner?.text || '', /Retrying after error: temporary disconnect/);
  handleRpcPayload({ type: 'auto_retry_end', success: false, finalError: 'still offline' });
  assert.match(piPhoneState.snapshot().feedback.banner?.text || '', /Retry failed: still offline/);
}

export async function run() {
  testMessageAdapterFixtures();
  testSnapshotEnvelopeReducer();
  testCommandAndPathSuggestionResponses();
  testLiveToolReducers();
  testToolPreviewAdapterFixtures();
  testMobileLayoutAndPanelPersistenceFixtures();
  testDesktopRightPanelControlStaticCoverage();
  testLiveAssistantStreamingReducers();
  testLateAssistantEventPreservesSettledMessage();
  testMessageUpdateWholeAssistantFallback();
  testAutocompleteActions();
  testCommandDispatchActions();
  testQuickActionAndSessionDispatchActions();
  testSavedSessionAndTreeAdapters();
  await testPromptSubmissionRules();
  await testAttachmentOrderingRemovalAndPayload();
  testAttachmentStoreOrderingAndCleanupHooks();
  testExtensionUiRequestActions();
  testLoginTokenUrlConsumption();
  await testLoginTokenSubmissionAction();
  await testQuotaContextVisibilityAndTransportFetch();
  await testPhoneClientTransportLifecycleFixtures();
  testServerLifecycleEnvelopeNotices();
}
