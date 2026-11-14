import {customerDate, customerUuid, customerVersion, exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason, requireFinanceAccount as check} from './finance-account-contract.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';

const positive = (value: unknown): value is string => isFinanceCents(value) && value !== '0';

export function parseTipReturnReference(value: unknown) {
  check(exact(value, ['operationId', 'recoveryEpoch', 'tipReturnId']) && customerUuid(value.operationId)
    && customerUuid(value.recoveryEpoch) && customerUuid(value.tipReturnId));
  return {operationId: value.operationId, recoveryEpoch: value.recoveryEpoch, tipReturnId: value.tipReturnId};
}

export function parseTipReturnOptions(value: unknown, businessId: string, customerId: string, actualOn: string) {
  check(exact(value, ['schemaVersion', 'businessId', 'customerId', 'actualOn', 'openPeriod', 'tips', 'channels'])
    && value.schemaVersion === 1 && value.businessId === businessId && value.customerId === customerId
    && value.actualOn === actualOn && customerDate(actualOn) && typeof value.openPeriod === 'boolean'
    && Array.isArray(value.tips) && value.tips.length <= 180 && Array.isArray(value.channels) && value.channels.length <= 180);
  const tips = value.tips.map((tip: unknown) => {
    check(exact(tip, ['tipRealizationId', 'originalTipEventId', 'realizedOn', 'originalCents', 'availableCents'])
      && customerUuid(tip.tipRealizationId) && customerUuid(tip.originalTipEventId) && customerDate(tip.realizedOn)
      && tip.realizedOn <= actualOn && positive(tip.originalCents) && positive(tip.availableCents)
      && BigInt(tip.availableCents) <= BigInt(tip.originalCents));
    return {tipRealizationId: tip.tipRealizationId, originalTipEventId: tip.originalTipEventId, realizedOn: tip.realizedOn,
      originalCents: tip.originalCents, availableCents: tip.availableCents};
  });
  const channels = value.channels.map((channel: unknown) => {
    check(exact(channel, ['channelId', 'version', 'label', 'kind']) && customerUuid(channel.channelId)
      && customerVersion(channel.version) && financeAccountReviewReason(channel.label)
      && (channel.kind === 'bank' || channel.kind === 'wallet'));
    return {channelId: channel.channelId, version: channel.version, label: channel.label, kind: channel.kind};
  });
  check(new Set(tips.map(tip => tip.tipRealizationId)).size === tips.length
    && new Set(tips.map(tip => tip.originalTipEventId)).size === tips.length
    && new Set(channels.map(channel => channel.channelId)).size === channels.length);
  return {actualOn, openPeriod: value.openPeriod, tips, channels};
}

export function parseTipReturnInput(value: unknown) {
  check(exact(value, ['reference', 'tipRealizationId', 'customerId', 'channelId', 'channelVersion', 'actualOn',
    'verifiedCents', 'confirmation', 'reason', 'externalIdentity'])
    && customerUuid(value.tipRealizationId) && customerUuid(value.customerId) && customerUuid(value.channelId)
    && customerVersion(value.channelVersion) && customerDate(value.actualOn) && value.actualOn >= '1900-01-01'
    && positive(value.verifiedCents) && financeAccountReviewReason(value.confirmation) && financeAccountReviewReason(value.reason));
  const identity = value.externalIdentity;
  check(exact(identity, ['namespace', 'id', 'rawReference']) && typeof identity.namespace === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(identity.namespace) && financeAccountReviewReason(identity.id)
    && [...identity.id].length <= 200 && financeAccountReviewReason(identity.rawReference));
  return {
    reference: parseTipReturnReference(value.reference), tipRealizationId: value.tipRealizationId, customerId: value.customerId,
    channelId: value.channelId, channelVersion: value.channelVersion, actualOn: value.actualOn, verifiedCents: value.verifiedCents,
    confirmation: value.confirmation, reason: value.reason,
    externalIdentity: {namespace: identity.namespace, id: identity.id, rawReference: identity.rawReference},
  };
}

export function parseTipReturnResult(value: unknown, businessId: string, reference: ReturnType<typeof parseTipReturnReference>) {
  if (exact(value, ['state']) && value.state === 'absent') return {state: 'absent'} as const;
  if (exact(value, ['state', 'reason']) && value.state === 'conflict' && value.reason === 'operation') {
    return {state: 'conflict', reason: 'operation'} as const;
  }
  check(exact(value, ['state', 'receipt']));
  const {receipt} = value;
  if (value.state === 'retired') {
    check(exact(receipt, ['schemaVersion', 'businessId', 'operationId', 'tipReturnId', 'originalEpoch', 'reviewEpoch', 'reason'])
      && receipt.schemaVersion === 1 && receipt.businessId === businessId && receipt.operationId === reference.operationId
      && receipt.tipReturnId === reference.tipReturnId && receipt.originalEpoch === reference.recoveryEpoch
      && customerUuid(receipt.reviewEpoch) && financeAccountReviewReason(receipt.reason));
    return {state: 'retired', receipt: {tipReturnId: reference.tipReturnId, reviewEpoch: receipt.reviewEpoch, reason: receipt.reason}} as const;
  }
  check(value.state === 'committed' && exact(receipt, ['schemaVersion', 'businessId', 'tipReturnId', 'operationId', 'eventId',
    'tipRealizationId', 'originalTipEventId', 'fundLotId', 'fundingOriginId', 'customerId', 'revenueAccountId', 'revenueMappingId',
    'taxAccountId', 'taxMappingId', 'taxProfileId', 'moneyAccountId', 'moneyMovementId', 'moneyChannelId', 'moneyChannelVersion',
    'evidenceId', 'actualOn', 'cents', 'netCents', 'taxCents', 'confirmation', 'reason', 'ranges'])
    && receipt.schemaVersion === 1 && receipt.businessId === businessId && receipt.tipReturnId === reference.tipReturnId
    && receipt.operationId === reference.operationId && customerUuid(receipt.eventId) && customerUuid(receipt.tipRealizationId)
    && customerUuid(receipt.originalTipEventId) && receipt.originalTipEventId !== receipt.eventId && customerUuid(receipt.fundLotId)
    && customerUuid(receipt.fundingOriginId) && customerUuid(receipt.customerId) && customerUuid(receipt.revenueAccountId)
    && customerUuid(receipt.revenueMappingId) && customerUuid(receipt.taxProfileId) && customerUuid(receipt.moneyAccountId)
    && receipt.moneyAccountId !== receipt.revenueAccountId && customerUuid(receipt.moneyMovementId)
    && customerUuid(receipt.moneyChannelId) && customerVersion(receipt.moneyChannelVersion) && customerUuid(receipt.evidenceId)
    && customerDate(receipt.actualOn) && receipt.actualOn >= '1900-01-01' && positive(receipt.cents)
    && isFinanceCents(receipt.netCents) && isFinanceCents(receipt.taxCents)
    && BigInt(receipt.netCents) + BigInt(receipt.taxCents) === BigInt(receipt.cents)
    && (receipt.taxAccountId === null && receipt.taxMappingId === null && receipt.taxCents === '0'
      || customerUuid(receipt.taxAccountId) && receipt.taxAccountId !== receipt.moneyAccountId
      && receipt.taxAccountId !== receipt.revenueAccountId && customerUuid(receipt.taxMappingId))
    && financeAccountReviewReason(receipt.confirmation) && financeAccountReviewReason(receipt.reason)
    && Array.isArray(receipt.ranges) && receipt.ranges.length > 0 && receipt.ranges.length <= 180);
  let last = 0n, total = 0n;
  const ranges = receipt.ranges.map((range: unknown) => {
    check(exact(range, ['firstCent', 'lastCent']) && positive(range.firstCent) && positive(range.lastCent));
    const start = BigInt(range.firstCent), end = BigInt(range.lastCent);
    check(start > last && end >= start);
    last = end;
    total += end - start + 1n;
    return {firstCent: range.firstCent, lastCent: range.lastCent};
  });
  check(total === BigInt(receipt.cents));
  return {state: 'committed', receipt: {
    schemaVersion: 1, businessId, tipReturnId: reference.tipReturnId, operationId: reference.operationId, eventId: receipt.eventId,
    tipRealizationId: receipt.tipRealizationId, originalTipEventId: receipt.originalTipEventId, fundLotId: receipt.fundLotId,
    fundingOriginId: receipt.fundingOriginId, customerId: receipt.customerId, revenueAccountId: receipt.revenueAccountId,
    revenueMappingId: receipt.revenueMappingId, taxAccountId: receipt.taxAccountId, taxMappingId: receipt.taxMappingId, taxProfileId: receipt.taxProfileId,
    moneyAccountId: receipt.moneyAccountId, moneyMovementId: receipt.moneyMovementId, moneyChannelId: receipt.moneyChannelId,
    moneyChannelVersion: receipt.moneyChannelVersion, evidenceId: receipt.evidenceId, actualOn: receipt.actualOn, cents: receipt.cents,
    netCents: receipt.netCents, taxCents: receipt.taxCents, confirmation: receipt.confirmation, reason: receipt.reason, ranges,
  }} as const;
}

export function tipReturnMatchesInput(
  receipt: Extract<ReturnType<typeof parseTipReturnResult>, {state: 'committed'}>['receipt'],
  input: ReturnType<typeof parseTipReturnInput>,
) {
  return receipt.tipRealizationId === input.tipRealizationId && receipt.customerId === input.customerId
    && receipt.moneyChannelId === input.channelId && receipt.moneyChannelVersion === input.channelVersion
    && receipt.actualOn === input.actualOn && receipt.cents === input.verifiedCents
    && receipt.confirmation === input.confirmation && receipt.reason === input.reason;
}

const refusals = {
  TIP_RETURN_ORIGINAL_REQUIRED: 'source_unavailable',
  TIP_RETURN_DATE_REQUIRED: 'invalid_date',
  TIP_RETURN_ALREADY_RECORDED: 'return_id_conflict',
  TIP_RETURN_AMOUNT_UNAVAILABLE: 'amount_changed',
  TIP_RETURN_VERIFIED_CHANNEL_REQUIRED: 'channel_review_required',
  TIP_RETURN_EXTERNAL_ID_ALREADY_RECORDED: 'external_return_already_recorded',
} as const;

export function tipReturnRefusal(value: unknown) {
  return typeof value === 'string' && Object.hasOwn(refusals, value) ? refusals[value as keyof typeof refusals] : null;
}
