import {customerDate, customerUuid, customerVersion, exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason, requireFinanceAccount as check} from './finance-account-contract.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';

export function parseExcessReturnReference(value: unknown) {
  check(exact(value, ['operationId', 'recoveryEpoch', 'excessReturnId'])
    && customerUuid(value.operationId) && customerUuid(value.recoveryEpoch) && customerUuid(value.excessReturnId));
  return {operationId: value.operationId, recoveryEpoch: value.recoveryEpoch, excessReturnId: value.excessReturnId};
}

const positive = (value: unknown): value is string => isFinanceCents(value) && value !== '0';

function validRange(first: string, last: string, cents: string) {
  return BigInt(last) >= BigInt(first) && BigInt(last) - BigInt(first) + 1n === BigInt(cents);
}

export function parseExcessReturnOptions(value: unknown, businessId: string, customerId: string, actualOn: string) {
  check(exact(value, ['schemaVersion', 'businessId', 'customerId', 'actualOn', 'openPeriod', 'lots', 'channels'])
    && value.schemaVersion === 1 && value.businessId === businessId && value.customerId === customerId
    && value.actualOn === actualOn && customerDate(value.actualOn) && typeof value.openPeriod === 'boolean'
    && Array.isArray(value.lots) && value.lots.length <= 180 && Array.isArray(value.channels) && value.channels.length <= 180);
  const lots = value.lots.map((lot: unknown) => {
    check(exact(lot, ['fundLotId', 'originalPaymentId', 'receivedOn', 'availableRanges'])
      && customerUuid(lot.fundLotId) && customerUuid(lot.originalPaymentId) && customerDate(lot.receivedOn)
      && lot.receivedOn <= actualOn && Array.isArray(lot.availableRanges)
      && lot.availableRanges.length > 0 && lot.availableRanges.length <= 180);
    const availableRanges = lot.availableRanges.map((range: unknown) => {
      check(exact(range, ['firstCent', 'lastCent']) && positive(range.firstCent) && positive(range.lastCent)
        && BigInt(range.firstCent) <= BigInt(range.lastCent));
      return {firstCent: range.firstCent, lastCent: range.lastCent};
    });
    check(availableRanges.every((range, index) => index === 0 || BigInt(availableRanges[index - 1]!.lastCent) + 1n < BigInt(range.firstCent)));
    return {fundLotId: lot.fundLotId, originalPaymentId: lot.originalPaymentId, receivedOn: lot.receivedOn, availableRanges};
  });
  const channels = value.channels.map((channel: unknown) => {
    check(exact(channel, ['channelId', 'version', 'label', 'kind']) && customerUuid(channel.channelId)
      && customerVersion(channel.version) && financeAccountReviewReason(channel.label)
      && (channel.kind === 'bank' || channel.kind === 'wallet'));
    return {channelId: channel.channelId, version: channel.version, label: channel.label, kind: channel.kind};
  });
  check(new Set(lots.map(lot => lot.fundLotId)).size === lots.length
    && new Set(channels.map(channel => channel.channelId)).size === channels.length);
  return {actualOn, openPeriod: value.openPeriod, lots, channels};
}

export function parseExcessReturnInput(value: unknown) {
  check(exact(value, ['reference', 'originalPaymentId', 'fundLotId', 'customerId', 'channelId', 'channelVersion',
    'actualOn', 'firstCent', 'lastCent', 'verifiedCents', 'confirmation', 'reason', 'externalIdentity'])
    && customerUuid(value.originalPaymentId) && customerUuid(value.fundLotId) && customerUuid(value.customerId)
    && customerUuid(value.channelId) && customerVersion(value.channelVersion)
    && customerDate(value.actualOn) && value.actualOn >= '1900-01-01'
    && positive(value.firstCent) && positive(value.lastCent) && positive(value.verifiedCents)
    && validRange(value.firstCent, value.lastCent, value.verifiedCents)
    && financeAccountReviewReason(value.confirmation) && financeAccountReviewReason(value.reason));
  const identity = value.externalIdentity;
  check(exact(identity, ['namespace', 'id', 'rawReference']) && typeof identity.namespace === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(identity.namespace)
    && financeAccountReviewReason(identity.id) && [...identity.id].length <= 200
    && financeAccountReviewReason(identity.rawReference));
  return {
    reference: parseExcessReturnReference(value.reference),
    originalPaymentId: value.originalPaymentId, fundLotId: value.fundLotId, customerId: value.customerId,
    channelId: value.channelId, channelVersion: value.channelVersion, actualOn: value.actualOn,
    firstCent: value.firstCent, lastCent: value.lastCent, verifiedCents: value.verifiedCents,
    confirmation: value.confirmation, reason: value.reason,
    externalIdentity: {namespace: identity.namespace, id: identity.id, rawReference: identity.rawReference},
  };
}

export function parseExcessReturnResult(value: unknown, businessId: string, reference: ReturnType<typeof parseExcessReturnReference>) {
  if (exact(value, ['state']) && value.state === 'absent') return {state: 'absent'} as const;
  if (exact(value, ['state', 'reason']) && value.state === 'conflict' && value.reason === 'operation') {
    return {state: 'conflict', reason: 'operation'} as const;
  }
  if (exact(value, ['state', 'receipt']) && value.state === 'retired') {
    const {receipt} = value;
    check(exact(receipt, ['schemaVersion', 'businessId', 'operationId', 'excessReturnId', 'originalEpoch', 'reviewEpoch', 'reason'])
      && receipt.schemaVersion === 1 && receipt.businessId === businessId && receipt.operationId === reference.operationId
      && receipt.excessReturnId === reference.excessReturnId && receipt.originalEpoch === reference.recoveryEpoch
      && customerUuid(receipt.reviewEpoch) && financeAccountReviewReason(receipt.reason));
    return {state: 'retired', receipt: {excessReturnId: reference.excessReturnId, reviewEpoch: receipt.reviewEpoch, reason: receipt.reason}} as const;
  }
  check(exact(value, ['state', 'receipt']) && value.state === 'committed');
  const {receipt} = value;
  check(exact(receipt, ['schemaVersion', 'businessId', 'excessReturnId', 'operationId', 'eventId', 'originalPaymentId',
    'originalReceiptEventId', 'fundLotId', 'fundingOriginId', 'parentPartitionId', 'customerId', 'fundsAccountId',
    'fundsMappingId', 'moneyAccountId', 'moneyMovementId', 'moneyChannelId', 'moneyChannelVersion', 'evidenceId',
    'actualOn', 'firstCent', 'lastCent', 'cents', 'confirmation', 'reason'])
    && receipt.schemaVersion === 1 && receipt.businessId === businessId
    && receipt.excessReturnId === reference.excessReturnId && receipt.operationId === reference.operationId
    && customerUuid(receipt.eventId) && customerUuid(receipt.originalPaymentId) && customerUuid(receipt.originalReceiptEventId)
    && receipt.originalReceiptEventId !== receipt.eventId && customerUuid(receipt.fundLotId)
    && customerUuid(receipt.fundingOriginId) && customerUuid(receipt.parentPartitionId) && customerUuid(receipt.customerId)
    && customerUuid(receipt.fundsAccountId) && customerUuid(receipt.fundsMappingId) && customerUuid(receipt.moneyAccountId)
    && receipt.fundsAccountId !== receipt.moneyAccountId && customerUuid(receipt.moneyMovementId)
    && customerUuid(receipt.moneyChannelId) && customerVersion(receipt.moneyChannelVersion) && customerUuid(receipt.evidenceId)
    && customerDate(receipt.actualOn) && receipt.actualOn >= '1900-01-01'
    && positive(receipt.firstCent) && positive(receipt.lastCent) && positive(receipt.cents)
    && validRange(receipt.firstCent, receipt.lastCent, receipt.cents)
    && financeAccountReviewReason(receipt.confirmation) && financeAccountReviewReason(receipt.reason));
  return {state: 'committed', receipt: {
    schemaVersion: 1, businessId, excessReturnId: reference.excessReturnId, operationId: reference.operationId,
    eventId: receipt.eventId, originalPaymentId: receipt.originalPaymentId, originalReceiptEventId: receipt.originalReceiptEventId,
    fundLotId: receipt.fundLotId, fundingOriginId: receipt.fundingOriginId, parentPartitionId: receipt.parentPartitionId,
    customerId: receipt.customerId, fundsAccountId: receipt.fundsAccountId, fundsMappingId: receipt.fundsMappingId,
    moneyAccountId: receipt.moneyAccountId, moneyMovementId: receipt.moneyMovementId, moneyChannelId: receipt.moneyChannelId,
    moneyChannelVersion: receipt.moneyChannelVersion, evidenceId: receipt.evidenceId, actualOn: receipt.actualOn,
    firstCent: receipt.firstCent, lastCent: receipt.lastCent, cents: receipt.cents, confirmation: receipt.confirmation, reason: receipt.reason,
  }} as const;
}

export function excessReturnMatchesInput(
  receipt: Extract<ReturnType<typeof parseExcessReturnResult>, {state: 'committed'}>['receipt'],
  input: ReturnType<typeof parseExcessReturnInput>,
) {
  return receipt.originalPaymentId === input.originalPaymentId && receipt.fundLotId === input.fundLotId
    && receipt.customerId === input.customerId && receipt.moneyChannelId === input.channelId
    && receipt.moneyChannelVersion === input.channelVersion && receipt.actualOn === input.actualOn
    && receipt.firstCent === input.firstCent && receipt.lastCent === input.lastCent && receipt.cents === input.verifiedCents
    && receipt.confirmation === input.confirmation && receipt.reason === input.reason;
}

const refusals = {
  EXCESS_RETURN_DATE_REQUIRED: 'invalid_date',
  EXCESS_RETURN_ORIGINAL_PAYMENT_REQUIRED: 'source_unavailable',
  EXCESS_RETURN_LOT_REQUIRED: 'source_unavailable',
  EXCESS_RETURN_RANGE_UNAVAILABLE: 'range_changed',
  EXCESS_RETURN_ALREADY_RECORDED: 'return_id_conflict',
  EXCESS_RETURN_VERIFIED_CHANNEL_REQUIRED: 'channel_review_required',
  EXCESS_RETURN_VERIFIED_AMOUNT_REQUIRED: 'amount_mismatch',
  EXCESS_RETURN_EXTERNAL_ID_ALREADY_RECORDED: 'external_return_already_recorded',
} as const;

export function excessReturnRefusal(value: unknown) {
  return typeof value === 'string' && Object.hasOwn(refusals, value) ? refusals[value as keyof typeof refusals] : null;
}
