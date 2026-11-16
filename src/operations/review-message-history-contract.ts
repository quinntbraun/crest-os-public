import {
 customerInstant as instant,
 customerUuid as uuid,
 exactCustomerObject as exact,
} from '../customer/customer-contract.ts';
import {requireBooking as check} from './confirmed-booking-contract.ts';
import {isReviewOutcomeAction} from '../security/original-operation-reference.ts';
import type {ReviewOutcomeAction} from '../security/original-operation-reference.ts';

export type ReviewHistoryScope = Readonly<{kind: 'job' | 'customer'; id: string}>;
export type ReviewHistoryCursor = Readonly<{source: 'event' | 'request'; id: string}>;
type Common = Readonly<{
 id: string;
 jobId: string;
 customerId: string;
 requestId: string;
 effectiveAt: string;
 recordedAt: string;
 actorId: string;
 reason: string | null;
}>;

const suppressions = [
 'owner_skipped', 'outreach_opt_out', 'no_contact', 'missing_review_url',
 'contact_review_required', 'duplicate_encounter', 'template_disabled',
] as const;
type Suppression = (typeof suppressions)[number];
export type ReviewHistoryEntry = Common & (
 Readonly<{source: 'event'; messageId: string; channel: 'email' | 'text'; kind: 'prepared' | ReviewOutcomeAction; suppression: null}>
 | Readonly<{source: 'request'; messageId: null; channel: null; kind: 'pending' | 'skipped'; suppression: Suppression}>
);

function suppression(value: unknown): value is Suppression {
 return suppressions.some(reason => reason === value);
}

function parseCursor(value: unknown): ReviewHistoryCursor {
 check(exact(value, ['source', 'id']) && (value.source === 'event' || value.source === 'request') && uuid(value.id));
 return Object.freeze({source: value.source, id: value.id});
}

export function parseReviewHistoryQuery(value:unknown){
 check(exact(value,['scopeKind','scopeId','cursorSource','cursorId']) &&
  (value.scopeKind==='job'||value.scopeKind==='customer') && uuid(value.scopeId));
 const scope=Object.freeze({kind:value.scopeKind,id:value.scopeId});
 const cursor=value.cursorSource===null&&value.cursorId===null
  ?null:parseCursor({source:value.cursorSource,id:value.cursorId});
 return Object.freeze({scope,cursor});
}
export type ReviewHistoryQuery=ReturnType<typeof parseReviewHistoryQuery>;

function parseEntry(value: unknown, scope: ReviewHistoryScope): ReviewHistoryEntry {
 check(exact(value, [
  'source', 'id', 'jobId', 'customerId', 'requestId', 'messageId', 'kind', 'channel',
  'suppression', 'reason', 'effectiveAt', 'recordedAt', 'actorId',
 ]) && uuid(value.id) && uuid(value.jobId) && uuid(value.customerId) && uuid(value.requestId) &&
  uuid(value.actorId) && instant(value.effectiveAt) && instant(value.recordedAt) &&
  (value.reason === null || typeof value.reason === 'string' && value.reason.length <= 2000));
 check(scope.id === (scope.kind === 'job' ? value.jobId : value.customerId));
 const common = {
  id: value.id, jobId: value.jobId, customerId: value.customerId, requestId: value.requestId,
  actorId: value.actorId, effectiveAt: value.effectiveAt, recordedAt: value.recordedAt, reason: value.reason,
 };
 if (value.source === 'event') {
  check(uuid(value.messageId) && (value.channel === 'email' || value.channel === 'text') &&
   (value.kind === 'prepared' || isReviewOutcomeAction(value.kind)) && value.suppression === null);
  return Object.freeze({...common, source: 'event', messageId: value.messageId, channel: value.channel, kind: value.kind, suppression: null});
 }
 check(value.source === 'request' && value.messageId === null && value.channel === null &&
  (value.kind === 'pending' || value.kind === 'skipped') && suppression(value.suppression) &&
  value.requestId === value.id && value.effectiveAt === value.recordedAt);
 return Object.freeze({...common, source: 'request', messageId: null, channel: null, kind: value.kind, suppression: value.suppression});
}

export function parseReviewMessageHistory(value: unknown, businessId: string, scope: ReviewHistoryScope) {
 check(uuid(businessId) && uuid(scope.id) && (scope.kind === 'job' || scope.kind === 'customer'));
 check(exact(value, ['schemaVersion', 'businessId', 'scope', 'entries', 'next']) &&
  value.schemaVersion === 1 && value.businessId === businessId &&
  exact(value.scope, ['kind', 'id']) && value.scope.kind === scope.kind && value.scope.id === scope.id &&
  Array.isArray(value.entries) && value.entries.length <= 20);
 const entries = value.entries.map(entry => parseEntry(entry, scope));
 const keys = entries.map(entry => entry.recordedAt + ':' + entry.source + ':' + entry.id);
 check(keys.every((key, index) => index === 0 || keys[index - 1]! > key));
 check(new Set(entries.map(entry => entry.source + ':' + entry.id)).size === entries.length);
 const next = value.next === null ? null : parseCursor(value.next);
 if (next) {
  const last = entries.at(-1);
  check(entries.length === 20 && last?.source === next.source && last.id === next.id);
 }
 return Object.freeze({schemaVersion: 1 as const, businessId, scope: Object.freeze({...scope}), entries: Object.freeze(entries), next});
}

export type ReviewHistoryPage = ReturnType<typeof parseReviewMessageHistory>;
