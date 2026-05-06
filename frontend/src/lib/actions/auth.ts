import { PhoneAuthError, readStoredToken, storeToken as persistToken, type PhoneHealth } from '$lib/pi-phone-transport';
import type { PhoneStateStore } from '$lib/stores/pi-phone-state';

const AUTH_REQUIRED_MESSAGE = 'Access token required. Enter the current /phone-start token.';
const EMPTY_TOKEN_MESSAGE = 'Enter the current /phone-start token.';

export type LoginTokenFragmentResult = {
  token: string | null;
  nextHash: string;
  stripped: boolean;
};

export type LoginTokenUrlResult = {
  token: string | null;
  nextPath: string;
  stripped: boolean;
};

export type PhoneLoginClient = {
  acceptToken(nextToken: string, options?: { connect?: boolean; store?: boolean }): Promise<PhoneHealth>;
};

export type SubmitLoginTokenResult =
  | { ok: true; token: string; health: PhoneHealth }
  | { ok: false; error: string };

function decodeParameterPart(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

export function consumeTokenFromFragment(hash: string): LoginTokenFragmentResult {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!fragment) return { token: null, nextHash: hash, stripped: false };

  const keptParts: string[] = [];
  let token: string | null = null;
  let stripped = false;

  for (const part of fragment.split('&')) {
    const equalsIndex = part.indexOf('=');
    const rawKey = equalsIndex === -1 ? part : part.slice(0, equalsIndex);
    const rawValue = equalsIndex === -1 ? '' : part.slice(equalsIndex + 1);

    if (decodeParameterPart(rawKey) === 'token') {
      if (token === null) token = decodeParameterPart(rawValue);
      stripped = true;
      continue;
    }

    keptParts.push(part);
  }

  return {
    token,
    nextHash: keptParts.length ? `#${keptParts.join('&')}` : '',
    stripped,
  };
}

export function consumeLoginTokenFromUrl(href: string, base = 'http://localhost'): LoginTokenUrlResult {
  const url = new URL(href, base);
  const fragmentToken = consumeTokenFromFragment(url.hash);
  const queryToken = url.searchParams.get('token');
  const token = fragmentToken.token ?? queryToken;
  const stripped = fragmentToken.stripped || queryToken !== null;

  if (stripped) {
    url.searchParams.delete('token');
    url.hash = fragmentToken.nextHash;
  }

  return {
    token,
    nextPath: `${url.pathname}${url.search}${url.hash}` || '/',
    stripped,
  };
}

export function consumeLoginTokenFromCurrentUrl() {
  if (typeof window === 'undefined') return null;

  const result = consumeLoginTokenFromUrl(window.location.href, window.location.origin);
  if (!result.stripped) return null;

  if (result.token !== null) persistToken(result.token);
  window.history.replaceState({}, document.title, result.nextPath || '/');
  return result.token;
}

function loginErrorMessage(error: unknown) {
  if (error instanceof PhoneAuthError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error || AUTH_REQUIRED_MESSAGE);
}

export async function submitLoginToken(
  token: string,
  options: {
    client: PhoneLoginClient;
    stateStore: PhoneStateStore;
    connect?: boolean;
    store?: boolean;
  },
): Promise<SubmitLoginTokenResult> {
  const nextToken = token.trim();
  if (!nextToken) {
    options.stateStore.setAuthError(EMPTY_TOKEN_MESSAGE);
    options.stateStore.setLoginOpen(true);
    options.stateStore.pushToast(EMPTY_TOKEN_MESSAGE, 'error');
    return { ok: false, error: EMPTY_TOKEN_MESSAGE };
  }

  try {
    const health = await options.client.acceptToken(nextToken, {
      connect: options.connect ?? true,
      store: options.store,
    });
    options.stateStore.setToken(nextToken);
    options.stateStore.setHealth(health);
    options.stateStore.setLoginOpen(false);
    options.stateStore.clearAuthError();
    options.stateStore.clearBanner();
    return { ok: true, token: nextToken, health };
  } catch (error) {
    const message = loginErrorMessage(error);
    options.stateStore.setAuthError(message);
    options.stateStore.setLoginOpen(true);
    options.stateStore.pushToast(message, 'error');
    return { ok: false, error: message };
  }
}
