import { normalizeQuotaModel, supportsPiQuotaForModel } from '$lib/adapters/quota-context';
import type {
  PhoneClientMessage,
  PhoneClientRpcCommand,
  PhoneEnvelope,
  PhoneHealth,
  PhoneLocalCommand,
  PhoneModel,
  PhoneQuotaResponse,
} from '$lib/types/pi-phone';

export type { PhoneHealth, PhoneQuotaResponse } from '$lib/types/pi-phone';

const TOKEN_STORAGE_KEY = 'pi-phone-token';
const RECONNECT_DELAY_MS = 1800;

export type PhoneLooseEnvelope = {
  channel?: string;
  event?: string;
  data?: unknown;
  payload?: unknown;
  [key: string]: unknown;
};

export type PiPhoneEnvelope = PhoneEnvelope | PhoneLooseEnvelope;
export type PiPhoneRpcCommand = PhoneClientRpcCommand;
export type PiPhoneLocalCommand = PhoneLocalCommand;

export type PhoneModelRef = {
  provider?: PhoneModel['provider'] | null;
  id?: PhoneModel['id'] | null;
  modelId?: string | null;
  name?: PhoneModel['name'] | null;
  [key: string]: unknown;
};

export type PhoneClientConnectionState =
  | 'idle'
  | 'health-loading'
  | 'auth-required'
  | 'connecting'
  | 'open'
  | 'closed'
  | 'reconnecting'
  | 'error';

export type PhoneClientBannerLevel = 'info' | 'error' | 'warning' | 'success';

export type PhoneClientNotice = {
  message: string;
  level?: PhoneClientBannerLevel;
};

export type PhoneClientState = {
  token: string;
  health: PhoneHealth | null;
  quota: PhoneQuotaResponse | null;
  connectionState: PhoneClientConnectionState;
  socketReadyState: number | null;
  manuallyClosed: boolean;
  reconnectScheduled: boolean;
  lastClose: { code: number; reason: string; wasClean: boolean } | null;
  lastError: string;
  currentModel: PhoneModelRef | null;
};

export type PhoneClientEventMap = {
  state: PhoneClientState;
  health: PhoneHealth;
  quota: PhoneQuotaResponse | null;
  envelope: PiPhoneEnvelope;
  'invalid-message': { raw: string; error: unknown };
  open: Event;
  close: CloseEvent;
  error: Event | Error;
  'auth-failure': void;
  'auth-required': PhoneHealth;
  banner: PhoneClientNotice;
  notification: PhoneClientNotice;
  'send-blocked': { kind: PhoneClientMessage['kind']; payload?: unknown; reason: string };
};

export type PhoneClientEventName = keyof PhoneClientEventMap;
export type PhoneClientListener<K extends PhoneClientEventName> = (payload: PhoneClientEventMap[K]) => void;

export type PhoneClientOptions = {
  token?: string;
  autoStoreToken?: boolean;
  reconnectDelayMs?: number;
  onEnvelope?: (envelope: PiPhoneEnvelope) => void;
  onAuthFailure?: () => void;
  onAuthRequired?: (health: PhoneHealth) => void;
  onStateChange?: (state: PhoneClientState) => void;
  onBanner?: (notice: PhoneClientNotice) => void;
  onNotification?: (notice: PhoneClientNotice) => void;
};

export type PhoneReloadGuardState = {
  status?: { isStreaming?: boolean } | null;
  snapshotState?: { isStreaming?: boolean; isCompacting?: boolean } | null;
  isStreaming?: boolean;
  isCompacting?: boolean;
};

export type PiPhoneSocketOptions = {
  token?: string;
  onOpen?: (event: Event) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
  onMessage?: (envelope: PiPhoneEnvelope, event: MessageEvent<string>) => void;
};

type ClientOutboundMessage = PhoneClientMessage;

export class PhoneHttpError extends Error {
  status: number;
  statusText: string;

  constructor(response: Response, message = `Request failed (${response.status})`) {
    super(message);
    this.name = 'PhoneHttpError';
    this.status = response.status;
    this.statusText = response.statusText;
  }
}

export class PhoneAuthError extends Error {
  constructor(message = 'The token was rejected. Enter the current /phone-start token.') {
    super(message);
    this.name = 'PhoneAuthError';
  }
}

const listenerKeys: PhoneClientEventName[] = [
  'state',
  'health',
  'quota',
  'envelope',
  'invalid-message',
  'open',
  'close',
  'error',
  'auth-failure',
  'auth-required',
  'banner',
  'notification',
  'send-blocked',
];

export function readStoredToken() {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
}

export function storeToken(token: string) {
  if (typeof localStorage === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function tokenHeaders(token = readStoredToken()) {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

function browserOrigin() {
  return typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
}

function makeApiUrl(path: string, token?: string) {
  const url = new URL(path, browserOrigin());
  if (token) url.searchParams.set('token', token);
  return url;
}

function makeWebSocketUrl(token?: string) {
  if (typeof window === 'undefined') {
    throw new Error('WebSocket transport is only available in the browser.');
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(`${protocol}//${window.location.host}/ws`);
  if (token) url.searchParams.set('token', token);
  return url;
}

function healthError(response: Response) {
  return new PhoneHttpError(response, `Health check failed (${response.status})`);
}

function isTokenRejectedHealth(health: PhoneHealth | null | undefined) {
  return Boolean(health?.hasToken && !health?.cwd);
}

function cloneState(state: PhoneClientState): PhoneClientState {
  return { ...state, lastClose: state.lastClose ? { ...state.lastClose } : null };
}

async function fetchHealthForToken(token = readStoredToken()) {
  const url = makeApiUrl('/api/health', token);
  const response = await fetch(url, {
    headers: tokenHeaders(token),
    cache: 'no-store',
  });

  if (!response.ok) throw healthError(response);
  return (await response.json()) as PhoneHealth;
}

export async function fetchHealth(token = readStoredToken()) {
  return fetchHealthForToken(token);
}

export function createPiPhoneSocket(options: PiPhoneSocketOptions = {}) {
  const token = options.token ?? readStoredToken();
  const socket = new WebSocket(makeWebSocketUrl(token));
  socket.addEventListener('open', (event) => options.onOpen?.(event));
  socket.addEventListener('close', (event) => options.onClose?.(event));
  socket.addEventListener('error', (event) => options.onError?.(event));
  socket.addEventListener('message', (event: MessageEvent<string>) => {
    try {
      options.onMessage?.(JSON.parse(event.data) as PiPhoneEnvelope, event);
    } catch {
      options.onMessage?.({ channel: 'client', event: 'invalid-json', data: event.data }, event);
    }
  });

  return socket;
}

export async function validateToken(nextToken: string) {
  let health: PhoneHealth;
  try {
    health = await fetchHealthForToken(nextToken);
  } catch (error) {
    if (error instanceof PhoneHttpError && (error.status === 401 || error.status === 403)) {
      throw new PhoneAuthError();
    }
    throw error;
  }

  if (isTokenRejectedHealth(health)) throw new PhoneAuthError();
  return health;
}

export class PhoneClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private quotaRequestId = 0;
  private listeners: { [K in PhoneClientEventName]: Set<PhoneClientListener<K>> };
  private readonly autoStoreToken: boolean;
  private readonly reconnectDelayMs: number;
  private readonly callbacks: PhoneClientOptions;

  state: PhoneClientState;

  constructor(options: PhoneClientOptions = {}) {
    this.callbacks = options;
    this.autoStoreToken = options.autoStoreToken ?? true;
    this.reconnectDelayMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS;
    this.listeners = Object.fromEntries(listenerKeys.map((key) => [key, new Set()])) as {
      [K in PhoneClientEventName]: Set<PhoneClientListener<K>>;
    };
    this.state = {
      token: options.token ?? readStoredToken(),
      health: null,
      quota: null,
      connectionState: 'idle',
      socketReadyState: null,
      manuallyClosed: false,
      reconnectScheduled: false,
      lastClose: null,
      lastError: '',
      currentModel: null,
    };
  }

  on<K extends PhoneClientEventName>(eventName: K, listener: PhoneClientListener<K>) {
    this.listeners[eventName].add(listener);
    return () => this.off(eventName, listener);
  }

  off<K extends PhoneClientEventName>(eventName: K, listener: PhoneClientListener<K>) {
    this.listeners[eventName].delete(listener);
  }

  snapshot() {
    return cloneState(this.state);
  }

  setToken(token: string, options: { store?: boolean } = {}) {
    this.state.token = token;
    if (options.store ?? this.autoStoreToken) storeToken(token);
    this.emitState();
  }

  clearToken(options: { store?: boolean } = {}) {
    this.setToken('', options);
  }

  setCurrentModel(model: PhoneModelRef | null | undefined) {
    this.state.currentModel = model ? { ...model } : null;
    this.emitState();
  }

  async validateToken(nextToken: string) {
    return validateToken(nextToken);
  }

  async acceptToken(nextToken: string, options: { connect?: boolean; store?: boolean } = {}) {
    const health = await this.validateToken(nextToken);
    this.setToken(nextToken, { store: options.store });
    this.setHealth(health);
    if (options.connect ?? true) this.connect();
    return health;
  }

  async loadHealth(token = this.state.token) {
    this.setConnectionState('health-loading');
    const health = await fetchHealthForToken(token);
    this.setHealth(health);
    return health;
  }

  async boot() {
    try {
      await this.loadHealth();
    } catch (error) {
      if (this.state.token && this.isAuthStatusError(error)) {
        this.handleAuthFailure();
        return;
      }
      this.setConnectionState('error');
      this.emitError(error instanceof Error ? error : new Error(String(error)));
      this.emitBanner(error instanceof Error ? error.message : 'Failed to reach server.', 'error');
      if (!this.state.manuallyClosed) this.scheduleReconnect();
      return;
    }

    this.clearReconnectTimer();

    if (this.state.token && isTokenRejectedHealth(this.state.health)) {
      this.handleAuthFailure();
      return;
    }

    if (this.state.health?.hasToken && !this.state.token) {
      this.setConnectionState('auth-required');
      this.callbacks.onAuthRequired?.(this.state.health);
      this.emit('auth-required', this.state.health);
    } else {
      this.connect();
    }

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  connect() {
    this.clearReconnectTimer();
    this.state.manuallyClosed = false;

    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      this.updateSocketReadyState();
      return this.socket;
    }

    const socket = new WebSocket(makeWebSocketUrl(this.state.token));
    this.socket = socket;
    this.setConnectionState('connecting');

    socket.addEventListener('open', (event) => {
      if (this.socket !== socket) return;
      this.clearReconnectTimer();
      this.state.lastError = '';
      this.setConnectionState('open');
      this.emitBanner('', 'info');
      this.emit('open', event);
      this.refreshAll();
    });

    socket.addEventListener('message', (event: MessageEvent<string>) => {
      if (this.socket !== socket) return;
      try {
        const envelope = JSON.parse(event.data) as PiPhoneEnvelope;
        this.callbacks.onEnvelope?.(envelope);
        this.emit('envelope', envelope);
      } catch (error) {
        this.emit('invalid-message', { raw: event.data, error });
        this.emitNotification('Received malformed data from server.', 'error');
      }
    });

    socket.addEventListener('close', (event) => {
      if (this.socket === socket) this.socket = null;
      this.state.lastClose = { code: event.code, reason: event.reason, wasClean: event.wasClean };
      this.updateSocketReadyState();
      this.emit('close', event);

      if (this.state.manuallyClosed) {
        this.setConnectionState('closed');
        return;
      }

      if (event.code === 4009) {
        this.setConnectionState('closed');
        this.emitBanner('This Pi Phone instance was opened from another device or tab.', 'error');
        return;
      }

      if (event.code === 4010) {
        this.setConnectionState('closed');
        this.emitBanner('Pi Phone stopped due to inactivity. Run /phone-start again when needed.', 'error');
        return;
      }

      if (event.code === 1008) {
        this.handleAuthFailure();
        return;
      }

      if (event.code === 1006) {
        this.emitBanner('Connection lost. Retrying…', 'error');
      }

      this.scheduleReconnect();
    });

    socket.addEventListener('error', (event) => {
      if (this.socket !== socket) return;
      this.updateSocketReadyState();
      this.emit('error', event);
    });

    return socket;
  }

  close(options: { manual?: boolean; code?: number; reason?: string } = {}) {
    const manual = options.manual ?? true;
    if (manual) this.state.manuallyClosed = true;
    this.clearReconnectTimer();

    const socket = this.socket;
    this.socket = null;

    if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
      socket.close(options.code ?? 1000, options.reason ?? 'client-close');
    }

    this.setConnectionState('closed');
  }

  sendRpc(command: PiPhoneRpcCommand) {
    return this.send({ kind: 'rpc', command });
  }

  sendLocalCommand(command: PiPhoneLocalCommand) {
    return this.send({ kind: 'local-command', command });
  }

  sendRefresh() {
    return this.send({ kind: 'refresh' });
  }

  sendSessionSelect(sessionId: string) {
    return this.send({ kind: 'session-select', sessionId });
  }

  sendParentSessionNew() {
    return this.send({ kind: 'session-parent-new' });
  }

  sendSessionSpawn() {
    return this.send({ kind: 'session-spawn' });
  }

  requestReload(guard: PhoneReloadGuardState = {}) {
    const isStreaming = Boolean(guard.isStreaming ?? guard.status?.isStreaming ?? guard.snapshotState?.isStreaming);
    if (isStreaming) {
      this.emitNotification('Wait for the current response to finish before reloading.', 'error');
      return false;
    }

    const isCompacting = Boolean(guard.isCompacting ?? guard.snapshotState?.isCompacting);
    if (isCompacting) {
      this.emitNotification('Wait for compaction to finish before reloading.', 'error');
      return false;
    }

    return this.sendLocalCommand('reload');
  }

  refreshAll(options: { forceQuota?: boolean } = {}) {
    if (this.isSocketOpen()) {
      this.sendRefresh();
      this.sendRpc({ type: 'get_commands' });
      this.sendRpc({ type: 'get_available_models' });
    }

    void this.refreshQuota({ force: options.forceQuota });
  }

  async refreshQuota(options: { force?: boolean; model?: PhoneModelRef | null } = {}) {
    const model = options.model === undefined ? this.state.currentModel : options.model;
    if (options.model !== undefined) this.setCurrentModel(options.model);

    if (!supportsPiQuotaForModel(model)) {
      this.quotaRequestId += 1;
      this.state.quota = null;
      this.emit('quota', null);
      this.emitState();
      return null;
    }

    const currentModel = normalizeQuotaModel(model);
    if (!currentModel) return null;

    const requestId = ++this.quotaRequestId;

    try {
      const url = makeApiUrl('/api/quota', this.state.token);
      url.searchParams.set('provider', currentModel.provider);
      url.searchParams.set('modelId', currentModel.modelId);
      if (options.force) url.searchParams.set('force', '1');

      const response = await fetch(url, {
        headers: tokenHeaders(this.state.token),
        cache: 'no-store',
      });
      if (!response.ok) throw new PhoneHttpError(response, `Quota request failed (${response.status})`);

      const quota = (await response.json()) as PhoneQuotaResponse;
      if (requestId !== this.quotaRequestId) return this.state.quota;
      this.state.quota = quota;
      this.emit('quota', quota);
      this.emitState();
      return quota;
    } catch (error) {
      if (requestId !== this.quotaRequestId) return this.state.quota;
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      if (!this.state.quota?.visible) {
        this.state.quota = null;
        this.emit('quota', null);
      }
      this.emitState();
      return this.state.quota;
    }
  }

  private send(message: ClientOutboundMessage) {
    if (!this.isSocketOpen()) {
      const reason = 'Not connected to Pi.';
      this.emitNotification(reason, 'error');
      this.emit('send-blocked', { kind: message.kind, payload: message, reason });
      return false;
    }

    this.socket?.send(JSON.stringify(message));
    return true;
  }

  private isSocketOpen() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private scheduleReconnect() {
    if (this.state.manuallyClosed) return;

    this.clearReconnectTimer();
    this.state.reconnectScheduled = true;
    this.setConnectionState('reconnecting');

    this.reconnectTimer = setTimeout(() => {
      void this.runReconnect();
    }, this.reconnectDelayMs);
  }

  private async runReconnect() {
    this.clearReconnectTimer();

    if (this.state.token) {
      try {
        await this.loadHealth();
      } catch (error) {
        if (this.isAuthStatusError(error)) {
          this.handleAuthFailure();
          return;
        }
        this.emitError(error instanceof Error ? error : new Error(String(error)));
        this.emitBanner(error instanceof Error ? error.message : 'Failed to reach server.', 'error');
        this.scheduleReconnect();
        return;
      }

      if (isTokenRejectedHealth(this.state.health)) {
        this.handleAuthFailure();
        return;
      }
    }

    this.connect();
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) {
      this.state.reconnectScheduled = false;
      this.emitState();
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.state.reconnectScheduled = false;
    this.emitState();
  }

  private setHealth(health: PhoneHealth) {
    this.state.health = health;
    this.emit('health', health);
    this.emitState();
  }

  private setConnectionState(connectionState: PhoneClientConnectionState) {
    this.state.connectionState = connectionState;
    this.updateSocketReadyState(false);
    this.emitState();
  }

  private updateSocketReadyState(emit = true) {
    this.state.socketReadyState = this.socket?.readyState ?? null;
    if (emit) this.emitState();
  }

  private handleAuthFailure() {
    this.clearReconnectTimer();
    this.close({ manual: true });
    this.clearToken();
    this.setConnectionState('auth-required');
    this.callbacks.onAuthFailure?.();
    this.emit('auth-failure', undefined);
    this.emitBanner('Access token required. Enter the current /phone-start token.', 'error');
  }

  private isAuthStatusError(error: unknown) {
    return error instanceof PhoneHttpError && (error.status === 401 || error.status === 403);
  }

  private emitState() {
    const state = this.snapshot();
    this.callbacks.onStateChange?.(state);
    this.emit('state', state);
  }

  private emitBanner(message: string, level: PhoneClientBannerLevel = 'info') {
    const notice = { message, level };
    this.callbacks.onBanner?.(notice);
    this.emit('banner', notice);
  }

  private emitNotification(message: string, level: PhoneClientBannerLevel = 'info') {
    const notice = { message, level };
    this.callbacks.onNotification?.(notice);
    this.emit('notification', notice);
  }

  private emitError(error: Error) {
    this.state.lastError = error.message;
    this.emit('error', error);
    this.emitState();
  }

  private emit<K extends PhoneClientEventName>(eventName: K, payload: PhoneClientEventMap[K]) {
    for (const listener of this.listeners[eventName]) {
      listener(payload);
    }
  }
}

export const phoneClient = new PhoneClient();
