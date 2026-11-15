import {customerDate, customerUuid, customerVersion, exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason as reviewed, requireFinanceAccount as check} from './finance-account-contract.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';

const positive = (value: unknown): value is string => isFinanceCents(value) && value !== '0';
const dated = (value: unknown): value is string => customerDate(value) && value >= '1900-01-01';
const modes = ['recording_error', 'settled_failure'] as const;
const kinds = ['allocation', 'application', 'funds', 'tip'] as const;
export type CollectionFailureMode = typeof modes[number];
export type CollectionFailureKind = typeof kinds[number];
const isMode = (value: unknown): value is CollectionFailureMode => modes.some(mode => mode === value);
const isKind = (value: unknown): value is CollectionFailureKind => kinds.some(kind => kind === value);
type Range = {firstCent: string; lastCent: string};

function orderedRange(value: unknown): Range {
  check(exact(value, ['firstCent', 'lastCent']) && positive(value.firstCent) && positive(value.lastCent)
    && BigInt(value.firstCent) <= BigInt(value.lastCent));
  return {firstCent: value.firstCent, lastCent: value.lastCent};
}

function rangeLength(range: Range) {
  return BigInt(range.lastCent) - BigInt(range.firstCent) + 1n;
}

function separateRanges(ranges: readonly Range[]) {
  const sorted = [...ranges].sort((a, b) => BigInt(a.firstCent) < BigInt(b.firstCent) ? -1 : 1);
  check(sorted.every((range, index) => index === 0 || BigInt(sorted[index - 1]!.lastCent) < BigInt(range.firstCent)));
}

export function parseCollectionFailureReference(value: unknown) {
  check(exact(value, ['operationId', 'recoveryEpoch', 'collectionFailureId']) && customerUuid(value.operationId)
    && customerUuid(value.recoveryEpoch) && customerUuid(value.collectionFailureId));
  return {operationId: value.operationId, recoveryEpoch: value.recoveryEpoch, collectionFailureId: value.collectionFailureId};
}

function selection(value: unknown) {
  check(exact(value, ['kind', 'sourceId', 'firstCent', 'lastCent']) && isKind(value.kind) && customerUuid(value.sourceId));
  return {kind: value.kind, sourceId: value.sourceId, ...orderedRange({firstCent: value.firstCent, lastCent: value.lastCent})};
}

function checkSelection(components: readonly ReturnType<typeof selection>[], cents: string) {
  const bySource = new Map<string, Range[]>();
  let total = 0n;
  for (const component of components) {
    const key = component.kind + ':' + component.sourceId;
    const ranges = bySource.get(key) ?? [];
    ranges.push(component);
    bySource.set(key, ranges);
    total += rangeLength(component);
  }
  for (const ranges of bySource.values()) separateRanges(ranges);
  check(total === BigInt(cents));
}

export function parseCollectionFailureInput(value: unknown) {
  check(exact(value, ['reference', 'originalPaymentId', 'customerId', 'kind', 'channelId', 'channelVersion',
    'effectiveOn', 'verifiedCents', 'confirmation', 'reason', 'externalIdentity', 'components'])
    && customerUuid(value.originalPaymentId) && customerUuid(value.customerId) && isMode(value.kind)
    && dated(value.effectiveOn) && positive(value.verifiedCents) && reviewed(value.confirmation) && reviewed(value.reason)
    && Array.isArray(value.components) && value.components.length > 0 && value.components.length <= 180);
  const components = value.components.map(selection);
  checkSelection(components, value.verifiedCents);
  const base = {reference: parseCollectionFailureReference(value.reference), originalPaymentId: value.originalPaymentId,
    customerId: value.customerId, effectiveOn: value.effectiveOn, verifiedCents: value.verifiedCents,
    confirmation: value.confirmation, reason: value.reason, components};
  if (value.kind === 'recording_error') {
    check(value.channelId === null && value.channelVersion === null && value.externalIdentity === null);
    return {...base, kind: value.kind, channelId: null, channelVersion: null, externalIdentity: null};
  }
  const identity = value.externalIdentity;
  check(customerUuid(value.channelId) && customerVersion(value.channelVersion) && exact(identity, ['namespace', 'id', 'rawReference'])
    && typeof identity.namespace === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(identity.namespace)
    && reviewed(identity.id) && [...identity.id].length <= 200 && reviewed(identity.rawReference));
  return {...base, kind: value.kind, channelId: value.channelId, channelVersion: value.channelVersion,
    externalIdentity: {namespace: identity.namespace, id: identity.id, rawReference: identity.rawReference}};
}

export function parseCollectionFailureOptions(value: unknown, businessId: string, customerId: string, originalPaymentId: string, effectiveOn: string) {
  check(exact(value, ['schemaVersion', 'businessId', 'customerId', 'originalPaymentId', 'effectiveOn', 'receivedOn', 'originalCents',
    'originalAccountLabel', 'openPeriod', 'components', 'channels']) && value.schemaVersion === 1
    && value.businessId === businessId && value.customerId === customerId && value.originalPaymentId === originalPaymentId
    && value.effectiveOn === effectiveOn && dated(effectiveOn) && dated(value.receivedOn) && value.receivedOn <= effectiveOn
    && positive(value.originalCents) && reviewed(value.originalAccountLabel) && typeof value.openPeriod === 'boolean'
    && Array.isArray(value.components) && value.components.length <= 180 && Array.isArray(value.channels) && value.channels.length <= 180);
  const maximum = BigInt(value.originalCents);
  const components = value.components.map((component: unknown) => {
    check(exact(component, ['kind', 'sourceId', 'label', 'availableRanges']) && isKind(component.kind) && customerUuid(component.sourceId)
      && reviewed(component.label) && Array.isArray(component.availableRanges)
      && component.availableRanges.length > 0 && component.availableRanges.length <= 180);
    const ranges = component.availableRanges.map(orderedRange);
    separateRanges(ranges);
    check(ranges.every(range => BigInt(range.lastCent) <= maximum));
    return {kind: component.kind, sourceId: component.sourceId, label: component.label, availableRanges: ranges};
  });
  const channels = value.channels.map((channel: unknown) => {
    check(exact(channel, ['channelId', 'version', 'label', 'kind']) && customerUuid(channel.channelId)
      && customerVersion(channel.version) && reviewed(channel.label) && (channel.kind === 'bank' || channel.kind === 'wallet'));
    return {channelId: channel.channelId, version: channel.version, label: channel.label, kind: channel.kind};
  });
  check(new Set(components.map(component => component.kind + ':' + component.sourceId)).size === components.length
    && new Set(channels.map(channel => channel.channelId)).size === channels.length);
  return {effectiveOn, receivedOn: value.receivedOn, originalCents: value.originalCents, originalAccountLabel: value.originalAccountLabel,
    openPeriod: value.openPeriod, components, channels};
}

export function parseCollectionFailurePayments(value: unknown, businessId: string, customerId: string) {
  check(exact(value, ['schemaVersion', 'businessId', 'customerId', 'hasMore', 'payments']) && value.schemaVersion === 1
    && value.businessId === businessId && value.customerId === customerId && typeof value.hasMore === 'boolean'
    && Array.isArray(value.payments) && value.payments.length <= 50 && (!value.hasMore || value.payments.length === 50));
  const payments = value.payments.map((payment: unknown) => {
    check(exact(payment, ['paymentId', 'receivedOn', 'cents', 'channelLabel']) && customerUuid(payment.paymentId)
      && dated(payment.receivedOn) && positive(payment.cents) && reviewed(payment.channelLabel));
    return {paymentId: payment.paymentId, receivedOn: payment.receivedOn, cents: payment.cents, channelLabel: payment.channelLabel};
  });
  check(new Set(payments.map(payment => payment.paymentId)).size === payments.length
    && payments.every((payment, index) => !index || payment.receivedOn <= payments[index - 1]!.receivedOn));
  return {hasMore: value.hasMore, payments};
}

export function parseCollectionFailureResult(value: unknown, businessId: string, reference: ReturnType<typeof parseCollectionFailureReference>) {
  if (exact(value, ['state']) && value.state === 'absent') return {state: 'absent'} as const;
  if (exact(value, ['state', 'reason']) && value.state === 'conflict' && value.reason === 'operation') {
    return {state: 'conflict', reason: 'operation'} as const;
  }
  check(exact(value, ['state', 'receipt']));
  const receipt = value.receipt;
  if (value.state === 'retired') {
    check(exact(receipt, ['schemaVersion', 'businessId', 'operationId', 'collectionFailureId', 'originalEpoch', 'reviewEpoch', 'reason'])
      && receipt.schemaVersion === 1 && receipt.businessId === businessId && receipt.operationId === reference.operationId
      && receipt.collectionFailureId === reference.collectionFailureId && receipt.originalEpoch === reference.recoveryEpoch
      && customerUuid(receipt.reviewEpoch) && reviewed(receipt.reason));
    return {state: 'retired', receipt: {collectionFailureId: reference.collectionFailureId, reviewEpoch: receipt.reviewEpoch, reason: receipt.reason}} as const;
  }
  check(value.state === 'committed' && exact(receipt, ['schemaVersion', 'businessId', 'collectionFailureId', 'operationId', 'eventId',
    'originalPaymentId', 'customerId', 'kind', 'moneyAccountId', 'moneyChannelId', 'moneyChannelVersion', 'moneyMovementId', 'evidenceId',
    'effectiveOn', 'cents', 'confirmation', 'reason', 'components'])
    && receipt.schemaVersion === 1 && receipt.businessId === businessId && receipt.operationId === reference.operationId
    && receipt.collectionFailureId === reference.collectionFailureId && customerUuid(receipt.eventId)
    && customerUuid(receipt.originalPaymentId) && customerUuid(receipt.customerId) && isMode(receipt.kind)
    && customerUuid(receipt.moneyAccountId) && customerUuid(receipt.moneyChannelId) && customerVersion(receipt.moneyChannelVersion)
    && (receipt.kind === 'settled_failure' && customerUuid(receipt.moneyMovementId) && customerUuid(receipt.evidenceId)
      || receipt.kind === 'recording_error' && receipt.moneyMovementId === null && receipt.evidenceId === null)
    && dated(receipt.effectiveOn) && positive(receipt.cents) && reviewed(receipt.confirmation) && reviewed(receipt.reason)
    && Array.isArray(receipt.components) && receipt.components.length > 0 && receipt.components.length <= 180);
  const components = receipt.components.map((component: unknown) => {
    check(exact(component, ['componentId', 'kind', 'sourceId', 'firstCent', 'lastCent', 'rootFirstCent', 'rootLastCent', 'netCents', 'taxCents'])
      && customerUuid(component.componentId) && isFinanceCents(component.netCents) && isFinanceCents(component.taxCents));
    const item = selection({kind: component.kind, sourceId: component.sourceId, firstCent: component.firstCent, lastCent: component.lastCent});
    const rootRange = orderedRange({firstCent: component.rootFirstCent, lastCent: component.rootLastCent});
    check(rangeLength(item) === rangeLength(rootRange)
      && BigInt(component.netCents) + BigInt(component.taxCents) === rangeLength(item)
      && (item.kind === 'tip' || component.taxCents === '0'
        && item.firstCent === rootRange.firstCent && item.lastCent === rootRange.lastCent));
    return {...item, componentId: component.componentId, rootFirstCent: rootRange.firstCent, rootLastCent: rootRange.lastCent,
      netCents: component.netCents, taxCents: component.taxCents};
  });
  checkSelection(components, receipt.cents);
  separateRanges(components.map(component => ({firstCent: component.rootFirstCent, lastCent: component.rootLastCent})));
  check(new Set(components.map(component => component.componentId)).size === components.length);
  return {state: 'committed', receipt: {
    schemaVersion: 1, businessId, operationId: reference.operationId, collectionFailureId: reference.collectionFailureId,
    eventId: receipt.eventId, originalPaymentId: receipt.originalPaymentId, customerId: receipt.customerId, kind: receipt.kind,
    moneyAccountId: receipt.moneyAccountId, moneyChannelId: receipt.moneyChannelId, moneyChannelVersion: receipt.moneyChannelVersion,
    moneyMovementId: receipt.moneyMovementId, evidenceId: receipt.evidenceId, effectiveOn: receipt.effectiveOn, cents: receipt.cents,
    confirmation: receipt.confirmation, reason: receipt.reason, components,
  }} as const;
}

export function collectionFailureMatchesInput(
  receipt: Extract<ReturnType<typeof parseCollectionFailureResult>, {state: 'committed'}>['receipt'],
  input: ReturnType<typeof parseCollectionFailureInput>,
) {
  return receipt.originalPaymentId === input.originalPaymentId && receipt.customerId === input.customerId
    && receipt.kind === input.kind && (input.kind === 'recording_error'
      || receipt.moneyChannelId === input.channelId && receipt.moneyChannelVersion === input.channelVersion)
    && receipt.effectiveOn === input.effectiveOn && receipt.cents === input.verifiedCents
    && receipt.confirmation === input.confirmation && receipt.reason === input.reason
    && receipt.components.length === input.components.length && input.components.every(selected => receipt.components.some(component =>
      selected.kind === component.kind && selected.sourceId === component.sourceId
      && selected.firstCent === component.firstCent && selected.lastCent === component.lastCent));
}

const refusals = {
  COLLECTION_FAILURE_ORIGINAL_ACCOUNT_REQUIRED: 'original_account_unavailable',
  COLLECTION_FAILURE_EVIDENCE_REQUIRED: 'evidence_required',
  COLLECTION_FAILURE_ORIGINAL_REQUIRED: 'source_unavailable',
  COLLECTION_FAILURE_DATE_REQUIRED: 'invalid_date',
  COLLECTION_FAILURE_AMOUNT_UNAVAILABLE: 'amount_unavailable',
  COLLECTION_FAILURE_ALREADY_RECORDED: 'id_conflict',
  COLLECTION_FAILURE_VERIFIED_CHANNEL_REQUIRED: 'channel_review_required',
  COLLECTION_FAILURE_EXTERNAL_ID_ALREADY_RECORDED: 'external_id_already_recorded',
  COLLECTION_FAILURE_RANGE_UNAVAILABLE: 'range_unavailable',
} as const;

export function collectionFailureRefusal(value: unknown) {
  return typeof value === 'string' && Object.hasOwn(refusals, value) ? refusals[value as keyof typeof refusals] : null;
}
