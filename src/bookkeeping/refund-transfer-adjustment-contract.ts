import {customerDate, customerUuid, customerVersion, exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason as reviewed, requireFinanceAccount as check} from './finance-account-contract.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';

export type RefundTransferKind = 'recredit' | 'retry';
type RefundObligation = 'service' | 'excess' | 'tip_return_due';
type RefundTemplate = 'P08' | 'P09' | 'P10';
const positive = (value: unknown): value is string => isFinanceCents(value) && value !== '0';
const dated = (value: unknown): value is string => customerDate(value) && value >= '1900-01-01';
const isTransferKind = (value: unknown): value is RefundTransferKind => value === 'recredit' || value === 'retry';
const obligations = {P08: 'service', P09: 'excess', P10: 'tip_return_due'} as const;
const isTemplate = (value: unknown): value is RefundTemplate =>
  typeof value === 'string' && Object.hasOwn(obligations, value);

function transferRanges(value: unknown, cents?: string) {
  check(Array.isArray(value) && value.length > 0 && value.length <= 180);
  let last = 0n;
  let total = 0n;
  const ranges = value.map((range: unknown) => {
    check(exact(range, ['firstCent', 'lastCent']) && positive(range.firstCent) && positive(range.lastCent));
    const start = BigInt(range.firstCent), end = BigInt(range.lastCent);
    check(start > last && end >= start);
    last = end;
    total += end - start + 1n;
    return {firstCent: range.firstCent, lastCent: range.lastCent};
  });
  check(cents === undefined || total === BigInt(cents));
  return ranges;
}

export function parseRefundTransferReference(value: unknown) {
  check(exact(value, ['operationId', 'recoveryEpoch', 'refundTransferAdjustmentId']) && customerUuid(value.operationId)
    && customerUuid(value.recoveryEpoch) && customerUuid(value.refundTransferAdjustmentId));
  return {operationId: value.operationId, recoveryEpoch: value.recoveryEpoch, refundTransferAdjustmentId: value.refundTransferAdjustmentId};
}

export function parseRefundTransferInput(value: unknown) {
  check(exact(value, ['reference', 'priorEventId', 'customerId', 'kind', 'channelId', 'channelVersion',
    'actualOn', 'verifiedCents', 'confirmation', 'reason', 'externalIdentity', 'ranges'])
    && customerUuid(value.priorEventId) && customerUuid(value.customerId) && isTransferKind(value.kind)
    && customerUuid(value.channelId) && customerVersion(value.channelVersion) && dated(value.actualOn)
    && positive(value.verifiedCents) && reviewed(value.confirmation) && reviewed(value.reason));
  const external = value.externalIdentity;
  check(exact(external, ['namespace', 'id', 'rawReference']) && typeof external.namespace === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(external.namespace)
    && reviewed(external.id) && [...external.id].length <= 200 && reviewed(external.rawReference));
  return {
    reference: parseRefundTransferReference(value.reference), priorEventId: value.priorEventId, customerId: value.customerId,
    kind: value.kind, channelId: value.channelId, channelVersion: value.channelVersion, actualOn: value.actualOn,
    verifiedCents: value.verifiedCents, confirmation: value.confirmation, reason: value.reason,
    externalIdentity: {namespace: external.namespace, id: external.id, rawReference: external.rawReference},
    ranges: transferRanges(value.ranges, value.verifiedCents),
  };
}

export function parseRefundTransferOptions(value: unknown, businessId: string, customerId: string, kind: RefundTransferKind, actualOn: string) {
  check(exact(value, ['schemaVersion', 'businessId', 'customerId', 'kind', 'actualOn', 'openPeriod', 'hasMore', 'refunds', 'channels'])
    && value.schemaVersion === 1 && value.businessId === businessId && value.customerId === customerId && value.kind === kind
    && value.actualOn === actualOn && dated(actualOn) && typeof value.openPeriod === 'boolean' && typeof value.hasMore === 'boolean'
    && Array.isArray(value.refunds) && value.refunds.length <= 50 && (!value.hasMore || value.refunds.length === 50)
    && Array.isArray(value.channels) && value.channels.length <= 180);
  const refunds = value.refunds.map((prior: unknown) => {
    check(exact(prior, ['priorEventId', 'originalEventId', 'priorOn', 'originalTemplate', 'priorAccountLabel', 'availableRanges'])
      && customerUuid(prior.priorEventId) && customerUuid(prior.originalEventId) && dated(prior.priorOn) && prior.priorOn <= actualOn
      && isTemplate(prior.originalTemplate) && reviewed(prior.priorAccountLabel));
    return {priorEventId: prior.priorEventId, originalEventId: prior.originalEventId, priorOn: prior.priorOn,
      originalTemplate: prior.originalTemplate, obligationType: obligations[prior.originalTemplate], priorAccountLabel: prior.priorAccountLabel,
      availableRanges: transferRanges(prior.availableRanges)};
  });
  const channels = value.channels.map((channel: unknown) => {
    check(exact(channel, ['channelId', 'version', 'label', 'kind']) && customerUuid(channel.channelId)
      && customerVersion(channel.version) && reviewed(channel.label) && (channel.kind === 'bank' || channel.kind === 'wallet'));
    return {channelId: channel.channelId, version: channel.version, label: channel.label, kind: channel.kind};
  });
  check(new Set(refunds.map(refund => refund.priorEventId)).size === refunds.length
    && new Set(channels.map(channel => channel.channelId)).size === channels.length);
  return {kind, actualOn, openPeriod: value.openPeriod, hasMore: value.hasMore, refunds, channels};
}

export function parseRefundTransferResult(value: unknown, businessId: string, reference: ReturnType<typeof parseRefundTransferReference>) {
  if (exact(value, ['state']) && value.state === 'absent') return {state: 'absent'} as const;
  if (exact(value, ['state', 'reason']) && value.state === 'conflict' && value.reason === 'operation') {
    return {state: 'conflict', reason: 'operation'} as const;
  }
  check(exact(value, ['state', 'receipt']));
  const receipt = value.receipt;
  if (value.state === 'retired') {
    check(exact(receipt, ['schemaVersion', 'businessId', 'operationId', 'refundTransferAdjustmentId', 'originalEpoch', 'reviewEpoch', 'reason'])
      && receipt.schemaVersion === 1 && receipt.businessId === businessId && receipt.operationId === reference.operationId
      && receipt.refundTransferAdjustmentId === reference.refundTransferAdjustmentId && receipt.originalEpoch === reference.recoveryEpoch
      && customerUuid(receipt.reviewEpoch) && reviewed(receipt.reason));
    return {state: 'retired', receipt: {...reference, reviewEpoch: receipt.reviewEpoch, reason: receipt.reason}} as const;
  }
  check(value.state === 'committed' && exact(receipt, ['schemaVersion', 'businessId', 'refundTransferAdjustmentId', 'operationId',
    'eventId', 'originalEventId', 'priorEventId', 'originalTemplate', 'obligationType', 'kind', 'fundLotId', 'fundingOriginId',
    'customerId', 'fundsAccountId', 'fundsMappingId', 'moneyAccountId', 'moneyChannelId', 'moneyChannelVersion',
    'moneyMovementId', 'evidenceId', 'actualOn', 'cents', 'confirmation', 'reason', 'ranges'])
    && receipt.schemaVersion === 1 && receipt.businessId === businessId && receipt.operationId === reference.operationId
    && receipt.refundTransferAdjustmentId === reference.refundTransferAdjustmentId && customerUuid(receipt.eventId)
    && customerUuid(receipt.originalEventId) && customerUuid(receipt.priorEventId)
    && receipt.originalEventId !== receipt.eventId && receipt.priorEventId !== receipt.eventId
    && isTemplate(receipt.originalTemplate) && receipt.obligationType === obligations[receipt.originalTemplate] && isTransferKind(receipt.kind)
    && customerUuid(receipt.fundLotId) && customerUuid(receipt.fundingOriginId) && customerUuid(receipt.customerId)
    && customerUuid(receipt.fundsAccountId) && customerUuid(receipt.fundsMappingId) && customerUuid(receipt.moneyAccountId)
    && receipt.fundsAccountId !== receipt.moneyAccountId && customerUuid(receipt.moneyChannelId)
    && customerVersion(receipt.moneyChannelVersion) && customerUuid(receipt.moneyMovementId) && customerUuid(receipt.evidenceId)
    && dated(receipt.actualOn) && positive(receipt.cents) && reviewed(receipt.confirmation) && reviewed(receipt.reason));
  const obligationType: RefundObligation = obligations[receipt.originalTemplate];
  return {state: 'committed', receipt: {
    schemaVersion: 1, businessId, refundTransferAdjustmentId: reference.refundTransferAdjustmentId, operationId: reference.operationId,
    eventId: receipt.eventId, originalEventId: receipt.originalEventId, priorEventId: receipt.priorEventId,
    originalTemplate: receipt.originalTemplate, obligationType, kind: receipt.kind, fundLotId: receipt.fundLotId,
    fundingOriginId: receipt.fundingOriginId, customerId: receipt.customerId, fundsAccountId: receipt.fundsAccountId,
    fundsMappingId: receipt.fundsMappingId, moneyAccountId: receipt.moneyAccountId, moneyChannelId: receipt.moneyChannelId,
    moneyChannelVersion: receipt.moneyChannelVersion, moneyMovementId: receipt.moneyMovementId, evidenceId: receipt.evidenceId,
    actualOn: receipt.actualOn, cents: receipt.cents, confirmation: receipt.confirmation, reason: receipt.reason,
    ranges: transferRanges(receipt.ranges, receipt.cents),
  }} as const;
}

export function refundTransferMatchesInput(
  receipt: Extract<ReturnType<typeof parseRefundTransferResult>, {state: 'committed'}>['receipt'],
  input: ReturnType<typeof parseRefundTransferInput>,
) {
  return receipt.priorEventId === input.priorEventId && receipt.customerId === input.customerId && receipt.kind === input.kind
    && receipt.moneyChannelId === input.channelId && receipt.moneyChannelVersion === input.channelVersion
    && receipt.actualOn === input.actualOn && receipt.cents === input.verifiedCents
    && receipt.confirmation === input.confirmation && receipt.reason === input.reason
    && receipt.ranges.length === input.ranges.length && receipt.ranges.every((range, index) =>
      range.firstCent === input.ranges[index]?.firstCent && range.lastCent === input.ranges[index]?.lastCent);
}

const refusals = {
  REFUND_TRANSFER_EVIDENCE_REQUIRED: 'evidence_required',
  REFUND_TRANSFER_AMOUNT_REQUIRED: 'amount_mismatch',
  REFUND_TRANSFER_PRIOR_REQUIRED: 'source_unavailable',
  REFUND_TRANSFER_DATE_REQUIRED: 'invalid_date',
  REFUND_TRANSFER_RANGE_UNAVAILABLE: 'range_unavailable',
  REFUND_TRANSFER_ALREADY_RECORDED: 'id_conflict',
  REFUND_TRANSFER_VERIFIED_CHANNEL_REQUIRED: 'channel_review_required',
  REFUND_TRANSFER_EXTERNAL_ID_ALREADY_RECORDED: 'external_id_already_recorded',
} as const;

export function refundTransferRefusal(value: unknown) {
  return typeof value === 'string' && Object.hasOwn(refusals, value) ? refusals[value as keyof typeof refusals] : null;
}
