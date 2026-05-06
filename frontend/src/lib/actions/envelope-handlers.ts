import { phoneClient, type PhoneClientNotice, type PhoneClientState } from '$lib/pi-phone-transport';
import {
  contentToText,
  isDuplicateSettledAssistant,
  stripTerminalControlSequences,
  transformPhoneMessage,
  transformPhoneMessages,
} from '$lib/adapters/message-adapter';
import { piPhoneState, type PhoneAppState } from '$lib/stores/pi-phone-state';
import type {
  PhoneAutocompleteItem,
  PhoneEnvelope,
  PhoneExtensionUiRequest,
  PhoneLiveTool,
  PhoneMessageContent,
  PhonePathSuggestion,
  PhoneRawMessage,
  PhoneRpcPayload,
  PhoneRpcResponse,
  PhoneSessionCatalog,
  PhoneSnapshotEnvelope,
  PhoneStatus,
  PhoneToolExecutionEndEvent,
  PhoneToolExecutionStartEvent,
  PhoneToolExecutionUpdateEvent,
  PhoneUiAssistantMessage,
  PhoneUiToolMessage,
  UnknownRecord,
} from '$lib/types/pi-phone';

type NoticeKind = 'info' | 'error' | 'warning' | 'success';
type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as LooseRecord) : null;
}

function cleanText(text: unknown) {
  return stripTerminalControlSequences(typeof text === 'string' ? text : text == null ? '' : String(text)).trim();
}

function noticeKind(value: unknown): NoticeKind {
  return value === 'error' || value === 'warning' || value === 'success' ? value : 'info';
}

function setBanner(state: PhoneAppState, text: unknown, kind: NoticeKind = 'info') {
  const message = cleanText(text);
  const notice = message ? { text: message, kind } : null;
  state.connection.banner = notice;
  state.feedback.banner = notice;
}

function setNotification(state: PhoneAppState, text: unknown, kind: NoticeKind = 'info') {
  const message = cleanText(text);
  if (!message) return;
  const notice = { text: message, kind };
  state.connection.notification = notice;
  const id = `toast-${state.feedback.nextToastId}`;
  state.feedback.nextToastId += 1;
  state.feedback.toasts = [
    ...state.feedback.toasts,
    {
      id,
      ...notice,
      createdAt: Date.now(),
      ttlMs: 3500,
    },
  ];
}

function clearTransientState(state: PhoneAppState) {
  state.messages.liveAssistant = null;
  state.tools.live = new Map();
}

function clearSnapshotView(state: PhoneAppState) {
  state.snapshot.state = null;
  state.snapshot.workerId = null;
  state.messages.items = [];
  clearTransientState(state);
}

function uiRequestKey(request: PhoneExtensionUiRequest | null | undefined) {
  if (!request || request.id == null) return '';
  return `${request.sessionWorkerId || ''}:${request.id}`;
}

function discardPendingUiRequest(state: PhoneAppState) {
  const key = uiRequestKey(state.uiRequests.pending);
  if (key) state.uiRequests.modalDrafts.delete(key);
  state.uiRequests.pending = null;
}

function requestRefresh(state: PhoneAppState, options: { forceQuota?: boolean } = {}) {
  state.connection.refreshRequested = true;
  state.connection.refreshRequestId += 1;
  state.connection.forceQuotaRefreshRequested = state.connection.forceQuotaRefreshRequested || Boolean(options.forceQuota);
  state.quota.refreshNeeded = true;
  state.quota.forceRefresh = state.quota.forceRefresh || Boolean(options.forceQuota);
}

function requestQuotaRefresh(state: PhoneAppState, force = false) {
  state.quota.refreshNeeded = true;
  state.quota.forceRefresh = state.quota.forceRefresh || force;
}

function currentLiveTool(state: PhoneAppState, toolCallId: string) {
  return state.tools.live.get(toolCallId);
}

function toolTextFromPayload(value: { result?: { content?: PhoneMessageContent } | null; partialResult?: { content?: PhoneMessageContent } | null; args?: UnknownRecord }) {
  return (
    contentToText(value.result?.content) ||
    contentToText(value.partialResult?.content) ||
    JSON.stringify(value.args || {}, null, 2)
  );
}

function liveToolFromSnapshot(tool: PhoneLiveTool): PhoneUiToolMessage {
  const hasResult = Boolean(tool.result);
  return {
    id: `tool-live-${tool.toolCallId}`,
    kind: 'tool',
    toolCallId: tool.toolCallId,
    toolName: tool.toolName || 'tool',
    args: tool.args || {},
    command: typeof tool.args?.command === 'string' ? tool.args.command : '',
    live: !hasResult,
    title: tool.toolName || 'tool',
    text: toolTextFromPayload(tool),
    meta: hasResult ? (tool.isError ? 'Failed' : 'Done') : 'Running…',
    details: tool.result?.details || tool.partialResult?.details,
    status: tool.isError ? 'error' : hasResult ? 'done' : 'running',
    rawContent: tool.result?.content || tool.partialResult?.content || null,
  };
}

function upsertLiveTool(state: PhoneAppState, toolCallId: string, value: PhoneUiToolMessage) {
  const tools = new Map(state.tools.live);
  tools.set(toolCallId, value);
  state.tools.live = tools;
}

function createEmptyLiveAssistant(): PhoneUiAssistantMessage {
  return {
    id: 'assistant-live',
    kind: 'assistant',
    live: true,
    text: '',
    thinking: '',
    toolCalls: [],
    meta: 'Streaming…',
  };
}

function setLiveAssistantFromMessage(state: PhoneAppState, message: PhoneRawMessage, live: boolean) {
  const transformed = transformPhoneMessage(message, Date.now())[0];
  if (transformed?.kind !== 'assistant') return;
  const nextAssistant: PhoneUiAssistantMessage = {
    ...transformed,
    id: live ? 'assistant-live' : transformed.id,
    live,
  };

  state.messages.liveAssistant = isDuplicateSettledAssistant(state.messages.items, nextAssistant) ? null : nextAssistant;
}

function handleAssistantEvent(state: PhoneAppState, event: unknown) {
  const payload = asRecord(event);
  if (!payload) return;

  if (!state.messages.liveAssistant || state.messages.liveAssistant.kind !== 'assistant') {
    state.messages.liveAssistant = createEmptyLiveAssistant();
  }

  const live = state.messages.liveAssistant as PhoneUiAssistantMessage;
  if (live.live !== false) {
    live.live = true;
    live.id = 'assistant-live';
  }
  if (payload.type === 'text_delta') live.text = `${live.text || ''}${stripTerminalControlSequences(String(payload.delta || ''))}`;
  if (payload.type === 'thinking_delta') {
    live.thinking = `${live.thinking || ''}${stripTerminalControlSequences(String(payload.delta || ''))}`;
  }
  if (payload.type === 'toolcall_end') {
    const toolCall = asRecord(payload.toolCall);
    if (toolCall) {
      live.toolCalls = [
        ...(live.toolCalls || []),
        {
          id: typeof toolCall.id === 'string' ? toolCall.id : '',
          name: typeof toolCall.name === 'string' ? toolCall.name : 'tool',
          arguments: asRecord(toolCall.arguments) || {},
        },
      ];
    }
  }
  if (payload.type === 'error') setNotification(state, payload.message || 'Agent error', 'error');
}

function mapPathSuggestions(context: NonNullable<PhoneAppState['autocomplete']['context']>, suggestions: PhonePathSuggestion[]): PhoneAutocompleteItem[] {
  if (context.type !== 'path') return [];
  return suggestions.map((suggestion) => ({
    kind: 'path',
    label: context.mode === 'mention' ? `@${suggestion.value}` : suggestion.value,
    badge: suggestion.kind === 'previous' ? 'recent' : suggestion.isDirectory ? 'dir' : 'file',
    description: suggestion.description || suggestion.value,
    value: suggestion.value,
    isDirectory: Boolean(suggestion.isDirectory),
    title: suggestion.description || suggestion.value,
  }));
}

function handleExtensionUiRequest(state: PhoneAppState, request: PhoneExtensionUiRequest) {
  if (request.method === 'notify') {
    const level = noticeKind((request as { level?: unknown }).level);
    setNotification(state, request.message || 'Notification', level);
    return;
  }

  if (request.method === 'setStatus') {
    state.uiRequests.footerStatus = typeof request.statusText === 'string' ? request.statusText : '';
    return;
  }

  if (request.method === 'setWidget') {
    const widgets = new Map(state.uiRequests.widgets);
    const key = typeof request.widgetKey === 'string' && request.widgetKey ? request.widgetKey : 'widget';
    const lines = Array.isArray(request.widgetLines) ? request.widgetLines.filter((line): line is string => typeof line === 'string') : [];
    if (lines.length) widgets.set(key, lines);
    else widgets.delete(key);
    state.uiRequests.widgets = widgets;
    return;
  }

  if (request.method === 'setTitle') {
    state.uiRequests.title = request.title || 'Pi Phone';
    return;
  }

  if (request.method === 'set_editor_text') {
    state.composer.text = typeof request.text === 'string' ? request.text : '';
    return;
  }

  if (!['select', 'confirm', 'input', 'editor'].includes(request.method)) {
    setNotification(state, `Unsupported UI request: ${request.method || 'unknown'}`);
    return;
  }

  if (request.sessionWorkerId && state.sessions.activeSessionId && request.sessionWorkerId !== state.sessions.activeSessionId) return;
  state.uiRequests.pending = request;
}

function applyResponseSuccess(state: PhoneAppState, payload: PhoneRpcResponse & { success: true }) {
  switch (payload.command) {
    case 'get_state': {
      state.snapshot.state = (payload.data as PhoneAppState['snapshot']['state']) || state.snapshot.state;
      requestQuotaRefresh(state);
      return;
    }

    case 'get_messages': {
      const data = asRecord(payload.data);
      state.messages.items = transformPhoneMessages(data?.messages);
      clearTransientState(state);
      return;
    }

    case 'get_commands': {
      const data = asRecord(payload.data);
      state.commands.available = Array.isArray(data?.commands) ? (data.commands as PhoneAppState['commands']['available']) : [];
      state.commands.loaded = true;
      return;
    }

    case 'path_suggestions': {
      const context = state.autocomplete.context;
      if (!context || context.type !== 'path') return;
      const data = asRecord(payload.data);
      if (Number(data?.requestId) !== state.autocomplete.remoteRequestId) return;
      if (data?.mode !== context.mode) return;
      if ((data?.query || '') !== context.query) return;
      const suggestions = Array.isArray(data?.suggestions) ? (data.suggestions as PhonePathSuggestion[]) : [];
      state.autocomplete.items = mapPathSuggestions(context, suggestions);
      return;
    }

    case 'cd': {
      const data = asRecord(payload.data);
      setNotification(state, `Changed directory to ${typeof data?.cwd === 'string' ? data.cwd : 'the selected path'}.`);
      requestRefresh(state);
      return;
    }

    case 'get_available_models': {
      const data = asRecord(payload.data);
      state.models.available = Array.isArray(data?.models) ? (data.models as PhoneAppState['models']['available']) : [];
      return;
    }

    case 'get_session_stats':
      state.stats = (payload.data as PhoneAppState['stats']) || null;
      return;

    case 'phone_list_sessions': {
      const data = asRecord(payload.data);
      state.sessions.saved = Array.isArray(data?.sessions) ? (data.sessions as PhoneAppState['sessions']['saved']) : [];
      return;
    }

    case 'phone_get_tree':
      state.tree = (payload.data as PhoneAppState['tree']) || null;
      return;

    case 'new_parent_session':
      clearTransientState(state);
      requestRefresh(state);
      setNotification(state, 'Started a new parent session.');
      return;

    case 'new_session':
      clearTransientState(state);
      requestRefresh(state);
      setNotification(state, 'Started a new Pi session.');
      return;

    case 'compact':
      setNotification(state, 'Compaction triggered.');
      requestRefresh(state);
      return;

    case 'slash_command': {
      const data = asRecord(payload.data);
      if (data?.source === 'extension') requestRefresh(state, { forceQuota: true });
      return;
    }

    case 'reload': {
      clearTransientState(state);
      const data = asRecord(payload.data);
      if (data?.commandControlsAvailable === false) {
        setNotification(
          state,
          data.warning || 'Reloaded, but parent session command controls need a fresh terminal command context.',
          'error',
        );
      } else {
        setNotification(state, 'Reloaded extensions, skills, prompts, and themes.');
      }
      requestRefresh(state, { forceQuota: true });
      return;
    }

    case 'set_model':
      setNotification(state, 'Model updated.');
      if (state.sheets.mode === 'models') state.sheets.open = false;
      requestRefresh(state, { forceQuota: true });
      return;

    case 'set_thinking_level':
      setNotification(state, 'Thinking level updated.');
      if (state.sheets.mode === 'thinking') state.sheets.open = false;
      requestRefresh(state);
      return;

    case 'switch_session':
      clearSnapshotView(state);
      state.stats = null;
      state.tree = null;
      setNotification(state, 'Session switched.');
      requestRefresh(state);
      return;

    case 'fork':
      state.stats = null;
      state.tree = null;
      setNotification(state, 'Fork created.');
      requestRefresh(state);
      return;

    case 'phone_open_branch_path':
      clearSnapshotView(state);
      state.stats = null;
      state.tree = null;
      setNotification(state, 'Opened selected branch path as a new session.');
      requestRefresh(state);
      return;

    default:
      return;
  }
}

function handleRpcResponse(state: PhoneAppState, payload: PhoneRpcResponse) {
  if (!payload.success) {
    if (payload.command === 'path_suggestions') {
      state.autocomplete.items = [];
      return;
    }
    setNotification(state, payload.error || `Command failed: ${payload.command}`, 'error');
    return;
  }

  applyResponseSuccess(state, payload);
}

function handleToolExecutionStart(state: PhoneAppState, payload: PhoneToolExecutionStartEvent) {
  upsertLiveTool(state, payload.toolCallId, {
    id: `tool-live-${payload.toolCallId}`,
    kind: 'tool',
    toolCallId: payload.toolCallId,
    toolName: payload.toolName || 'tool',
    args: payload.args || {},
    command: typeof payload.args?.command === 'string' ? payload.args.command : '',
    live: true,
    title: payload.toolName || 'tool',
    text: JSON.stringify(payload.args || {}, null, 2),
    meta: 'Running…',
    status: 'running',
    rawContent: null,
  });
}

function handleToolExecutionUpdate(state: PhoneAppState, payload: PhoneToolExecutionUpdateEvent) {
  const previous = currentLiveTool(state, payload.toolCallId);
  const args = payload.args || previous?.args || {};
  upsertLiveTool(state, payload.toolCallId, {
    ...previous,
    id: `tool-live-${payload.toolCallId}`,
    kind: 'tool',
    toolCallId: payload.toolCallId,
    toolName: payload.toolName || previous?.toolName || 'tool',
    args,
    command: typeof args.command === 'string' ? args.command : previous?.command || '',
    live: true,
    title: payload.toolName || previous?.title || 'tool',
    text: contentToText(payload.partialResult?.content) || JSON.stringify(args, null, 2),
    meta: 'Running…',
    status: 'running',
    details: payload.partialResult?.details,
    rawContent: payload.partialResult?.content || previous?.rawContent || null,
  });
}

function handleToolExecutionEnd(state: PhoneAppState, payload: PhoneToolExecutionEndEvent) {
  const previous = currentLiveTool(state, payload.toolCallId);
  const args = payload.args || previous?.args || {};
  upsertLiveTool(state, payload.toolCallId, {
    ...previous,
    id: `tool-live-${payload.toolCallId}`,
    kind: 'tool',
    toolCallId: payload.toolCallId,
    toolName: payload.toolName || previous?.toolName || 'tool',
    args,
    command: typeof args.command === 'string' ? args.command : previous?.command || '',
    live: false,
    title: payload.toolName || previous?.title || 'tool',
    text: contentToText(payload.result?.content),
    meta: payload.isError ? 'Failed' : 'Done',
    status: payload.isError ? 'error' : 'done',
    details: payload.result?.details,
    rawContent: payload.result?.content || previous?.rawContent || null,
  });
}

function applyRpcPayloadToState(state: PhoneAppState, payload: PhoneRpcPayload | unknown) {
  const record = asRecord(payload);
  if (!record || typeof record.type !== 'string') return;

  if (record.type === 'response') {
    handleRpcResponse(state, record as PhoneRpcResponse);
    return;
  }

  if (record.type === 'agent_start') {
    state.status = { ...(state.status || ({} as PhoneStatus)), isStreaming: true } as PhoneStatus;
    return;
  }

  if (record.type === 'agent_end') {
    state.status = { ...(state.status || ({} as PhoneStatus)), isStreaming: false } as PhoneStatus;
    requestRefresh(state, { forceQuota: true });
    return;
  }

  if (record.type === 'message_update') {
    if (record.assistantMessageEvent) {
      handleAssistantEvent(state, record.assistantMessageEvent);
      return;
    }

    const message = record.message as PhoneRawMessage | undefined;
    if (message?.role === 'assistant') setLiveAssistantFromMessage(state, message, true);
    return;
  }

  if (record.type === 'message_end') {
    const message = record.message as PhoneRawMessage | undefined;
    if (message?.role === 'assistant') setLiveAssistantFromMessage(state, message, false);
    return;
  }

  if (record.type === 'tool_execution_start') {
    handleToolExecutionStart(state, record as PhoneToolExecutionStartEvent);
    return;
  }

  if (record.type === 'tool_execution_update') {
    handleToolExecutionUpdate(state, record as PhoneToolExecutionUpdateEvent);
    return;
  }

  if (record.type === 'tool_execution_end') {
    handleToolExecutionEnd(state, record as PhoneToolExecutionEndEvent);
    return;
  }

  if (record.type === 'extension_ui_request') {
    handleExtensionUiRequest(state, record as PhoneExtensionUiRequest);
    return;
  }

  if (record.type === 'auto_retry_start') {
    setBanner(state, `Retrying after error: ${record.errorMessage || 'temporary failure'}`);
    return;
  }

  if (record.type === 'auto_retry_end') {
    setBanner(state, record.success ? '' : `Retry failed: ${record.finalError || 'Unknown error'}`, record.success ? 'info' : 'error');
  }
}

export function handleRpcPayload(payload: PhoneRpcPayload | unknown) {
  piPhoneState.update((state) => {
    applyRpcPayloadToState(state, payload);
    return state;
  });
}

function handleSessionCatalog(state: PhoneAppState, catalog: PhoneSessionCatalog | undefined) {
  const nextActiveSessionId = catalog?.activeSessionId || state.sessions.activeSessionId;
  const activeSessionChanged = nextActiveSessionId !== state.sessions.activeSessionId;

  state.sessions.active = catalog?.sessions || [];
  state.sessions.activeSessionId = nextActiveSessionId || null;

  if (activeSessionChanged) {
    discardPendingUiRequest(state);
    state.stats = null;
    state.tree = null;
  }

  if (activeSessionChanged && state.snapshot.workerId && state.snapshot.workerId !== state.sessions.activeSessionId) {
    clearSnapshotView(state);
  }
}

function handleSnapshotEnvelope(state: PhoneAppState, envelope: PhoneSnapshotEnvelope) {
  if (envelope.sessionWorkerId && state.sessions.activeSessionId && envelope.sessionWorkerId !== state.sessions.activeSessionId) return;

  state.snapshot.state = envelope.state || null;
  state.snapshot.workerId = envelope.sessionWorkerId || state.sessions.activeSessionId || null;
  state.status = { ...(state.status || ({} as PhoneStatus)), isStreaming: Boolean(envelope.state?.isStreaming) } as PhoneStatus;
  state.messages.items = transformPhoneMessages(envelope.messages);
  if (envelope.commands) {
    state.commands.available = envelope.commands;
    state.commands.loaded = true;
  }
  state.uiRequests.pending = null;
  clearTransientState(state);

  if (envelope.liveAssistantMessage?.role === 'assistant') {
    const assistant = transformPhoneMessage(envelope.liveAssistantMessage, Date.now())[0];
    if (assistant?.kind === 'assistant') state.messages.liveAssistant = { ...assistant, id: 'assistant-live', live: true };
  }

  const liveTools = new Map<string, PhoneUiToolMessage>();
  for (const tool of envelope.liveTools || []) liveTools.set(tool.toolCallId, liveToolFromSnapshot(tool));
  state.tools.live = liveTools;
  requestQuotaRefresh(state);
}

function handleServerEnvelope(state: PhoneAppState, event: string, data: unknown) {
  const record = asRecord(data);
  if (event === 'status') {
    state.status = data as PhoneStatus;
    return;
  }
  if (event === 'stderr') {
    setBanner(state, cleanText(record?.text), 'error');
    return;
  }
  if (event === 'reloading') {
    setBanner(state, record?.message || '');
    return;
  }
  if (event === 'session-spawned') {
    setNotification(state, record?.message || 'Opened new parallel session.');
    return;
  }
  if (event === 'single-client-replaced') {
    setBanner(state, record?.message || 'This phone session was replaced by another client.', 'error');
    return;
  }
  if (event === 'command-controls-unavailable') {
    setBanner(state, record?.message || 'Parent session command controls are unavailable until Pi provides a fresh command context.', 'error');
    return;
  }
  if (event === 'idle-timeout') {
    setBanner(state, record?.message || 'Pi Phone stopped because it was idle.', 'error');
    return;
  }
  if (['startup-error', 'snapshot-error', 'client-error'].includes(event)) {
    setNotification(state, record?.message || 'Server error', 'error');
    return;
  }
  if (event === 'agent-exit') setBanner(state, record?.message || 'Pi rpc exited.', 'error');
}

export function handleEnvelope(envelope: PhoneEnvelope | unknown) {
  const event = asRecord(envelope);
  if (!event) return;

  piPhoneState.update((state) => {
    state.connection.lastEnvelope = envelope as PhoneEnvelope;

    if (event.channel === 'sessions' && event.event === 'catalog') {
      handleSessionCatalog(state, event.data as PhoneSessionCatalog | undefined);
      return state;
    }

    if (event.channel === 'snapshot') {
      handleSnapshotEnvelope(state, event as PhoneSnapshotEnvelope);
      return state;
    }

    if (event.channel === 'server' && typeof event.event === 'string') {
      handleServerEnvelope(state, event.event, event.data);
      return state;
    }

    if (event.channel === 'rpc') applyRpcPayloadToState(state, event.payload);
    return state;
  });
}

export function handleAuthFailure() {
  piPhoneState.update((state) => {
    state.auth.token = '';
    state.auth.loginOpen = true;
    state.auth.authError = 'Access token required. Enter the current /phone-start token.';
    state.connection.client = null;
    state.connection.connectionState = 'auth-required';
    state.connection.socketReadyState = null;
    state.connection.manuallyClosed = true;
    discardPendingUiRequest(state);
    setBanner(state, state.auth.authError, 'error');
    return state;
  });
}

export function applyClientState(clientState: PhoneClientState) {
  piPhoneState.update((state) => {
    state.connection.client = clientState;
    state.connection.connectionState = clientState.connectionState;
    state.connection.socketReadyState = clientState.socketReadyState;
    state.connection.manuallyClosed = clientState.manuallyClosed;
    state.connection.reconnectScheduled = clientState.reconnectScheduled;
    state.connection.lastClose = clientState.lastClose;
    state.connection.lastError = clientState.lastError;
    state.auth.token = clientState.token;
    state.auth.health = clientState.health;
    state.status = clientState.health ? ({ ...(state.status || {}), ...clientState.health } as PhoneStatus) : state.status;
    state.quota.value = clientState.quota;
    return state;
  });
}

export function applyHealth(health: PhoneClientState['health']) {
  piPhoneState.update((state) => {
    state.auth.health = health;
    if (health) state.status = { ...(state.status || {}), ...health } as PhoneStatus;
    return state;
  });
}

export function applyQuota(quota: PhoneClientState['quota']) {
  piPhoneState.update((state) => {
    state.quota.value = quota;
    state.quota.refreshNeeded = false;
    state.quota.forceRefresh = false;
    state.connection.forceQuotaRefreshRequested = false;
    return state;
  });
}

export function applyClientNotice(target: 'banner' | 'notification', notice: PhoneClientNotice) {
  piPhoneState.update((state) => {
    if (target === 'banner') setBanner(state, notice.message, noticeKind(notice.level));
    else setNotification(state, notice.message, noticeKind(notice.level));
    return state;
  });
}

export function clearRefreshRequest() {
  piPhoneState.update((state) => {
    state.connection.refreshRequested = false;
    state.connection.forceQuotaRefreshRequested = false;
    return state;
  });
}

export function registerPhoneClientStoreHandlers() {
  const offState = phoneClient.on('state', applyClientState);
  const offHealth = phoneClient.on('health', applyHealth);
  const offQuota = phoneClient.on('quota', applyQuota);
  const offEnvelope = phoneClient.on('envelope', handleEnvelope);
  const offAuthFailure = phoneClient.on('auth-failure', handleAuthFailure);
  const offAuthRequired = phoneClient.on('auth-required', (health) => {
    piPhoneState.update((state) => {
      state.auth.health = health;
      state.auth.loginOpen = true;
      state.connection.connectionState = 'auth-required';
      return state;
    });
  });
  const offBanner = phoneClient.on('banner', (notice) => applyClientNotice('banner', notice));
  const offNotification = phoneClient.on('notification', (notice) => applyClientNotice('notification', notice));
  const offInvalidMessage = phoneClient.on('invalid-message', () => {
    applyClientNotice('notification', { message: 'Received malformed data from server.', level: 'error' });
  });
  const offSendBlocked = phoneClient.on('send-blocked', (payload) => {
    applyClientNotice('notification', { message: payload.reason, level: 'error' });
  });

  return () => {
    offState();
    offHealth();
    offQuota();
    offEnvelope();
    offAuthFailure();
    offAuthRequired();
    offBanner();
    offNotification();
    offInvalidMessage();
    offSendBlocked();
  };
}
