import 'server-only';
import { GoogleCalendarOAuthError, googleCalendarOAuthClient, googleCalendarOAuthIssuer, googleCalendarOAuthScope } from './google-calendar-oauth.ts';
import type { GoogleCalendarExchangeMaterial } from './google-calendar-oauth.ts';

const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const revokeEndpoint = 'https://oauth2.googleapis.com/revoke';
const maxBody = 16_384;
const bearer = /^[A-Za-z0-9._~+/=-]{1,4096}$/;
type Kind = 'exchange' | 'refresh' | 'revoke';
type Failure = Readonly<{ state: 'paused' | 'delayed' | 'reconnect' | 'review' | 'uncertain' }>;
type Admission = Readonly<{ kind: 'exchange'; attemptId: string }> |
  Readonly<{ kind: 'refresh' | 'revoke'; retained: GoogleCalendarGrant }>;
type TokenResult = Failure | Readonly<{ state: 'granted'; grant: GoogleCalendarGrant }>;

class GoogleCalendarGrant {
  #accessToken: string;
  #refreshToken: string;
  readonly clientId: string;
  readonly expiresAt: number;
  readonly refreshExpiresAt: number | null;

  constructor(input: Readonly<{ clientId: string; accessToken: string; refreshToken: string; expiresAt: number; refreshExpiresAt: number | null }>) {
    this.clientId = input.clientId;
    this.#accessToken = input.accessToken;
    this.#refreshToken = input.refreshToken;
    this.expiresAt = input.expiresAt;
    this.refreshExpiresAt = input.refreshExpiresAt;
    Object.freeze(this);
  }

  forPrivateCredentialStore() {
    return Object.freeze({ clientId: this.clientId, accessToken: this.#accessToken, refreshToken: this.#refreshToken,
      scope: googleCalendarOAuthScope, expiresAt: this.expiresAt, refreshExpiresAt: this.refreshExpiresAt });
  }

  toJSON(): never { throw new GoogleCalendarOAuthError(); }
}

export type GoogleCalendarStoredGrant = ReturnType<GoogleCalendarGrant['forPrivateCredentialStore']>;
export type GoogleCalendarRetainedGrant = GoogleCalendarGrant;
type StoredGrant = GoogleCalendarStoredGrant;

function validExpiry(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function boundedSeconds(value: unknown, max: number): value is number {
  return validExpiry(value) && value <= max;
}

function isBearer(value: unknown): value is string {
  return typeof value === 'string' && bearer.test(value);
}

export function parseGoogleCalendarStoredGrant(input: unknown, clientId: string): StoredGrant {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new GoogleCalendarOAuthError();
  const fields = ['clientId', 'scope', 'accessToken', 'refreshToken', 'expiresAt', 'refreshExpiresAt'];
  if (Object.keys(input).length !== fields.length || !fields.every(field => Object.hasOwn(input, field))) throw new GoogleCalendarOAuthError();
  const { clientId: storedClient, scope, accessToken, refreshToken, expiresAt, refreshExpiresAt } = input as Record<string, unknown>;
  if (storedClient !== clientId || scope !== googleCalendarOAuthScope || !isBearer(accessToken) || !isBearer(refreshToken) ||
    !validExpiry(expiresAt) || !(refreshExpiresAt === null || validExpiry(refreshExpiresAt))) throw new GoogleCalendarOAuthError();
  return Object.freeze({ clientId, accessToken, refreshToken, scope, expiresAt, refreshExpiresAt });
}

async function readReply(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  const length = response.headers.get('content-length');
  if (!/^application\/json\s*(?:;|$)/i.test(response.headers.get('content-type') ?? '') ||
    (length !== null && (!/^\d{1,5}$/.test(length) || Number(length) > maxBody)) || !response.body) throw new GoogleCalendarOAuthError();
  const reader = response.body.getReader();
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0, text = '';
    for (;;) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBody) throw new GoogleCalendarOAuthError();
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    // OAuth replies used here are flat scalars. Reject duplicate keys before
    // JSON.parse would silently choose the last scope, token or error value.
    const members = text.trim().slice(1, -1).trim();
    const fields = members.matchAll(/\s*"((?:[^"\\]|\\.)*)"\s*:\s*(?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)\s*(?:,|$)/g);
    let end = 0;
    const names = new Set<string>();
    for (const field of fields) {
      const name = JSON.parse('"' + field[1] + '"') as string;
      if (field.index !== end || names.has(name)) throw new GoogleCalendarOAuthError();
      names.add(name);
      end += field[0].length;
    }
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GoogleCalendarOAuthError();
    if (end !== members.length || names.size !== Object.keys(value).length) throw new GoogleCalendarOAuthError();
    return value as Record<string, unknown>;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function classifiedError(status: number, reply: Record<string, unknown>): Failure {
  if (status === 400 && reply.error === 'invalid_grant') return { state: 'reconnect' };
  if ((status === 400 || status === 403) && (reply.error === 'temporarily_unavailable' || reply.error === 'rate_limit_exceeded')) {
    return { state: 'delayed' };
  }
  return { state: 'review' };
}

function granted(reply: Record<string, unknown>, clientId: string, observedAt: number, previous?: StoredGrant): TokenResult {
  const { access_token, expires_in, refresh_token, refresh_token_expires_in, scope, token_type } = reply;
  // A refresh response can omit scope or a replacement refresh token. The
  // prior grant must already have been verified for this exact client/scope.
  if (scope !== googleCalendarOAuthScope && (scope !== undefined || !previous)) return { state: 'review' };
  if (!isBearer(access_token) || token_type !== 'Bearer' || !boundedSeconds(expires_in, 86_400) ||
    (refresh_token_expires_in !== undefined && !boundedSeconds(refresh_token_expires_in, 315_576_000)) ||
    Object.hasOwn(reply, 'error')) return { state: 'uncertain' };
  if (Object.hasOwn(reply, 'id_token')) return { state: 'review' };
  if (refresh_token !== undefined && !isBearer(refresh_token)) return { state: 'uncertain' };
  const refreshToken = refresh_token ?? previous?.refreshToken;
  if (!refreshToken) return { state: 'reconnect' };
  const expiryHint = refresh_token_expires_in === undefined ? null : observedAt + refresh_token_expires_in * 1_000;
  // Omission is never permission to extend a known lifetime.
  const originalExpiry = previous?.refreshExpiresAt ?? null;
  const refreshExpiresAt = originalExpiry === null ? expiryHint : expiryHint === null ? originalExpiry : Math.min(originalExpiry, expiryHint);
  const expiresAt = observedAt + expires_in * 1_000;
  if (expiresAt <= Date.now() || (refreshExpiresAt !== null && refreshExpiresAt <= Date.now())) return { state: 'reconnect' };
  return { state: 'granted', grant: new GoogleCalendarGrant({ clientId, accessToken: access_token, refreshToken, expiresAt, refreshExpiresAt }) };
}

// Runtime composition supplies a bounded maintained OAuth transport and a
// committed admission under the credential/lease fence for each operation.
// Admission must serialize refresh and pin the exact stored grant on revoke.
// This adapter never retries, performs discovery, or opens a redirect.
export function createGoogleCalendarOAuthTransport(config: Readonly<{
  clientId: string;
  clientSecret: string;
  callbackUri: string;
  admit: (request: Admission, signal: AbortSignal) => Promise<boolean>;
  request: typeof fetch;
  timeoutMs?: number;
}>) {
  const { clientId, clientSecret, callbackUri, admit, request } = config;
  const timeoutMs = config.timeoutMs ?? 8_000;
  try { googleCalendarOAuthClient(clientId, callbackUri); } catch { throw new GoogleCalendarOAuthError(); }
  if (typeof clientSecret !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(clientSecret) ||
    typeof admit !== 'function' || typeof request !== 'function' || !validExpiry(timeoutMs) || timeoutMs > 15_000) {
    throw new GoogleCalendarOAuthError();
  }

  // Trusted persisted credential input after authenticated decryption.
  function openRetained(input: unknown) {
    return new GoogleCalendarGrant(parseGoogleCalendarStoredGrant(input, clientId));
  }

  async function send(kind: 'exchange' | 'refresh', admission: Admission, body: () => URLSearchParams, external: AbortSignal,
    previous?: StoredGrant): Promise<TokenResult>;
  async function send(kind: 'revoke', admission: Admission, body: () => URLSearchParams, external: AbortSignal):
    Promise<Failure | Readonly<{ state: 'revoked' }>>;
  async function send(kind: Kind, admission: Admission, body: () => URLSearchParams, external: AbortSignal, previous?: StoredGrant):
    Promise<TokenResult | Readonly<{ state: 'revoked' }>> {
    const signal = AbortSignal.any([external, AbortSignal.timeout(timeoutMs)]);
    try {
      signal.throwIfAborted();
      if (await admit(admission, signal) !== true) return { state: 'paused' };
      signal.throwIfAborted();
    } catch { return { state: 'paused' }; }

    let payload: URLSearchParams;
    try { payload = body(); } catch { return { state: 'review' }; }
    let response: Response | undefined;
    try {
      const observedAt = Date.now();
      const endpoint = kind === 'revoke' ? revokeEndpoint : tokenEndpoint;
      response = await request(endpoint, {
        method: 'POST', redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: payload,
      });
      signal.throwIfAborted();
      if (response.redirected || response.type === 'opaqueredirect' || (response.url !== '' && response.url !== endpoint) ||
        (response.status >= 300 && response.status < 400)) {
        return { state: 'uncertain' };
      }
      if (kind === 'revoke') return { state: response.status === 200 ? 'revoked' : 'uncertain' };
      if (response.status === 429) return { state: 'delayed' };
      if (response.status >= 500) return { state: 'uncertain' };
      if (response.status === 401) return { state: 'review' };
      if (response.status !== 200) return classifiedError(response.status, await readReply(response, signal));
      return granted(await readReply(response, signal), clientId, observedAt, previous);
    } catch {
      // A dropped response or malformed successful reply can conceal a
      // committed grant change. Never surface transport errors or retry it.
      return { state: 'uncertain' };
    } finally {
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined);
    }
  }

  return Object.freeze({
    openRetained,
    exchange(material: GoogleCalendarExchangeMaterial, signal: AbortSignal) {
      return send('exchange', { kind: 'exchange', attemptId: material.attemptId }, () => {
        const value = material.takeForOAuthLibrary();
        if (value.issuer !== googleCalendarOAuthIssuer || value.clientId !== clientId || value.callbackUri !== callbackUri ||
          value.scope !== googleCalendarOAuthScope) throw new GoogleCalendarOAuthError();
        return new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret,
          redirect_uri: callbackUri, code: value.code, code_verifier: value.codeVerifier });
      }, signal);
    },
    refresh(retained: GoogleCalendarGrant, signal: AbortSignal): Promise<TokenResult> {
      const previous = retained.forPrivateCredentialStore();
      if (previous.clientId !== clientId || (previous.refreshExpiresAt !== null && previous.refreshExpiresAt <= Date.now())) {
        return Promise.resolve({ state: 'reconnect' });
      }
      return send('refresh', { kind: 'refresh', retained }, () => new URLSearchParams({
        grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: previous.refreshToken,
      }), signal, previous);
    },
    revoke(retained: GoogleCalendarGrant, signal: AbortSignal) {
      if (retained.clientId !== clientId) return Promise.resolve({ state: 'review' } as const);
      return send('revoke', { kind: 'revoke', retained }, () => new URLSearchParams({ token: retained.forPrivateCredentialStore().refreshToken }), signal);
    },
  });
}
