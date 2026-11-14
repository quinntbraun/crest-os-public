import 'server-only';
import { hkdfSync } from 'node:crypto';
import { FlattenedEncrypt, flattenedDecrypt } from 'jose';
import type { FlattenedJWE } from 'jose';
import { customerUuid, customerVersion } from '../customer/customer-contract.ts';
import { GoogleCalendarOAuthError, googleCalendarOAuthScope } from './google-calendar-oauth.ts';
import { parseGoogleCalendarStoredGrant } from './google-calendar-oauth-transport.ts';
import type { GoogleCalendarRetainedGrant, GoogleCalendarStoredGrant } from './google-calendar-oauth-transport.ts';

const purpose = 'crest.google-calendar-credentials.v1';
const mediaType = 'application/vnd.crest.google-calendar-credentials.v1';
const keyPattern = /^[A-Za-z0-9_-]{1,100}$/;
const clientPattern = /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
const maxEnvelopeBytes = 12_300;
const maxCiphertextCharacters = 11_600;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const emptyId = '00000000-0000-0000-0000-000000000000';

export type GoogleCalendarCredentialBinding = Readonly<{
  businessId: string;
  destinationId: string;
  connectionGeneration: string;
  recoveryEpoch: string;
  clientId: string;
  credentialId: string;
  version: string;
}>;

type Sealed = Readonly<{ keyId: string; envelope: FlattenedJWE }>;

function requireCredential(condition: unknown): asserts condition {
  if (!condition) throw new GoogleCalendarOAuthError();
}

function bound(input: GoogleCalendarCredentialBinding) {
  const { businessId, destinationId, connectionGeneration, recoveryEpoch, clientId, credentialId, version } = input;
  requireCredential([businessId, destinationId, recoveryEpoch, credentialId].every(value => customerUuid(value) && value !== emptyId) &&
    customerVersion(connectionGeneration) && customerVersion(version) &&
    typeof clientId === 'string' && clientId.length <= 200 && clientPattern.test(clientId));
  return {
    clientId,
    aad: Buffer.from([purpose, businessId, destinationId, connectionGeneration, recoveryEpoch, clientId,
      googleCalendarOAuthScope, credentialId, version].join('\n')),
  };
}

function protectedHeader(keyId: string) {
  return { alg: 'dir', enc: 'A256GCM', kid: keyId, typ: mediaType };
}

function base64url(value: unknown, max: number, byteLength?: number) {
  requireCredential(typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value));
  const bytes = Buffer.from(value, 'base64url');
  requireCredential(bytes.toString('base64url') === value && (byteLength === undefined || bytes.byteLength === byteLength));
}

function checkedEnvelope(value: unknown, keyId: string, aad: Buffer): FlattenedJWE {
  requireCredential(value && typeof value === 'object' && !Array.isArray(value));
  const fields = ['protected', 'aad', 'iv', 'ciphertext', 'tag'];
  requireCredential(Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field)));
  const candidate = value as Record<string, unknown>;
  requireCredential(candidate.protected === Buffer.from(JSON.stringify(protectedHeader(keyId))).toString('base64url') &&
    candidate.aad === aad.toString('base64url'));
  base64url(candidate.iv, 16, 12);
  base64url(candidate.tag, 22, 16);
  base64url(candidate.ciphertext, maxCiphertextCharacters);
  const envelope = candidate as unknown as FlattenedJWE;
  // Match the SQL envelope size including PostgreSQL jsonb's separator spaces.
  requireCredential(Buffer.byteLength(JSON.stringify(envelope)) + 9 <= maxEnvelopeBytes);
  return envelope;
}

// Key material comes from private server configuration. Calendar grant keys
// and PKCE keys are different derived purposes, even if backed by one Calendar
// root. Database roles and worker admission still decide who may open a grant.
export async function createGoogleCalendarCredentialStore(config: Readonly<{
  activeKeyId: string;
  calendarKeyMaterial: Uint8Array;
}>) {
  let key: CryptoKey;
  const keyId = config.activeKeyId;
  try {
    requireCredential(typeof keyId === 'string' && keyPattern.test(keyId) &&
      config.calendarKeyMaterial instanceof Uint8Array && config.calendarKeyMaterial.byteLength === 32);
    const derived = Buffer.from(hkdfSync('sha256', config.calendarKeyMaterial, purpose, keyId, 32));
    try { key = await crypto.subtle.importKey('raw', derived, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }
    finally { derived.fill(0); }
  } catch { throw new GoogleCalendarOAuthError(); }

  return Object.freeze({
    async seal(binding: GoogleCalendarCredentialBinding, grant: GoogleCalendarRetainedGrant): Promise<Sealed> {
      try {
        const { clientId, aad } = bound(binding);
        const payload = parseGoogleCalendarStoredGrant(grant.forPrivateCredentialStore(), clientId);
        const clear = Buffer.from(JSON.stringify(payload));
        try {
          const envelope = await new FlattenedEncrypt(clear).setProtectedHeader(protectedHeader(keyId))
            .setAdditionalAuthenticatedData(aad).encrypt(key);
          return Object.freeze({ keyId, envelope: Object.freeze(checkedEnvelope(envelope, keyId, aad)) });
        } finally { clear.fill(0); }
      } catch { throw new GoogleCalendarOAuthError(); }
    },

    async open(binding: GoogleCalendarCredentialBinding, retained: Readonly<{ keyId: unknown; envelope: unknown }>,
      restoreGrant: (input: GoogleCalendarStoredGrant) => GoogleCalendarRetainedGrant): Promise<GoogleCalendarRetainedGrant> {
      try {
        const { clientId, aad } = bound(binding);
        requireCredential(retained.keyId === keyId);
        const envelope = checkedEnvelope(retained.envelope, keyId, aad);
        const result = await flattenedDecrypt(envelope, key, { keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'] });
        try {
          const text = utf8.decode(result.plaintext);
          const payload = parseGoogleCalendarStoredGrant(JSON.parse(text), clientId);
          requireCredential(JSON.stringify(payload) === text);
          // The provider adapter returns a nonserializable grant. Application
          // composition must pass only that trusted restore function here.
          return restoreGrant(payload);
        } finally { result.plaintext.fill(0); }
      } catch { throw new GoogleCalendarOAuthError(); }
    },
  });
}
