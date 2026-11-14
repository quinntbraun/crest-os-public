import {customerDate, customerUuid, customerVersion, exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason as reviewed, requireFinanceAccount as check} from './finance-account-contract.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';

const positive = (value: unknown): value is string => isFinanceCents(value) && value !== '0';
const actualDate = (value: unknown): value is string => customerDate(value) && value >= '1900-01-01';
const receiptKeys = ['schemaVersion', 'businessId', 'operationId', 'recreditId', 'eventId', 'failureId',
  'failureComponentId', 'originalPaymentId', 'originalEventId', 'customerId', 'fundingOriginId',
  'previousFundLotId', 'fundLotId', 'fundsAccountId', 'fundsMappingId', 'moneyAccountId', 'moneyChannelId',
  'moneyChannelVersion', 'moneyMovementId', 'evidenceId', 'actualOn', 'firstCent', 'lastCent', 'cents',
  'confirmation', 'reason'];

function covers(first: string, last: string, cents: string) {
  return BigInt(last) - BigInt(first) + 1n === BigInt(cents);
}

export function parseCollectionFailureRecreditReference(value: unknown) {
  check(exact(value, ['operationId', 'recoveryEpoch', 'recreditId']) && customerUuid(value.operationId)
    && customerUuid(value.recoveryEpoch) && customerUuid(value.recreditId));
  return {operationId: value.operationId, recoveryEpoch: value.recoveryEpoch, recreditId: value.recreditId};
}

export function parseCollectionFailureRecreditInput(value: unknown) {
  check(exact(value, ['reference', 'failureId', 'customerId', 'failureComponentId', 'channelId', 'channelVersion',
    'actualOn', 'firstCent', 'lastCent', 'verifiedCents', 'confirmation', 'reason', 'externalIdentity'])
    && customerUuid(value.failureId) && customerUuid(value.customerId) && customerUuid(value.failureComponentId)
    && customerUuid(value.channelId) && customerVersion(value.channelVersion) && actualDate(value.actualOn)
    && positive(value.firstCent) && positive(value.lastCent) && positive(value.verifiedCents)
    && covers(value.firstCent, value.lastCent, value.verifiedCents) && reviewed(value.confirmation) && reviewed(value.reason));
  const identity = value.externalIdentity;
  check(exact(identity, ['namespace', 'id', 'rawReference']) && typeof identity.namespace === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(identity.namespace)
    && reviewed(identity.id) && [...identity.id].length <= 200 && reviewed(identity.rawReference));
  return {reference: parseCollectionFailureRecreditReference(value.reference), failureId: value.failureId,
    customerId: value.customerId, failureComponentId: value.failureComponentId, channelId: value.channelId,
    channelVersion: value.channelVersion, actualOn: value.actualOn, firstCent: value.firstCent, lastCent: value.lastCent,
    verifiedCents: value.verifiedCents, confirmation: value.confirmation, reason: value.reason,
    externalIdentity: {namespace: identity.namespace, id: identity.id, rawReference: identity.rawReference}};
}

export function parseCollectionFailureRecreditResult(value: unknown, businessId: string,
  reference: ReturnType<typeof parseCollectionFailureRecreditReference>) {
  if (exact(value, ['state']) && value.state === 'absent') return {state: 'absent'} as const;
  if (exact(value, ['state', 'reason']) && value.state === 'conflict' && value.reason === 'operation') {
    return {state: 'conflict', reason: 'operation'} as const;
  }
  check(exact(value, ['state', 'receipt']));
  const receipt = value.receipt;
  if (value.state === 'retired') {
    check(exact(receipt, ['schemaVersion', 'businessId', 'operationId', 'recreditId', 'originalEpoch', 'reviewEpoch', 'reason'])
      && receipt.schemaVersion === 1 && receipt.businessId === businessId && receipt.operationId === reference.operationId
      && receipt.recreditId === reference.recreditId && receipt.originalEpoch === reference.recoveryEpoch
      && customerUuid(receipt.reviewEpoch) && reviewed(receipt.reason));
    return {state: 'retired', receipt: {recreditId: reference.recreditId, reviewEpoch: receipt.reviewEpoch, reason: receipt.reason}} as const;
  }
  check(value.state === 'committed' && exact(receipt, receiptKeys) && receipt.schemaVersion === 1
    && receipt.businessId === businessId && receipt.operationId === reference.operationId && receipt.recreditId === reference.recreditId
    && customerUuid(receipt.eventId) && customerUuid(receipt.failureId) && customerUuid(receipt.failureComponentId)
    && customerUuid(receipt.originalPaymentId) && customerUuid(receipt.originalEventId) && customerUuid(receipt.customerId)
    && customerUuid(receipt.fundingOriginId) && customerUuid(receipt.previousFundLotId) && customerUuid(receipt.fundLotId)
    && receipt.previousFundLotId !== receipt.fundLotId && customerUuid(receipt.fundsAccountId) && customerUuid(receipt.fundsMappingId)
    && customerUuid(receipt.moneyAccountId) && receipt.moneyAccountId !== receipt.fundsAccountId
    && customerUuid(receipt.moneyChannelId) && customerVersion(receipt.moneyChannelVersion)
    && customerUuid(receipt.moneyMovementId) && customerUuid(receipt.evidenceId) && actualDate(receipt.actualOn)
    && positive(receipt.firstCent) && positive(receipt.lastCent) && positive(receipt.cents)
    && covers(receipt.firstCent, receipt.lastCent, receipt.cents) && reviewed(receipt.confirmation) && reviewed(receipt.reason));
  return {state: 'committed', receipt: {
    schemaVersion: 1, businessId, operationId: reference.operationId, recreditId: reference.recreditId,
    eventId: receipt.eventId, failureId: receipt.failureId, failureComponentId: receipt.failureComponentId,
    originalPaymentId: receipt.originalPaymentId, originalEventId: receipt.originalEventId, customerId: receipt.customerId,
    fundingOriginId: receipt.fundingOriginId, previousFundLotId: receipt.previousFundLotId, fundLotId: receipt.fundLotId,
    fundsAccountId: receipt.fundsAccountId, fundsMappingId: receipt.fundsMappingId, moneyAccountId: receipt.moneyAccountId,
    moneyChannelId: receipt.moneyChannelId, moneyChannelVersion: receipt.moneyChannelVersion,
    moneyMovementId: receipt.moneyMovementId, evidenceId: receipt.evidenceId, actualOn: receipt.actualOn,
    firstCent: receipt.firstCent, lastCent: receipt.lastCent, cents: receipt.cents,
    confirmation: receipt.confirmation, reason: receipt.reason,
  }} as const;
}

export function collectionFailureRecreditMatchesInput(
  receipt: Extract<ReturnType<typeof parseCollectionFailureRecreditResult>, {state: 'committed'}>['receipt'],
  input: ReturnType<typeof parseCollectionFailureRecreditInput>,
) {
  return receipt.failureId === input.failureId && receipt.failureComponentId === input.failureComponentId
    && receipt.customerId === input.customerId && receipt.moneyChannelId === input.channelId
    && receipt.moneyChannelVersion === input.channelVersion && receipt.actualOn === input.actualOn
    && receipt.firstCent === input.firstCent && receipt.lastCent === input.lastCent && receipt.cents === input.verifiedCents
    && receipt.confirmation === input.confirmation && receipt.reason === input.reason;
}


export function parseCollectionFailureRecreditOptions(value: unknown, businessId: string, customerId: string,
  failureId: string, date: string) {
  if (exact(value, ['state']) && value.state === 'absent') return {state: 'absent'} as const;
  check(exact(value, ['state', 'schemaVersion', 'businessId', 'customerId', 'failureId', 'originalPaymentId',
    'failedOn', 'actualOn', 'openPeriod', 'fundsMapping', 'components', 'channels'])
    && value.state === 'ready' && value.schemaVersion === 1 && value.businessId === businessId
    && value.customerId === customerId && value.failureId === failureId && customerUuid(value.originalPaymentId)
    && value.actualOn === date && actualDate(date) && actualDate(value.failedOn) && value.failedOn <= date
    && typeof value.openPeriod === 'boolean' && Array.isArray(value.components) && value.components.length <= 180
    && Array.isArray(value.channels) && value.channels.length <= 180);
  const mapping = value.fundsMapping;
  check(mapping === null || exact(mapping, ['mappingId', 'accountId', 'label']) && customerUuid(mapping.mappingId)
    && customerUuid(mapping.accountId) && reviewed(mapping.label));
  const components = value.components.map((item: unknown) => {
    check(exact(item, ['failureComponentId', 'previousFundLotId', 'availableRanges']) && customerUuid(item.failureComponentId)
      && customerUuid(item.previousFundLotId) && Array.isArray(item.availableRanges)
      && item.availableRanges.length > 0 && item.availableRanges.length <= 180);
    let previous = 0n;
    const ranges = item.availableRanges.map((range: unknown) => {
      check(exact(range, ['firstCent', 'lastCent']) && positive(range.firstCent) && positive(range.lastCent)
        && BigInt(range.firstCent) > previous && BigInt(range.lastCent) >= BigInt(range.firstCent));
      previous = BigInt(range.lastCent);
      return {firstCent: range.firstCent, lastCent: range.lastCent};
    });
    return {failureComponentId: item.failureComponentId, previousFundLotId: item.previousFundLotId, availableRanges: ranges};
  });
  check(new Set(components.map(component => component.failureComponentId)).size === components.length);
  const channels = value.channels.map((item: unknown) => {
    check(exact(item, ['channelId', 'version', 'label', 'kind']) && customerUuid(item.channelId)
      && customerVersion(item.version) && reviewed(item.label) && (item.kind === 'bank' || item.kind === 'wallet'));
    return {channelId: item.channelId, version: item.version, label: item.label, kind: item.kind};
  });
  check(new Set(channels.map(channel => channel.channelId)).size === channels.length);
  return {state: 'ready', actualOn: date, openPeriod: value.openPeriod, failureId, originalPaymentId: value.originalPaymentId,
    failedOn: value.failedOn, fundsMapping: mapping, components, channels} as const;
}


export function parseCollectionFailureRecreditList(value: unknown, businessId: string, customerId: string) {
  if (exact(value, ['state']) && value.state === 'absent') return {state: 'absent'} as const;
  check(exact(value, ['state', 'schemaVersion', 'businessId', 'customerId', 'hasMore', 'failures'])
    && value.state === 'ready' && value.schemaVersion === 1 && value.businessId === businessId
    && value.customerId === customerId && typeof value.hasMore === 'boolean' && Array.isArray(value.failures)
    && value.failures.length <= 50 && (!value.hasMore || value.failures.length === 50));
  const failures = value.failures.map((item: unknown) => {
    check(exact(item, ['failureId', 'originalPaymentId', 'failedOn', 'cents', 'availableCents'])
      && customerUuid(item.failureId) && customerUuid(item.originalPaymentId) && actualDate(item.failedOn)
      && positive(item.cents) && positive(item.availableCents) && BigInt(item.availableCents) <= BigInt(item.cents));
    return {failureId: item.failureId, originalPaymentId: item.originalPaymentId, failedOn: item.failedOn,
      cents: item.cents, availableCents: item.availableCents};
  });
  check(new Set(failures.map(failure => failure.failureId)).size === failures.length);
  return {state: 'ready', hasMore: value.hasMore, failures} as const;
}

const recreditRefusals = {
  COLLECTION_RECREDIT_INPUT_REQUIRED: 'input_required',
  COLLECTION_RECREDIT_FAILURE_REQUIRED: 'source_unavailable',
  COLLECTION_RECREDIT_RANGE_UNAVAILABLE: 'range_unavailable',
  COLLECTION_RECREDIT_AMOUNT_REQUIRED: 'amount_required',
  COLLECTION_RECREDIT_DATE_REQUIRED: 'invalid_date',
  COLLECTION_RECREDIT_VERIFIED_CHANNEL_REQUIRED: 'channel_review_required',
  COLLECTION_RECREDIT_FUNDS_MAPPING_REQUIRED: 'mapping_required',
  COLLECTION_RECREDIT_EVIDENCE_REQUIRED: 'evidence_required',
  COLLECTION_RECREDIT_EXTERNAL_ID_ALREADY_RECORDED: 'external_id_already_recorded',
  COLLECTION_RECREDIT_ALREADY_RECORDED: 'id_conflict',
  COLLECTION_RECREDIT_OPTIONS_LIMIT: 'options_limit',
} as const;

export function collectionFailureRecreditRefusal(value: unknown) {
  return typeof value === 'string' && Object.hasOwn(recreditRefusals, value)
    ? recreditRefusals[value as keyof typeof recreditRefusals] : null;
}
