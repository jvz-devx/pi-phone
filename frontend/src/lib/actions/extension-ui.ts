import { phoneClient, type PhoneClient } from '$lib/pi-phone-transport';
import { piPhoneState, type PhoneAppState, type PhoneStateStore } from '$lib/stores/pi-phone-state';
import type { PhoneExtensionUiRequest, PhoneExtensionUiResponse } from '$lib/types/pi-phone';

export type PhoneExtensionUiClient = Pick<PhoneClient, 'sendRpc'>;
export type ExtensionUiResponsePayload = Omit<PhoneExtensionUiResponse, 'type' | 'sessionWorkerId'>;

export function extensionUiRequestKey(request: PhoneExtensionUiRequest | null | undefined) {
  if (!request || request.id == null) return '';
  return `${request.sessionWorkerId || ''}:${request.id}`;
}

export function extensionUiDraftValue(state: PhoneAppState, request: PhoneExtensionUiRequest | null | undefined) {
  const key = extensionUiRequestKey(request);
  const draft = key ? state.uiRequests.modalDrafts.get(key) : undefined;
  const prefill = typeof (request as { prefill?: unknown } | null | undefined)?.prefill === 'string'
    ? String((request as { prefill?: unknown }).prefill)
    : '';
  return draft ?? prefill;
}

export function isExtensionUiRequestOwnedByActiveSession(state: PhoneAppState, request: PhoneExtensionUiRequest | null | undefined) {
  if (!request?.sessionWorkerId || !state.sessions.activeSessionId) return true;
  return request.sessionWorkerId === state.sessions.activeSessionId;
}

export function persistExtensionUiDraft(
  request: PhoneExtensionUiRequest | null | undefined,
  value: string,
  options: { store?: PhoneStateStore } = {},
) {
  const store = options.store || piPhoneState;
  if (!request || !['input', 'editor'].includes(request.method)) return;
  store.setUiRequestDraft(request, value);
}

export function clearPendingExtensionUiRequest(options: { store?: PhoneStateStore; discardDraft?: boolean } = {}) {
  const store = options.store || piPhoneState;
  const pending = store.snapshot().uiRequests.pending;
  if (options.discardDraft) store.forgetUiRequestDraft(pending);
  store.clearPendingUiRequest();
}

export function sendExtensionUiResponse(
  payload: ExtensionUiResponsePayload,
  options: { store?: PhoneStateStore; client?: PhoneExtensionUiClient } = {},
) {
  const store = options.store || piPhoneState;
  const client = options.client || phoneClient;
  const state = store.snapshot();
  const pending = state.uiRequests.pending;
  const pendingId = pending?.id == null ? '' : String(pending.id);
  const responseId = payload.id == null ? '' : String(payload.id);

  if (!pending || !pendingId || !responseId || pendingId !== responseId) {
    store.clearPendingUiRequest();
    store.pushToast('That UI request is no longer pending.', 'error');
    return false;
  }

  if (!isExtensionUiRequestOwnedByActiveSession(state, pending)) {
    store.clearPendingUiRequest();
    store.pushToast('That UI request belongs to another session.', 'error');
    return false;
  }

  const response: PhoneExtensionUiResponse = {
    type: 'extension_ui_response',
    sessionWorkerId: pending.sessionWorkerId,
    ...payload,
  };

  const sent = client.sendRpc(response);
  if (!sent) return false;

  store.forgetUiRequestDraft(pending);
  store.clearPendingUiRequest();
  return true;
}

export function cancelExtensionUiRequest(
  request: PhoneExtensionUiRequest,
  options: { store?: PhoneStateStore; client?: PhoneExtensionUiClient } = {},
) {
  return sendExtensionUiResponse({ id: request.id as string | number, cancelled: true }, options);
}
