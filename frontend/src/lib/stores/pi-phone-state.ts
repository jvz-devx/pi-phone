import { get, writable, type Readable } from 'svelte/store';
import type { PhoneClientConnectionState, PhoneClientState } from '$lib/pi-phone-transport';
import type {
  PhoneAttachmentRecord,
  PhoneAutocompleteContext,
  PhoneAutocompleteItem,
  PhoneCommand,
  PhoneEnvelope,
  PhoneExtensionUiRequest,
  PhoneHealth,
  PhoneModel,
  PhoneQuotaResponse,
  PhoneSavedSession,
  PhoneSessionCatalog,
  PhoneSessionSummary,
  PhoneSheetMode,
  PhoneSnapshotState,
  PhoneStats,
  PhoneStatus,
  PhoneTree,
  PhoneUiMessage,
  PhoneUiToolMessage,
} from '$lib/types/pi-phone';

export type PhoneNoticeKind = 'info' | 'error' | 'warning' | 'success';

export type PhoneNotice = {
  text: string;
  kind: PhoneNoticeKind;
};

export type PhoneToast = PhoneNotice & {
  id: string;
  createdAt: number;
  ttlMs: number;
};

export type PhoneConnectionState = {
  client: PhoneClientState | null;
  connectionState: PhoneClientConnectionState;
  socketReadyState: number | null;
  manuallyClosed: boolean;
  reconnectScheduled: boolean;
  lastClose: { code: number; reason: string; wasClean: boolean } | null;
  lastError: string;
  lastEnvelope: PhoneEnvelope | null;
  refreshRequested: boolean;
  refreshRequestId: number;
  forceQuotaRefreshRequested: boolean;
  /** Last transport banner notice. Kept here so PhoneClient events can be mirrored without owning transport. */
  banner: PhoneNotice | null;
  /** Last transport notification notice. Components may also choose to add this to feedback.toasts. */
  notification: PhoneNotice | null;
};

export type PhoneAuthState = {
  token: string;
  health: PhoneHealth | null;
  loginOpen: boolean;
  authError: string;
};

export type PhoneSessionsState = {
  saved: PhoneSavedSession[];
  active: PhoneSessionSummary[];
  activeSessionId: string | null;
};

export type PhoneSnapshotStoreState = {
  state: PhoneSnapshotState | null;
  workerId: string | null;
};

export type PhoneMessagesState = {
  items: PhoneUiMessage[];
  liveAssistant: PhoneUiMessage | null;
  followLatest: boolean;
  lastAutoFollowAt: number;
  lastAutoFollowHeight: number;
  ignoreScrollTrackingUntil: number;
  lastUserScrollIntentAt: number;
};

export type PhoneToolsState = {
  live: Map<string, PhoneUiToolMessage>;
  panelOpen: Map<string, boolean>;
  selectedToolId: string | null;
};

export type PhoneCommandsState = {
  available: PhoneCommand[];
};

export type PhoneModelsState = {
  available: PhoneModel[];
};

export type PhoneSheetsState = {
  open: boolean;
  mode: PhoneSheetMode;
  commandCategory: string;
  lastPointerAction: string;
  lastPointerActionAt: number;
};

export type PhoneComposerState = {
  text: string;
  isSubmitting: boolean;
  steerAvailable: boolean;
};

export type PhoneAttachmentsState = {
  items: PhoneAttachmentRecord[];
  nextTokenId: number;
};

export type PhoneAutocompleteState = {
  context: PhoneAutocompleteContext | null;
  items: PhoneAutocompleteItem[];
  remoteRequestId: number;
  remoteTimer: ReturnType<typeof setTimeout> | null;
};

export type PhoneQuotaState = {
  value: PhoneQuotaResponse | null;
  requestId: number;
  refreshNeeded: boolean;
  forceRefresh: boolean;
};

export type PhoneUiRequestsState = {
  pending: PhoneExtensionUiRequest | null;
  modalDrafts: Map<string, string>;
  widgets: Map<string, string[]>;
  footerStatus: string;
  title: string;
};

export type PhoneFeedbackState = {
  banner: PhoneNotice | null;
  toasts: PhoneToast[];
  nextToastId: number;
};

export type PhoneAppState = {
  connection: PhoneConnectionState;
  auth: PhoneAuthState;
  status: PhoneStatus | null;
  sessions: PhoneSessionsState;
  snapshot: PhoneSnapshotStoreState;
  messages: PhoneMessagesState;
  tools: PhoneToolsState;
  commands: PhoneCommandsState;
  models: PhoneModelsState;
  sheets: PhoneSheetsState;
  composer: PhoneComposerState;
  attachments: PhoneAttachmentsState;
  autocomplete: PhoneAutocompleteState;
  quota: PhoneQuotaState;
  uiRequests: PhoneUiRequestsState;
  feedback: PhoneFeedbackState;
  stats: PhoneStats | null;
  tree: PhoneTree | null;
};

export type PhoneStateResetOptions = {
  token?: string;
  preserveToken?: boolean;
};

export type PhoneSetBannerOptions = {
  mirrorToConnection?: boolean;
};

export type PhoneToastOptions = {
  id?: string;
  createdAt?: number;
  ttlMs?: number;
};

function cloneLastClose(close: PhoneConnectionState['lastClose']) {
  return close ? { ...close } : null;
}

function cloneClientState(client: PhoneClientState | null): PhoneClientState | null {
  if (!client) return null;
  return {
    ...client,
    health: client.health ? { ...client.health } : null,
    quota: client.quota ? { ...client.quota } : null,
    lastClose: client.lastClose ? { ...client.lastClose } : null,
    currentModel: client.currentModel ? { ...client.currentModel } : null,
  };
}

function cloneWidgetMap(widgets: Map<string, string[]>) {
  return new Map([...widgets.entries()].map(([key, lines]) => [key, [...lines]]));
}

function clonePhoneAppState(state: PhoneAppState): PhoneAppState {
  return {
    ...state,
    connection: {
      ...state.connection,
      client: cloneClientState(state.connection.client),
      lastClose: cloneLastClose(state.connection.lastClose),
      banner: state.connection.banner ? { ...state.connection.banner } : null,
      notification: state.connection.notification ? { ...state.connection.notification } : null,
    },
    auth: { ...state.auth, health: state.auth.health ? { ...state.auth.health } : null },
    sessions: { ...state.sessions, saved: [...state.sessions.saved], active: [...state.sessions.active] },
    snapshot: { ...state.snapshot },
    messages: {
      ...state.messages,
      items: [...state.messages.items],
      liveAssistant: state.messages.liveAssistant ? { ...state.messages.liveAssistant } : null,
    },
    tools: {
      ...state.tools,
      live: new Map(state.tools.live),
      panelOpen: new Map(state.tools.panelOpen),
    },
    commands: { ...state.commands, available: [...state.commands.available] },
    models: { ...state.models, available: [...state.models.available] },
    sheets: { ...state.sheets },
    composer: { ...state.composer },
    attachments: { ...state.attachments, items: [...state.attachments.items] },
    autocomplete: { ...state.autocomplete, items: [...state.autocomplete.items] },
    quota: { ...state.quota },
    uiRequests: {
      ...state.uiRequests,
      modalDrafts: new Map(state.uiRequests.modalDrafts),
      widgets: cloneWidgetMap(state.uiRequests.widgets),
    },
    feedback: {
      ...state.feedback,
      banner: state.feedback.banner ? { ...state.feedback.banner } : null,
      toasts: state.feedback.toasts.map((toast) => ({ ...toast })),
    },
  };
}

function uiRequestKey(request: PhoneExtensionUiRequest | null | undefined) {
  if (!request || request.id == null) return '';
  return `${request.sessionWorkerId || ''}:${request.id}`;
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null) {
  if (timer) clearTimeout(timer);
}

export function createInitialPhoneState(token = ''): PhoneAppState {
  return {
    connection: {
      client: null,
      connectionState: 'idle',
      socketReadyState: null,
      manuallyClosed: false,
      reconnectScheduled: false,
      lastClose: null,
      lastError: '',
      lastEnvelope: null,
      refreshRequested: false,
      refreshRequestId: 0,
      forceQuotaRefreshRequested: false,
      banner: null,
      notification: null,
    },
    auth: {
      token,
      health: null,
      loginOpen: false,
      authError: '',
    },
    status: null,
    sessions: {
      saved: [],
      active: [],
      activeSessionId: null,
    },
    snapshot: {
      state: null,
      workerId: null,
    },
    messages: {
      items: [],
      liveAssistant: null,
      followLatest: true,
      lastAutoFollowAt: 0,
      lastAutoFollowHeight: 0,
      ignoreScrollTrackingUntil: 0,
      lastUserScrollIntentAt: 0,
    },
    tools: {
      live: new Map(),
      panelOpen: new Map(),
      selectedToolId: null,
    },
    commands: {
      available: [],
    },
    models: {
      available: [],
    },
    sheets: {
      open: false,
      mode: 'actions',
      commandCategory: 'local',
      lastPointerAction: '',
      lastPointerActionAt: 0,
    },
    composer: {
      text: '',
      isSubmitting: false,
      steerAvailable: false,
    },
    attachments: {
      items: [],
      nextTokenId: 1,
    },
    autocomplete: {
      context: null,
      items: [],
      remoteRequestId: 0,
      remoteTimer: null,
    },
    quota: {
      value: null,
      requestId: 0,
      refreshNeeded: false,
      forceRefresh: false,
    },
    uiRequests: {
      pending: null,
      modalDrafts: new Map(),
      widgets: new Map(),
      footerStatus: '',
      title: 'Pi Phone',
    },
    feedback: {
      banner: null,
      toasts: [],
      nextToastId: 1,
    },
    stats: null,
    tree: null,
  };
}

export type PhoneStateStore = Readable<PhoneAppState> & {
  snapshot(): PhoneAppState;
  reset(options?: PhoneStateResetOptions): void;
  replace(nextState: PhoneAppState): void;
  patch(patch: Partial<PhoneAppState>): void;
  update(updater: (state: PhoneAppState) => PhoneAppState | void): void;

  setClientState(client: PhoneClientState | null): void;
  updateConnection(patch: Partial<PhoneConnectionState>): void;
  setConnectionState(connectionState: PhoneClientConnectionState): void;
  setLastEnvelope(envelope: PhoneEnvelope | null): void;

  setToken(token: string): void;
  setHealth(health: PhoneHealth | null): void;
  setLoginOpen(loginOpen: boolean): void;
  setAuthError(authError: string): void;
  markAuthRequired(message?: string): void;
  clearAuthError(): void;

  setStatus(status: PhoneStatus | null): void;
  setSessionCatalog(catalog: PhoneSessionCatalog | null | undefined): void;
  setActiveSessions(sessions: PhoneSessionSummary[], activeSessionId?: string | null): void;
  setSavedSessions(sessions: PhoneSavedSession[]): void;
  setActiveSessionId(activeSessionId: string | null): void;

  setSnapshot(snapshot: PhoneSnapshotState | null, workerId?: string | null): void;
  clearSnapshotView(): void;

  setMessages(messages: PhoneUiMessage[]): void;
  appendMessages(messages: PhoneUiMessage[]): void;
  setLiveAssistant(message: PhoneUiMessage | null): void;
  updateLiveAssistant(updater: (message: PhoneUiMessage | null) => PhoneUiMessage | null): void;
  setFollowLatest(followLatest: boolean): void;
  updateScrollFlags(patch: Partial<Omit<PhoneMessagesState, 'items' | 'liveAssistant'>>): void;

  setLiveTools(tools: Map<string, PhoneUiToolMessage> | Iterable<[string, PhoneUiToolMessage]>): void;
  upsertLiveTool(toolId: string, tool: PhoneUiToolMessage): void;
  removeLiveTool(toolId: string): void;
  clearTransientState(): void;
  setToolPanelOpen(toolId: string, open: boolean): void;
  setSelectedToolId(toolId: string | null): void;

  setCommands(commands: PhoneCommand[]): void;
  setCommandSheetCategory(category: string): void;
  setModels(models: PhoneModel[]): void;

  setSheetMode(mode: PhoneSheetMode, options?: { open?: boolean }): void;
  setSheetOpen(open: boolean): void;
  recordSheetPointerAction(action: string, at?: number): void;

  setComposerText(text: string): void;
  updateComposer(patch: Partial<PhoneComposerState>): void;
  resetComposer(): void;

  allocateAttachmentTokenId(): number;
  setAttachments(attachments: PhoneAttachmentRecord[]): void;
  addAttachments(attachments: PhoneAttachmentRecord[]): void;
  removeAttachment(id: string): PhoneAttachmentRecord | null;
  clearAttachments(): PhoneAttachmentRecord[];
  setNextAttachmentTokenId(nextTokenId: number): void;

  setAutocompleteContext(context: PhoneAutocompleteContext | null): void;
  setAutocompleteItems(items: PhoneAutocompleteItem[]): void;
  beginAutocompleteRequest(): number;
  setAutocompleteRemoteRequestId(requestId: number): void;
  setAutocompleteTimer(timer: ReturnType<typeof setTimeout> | null): void;
  clearAutocompleteTimer(): void;
  clearAutocomplete(): void;

  setQuota(quota: PhoneQuotaResponse | null): void;
  beginQuotaRequest(): number;
  setQuotaRequestId(requestId: number): void;

  setPendingUiRequest(request: PhoneExtensionUiRequest | null): void;
  clearPendingUiRequest(): void;
  uiRequestKey(request: PhoneExtensionUiRequest | null | undefined): string;
  setUiRequestDraft(request: PhoneExtensionUiRequest | null | undefined, value: string): void;
  forgetUiRequestDraft(request: PhoneExtensionUiRequest | null | undefined): void;
  clearUiRequestDrafts(): void;
  setWidget(key: string, lines: string[] | null | undefined): void;
  clearWidgets(): void;
  setFooterStatus(status: string): void;

  setStats(stats: PhoneStats | null): void;
  setTree(tree: PhoneTree | null): void;

  setBanner(text: string, kind?: PhoneNoticeKind, options?: PhoneSetBannerOptions): void;
  clearBanner(): void;
  setNotification(text: string, kind?: PhoneNoticeKind): void;
  pushToast(text: string, kind?: PhoneNoticeKind, options?: PhoneToastOptions): string | null;
  dismissToast(id: string): void;
  clearToasts(): void;
};

export function createPiPhoneStateStore(initialState: PhoneAppState = createInitialPhoneState()): PhoneStateStore {
  const store = writable<PhoneAppState>(clonePhoneAppState(initialState));

  function snapshot() {
    return clonePhoneAppState(get(store));
  }

  function replace(nextState: PhoneAppState) {
    const current = get(store);
    clearTimer(current.autocomplete.remoteTimer);
    store.set(clonePhoneAppState(nextState));
  }

  function reset(options: PhoneStateResetOptions = {}) {
    const current = get(store);
    clearTimer(current.autocomplete.remoteTimer);
    const token = options.token ?? (options.preserveToken ? current.auth.token : '');
    store.set(createInitialPhoneState(token));
  }

  function patch(patchValue: Partial<PhoneAppState>) {
    store.update((current) => clonePhoneAppState({ ...current, ...patchValue }));
  }

  function update(updater: (state: PhoneAppState) => PhoneAppState | void) {
    store.update((current) => {
      const draft = clonePhoneAppState(current);
      const next = updater(draft);
      return clonePhoneAppState(next || draft);
    });
  }

  function updateSection<K extends keyof PhoneAppState>(
    section: K,
    updater: (sectionState: PhoneAppState[K], current: PhoneAppState) => PhoneAppState[K],
  ) {
    store.update((current) => ({ ...current, [section]: updater(current[section], current) }));
  }

  function updateConnection(patchValue: Partial<PhoneConnectionState>) {
    updateSection('connection', (connection) => ({
      ...connection,
      ...patchValue,
      client: patchValue.client === undefined ? connection.client : cloneClientState(patchValue.client),
      lastClose: patchValue.lastClose === undefined ? connection.lastClose : cloneLastClose(patchValue.lastClose),
    }));
  }

  function setClientState(client: PhoneClientState | null) {
    const nextClient = cloneClientState(client);
    store.update((current) => ({
      ...current,
      connection: {
        ...current.connection,
        client: nextClient,
        connectionState: nextClient?.connectionState ?? current.connection.connectionState,
        socketReadyState: nextClient?.socketReadyState ?? null,
        manuallyClosed: nextClient?.manuallyClosed ?? current.connection.manuallyClosed,
        reconnectScheduled: nextClient?.reconnectScheduled ?? current.connection.reconnectScheduled,
        lastClose: cloneLastClose(nextClient?.lastClose ?? current.connection.lastClose),
        lastError: nextClient?.lastError ?? current.connection.lastError,
      },
      auth: {
        ...current.auth,
        token: nextClient?.token ?? current.auth.token,
        health: nextClient?.health ?? current.auth.health,
      },
      quota: {
        ...current.quota,
        value: nextClient?.quota ?? current.quota.value,
      },
    }));
  }

  function setConnectionState(connectionState: PhoneClientConnectionState) {
    updateConnection({ connectionState });
  }

  function setLastEnvelope(envelope: PhoneEnvelope | null) {
    updateConnection({ lastEnvelope: envelope });
  }

  function setToken(token: string) {
    updateSection('auth', (auth) => ({ ...auth, token }));
  }

  function setHealth(health: PhoneHealth | null) {
    store.update((current) => ({
      ...current,
      auth: { ...current.auth, health },
      connection: current.connection.client
        ? { ...current.connection, client: { ...current.connection.client, health } }
        : current.connection,
    }));
  }

  function setLoginOpen(loginOpen: boolean) {
    updateSection('auth', (auth) => ({ ...auth, loginOpen }));
  }

  function setAuthError(authError: string) {
    updateSection('auth', (auth) => ({ ...auth, authError }));
  }

  function markAuthRequired(message = 'Access token required. Enter the current /phone-start token.') {
    store.update((current) => ({
      ...current,
      auth: { ...current.auth, loginOpen: true, authError: message },
      connection: { ...current.connection, connectionState: 'auth-required' },
      feedback: { ...current.feedback, banner: { text: message, kind: 'error' } },
    }));
  }

  function clearAuthError() {
    setAuthError('');
  }

  function setStatus(status: PhoneStatus | null) {
    store.update((current) => ({
      ...current,
      status,
      messages: {
        ...current.messages,
        liveAssistant: current.messages.liveAssistant,
      },
    }));
  }

  function setSessionCatalog(catalog: PhoneSessionCatalog | null | undefined) {
    store.update((current) => ({
      ...current,
      sessions: {
        ...current.sessions,
        active: catalog?.sessions ? [...catalog.sessions] : [],
        activeSessionId: catalog?.activeSessionId ?? current.sessions.activeSessionId,
      },
    }));
  }

  function setActiveSessions(sessions: PhoneSessionSummary[], activeSessionId?: string | null) {
    updateSection('sessions', (section) => ({
      ...section,
      active: [...sessions],
      activeSessionId: activeSessionId === undefined ? section.activeSessionId : activeSessionId,
    }));
  }

  function setSavedSessions(sessions: PhoneSavedSession[]) {
    updateSection('sessions', (section) => ({ ...section, saved: [...sessions] }));
  }

  function setActiveSessionId(activeSessionId: string | null) {
    updateSection('sessions', (section) => ({ ...section, activeSessionId }));
  }

  function setSnapshot(snapshotState: PhoneSnapshotState | null, workerId?: string | null) {
    store.update((current) => ({
      ...current,
      snapshot: {
        state: snapshotState,
        workerId: workerId === undefined ? current.snapshot.workerId : workerId,
      },
      status: current.status && snapshotState
        ? { ...current.status, isStreaming: Boolean(snapshotState.isStreaming) }
        : current.status,
    }));
  }

  function clearTransientState() {
    store.update((current) => ({
      ...current,
      messages: { ...current.messages, liveAssistant: null },
      tools: { ...current.tools, live: new Map() },
    }));
  }

  function clearSnapshotView() {
    store.update((current) => ({
      ...current,
      snapshot: { state: null, workerId: null },
      messages: { ...current.messages, items: [], liveAssistant: null },
      tools: { ...current.tools, live: new Map() },
    }));
  }

  function setMessages(messages: PhoneUiMessage[]) {
    updateSection('messages', (section) => ({ ...section, items: [...messages] }));
  }

  function appendMessages(messages: PhoneUiMessage[]) {
    if (!messages.length) return;
    updateSection('messages', (section) => ({ ...section, items: [...section.items, ...messages] }));
  }

  function setLiveAssistant(message: PhoneUiMessage | null) {
    updateSection('messages', (section) => ({ ...section, liveAssistant: message }));
  }

  function updateLiveAssistant(updater: (message: PhoneUiMessage | null) => PhoneUiMessage | null) {
    updateSection('messages', (section) => ({ ...section, liveAssistant: updater(section.liveAssistant) }));
  }

  function setFollowLatest(followLatest: boolean) {
    updateSection('messages', (section) => ({
      ...section,
      followLatest,
      lastAutoFollowAt: followLatest ? 0 : section.lastAutoFollowAt,
      lastAutoFollowHeight: followLatest ? 0 : section.lastAutoFollowHeight,
    }));
  }

  function updateScrollFlags(patchValue: Partial<Omit<PhoneMessagesState, 'items' | 'liveAssistant'>>) {
    updateSection('messages', (section) => ({ ...section, ...patchValue }));
  }

  function setLiveTools(tools: Map<string, PhoneUiToolMessage> | Iterable<[string, PhoneUiToolMessage]>) {
    updateSection('tools', (section) => ({ ...section, live: new Map(tools) }));
  }

  function upsertLiveTool(toolId: string, tool: PhoneUiToolMessage) {
    updateSection('tools', (section) => {
      const live = new Map(section.live);
      live.set(toolId, tool);
      return { ...section, live };
    });
  }

  function removeLiveTool(toolId: string) {
    updateSection('tools', (section) => {
      if (!section.live.has(toolId)) return section;
      const live = new Map(section.live);
      live.delete(toolId);
      return { ...section, live };
    });
  }

  function setToolPanelOpen(toolId: string, open: boolean) {
    updateSection('tools', (section) => {
      const panelOpen = new Map(section.panelOpen);
      panelOpen.set(toolId, open);
      return { ...section, panelOpen };
    });
  }

  function setSelectedToolId(toolId: string | null) {
    updateSection('tools', (section) => ({ ...section, selectedToolId: toolId }));
  }

  function setCommands(commands: PhoneCommand[]) {
    updateSection('commands', () => ({ available: [...commands] }));
  }

  function setCommandSheetCategory(category: string) {
    updateSection('sheets', (section) => ({ ...section, commandCategory: category }));
  }

  function setModels(models: PhoneModel[]) {
    updateSection('models', () => ({ available: [...models] }));
  }

  function setSheetMode(mode: PhoneSheetMode, options: { open?: boolean } = {}) {
    updateSection('sheets', (section) => ({
      ...section,
      mode,
      open: options.open ?? section.open,
    }));
  }

  function setSheetOpen(open: boolean) {
    updateSection('sheets', (section) => ({ ...section, open }));
  }

  function recordSheetPointerAction(action: string, at = Date.now()) {
    updateSection('sheets', (section) => ({ ...section, lastPointerAction: action, lastPointerActionAt: at }));
  }

  function setComposerText(text: string) {
    updateSection('composer', (section) => ({ ...section, text }));
  }

  function updateComposer(patchValue: Partial<PhoneComposerState>) {
    updateSection('composer', (section) => ({ ...section, ...patchValue }));
  }

  function resetComposer() {
    updateSection('composer', () => ({ text: '', isSubmitting: false, steerAvailable: false }));
  }

  function allocateAttachmentTokenId() {
    let tokenId = 1;
    updateSection('attachments', (section) => {
      tokenId = section.nextTokenId;
      return { ...section, nextTokenId: tokenId + 1 };
    });
    return tokenId;
  }

  function setAttachments(attachments: PhoneAttachmentRecord[]) {
    updateSection('attachments', (section) => ({ ...section, items: [...attachments] }));
  }

  function addAttachments(attachments: PhoneAttachmentRecord[]) {
    if (!attachments.length) return;
    updateSection('attachments', (section) => ({ ...section, items: [...section.items, ...attachments] }));
  }

  function removeAttachment(id: string) {
    let removed: PhoneAttachmentRecord | null = null;
    updateSection('attachments', (section) => {
      const items = section.items.filter((attachment) => {
        if (attachment.id !== id) return true;
        removed = attachment;
        return false;
      });
      return items.length === section.items.length ? section : { ...section, items };
    });
    return removed;
  }

  function clearAttachments() {
    let removed: PhoneAttachmentRecord[] = [];
    updateSection('attachments', (section) => {
      removed = [...section.items];
      return { ...section, items: [] };
    });
    return removed;
  }

  function setNextAttachmentTokenId(nextTokenId: number) {
    updateSection('attachments', (section) => ({ ...section, nextTokenId: Math.max(1, Math.floor(nextTokenId) || 1) }));
  }

  function setAutocompleteContext(context: PhoneAutocompleteContext | null) {
    updateSection('autocomplete', (section) => ({ ...section, context }));
  }

  function setAutocompleteItems(items: PhoneAutocompleteItem[]) {
    updateSection('autocomplete', (section) => ({ ...section, items: [...items] }));
  }

  function beginAutocompleteRequest() {
    let requestId = 0;
    updateSection('autocomplete', (section) => {
      requestId = section.remoteRequestId + 1;
      return { ...section, remoteRequestId: requestId };
    });
    return requestId;
  }

  function setAutocompleteRemoteRequestId(requestId: number) {
    updateSection('autocomplete', (section) => ({ ...section, remoteRequestId: requestId }));
  }

  function setAutocompleteTimer(timer: ReturnType<typeof setTimeout> | null) {
    updateSection('autocomplete', (section) => {
      if (section.remoteTimer && section.remoteTimer !== timer) clearTimeout(section.remoteTimer);
      return { ...section, remoteTimer: timer };
    });
  }

  function clearAutocompleteTimer() {
    setAutocompleteTimer(null);
  }

  function clearAutocomplete() {
    updateSection('autocomplete', (section) => {
      clearTimer(section.remoteTimer);
      return { ...section, context: null, items: [], remoteTimer: null };
    });
  }

  function setQuota(quota: PhoneQuotaResponse | null) {
    updateSection('quota', (section) => ({ ...section, value: quota }));
  }

  function beginQuotaRequest() {
    let requestId = 0;
    updateSection('quota', (section) => {
      requestId = section.requestId + 1;
      return { ...section, requestId };
    });
    return requestId;
  }

  function setQuotaRequestId(requestId: number) {
    updateSection('quota', (section) => ({ ...section, requestId }));
  }

  function setPendingUiRequest(request: PhoneExtensionUiRequest | null) {
    updateSection('uiRequests', (section) => ({ ...section, pending: request }));
  }

  function clearPendingUiRequest() {
    setPendingUiRequest(null);
  }

  function setUiRequestDraft(request: PhoneExtensionUiRequest | null | undefined, value: string) {
    const key = uiRequestKey(request);
    if (!key) return;
    updateSection('uiRequests', (section) => {
      const modalDrafts = new Map(section.modalDrafts);
      modalDrafts.set(key, value);
      return { ...section, modalDrafts };
    });
  }

  function forgetUiRequestDraft(request: PhoneExtensionUiRequest | null | undefined) {
    const key = uiRequestKey(request);
    if (!key) return;
    updateSection('uiRequests', (section) => {
      if (!section.modalDrafts.has(key)) return section;
      const modalDrafts = new Map(section.modalDrafts);
      modalDrafts.delete(key);
      return { ...section, modalDrafts };
    });
  }

  function clearUiRequestDrafts() {
    updateSection('uiRequests', (section) => ({ ...section, modalDrafts: new Map() }));
  }

  function setWidget(key: string, lines: string[] | null | undefined) {
    updateSection('uiRequests', (section) => {
      const widgets = cloneWidgetMap(section.widgets);
      if (lines?.length) widgets.set(key || 'widget', [...lines]);
      else widgets.delete(key || 'widget');
      return { ...section, widgets };
    });
  }

  function clearWidgets() {
    updateSection('uiRequests', (section) => ({ ...section, widgets: new Map() }));
  }

  function setFooterStatus(status: string) {
    updateSection('uiRequests', (section) => ({ ...section, footerStatus: status }));
  }

  function setStats(stats: PhoneStats | null) {
    store.update((current) => ({ ...current, stats }));
  }

  function setTree(tree: PhoneTree | null) {
    store.update((current) => ({ ...current, tree }));
  }

  function setBanner(text: string, kind: PhoneNoticeKind = 'info', options: PhoneSetBannerOptions = {}) {
    const cleanText = text.trim();
    const notice = cleanText ? { text: cleanText, kind } : null;
    store.update((current) => ({
      ...current,
      feedback: { ...current.feedback, banner: notice },
      connection: options.mirrorToConnection === false ? current.connection : { ...current.connection, banner: notice },
    }));
  }

  function clearBanner() {
    setBanner('');
  }

  function setNotification(text: string, kind: PhoneNoticeKind = 'info') {
    const cleanText = text.trim();
    const notice = cleanText ? { text: cleanText, kind } : null;
    store.update((current) => {
      if (!notice) return { ...current, connection: { ...current.connection, notification: null } };
      const id = `toast-${current.feedback.nextToastId}`;
      return {
        ...current,
        connection: { ...current.connection, notification: notice },
        feedback: {
          ...current.feedback,
          nextToastId: current.feedback.nextToastId + 1,
          toasts: [
            ...current.feedback.toasts,
            {
              id,
              ...notice,
              createdAt: Date.now(),
              ttlMs: 3500,
            },
          ],
        },
      };
    });
  }

  function pushToast(text: string, kind: PhoneNoticeKind = 'info', options: PhoneToastOptions = {}) {
    const cleanText = text.trim();
    if (!cleanText) return null;
    let id = options.id || '';
    store.update((current) => {
      id = id || `toast-${current.feedback.nextToastId}`;
      const nextToastId = id.startsWith('toast-') ? current.feedback.nextToastId + 1 : current.feedback.nextToastId;
      return {
        ...current,
        feedback: {
          ...current.feedback,
          nextToastId,
          toasts: [
            ...current.feedback.toasts,
            {
              id,
              text: cleanText,
              kind,
              createdAt: options.createdAt ?? Date.now(),
              ttlMs: options.ttlMs ?? 3500,
            },
          ],
        },
      };
    });
    return id;
  }

  function dismissToast(id: string) {
    updateSection('feedback', (feedback) => ({
      ...feedback,
      toasts: feedback.toasts.filter((toast) => toast.id !== id),
    }));
  }

  function clearToasts() {
    updateSection('feedback', (feedback) => ({ ...feedback, toasts: [] }));
  }

  return {
    subscribe: store.subscribe,
    snapshot,
    reset,
    replace,
    patch,
    update,
    setClientState,
    updateConnection,
    setConnectionState,
    setLastEnvelope,
    setToken,
    setHealth,
    setLoginOpen,
    setAuthError,
    markAuthRequired,
    clearAuthError,
    setStatus,
    setSessionCatalog,
    setActiveSessions,
    setSavedSessions,
    setActiveSessionId,
    setSnapshot,
    clearSnapshotView,
    setMessages,
    appendMessages,
    setLiveAssistant,
    updateLiveAssistant,
    setFollowLatest,
    updateScrollFlags,
    setLiveTools,
    upsertLiveTool,
    removeLiveTool,
    clearTransientState,
    setToolPanelOpen,
    setSelectedToolId,
    setCommands,
    setCommandSheetCategory,
    setModels,
    setSheetMode,
    setSheetOpen,
    recordSheetPointerAction,
    setComposerText,
    updateComposer,
    resetComposer,
    allocateAttachmentTokenId,
    setAttachments,
    addAttachments,
    removeAttachment,
    clearAttachments,
    setNextAttachmentTokenId,
    setAutocompleteContext,
    setAutocompleteItems,
    beginAutocompleteRequest,
    setAutocompleteRemoteRequestId,
    setAutocompleteTimer,
    clearAutocompleteTimer,
    clearAutocomplete,
    setQuota,
    beginQuotaRequest,
    setQuotaRequestId,
    setPendingUiRequest,
    clearPendingUiRequest,
    uiRequestKey,
    setUiRequestDraft,
    forgetUiRequestDraft,
    clearUiRequestDrafts,
    setWidget,
    clearWidgets,
    setFooterStatus,
    setStats,
    setTree,
    setBanner,
    clearBanner,
    setNotification,
    pushToast,
    dismissToast,
    clearToasts,
  };
}

export const piPhoneState = createPiPhoneStateStore();

// Envelope/RPC reducers live in actions/envelope-handlers.ts.
// Transport ownership remains in PhoneClient; this module stores data and UI state only.
