import 'server-only';
import { createHash } from 'node:crypto';
import { customerUuid as uuid, customerVersion as version, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { createGoogleCalendarCredentialStore } from './google-calendar-credential-store.ts';
import { googleCalendarWorkerStatements as sql, syntheticGoogleCalendarWorkerDatabase } from './google-calendar-database.ts';
import { createGoogleCalendarOAuthTransport } from './google-calendar-oauth-transport.ts';
import { projectGoogleCalendarAppointment } from './google-calendar-projection.ts';
import type { CalendarDisclosure, GoogleCalendarEvent } from './google-calendar-projection.ts';
import { createGoogleCalendarProvider, googleCalendarMutationBody } from './google-calendar-provider.ts';
import { calendarEventEtag, planGoogleCalendarMutation, reconcileGoogleCalendarMutation } from './google-calendar-reconciliation.ts';
import type { CalendarMutation, ConfirmedCalendarEvent } from './google-calendar-reconciliation.ts';
import { parseScheduleTime } from './schedule-time.ts';
import { syntheticGoogleCalendarIdentity } from './google-calendar-runtime.ts';
import { startCalendarRunner } from './google-calendar-runner.ts';

type Target = Readonly<{ businessId: string; destinationId: string; jobId: string; recoveryEpoch: string; generation: string }>;
type Outcome = 'published' | 'removed' | 'no_effect' | 'delayed' | 'reconnect' | 'review' | 'uncertain';
const eventKeys = ['id', 'summary', 'description', 'location', 'start', 'end', 'status', 'visibility', 'transparency', 'reminders', 'extendedProperties'];
const leaseKeys = ['state', 'leaseId', 'leaseUntil', 'outboxId', 'appointmentId', 'appointmentSequence', 'action', 'sourceCurrent', 'mode',
  'attempt', 'providerCalendarId', 'eventId', 'marker', 'previousSend'];
const disclosureKeys = ['clientName', 'serviceLabel', 'workAddress'] as const;
const unavailable = { state: 'unavailable' } as const;

function digest(body: string) {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

function boundedBody(body: unknown, sha256: unknown): body is string {
  return typeof body === 'string' && Buffer.byteLength(body, 'utf8') <= 8192 && sha256 === digest(body);
}

function exactEvent(value: unknown, eventId: string, marker: string, href: string, disclosure: CalendarDisclosure): GoogleCalendarEvent {
  if (!exact(value, eventKeys) || value.id !== eventId || typeof value.summary !== 'string' || typeof value.location !== 'string' ||
    (value.summary !== 'Crest job' && (!(disclosure.clientName || disclosure.serviceLabel) || !value.summary.startsWith('Crest job · '))) ||
    [...value.summary].length > 415 || (!disclosure.workAddress && value.location !== '') || [...value.location].length > 512 ||
    value.description !== 'View the saved appointment in Crest OS: ' + href || value.status !== 'confirmed' ||
    value.visibility !== 'private' || value.transparency !== 'opaque' || !exact(value.reminders, ['useDefault', 'overrides']) ||
    value.reminders.useDefault !== false || !Array.isArray(value.reminders.overrides) || value.reminders.overrides.length ||
    !exact(value.extendedProperties, ['private']) || !exact(value.extendedProperties.private, ['crestMapping']) ||
    value.extendedProperties.private.crestMapping !== marker) throw Error();
  const { start, end } = value;
  if (!exact(start, ['dateTime', 'timeZone']) || !exact(end, ['dateTime', 'timeZone']) ||
    typeof start.dateTime !== 'string' || typeof end.dateTime !== 'string' || typeof start.timeZone !== 'string' || start.timeZone !== end.timeZone ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(start.dateTime) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(end.dateTime) || end.dateTime <= start.dateTime) throw Error();
  return value as unknown as GoogleCalendarEvent;
}

// Bounded local simulation. Every claim, read, send admission and completion
// still crosses the real, dedicated PostgreSQL worker role. This starts no
// polling loop and can only reach the fixed in-process fictional provider.
export async function createSyntheticGoogleCalendarWorker(config: Readonly<{
  environment: 'test'; origin: string; connectionString: string; calendarKeyMaterial: Uint8Array;
}>, provider: { request: typeof fetch }) {
  const origin = new URL(config.origin);
  if (config.environment !== 'test' || origin.protocol !== 'https:' || origin.origin !== config.origin ||
    !['127.0.0.1', '[::1]'].includes(origin.hostname) || !syntheticProviders.has(provider))
    throw Error('GOOGLE_CALENDAR_SYNTHETIC_WORKER_CONFIGURATION_REQUIRED');
  const database = syntheticGoogleCalendarWorkerDatabase(config);
  const { clientId, credentialKeyId } = syntheticGoogleCalendarIdentity;
  const store = await createGoogleCalendarCredentialStore({ activeKeyId: credentialKeyId, calendarKeyMaterial: config.calendarKeyMaterial });
  const oauth = createGoogleCalendarOAuthTransport({ clientId, callbackUri: config.origin + '/api/google-calendar/callback',
    clientSecret: 'fictional-calendar-only', request: provider.request, admit: async () => false });

  return async (target: Target, external: AbortSignal) => {
    const { businessId, destinationId, jobId, generation, recoveryEpoch } = target;
    if (![businessId, destinationId, jobId, recoveryEpoch].every(uuid) || !version(generation) || external.aborted) return unavailable;
    const signal = AbortSignal.any([external, AbortSignal.timeout(35000)]);
    const scope = [businessId, destinationId, jobId, generation, recoveryEpoch];
    let lease;
    try {
      lease = await database(sql.claim, scope, signal);
    } catch { return unavailable; }
    if (exact(lease, ['state']) && (lease.state === 'busy' || lease.state === 'reconnect' || lease.state === 'review'))
      return { state: lease.state };
    if (!exact(lease, leaseKeys) || lease.state !== 'leased' || !uuid(lease.leaseId) || !uuid(lease.outboxId) || !uuid(lease.appointmentId) ||
      !version(lease.appointmentSequence) || (lease.action !== 'publish' && lease.action !== 'remove') ||
      (lease.mode !== 'dispatch' && lease.mode !== 'reconcile') || typeof lease.sourceCurrent !== 'boolean' ||
      typeof lease.eventId !== 'string' || !/^[a-f0-9]{32}$/.test(lease.eventId) || !uuid(lease.marker) ||
      lease.providerCalendarId !== syntheticCalendarId) return unavailable;
    const claimed = [...scope, lease.leaseId];
    const { eventId, marker } = lease;
    const href = config.origin + '/schedule?job=' + jobId;
    function parsePrior(body: unknown, hash: unknown, etag: unknown, disclosure: CalendarDisclosure): ConfirmedCalendarEvent {
      if (!boundedBody(body, hash) || !calendarEventEtag(etag)) throw Error();
      return { event: exactEvent(JSON.parse(body), eventId, marker, href, disclosure), etag };
    }
    async function finish(outcome: Outcome, etag: string | null = null) {
      try {
        const result = await database(sql.finish, [...claimed, outcome, etag], signal);
        if (exact(result, ['state', 'outcome', 'sourceCurrent']) && result.state === 'recorded' &&
          (result.outcome === outcome || (outcome === 'delayed' && result.outcome === 'uncertain')) && typeof result.sourceCurrent === 'boolean')
          return { state: result.outcome as Outcome, sourceCurrent: result.sourceCurrent };
      } catch { /* A later claim resolves any lost write acknowledgement. */ }
      return unavailable;
    }

    let sent = false;
    try {
      const material = await database(sql.material, claimed, signal);
      if (exact(material, ['state']) && (material.state === 'review' || material.state === 'reconnect')) return finish(material.state);
      if (!exact(material, ['state', 'outboxId', 'time', 'disclosure', 'fields', 'previous', 'credential']) || material.state !== 'ready' ||
        material.outboxId !== lease.outboxId || !exact(material.credential, ['credentialId', 'clientId', 'keyId', 'version', 'envelope']))
        return finish('review');
      const { credential, fields } = material;
      const flags = material.disclosure;
      if (!exact(flags, disclosureKeys) || !exact(fields, disclosureKeys) ||
        typeof flags.clientName !== 'boolean' || typeof flags.serviceLabel !== 'boolean' || typeof flags.workAddress !== 'boolean' ||
        disclosureKeys.some(key => fields[key] !== null && (typeof fields[key] !== 'string' || flags[key] !== true))) return finish('review');
      const disclosure = { clientName: flags.clientName, serviceLabel: flags.serviceLabel, workAddress: flags.workAddress };
      const text = (value: unknown) => typeof value === 'string' ? value : null;
      const optional = { clientName: text(fields.clientName), serviceLabel: text(fields.serviceLabel), workAddress: text(fields.workAddress) };
      if (!uuid(credential.credentialId) || credential.clientId !== clientId || !version(credential.version)) return finish('reconnect');
      const grant = await store.open({ businessId, destinationId, connectionGeneration: generation, recoveryEpoch, clientId,
        credentialId: credential.credentialId, version: credential.version }, { keyId: credential.keyId, envelope: credential.envelope }, oauth.openRetained)
        .catch(() => null);
      if (!grant || grant.expiresAt <= Date.now()) return finish('reconnect');
      const previous = material.previous === null ? null :
        exact(material.previous, ['body', 'sha256', 'etag']) ? parsePrior(material.previous.body, material.previous.sha256, material.previous.etag, disclosure) : undefined;
      if (previous === undefined) return finish('review');
      const eventUuid = eventId.replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5');
      const mapping = { businessId, destinationId, jobId, eventUuid, marker };
      const appointment = { businessId, jobId, appointmentId: lease.appointmentId, appointmentSequence: lease.appointmentSequence };
      const intent = projectGoogleCalendarAppointment(mapping, lease.action === 'remove' ? { ...appointment, action: 'cancel', confirmation: 'cancelled' }
        : { ...appointment, action: 'confirm', confirmation: 'confirmed', time: parseScheduleTime(material.time) },
      { trustedOrigin: config.origin, disclosure, fields: optional });
      const bridge = createGoogleCalendarProvider({ calendarId: syntheticCalendarId, eventUuid, marker, request: provider.request,
        async admit(kind, requestSignal) {
          if (grant.expiresAt <= Date.now()) return null;
          const admission = await database(sql.admit, [...claimed, kind], requestSignal);
          if (exact(admission, ['state']) && admission.state === 'delayed') return { state: 'delayed' };
          if (!exact(admission, ['state', 'admissionId']) || admission.state !== 'admitted' || !uuid(admission.admissionId)) return null;
          if (kind === 'insert' || kind === 'update' || kind === 'delete') sent = true;
          return grant.forPrivateCredentialStore().accessToken;
        } });
      const observed = await bridge.observe(signal);
      if (observed.state === 'paused') return finish('delayed');
      if (observed.state === 'delayed' || observed.state === 'reconnect') return finish(observed.state);
      if (observed.state === 'review') return finish('review');

      let decision;
      if (lease.mode === 'reconcile') {
        const original = lease.previousSend;
        if (!exact(original, ['action', 'requestSha256', 'requestBody', 'priorEtag']) ||
          !boundedBody(original.requestBody, original.requestSha256)) return finish('review');
        const action = original.action;
        let mutation: CalendarMutation;
        if (action === 'insert' && original.priorEtag === null) {
          mutation = { action, desired: exactEvent(JSON.parse(original.requestBody), eventId, marker, href, disclosure) };
        } else if (previous && previous.etag === original.priorEtag && action === 'update') {
          mutation = { action, previous, desired: exactEvent(JSON.parse(original.requestBody), eventId, marker, href, disclosure) };
        } else if (previous && previous.etag === original.priorEtag && action === 'delete' && original.requestBody === '') {
          mutation = { action, previous };
        } else return finish('review');
        decision = reconcileGoogleCalendarMutation(mutation, observed);
        if (decision.state === 'dispatch' && lease.sourceCurrent !== true) return finish('review');
      } else {
        decision = planGoogleCalendarMutation(intent, previous, observed);
      }
      if (decision.state === 'review') return finish('review');
      if (decision.state === 'confirmed') return finish('published', decision.confirmed.etag);
      if (decision.state === 'removed') return finish('removed');
      if (decision.state === 'unchanged') return finish('no_effect');
      if (decision.state !== 'dispatch') return finish('review');

      const { mutation } = decision;
      const expected = googleCalendarMutationBody(mutation);
      const priorEtag = mutation.action === 'insert' ? null : mutation.previous.etag;
      const retained = await database(sql.record, [...claimed, mutation.action, expected, priorEtag], signal);
      if (!exact(retained, ['state', 'sendId', 'requestBody', 'requestSha256']) || retained.state !== 'recorded' || !uuid(retained.sendId) ||
        !boundedBody(retained.requestBody, retained.requestSha256)) return finish('review');
      const result = await bridge.apply(mutation, signal, retained.requestBody);
      if (result.state === 'confirmed') return finish('published', result.confirmed.etag);
      if (result.state === 'removed') return finish('removed');
      if (result.state === 'reconnect') return finish('reconnect');
      if (result.state === 'paused' || result.state === 'delayed') return finish('delayed');
      return finish(result.state === 'uncertain' ? 'uncertain' : 'review');
    } catch {
      return signal.aborted ? unavailable : finish(sent ? 'uncertain' : 'review');
    }
  };
}

const syntheticCalendarId = 'crest-fictional-appointments@group.calendar.google.com';
const syntheticProviders = new WeakSet<object>();

export async function prepareSyntheticGoogleCalendarRunner(config: Parameters<typeof createSyntheticGoogleCalendarWorker>[0] &
  Readonly<{ businessId: string }>) {
  const dispatch = await createSyntheticGoogleCalendarWorker(config, createSyntheticGoogleCalendarEvents());
  const database = syntheticGoogleCalendarWorkerDatabase(config);
  if (!uuid(config.businessId)) throw Error('GOOGLE_CALENDAR_SYNTHETIC_RUNNER_CONFIGURATION_REQUIRED');
  return () => startCalendarRunner(config.businessId, { next: signal => database(sql.next, [config.businessId], signal), dispatch });
}

export function createSyntheticGoogleCalendarEvents() {
  const events = new Map<string, Record<string, unknown>>();
  let revision = 0, loseNextResponse = false;
  const eventPaths = '/calendar/v3/calendars/' + encodeURIComponent(syntheticCalendarId) + '/events';
  const simulated = {
    async request(input: string | URL | Request, init?: RequestInit) {
      if (typeof input !== 'string' || !init || init.signal?.aborted ||
        new Headers(init.headers).get('authorization') !== 'Bearer fictional-calendar-access') return new Response(null, { status: 403 });
      const url = new URL(input);
      if (url.origin !== 'https://www.googleapis.com') return new Response(null, { status: 400 });
      if (init.method === 'GET' && url.pathname === eventPaths.slice(0, -'/events'.length) && url.search === '?fields=id')
        return Response.json({ id: syntheticCalendarId });
      const key = url.pathname.startsWith(eventPaths + '/') ? url.pathname.slice(eventPaths.length + 1) : '';
      const prior = events.get(key);
      if (init.method === 'GET' && !url.search && /^[a-f0-9]{32}$/.test(key))
        return prior ? Response.json(prior) : new Response(null, { status: 404 });
      if (url.search !== '?sendUpdates=none') return new Response(null, { status: 400 });
      let response: Response;
      if (init.method === 'POST' && url.pathname === eventPaths && typeof init.body === 'string') {
        const event = JSON.parse(init.body) as Record<string, unknown>;
        if (typeof event.id !== 'string' || !/^[a-f0-9]{32}$/.test(event.id)) return new Response(null, { status: 400 });
        if (events.has(event.id)) return new Response(null, { status: 409 });
        const saved = { ...event, etag: '"fictional-' + ++revision + '"', organizer: { self: true } };
        events.set(event.id, saved);
        response = Response.json(saved, { status: 201 });
      } else {
        if (!prior) return new Response(null, { status: 404 });
        if (new Headers(init.headers).get('if-match') !== prior.etag) return new Response(null, { status: 412 });
        if (init.method === 'DELETE') {
          events.delete(key);
          response = new Response(null, { status: 204 });
        } else if (init.method === 'PUT' && typeof init.body === 'string') {
          const event = JSON.parse(init.body) as Record<string, unknown>;
          if (event.id !== key) return new Response(null, { status: 400 });
          const saved = { ...event, etag: '"fictional-' + ++revision + '"', organizer: { self: true } };
          events.set(key, saved);
          response = Response.json(saved);
        } else return new Response(null, { status: 400 });
      }
      if (loseNextResponse) {
        loseNextResponse = false;
        throw Error('FICTIONAL_GOOGLE_RESPONSE_LOST');
      }
      return response;
    },
    snapshot: () => structuredClone([...events.values()]),
    loseNextWriteResponse() { loseNextResponse = true; },
  };
  syntheticProviders.add(simulated);
  return Object.freeze(simulated);
}
