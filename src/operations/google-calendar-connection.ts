import 'server-only';
import { randomUUID } from 'node:crypto';
import { customerUuid, customerVersion } from '../customer/customer-contract.ts';
import { createGoogleCalendarCredentialStore } from './google-calendar-credential-store.ts';
import { googleCalendarConsentStatements } from './google-calendar-database.ts';
import { googleCalendarSetupStatements } from './google-calendar-database.ts';
import { createGoogleCalendarDestinationVerifier } from './google-calendar-destination.ts';
import { createGoogleCalendarSecondaryCreator } from './google-calendar-destination-creation.ts';
import type { ReviewedGoogleCalendarDestination } from './google-calendar-destination.ts';
import { createGoogleCalendarOAuth, GoogleCalendarOAuthError, googleCalendarOAuthClient } from './google-calendar-oauth.ts';
import { createGoogleCalendarOAuthTransport } from './google-calendar-oauth-transport.ts';
import type { GoogleCalendarOAuthOwner } from './google-calendar-oauth.ts';
import { googleCalendarInitialConsentPreview } from './google-calendar-initial-consent.ts';
import type { CalendarDisclosure } from './google-calendar-projection.ts';

// The caller verifies the Crest cookie, local session and live provider proof
// before supplying this server-only evidence. PostgreSQL rechecks authority.
export type GoogleCalendarConnectionAuthority = GoogleCalendarOAuthOwner & Readonly<{
  credentialHash: Uint8Array;
  authIssuer: string;
  authSubject: string;
  authProviderSessionId: string;
  providerValidUntil: number;
}>;

const { begin: beginSql, consume: consumeSql, exchange: creationExchangeSql, confirm: confirmCreationSql,
  admit: admitCreationSql, finish: finishCreationSql, promote: promoteCreationSql } = googleCalendarSetupStatements;
const admitSql = 'SELECT crest_commands.admit_google_calendar_code_exchange($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::bigint,$11::text,$12::text,$13::text,$14::uuid) AS result';
const stageSql = 'SELECT crest_commands.stage_google_calendar_credential($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::text,$14::jsonb) AS result';
const confirmDestinationSql = 'SELECT crest_commands.confirm_google_calendar_setup_destination($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::bigint,$11::text,$12::text,$13::text,$14::uuid,$15::text,$16::text,$17::boolean) AS result';
const admitDestinationSql = 'SELECT crest_commands.admit_google_calendar_setup_destination($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::bigint,$11::text,$12::text,$13::text,$14::uuid) AS result';
const finishDestinationSql = 'SELECT crest_commands.finish_google_calendar_setup_destination($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::bigint,$11::text,$12::text,$13::text,$14::uuid,$15::uuid) AS result';

type Result = Readonly<{ state: 'restart' | 'denied' | 'review' | 'reconnect' | 'uncertain' }> |
  Readonly<{ state: 'staged'; credentialId: string; generation: string }>;

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function disclosureFlags(disclosure: CalendarDisclosure) {
  if (!exact(disclosure, ['clientName', 'serviceLabel', 'workAddress']) || typeof disclosure.clientName !== 'boolean' ||
    typeof disclosure.serviceLabel !== 'boolean' || typeof disclosure.workAddress !== 'boolean') throw new GoogleCalendarOAuthError();
  return [disclosure.clientName, disclosure.serviceLabel, disclosure.workAddress] as const;
}

function matchesDisclosure(value: unknown, flags: ReturnType<typeof disclosureFlags>) {
  return exact(value, ['clientName', 'serviceLabel', 'workAddress']) && value.clientName === flags[0] &&
    value.serviceLabel === flags[1] && value.workAddress === flags[2];
}

function authority(input: GoogleCalendarConnectionAuthority) {
  const { businessId, actorId, appSessionId, recoveryEpoch, connectionGeneration,
    authIssuer, authSubject, authProviderSessionId, providerValidUntil, credentialHash } = input;
  if (![businessId, actorId, appSessionId, recoveryEpoch, authSubject, authProviderSessionId].every(customerUuid) ||
    !customerVersion(connectionGeneration, true) || BigInt(connectionGeneration) >= 9_223_372_036_854_775_807n ||
    typeof authIssuer !== 'string' || authIssuer.length < 1 || authIssuer.length > 500 ||
    !Number.isSafeInteger(providerValidUntil) || providerValidUntil <= Date.now() || providerValidUntil > 8.64e15 ||
    !(credentialHash instanceof Uint8Array) || credentialHash.byteLength !== 32) throw new GoogleCalendarOAuthError();
  const hash = Buffer.from(credentialHash);
  return { hash, owner: Object.freeze({ businessId, actorId, appSessionId, recoveryEpoch, connectionGeneration }),
    args: [hash, appSessionId, actorId, authIssuer, authSubject, authProviderSessionId, new Date(providerValidUntil), businessId, recoveryEpoch] };
}

// There is no published route or default provider here. The dedicated DB
// role must resolve each call after commit. Destination review is an existing
// trusted server decision; the callback cannot supply or select a calendar.
export async function createGoogleCalendarConnection(config: Readonly<{
  clientId: string;
  callbackUri: string;
  clientSecret: string;
  verifierKeyId: string;
  credentialKeyId: string;
  calendarKeyMaterial: Uint8Array;
  committedQuery: (statement: string, values: unknown[], signal: AbortSignal) => Promise<unknown>;
  request: typeof fetch;
  timeoutMs?: number;
}>) {
  const { clientId, callbackUri, clientSecret, verifierKeyId, credentialKeyId, calendarKeyMaterial, committedQuery,
    request: providerRequest, timeoutMs } = config;
  const client = googleCalendarOAuthClient(clientId, callbackUri);
  const origin = new URL(callbackUri).origin;
  if (verifierKeyId === credentialKeyId || typeof committedQuery !== 'function') throw new GoogleCalendarOAuthError();
  const credentialStore = await createGoogleCalendarCredentialStore({ activeKeyId: credentialKeyId, calendarKeyMaterial });
  function oauthArguments(current: ReturnType<typeof authority>) {
    return [...current.args, current.owner.connectionGeneration, client.issuer, clientId, callbackUri];
  }
  function creationArguments(current: ReturnType<typeof authority>) {
    return [...current.args, client.issuer, clientId, callbackUri];
  }
  // Each request gets its own owner/database closure. The secret is never in a
  // SQL argument, callback payload, result, or error.
  function services(current: ReturnType<typeof authority>) {
    const oauthArgs = oauthArguments(current);
    const oauth = createGoogleCalendarOAuth({ clientId, callbackUri, verifierKeyId, calendarKeyMaterial, store: {
      begin: (attempt, signal) => committedQuery(beginSql,
        [...oauthArgs, attempt.attemptId, attempt.stateDigest, attempt.verifierKeyId, attempt.verifierEnvelope], signal),
      consume: (attempt, signal) => committedQuery(consumeSql, [...oauthArgs, attempt.attemptId, attempt.stateDigest], signal),
    } });
    return { oauthArgs, oauth };
  }
  async function completeCallback(request: Request, input: GoogleCalendarConnectionAuthority, external: AbortSignal, initialCreation: boolean): Promise<Result> {
    let current: ReturnType<typeof authority> | undefined;
    let exchangeAdmissionStarted = false;
    try {
      const signal = AbortSignal.any([external, request.signal, AbortSignal.timeout(40_000)]);
      signal.throwIfAborted();
      current = authority(input);
      if (initialCreation && current.owner.connectionGeneration !== '0') return { state: 'review' };
      const { oauth, oauthArgs } = services(current);
      const checked = await (await oauth).callback(request, current.owner, signal);
      if (checked.state !== 'exchange_pending') return { state: checked.state };
      const attemptId = checked.exchange.attemptId, creationArgs = creationArguments(current);
      let admittedDeadline = 0;
      let admissionRefused = false;
      const transport = createGoogleCalendarOAuthTransport({ clientId, callbackUri, clientSecret, request: providerRequest,
        ...(timeoutMs === undefined ? {} : { timeoutMs }), async admit(operation, admissionSignal) {
          if (operation.kind !== 'exchange' || operation.attemptId !== attemptId) return false;
          exchangeAdmissionStarted = true;
          const requestedAt = Date.now();
          const receipt = initialCreation
            ? await committedQuery(creationExchangeSql, [...creationArgs, attemptId], admissionSignal)
            : await committedQuery(admitSql, [...oauthArgs, attemptId], admissionSignal);
          if (receipt === null) { admissionRefused = true; return false; }
          const deadline = exact(receipt, ['attemptId', 'deadline']) && receipt.attemptId === attemptId &&
            typeof receipt.deadline === 'string' ? Date.parse(receipt.deadline) : NaN;
          const now = Date.now();
          if (!Number.isFinite(deadline) || deadline <= now || deadline > now + 31_000 || requestedAt + 30_000 <= now) return false;
          admittedDeadline = Math.min(deadline, requestedAt + 30_000);
          return true;
        } });
      const exchanged = await transport.exchange(checked.exchange, signal);
      if (exchanged.state !== 'granted') {
        if (exchanged.state === 'reconnect' || exchanged.state === 'review') return { state: exchanged.state };
        return { state: admissionRefused || !exchangeAdmissionStarted ? 'restart' : 'uncertain' };
      }
      signal.throwIfAborted();
      if (Date.now() >= admittedDeadline) return { state: 'uncertain' };
      const admittedSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(0, admittedDeadline - Date.now()))]);
      const generation = (BigInt(current.owner.connectionGeneration) + 1n).toString(), credentialId = randomUUID();
      if (initialCreation) {
        const createSecondary = createGoogleCalendarSecondaryCreator({ request: providerRequest,
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
          admit: (id, admissionSignal) => committedQuery(admitCreationSql, [...creationArgs, id], admissionSignal),
          async finish(id, outcome, finishSignal) {
            return await committedQuery(finishCreationSql, [...creationArgs, id, outcome.state,
              ...('providerCalendarId' in outcome ? [outcome.providerCalendarId, outcome.observedGoogleOwner, outcome.marker] : [null, null, null])],
            finishSignal) === true;
          } });
        const creation = await createSecondary(attemptId, exchanged.grant, admittedSignal);
        if (creation.state !== 'created') return { state: creation.state === 'review' ? 'review' : 'uncertain' };
        const destinationId = randomUUID();
        const sealed = await credentialStore.seal({ businessId: current.owner.businessId, destinationId, connectionGeneration: generation,
          recoveryEpoch: current.owner.recoveryEpoch, clientId, credentialId, version: '1' }, exchanged.grant);
        admittedSignal.throwIfAborted();
        const staged = await committedQuery(promoteCreationSql, [...creationArgs, attemptId, destinationId, credentialId,
          sealed.keyId, sealed.envelope], admittedSignal);
        if (admittedSignal.aborted || !exact(staged, ['schemaVersion', 'destinationId', 'credentialId', 'generation', 'version']) ||
          staged.schemaVersion !== 1 || staged.destinationId !== destinationId || staged.credentialId !== credentialId ||
          staged.generation !== generation || staged.version !== '1') return { state: 'uncertain' };
        return { state: 'staged', credentialId, generation };
      }
      const verifyDestination = createGoogleCalendarDestinationVerifier({ request: providerRequest,
        review: {
          admit: (context, admissionSignal) => committedQuery(admitDestinationSql, [...oauthArgs, context.attemptId], admissionSignal),
        },
        ...(timeoutMs === undefined ? {} : { timeoutMs }) });
      const proof = await verifyDestination({ ...current.owner, attemptId }, exchanged.grant, admittedSignal);
      if (proof.state !== 'verified') return { state: proof.state === 'review' || proof.state === 'reconnect' ? proof.state : 'uncertain' };
      const reviewedDestinationId = proof.destinationId;
      if (await committedQuery(finishDestinationSql, [...oauthArgs, attemptId, reviewedDestinationId], admittedSignal) !== true) {
        return { state: 'uncertain' };
      }
      const sealed = await credentialStore.seal({ businessId: current.owner.businessId, destinationId: reviewedDestinationId,
        connectionGeneration: generation, recoveryEpoch: current.owner.recoveryEpoch, clientId, credentialId, version: '1' }, exchanged.grant);
      admittedSignal.throwIfAborted();
      const staged = await committedQuery(stageSql, [...current.args, reviewedDestinationId, attemptId, credentialId, sealed.keyId, sealed.envelope], admittedSignal);
      if (admittedSignal.aborted || !exact(staged, ['credentialId', 'generation', 'version']) || staged.credentialId !== credentialId ||
        staged.generation !== generation || staged.version !== '1') return { state: 'uncertain' };
      return { state: 'staged', credentialId, generation };
    } catch { return { state: exchangeAdmissionStarted ? 'uncertain' : 'restart' }; }
    finally { current?.hash.fill(0); }
  }
  return Object.freeze({
    async setupState(input: GoogleCalendarConnectionAuthority, signal: AbortSignal) {
      const current = authority(input);
      try { return await committedQuery(googleCalendarSetupStatements.state, current.args, signal); }
      finally { current.hash.fill(0); }
    },
    async jobStatus(input: GoogleCalendarConnectionAuthority, jobId: string, signal: AbortSignal) {
      if (!customerUuid(jobId)) throw new GoogleCalendarOAuthError();
      const current = authority(input);
      try { return await committedQuery(googleCalendarSetupStatements.jobStatus, [...current.args, jobId], signal); }
      finally { current.hash.fill(0); }
    },
    async prepareConsent(input: GoogleCalendarConnectionAuthority, destinationId: string, credentialId: string,
      disclosure: CalendarDisclosure, signal: AbortSignal) {
      let current: ReturnType<typeof authority> | undefined;
      try {
        if (!customerUuid(destinationId) || !customerUuid(credentialId)) return null;
        const flags = disclosureFlags(disclosure), reviewId = randomUUID();
        signal.throwIfAborted();
        current = authority(input);
        if (current.owner.connectionGeneration !== '0') return null;
        const preview = googleCalendarInitialConsentPreview(origin, disclosure);
        const result = await committedQuery(googleCalendarConsentStatements.prepare, [...current.args, destinationId, credentialId, reviewId, ...flags], signal);
        if (signal.aborted || !exact(result, ['reviewId', 'destinationId', 'providerCalendarId', 'googleOwner', 'credentialId',
          'payloadVersion', 'expiresAt', 'disclosure']) || result.reviewId !== reviewId || result.destinationId !== destinationId ||
          result.credentialId !== credentialId || result.payloadVersion !== preview.payloadVersion ||
          typeof result.providerCalendarId !== 'string' || typeof result.googleOwner !== 'string' || typeof result.expiresAt !== 'string' ||
          !Number.isFinite(Date.parse(result.expiresAt)) || !matchesDisclosure(result.disclosure, flags)) return null;
        return { reviewId, destinationId, credentialId, expiresAt: result.expiresAt, providerCalendarId: result.providerCalendarId,
          googleOwner: result.googleOwner, disclosure: Object.freeze({ clientName: flags[0], serviceLabel: flags[1], workAddress: flags[2] }), ...preview };
      } catch { return null; }
      finally { current?.hash.fill(0); }
    },
    async confirmConsent(input: GoogleCalendarConnectionAuthority, selection: Readonly<{
      destinationId: string; credentialId: string; reviewId: string; disclosure: CalendarDisclosure;
      payloadReviewed: boolean; sharingReviewed: boolean; notificationsReviewed: boolean;
    }>, signal: AbortSignal) {
      let current: ReturnType<typeof authority> | undefined;
      try {
        const { destinationId, credentialId, reviewId, disclosure, payloadReviewed, sharingReviewed, notificationsReviewed } = selection;
        if (![destinationId, credentialId, reviewId].every(customerUuid) || payloadReviewed !== true ||
          sharingReviewed !== true || notificationsReviewed !== true) return null;
        const flags = disclosureFlags(disclosure);
        signal.throwIfAborted();
        current = authority(input);
        if (current.owner.connectionGeneration !== '0') return null;
        const result = await committedQuery(googleCalendarConsentStatements.confirm, [...current.args, destinationId, credentialId, reviewId, ...flags, true, true, true], signal);
        if (signal.aborted || !exact(result, ['schemaVersion', 'state', 'destinationId', 'consentId', 'generation', 'payloadVersion', 'disclosure']) ||
          result.schemaVersion !== 1 || result.state !== 'active' || result.destinationId !== destinationId || !customerUuid(result.consentId) ||
          result.generation !== '1' || result.payloadVersion !== 1 || !matchesDisclosure(result.disclosure, flags)) return null;
        return { state: 'active' as const, destinationId, consentId: result.consentId, generation: '1' as const };
      } catch { return null; }
      finally { current?.hash.fill(0); }
    },
    async lookupConsent(input: GoogleCalendarConnectionAuthority, destinationId: string, credentialId: string,
      reviewId: string, signal: AbortSignal) {
      let current: ReturnType<typeof authority> | undefined;
      try {
        if (![destinationId, credentialId, reviewId].every(customerUuid)) return null;
        signal.throwIfAborted();
        current = authority(input);
        const result = await committedQuery(googleCalendarConsentStatements.lookup, [...current.args, destinationId, credentialId, reviewId], signal);
        if (signal.aborted) return null;
        if (exact(result, ['state']) && result.state === 'absent') return { state: 'absent' as const };
        if (exact(result, ['state']) && result.state === 'changed') return { state: 'changed' as const };
        if (!exact(result, ['schemaVersion', 'state', 'destinationId', 'consentId', 'generation', 'payloadVersion', 'disclosure']) ||
          result.schemaVersion !== 1 || result.state !== 'active' || result.destinationId !== destinationId ||
          !customerUuid(result.consentId) || result.generation !== '1' || result.payloadVersion !== 1) return null;
        return { state: 'active' as const, destinationId, consentId: result.consentId, generation: '1' as const };
      } catch { return null; }
      finally { current?.hash.fill(0); }
    },
    async confirmCreation(input: GoogleCalendarConnectionAuthority, attemptId: string, reviewedGoogleOwner: string,
      confirmed: boolean, signal: AbortSignal) {
      let current: ReturnType<typeof authority> | undefined;
      try {
        if (confirmed !== true || !customerUuid(attemptId) || typeof reviewedGoogleOwner !== 'string' ||
          reviewedGoogleOwner.length > 254) return false;
        signal.throwIfAborted();
        current = authority(input);
        if (current.owner.connectionGeneration !== '0') return false;
        const result = await committedQuery(confirmCreationSql, [...creationArguments(current), attemptId, reviewedGoogleOwner, true], signal);
        return !signal.aborted && result === true;
      } catch { return false; }
      finally { current?.hash.fill(0); }
    },
    async confirmDestination(input: GoogleCalendarConnectionAuthority,
      reviewed: ReviewedGoogleCalendarDestination & Readonly<{ confirmed: boolean }>, signal: AbortSignal) {
      let current: ReturnType<typeof authority> | undefined;
      try {
        if (reviewed.confirmed !== true || !customerUuid(reviewed.destinationId) ||
          typeof reviewed.providerCalendarId !== 'string' || typeof reviewed.reviewedCalendarOwner !== 'string') return false;
        signal.throwIfAborted();
        current = authority(input);
        const result = await committedQuery(confirmDestinationSql, [...oauthArguments(current), reviewed.destinationId,
          reviewed.providerCalendarId, reviewed.reviewedCalendarOwner, true], signal);
        return !signal.aborted && result === true;
      } catch { return false; }
      finally { current?.hash.fill(0); }
    },

    async begin(input: GoogleCalendarConnectionAuthority, signal: AbortSignal) {
      let current: ReturnType<typeof authority> | undefined;
      try {
        current = authority(input);
        const { oauth } = services(current);
        return await (await oauth).begin(current.owner, signal);
      } catch { throw new GoogleCalendarOAuthError(); }
      finally { current?.hash.fill(0); }
    },

    callback(request: Request, input: GoogleCalendarConnectionAuthority, external: AbortSignal) {
      return completeCallback(request, input, external, false);
    },
    initialCreationCallback(request: Request, input: GoogleCalendarConnectionAuthority, external: AbortSignal) {
      return completeCallback(request, input, external, true);
    },
  });
}
