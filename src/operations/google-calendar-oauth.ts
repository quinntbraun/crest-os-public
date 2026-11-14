import 'server-only';
import { createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { FlattenedEncrypt, flattenedDecrypt } from 'jose';
import type { FlattenedJWE } from 'jose';
import { customerUuid, customerVersion } from '../customer/customer-contract.ts';

export const googleCalendarOAuthIssuer = 'https://accounts.google.com';
export const googleCalendarOAuthScope = 'https://www.googleapis.com/auth/calendar.app.created';
const authorizationEndpoint = googleCalendarOAuthIssuer + '/o/oauth2/v2/auth';
const callbackPath = '/api/google-calendar/callback';
const cleanResultPath = '/settings/google-calendar';
const purpose = 'crest.google-calendar-pkce.v1';
const mediaType = 'application/vnd.crest.google-calendar-pkce.v1';
const maximumQuery = 4096;
const keyPattern = /^[A-Za-z0-9_-]{1,100}$/;
const oauthCode = /^[A-Za-z0-9._~/-]{1,2048}$/;
const stateToken = /^[A-Za-z0-9_-]{43}$/;
const safeHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

export class GoogleCalendarOAuthError extends Error {
  constructor() {
    super('GOOGLE_CALENDAR_OAUTH_FAILED');
    this.name = 'GoogleCalendarOAuthError';
  }
}

function requireOAuth(condition: unknown): asserts condition {
  if (!condition) throw new GoogleCalendarOAuthError();
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && stateToken.test(value) && Buffer.from(value, 'base64url').toString('base64url') === value;
}

function validUuid(value: unknown): value is string {
  return customerUuid(value) && value !== '00000000-0000-0000-0000-000000000000';
}

export type GoogleCalendarOAuthOwner = Readonly<{
  businessId: string;
  actorId: string;
  appSessionId: string;
  recoveryEpoch: string;
  connectionGeneration: string;
}>;

type Client = Readonly<{ issuer: typeof googleCalendarOAuthIssuer; clientId: string; callbackUri: string }>;
type Scope = Readonly<{ owner: GoogleCalendarOAuthOwner; client: Client; attemptId: string; stateDigest: Buffer }>;
export type GoogleCalendarOAuthAttemptStore = Readonly<{
  // Adapters must require fresh genuine Crest owner authority and resolve only
  // after the matching fixed PostgreSQL command commits. Never log arguments.
  begin: (request: Scope & Readonly<{ verifierKeyId: string; verifierEnvelope: FlattenedJWE }>, signal: AbortSignal) => Promise<unknown>;
  consume: (request: Scope, signal: AbortSignal) => Promise<unknown>;
}>;

function ownerBinding(input: GoogleCalendarOAuthOwner): GoogleCalendarOAuthOwner {
  const { businessId, actorId, appSessionId, recoveryEpoch, connectionGeneration } = input;
  requireOAuth([businessId, actorId, appSessionId, recoveryEpoch].every(validUuid) && customerVersion(connectionGeneration, true));
  return Object.freeze({ businessId, actorId, appSessionId, recoveryEpoch, connectionGeneration });
}

export function googleCalendarOAuthClient(clientId: string, callbackUri: string): Client {
  requireOAuth(typeof clientId === 'string' && clientId.length <= 200 && /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) &&
    typeof callbackUri === 'string' && callbackUri.length <= 300);
  const url = new URL(callbackUri);
  requireOAuth(url.href === callbackUri && url.protocol === 'https:' && url.pathname === callbackPath &&
    !url.username && !url.password && url.origin + callbackPath === callbackUri);
  return Object.freeze({ issuer: googleCalendarOAuthIssuer, clientId, callbackUri });
}

function associatedData(scope: Scope) {
  const { owner, client, attemptId } = scope;
  // Match the proposal's binding and ordering exactly.
  return Buffer.from([purpose, attemptId, owner.businessId, owner.actorId, owner.appSessionId, owner.recoveryEpoch,
    owner.connectionGeneration, client.issuer, client.clientId, client.callbackUri].join('\n'));
}

function protectedHeader(keyId: string) {
  return { alg: 'dir', enc: 'A256GCM', kid: keyId, typ: mediaType };
}

function digest(value: string) {
  return createHash('sha256').update(value, 'ascii').digest();
}

function makeAuthorizationUrl(client: Client, state: string, challenge: string) {
  const url = new URL(authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: client.clientId, redirect_uri: client.callbackUri, response_type: 'code', scope: googleCalendarOAuthScope,
    access_type: 'offline', include_granted_scopes: 'false', state, code_challenge: challenge, code_challenge_method: 'S256',
  }).toString();
  return url.href;
}

type ParsedCallback = Readonly<{ attemptId: string; state: string }> &
  (Readonly<{ code: string }> | Readonly<{ error: 'denied' | 'review' }>);

function parseCallback(request: Request, client: Client): ParsedCallback {
  requireOAuth(request.method === 'GET' && request.url.length <= client.callbackUri.length + maximumQuery + 1 &&
    request.url.startsWith(client.callbackUri + '?'));
  const query = request.url.slice(client.callbackUri.length + 1);
  requireOAuth(query.length > 0 && !/[#\s]|%(?![0-9a-f]{2})/i.test(query));
  const fields = new URLSearchParams(query);
  const allowed = new Set(['state', 'code', 'error', 'error_description', 'error_uri', 'iss', 'scope', 'authuser', 'prompt']);
  const seen = new Set<string>();
  for (const [name, value] of fields) {
    requireOAuth(allowed.has(name) && !seen.has(name) && value.length > 0 && !/[\p{Cc}\p{Cs}\ufffd]/u.test(value));
    seen.add(name);
  }
  const state = fields.get('state');
  const parts = state?.split('.');
  requireOAuth(state !== null && parts?.length === 2 && validUuid(parts[0]) && validToken(parts[1]));
  const [attemptId] = parts;
  const issuer = fields.get('iss');
  requireOAuth(issuer === null || issuer === client.issuer);
  const code = fields.get('code'), error = fields.get('error'), scope = fields.get('scope'), authuser = fields.get('authuser');
  requireOAuth((code === null) !== (error === null) && (authuser === null || /^\d{1,4}$/.test(authuser)));
  if (error !== null) {
    requireOAuth(/^[a-z][a-z_]{0,63}$/.test(error));
    return { attemptId, state, error: error === 'access_denied' ? 'denied' : 'review' };
  }
  requireOAuth(code !== null && oauthCode.test(code) && !fields.has('error_description') && !fields.has('error_uri'));
  // Callback scope is advisory. The token exchange must independently verify
  // the issued grant even if Google supplies the requested scope here.
  if (scope !== null && scope !== googleCalendarOAuthScope) return { attemptId, state, error: 'review' };
  return { attemptId, state, code };
}

class ExchangeMaterial {
  #code: string;
  #verifier: string;
  #client: Client;
  #released = false;
  readonly attemptId: string;

  constructor(code: string, verifier: string, client: Client, attemptId: string) {
    this.#code = code;
    this.#verifier = verifier;
    this.#client = client;
    this.attemptId = attemptId;
    Object.freeze(this);
  }

  takeForOAuthLibrary() {
    requireOAuth(!this.#released);
    this.#released = true;
    const payload = Object.freeze({ code: this.#code, codeVerifier: this.#verifier, ...this.#client, scope: googleCalendarOAuthScope });
    this.#code = this.#verifier = '';
    return payload;
  }

  toJSON(): never { throw new GoogleCalendarOAuthError(); }
}

export type GoogleCalendarExchangeMaterial = ExchangeMaterial;

type CallbackResult = Readonly<{ state: 'restart' | 'denied' | 'review' }> |
  Readonly<{ state: 'exchange_pending'; exchange: ExchangeMaterial }>;

export function cleanGoogleCalendarOAuthResponse() {
  return new Response(null, { status: 303, headers: { ...safeHeaders, Location: cleanResultPath } });
}

// Internal server composition. The start route must validate Origin, CSRF and
// current owner intent before calling begin. Callback authentication is still
// required. No provider transport, raw URL logging or route is installed here.
export async function createGoogleCalendarOAuth(config: Readonly<{
  clientId: string;
  callbackUri: string;
  verifierKeyId: string;
  calendarKeyMaterial: Uint8Array;
  store: GoogleCalendarOAuthAttemptStore;
}>) {
  let client: Client, key: CryptoKey, keyId: string;
  try {
    client = googleCalendarOAuthClient(config.clientId, config.callbackUri);
    keyId = config.verifierKeyId;
    requireOAuth(typeof keyId === 'string' && keyPattern.test(keyId) && config.calendarKeyMaterial instanceof Uint8Array &&
      config.calendarKeyMaterial.byteLength === 32 && typeof config.store.begin === 'function' && typeof config.store.consume === 'function');
    const derived = Buffer.from(hkdfSync('sha256', config.calendarKeyMaterial, purpose, keyId, 32));
    try { key = await crypto.subtle.importKey('raw', derived, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }
    finally { derived.fill(0); }
  } catch {
    throw new GoogleCalendarOAuthError();
  }
  const store = config.store;

  return Object.freeze({
    async begin(input: GoogleCalendarOAuthOwner, signal: AbortSignal) {
      try {
        signal.throwIfAborted();
        const owner = ownerBinding(input), attemptId = randomUUID(), nonce = randomBytes(32).toString('base64url');
        const verifier = randomBytes(32).toString('base64url');
        const state = attemptId + '.' + nonce;
        const scope = Object.freeze({ owner, client, attemptId, stateDigest: digest(state) });
        const clearVerifier = Buffer.from(verifier, 'ascii');
        let verifierEnvelope: FlattenedJWE;
        try {
          verifierEnvelope = await new FlattenedEncrypt(clearVerifier)
            .setProtectedHeader(protectedHeader(keyId)).setAdditionalAuthenticatedData(associatedData(scope)).encrypt(key);
        } finally { clearVerifier.fill(0); }
        const receipt = await store.begin(Object.freeze({ ...scope, verifierKeyId: keyId, verifierEnvelope }), signal);
        const expiry = exact(receipt, ['attemptId', 'expiresAt']) && typeof receipt.expiresAt === 'string' ? Date.parse(receipt.expiresAt) : NaN;
        const now = Date.now();
        // The PostgreSQL host is authoritative for expiration. Allow bounded
        // clock skew in the receipt without changing the database's TTL.
        requireOAuth(receipt !== null && typeof receipt === 'object' && 'attemptId' in receipt && receipt.attemptId === attemptId &&
          Number.isFinite(expiry) && expiry > now && expiry <= now + 5 * 60_000 + 1_000);
        signal.throwIfAborted();
        return new Response(null, { status: 303, headers: { ...safeHeaders,
          Location: makeAuthorizationUrl(client, state, digest(verifier).toString('base64url')) } });
      } catch {
        throw new GoogleCalendarOAuthError();
      }
    },

    async callback(request: Request, input: GoogleCalendarOAuthOwner, signal: AbortSignal): Promise<CallbackResult> {
      try {
        signal.throwIfAborted();
        request.signal.throwIfAborted();
        const owner = ownerBinding(input), parsed = parseCallback(request, client);
        const scope = Object.freeze({ owner, client, attemptId: parsed.attemptId, stateDigest: digest(parsed.state) });
        const receipt = await store.consume(scope, signal);
        signal.throwIfAborted();
        request.signal.throwIfAborted();
        if (!exact(receipt, ['attemptId', 'verifierKeyId', 'verifierEnvelope']) || receipt.attemptId !== parsed.attemptId ||
          receipt.verifierKeyId !== keyId) return { state: 'restart' };
        const envelope = receipt.verifierEnvelope;
        requireOAuth(exact(envelope, ['protected', 'aad', 'iv', 'ciphertext', 'tag']) &&
          envelope.protected === Buffer.from(JSON.stringify(protectedHeader(keyId))).toString('base64url') &&
          envelope.aad === associatedData(scope).toString('base64url') &&
          typeof envelope.iv === 'string' && /^[A-Za-z0-9_-]{16}$/.test(envelope.iv) &&
          typeof envelope.tag === 'string' && /^[A-Za-z0-9_-]{22}$/.test(envelope.tag) &&
          typeof envelope.ciphertext === 'string' && /^[A-Za-z0-9_-]{58}$/.test(envelope.ciphertext));
        const opened = await flattenedDecrypt(envelope as unknown as FlattenedJWE, key,
          { keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'] });
        let verifier: string;
        try { verifier = new TextDecoder('utf-8', { fatal: true }).decode(opened.plaintext); }
        finally { opened.plaintext.fill(0); }
        requireOAuth(validToken(verifier));
        signal.throwIfAborted();
        request.signal.throwIfAborted();
        if ('error' in parsed) return { state: parsed.error };
        return { state: 'exchange_pending', exchange: new ExchangeMaterial(parsed.code, verifier, client, parsed.attemptId) };
      } catch {
        return { state: 'restart' };
      }
    },
  });
}
