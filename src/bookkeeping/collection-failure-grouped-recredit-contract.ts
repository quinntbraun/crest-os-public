import {customerDate, customerUuid, customerVersion, exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason as reviewed, requireFinanceAccount as check} from './finance-account-contract.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';

export {parseCollectionFailureRecreditList} from './collection-failure-recredit-contract.ts';

const positive = (value: unknown): value is string => isFinanceCents(value) && value !== '0';
const dated = (value: unknown): value is string => customerDate(value) && value >= '1900-01-01';
const sourceKinds = ['allocation', 'application', 'funds', 'tip'] as const;
const receiptFields = ['schemaVersion', 'businessId', 'operationId', 'settlementId', 'eventId', 'failureId',
  'originalPaymentId', 'originalEventId', 'customerId', 'moneyAccountId', 'moneyChannelId', 'moneyChannelVersion',
  'moneyMovementId', 'evidenceId', 'actualOn', 'cents', 'confirmation', 'reason', 'components'];
const rangeFields = ['failureComponentId', 'firstCent', 'lastCent', 'disposition'];
const componentFields = [...rangeFields, 'settlementComponentId', 'parentPartitionId', 'cents', 'receivableId', 'fundLotId'];
type Range = {firstCent: string; lastCent: string};

function range(value: unknown): Range {
  check(exact(value, ['firstCent', 'lastCent']) && positive(value.firstCent) && positive(value.lastCent)
    && BigInt(value.lastCent) >= BigInt(value.firstCent));
  return {firstCent: value.firstCent, lastCent: value.lastCent};
}

function length(item: Range) {
  return BigInt(item.lastCent) - BigInt(item.firstCent) + 1n;
}

function canonicalRanges<T extends Range>(items: readonly T[], expected?: string) {
  const sorted = [...items].sort((a, b) => BigInt(a.firstCent) < BigInt(b.firstCent) ? -1 : 1);
  check(sorted.every((item, index) => index === 0 || BigInt(item.firstCent) > BigInt(sorted[index - 1]!.lastCent)));
  check(expected === undefined || sorted.reduce((sum, item) => sum + length(item), 0n) === BigInt(expected));
  return sorted;
}

function selection(value: unknown) {
  check(exact(value, rangeFields) && customerUuid(value.failureComponentId)
    && (value.disposition === 'receivable' || value.disposition === 'funds'));
  return {failureComponentId: value.failureComponentId, disposition: value.disposition,
    ...range({firstCent: value.firstCent, lastCent: value.lastCent})};
}

export function parseGroupedRecreditReference(value: unknown) {
  check(exact(value, ['operationId', 'recoveryEpoch', 'settlementId']) && customerUuid(value.operationId)
    && customerUuid(value.recoveryEpoch) && customerUuid(value.settlementId));
  return {operationId: value.operationId, recoveryEpoch: value.recoveryEpoch, settlementId: value.settlementId};
}

export function parseGroupedRecreditInput(value: unknown) {
  check(exact(value, ['reference', 'failureId', 'customerId', 'channelId', 'channelVersion', 'actualOn',
    'verifiedCents', 'confirmation', 'reason', 'externalIdentity', 'ranges'])
    && customerUuid(value.failureId) && customerUuid(value.customerId) && customerUuid(value.channelId)
    && customerVersion(value.channelVersion) && dated(value.actualOn) && positive(value.verifiedCents)
    && reviewed(value.confirmation) && reviewed(value.reason) && Array.isArray(value.ranges)
    && value.ranges.length > 0 && value.ranges.length <= 180);
  const identity = value.externalIdentity;
  check(exact(identity, ['namespace', 'id', 'rawReference']) && typeof identity.namespace === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(identity.namespace)
    && reviewed(identity.id) && [...identity.id].length <= 200 && reviewed(identity.rawReference));
  return {reference: parseGroupedRecreditReference(value.reference), failureId: value.failureId, customerId: value.customerId,
    channelId: value.channelId, channelVersion: value.channelVersion, actualOn: value.actualOn, verifiedCents: value.verifiedCents,
    confirmation: value.confirmation, reason: value.reason, ranges: canonicalRanges(value.ranges.map(selection), value.verifiedCents),
    externalIdentity: {namespace: identity.namespace, id: identity.id, rawReference: identity.rawReference}};
}

export function parseGroupedRecreditResult(value: unknown, businessId: string,
  reference: ReturnType<typeof parseGroupedRecreditReference>) {
  if (exact(value, ['state']) && value.state === 'absent') return {state: 'absent'} as const;
  if (exact(value, ['state', 'reason']) && value.state === 'conflict' && value.reason === 'operation') {
    return {state: 'conflict', reason: 'operation'} as const;
  }
  check(exact(value, ['state', 'receipt']));
  const receipt = value.receipt;
  if (value.state === 'retired') {
    check(exact(receipt, ['schemaVersion', 'businessId', 'operationId', 'settlementId', 'originalEpoch', 'reviewEpoch', 'reason'])
      && receipt.schemaVersion === 1 && receipt.businessId === businessId && receipt.operationId === reference.operationId
      && receipt.settlementId === reference.settlementId && receipt.originalEpoch === reference.recoveryEpoch
      && customerUuid(receipt.reviewEpoch) && reviewed(receipt.reason));
    return {state: 'retired', receipt: {settlementId: reference.settlementId, reviewEpoch: receipt.reviewEpoch, reason: receipt.reason}} as const;
  }
  check(value.state === 'committed' && exact(receipt, receiptFields) && receipt.schemaVersion === 2
    && receipt.businessId === businessId && receipt.operationId === reference.operationId && receipt.settlementId === reference.settlementId
    && customerUuid(receipt.eventId) && customerUuid(receipt.failureId) && customerUuid(receipt.originalPaymentId)
    && customerUuid(receipt.originalEventId) && customerUuid(receipt.customerId) && customerUuid(receipt.moneyAccountId)
    && customerUuid(receipt.moneyChannelId) && customerVersion(receipt.moneyChannelVersion) && customerUuid(receipt.moneyMovementId)
    && customerUuid(receipt.evidenceId) && dated(receipt.actualOn) && positive(receipt.cents) && reviewed(receipt.confirmation)
    && reviewed(receipt.reason) && Array.isArray(receipt.components) && receipt.components.length > 0 && receipt.components.length <= 180);
  const components = receipt.components.map((row: unknown) => {
    check(exact(row, componentFields) && customerUuid(row.settlementComponentId)
      && customerUuid(row.parentPartitionId) && positive(row.cents));
    const item = selection({failureComponentId: row.failureComponentId, firstCent: row.firstCent,
      lastCent: row.lastCent, disposition: row.disposition});
    check(length(item) === BigInt(row.cents) && (item.disposition === 'funds'
      ? row.receivableId === null && customerUuid(row.fundLotId) : row.fundLotId === null && customerUuid(row.receivableId)));
    return {...item, settlementComponentId: row.settlementComponentId, parentPartitionId: row.parentPartitionId,
      cents: row.cents, receivableId: customerUuid(row.receivableId)?row.receivableId:null, fundLotId: customerUuid(row.fundLotId)?row.fundLotId:null};
  });
  check(new Set(components.map(row => row.settlementComponentId)).size === components.length);
  const sorted = canonicalRanges(components, receipt.cents);
  check(sorted.every((row, index) => row === components[index]));
  return {state: 'committed', receipt: {settlementId: reference.settlementId, eventId: receipt.eventId,
    failureId: receipt.failureId, originalPaymentId: receipt.originalPaymentId, originalEventId: receipt.originalEventId,
    customerId: receipt.customerId, moneyAccountId: receipt.moneyAccountId, moneyChannelId: receipt.moneyChannelId,
    moneyChannelVersion: receipt.moneyChannelVersion, moneyMovementId: receipt.moneyMovementId, evidenceId: receipt.evidenceId,
    actualOn: receipt.actualOn, cents: receipt.cents, confirmation: receipt.confirmation, reason: receipt.reason, components}} as const;
}

export function groupedRecreditMatchesInput(receipt: Extract<ReturnType<typeof parseGroupedRecreditResult>, {state: 'committed'}>['receipt'],
  input: ReturnType<typeof parseGroupedRecreditInput>) {
  return receipt.failureId === input.failureId && receipt.customerId === input.customerId && receipt.moneyChannelId === input.channelId
    && receipt.moneyChannelVersion === input.channelVersion && receipt.actualOn === input.actualOn && receipt.cents === input.verifiedCents
    && receipt.confirmation === input.confirmation && receipt.reason === input.reason && receipt.components.length === input.ranges.length
    && receipt.components.every((row, index) => {
      const selected = input.ranges[index]!;
      return row.disposition === selected.disposition && row.failureComponentId === selected.failureComponentId
        && row.firstCent === selected.firstCent && row.lastCent === selected.lastCent;
    });
}

export function parseGroupedRecreditOptions(value: unknown, businessId: string, customerId: string, failureId: string, actualOn: string) {
  if (exact(value, ['state']) && value.state === 'absent') return {state: 'absent'} as const;
  check(exact(value, ['state', 'schemaVersion', 'businessId', 'customerId', 'failureId', 'originalPaymentId', 'failedOn',
    'actualOn', 'openPeriod', 'fundsMapping', 'components', 'channels'])
    && value.state === 'ready' && value.schemaVersion === 1 && value.businessId === businessId && value.customerId === customerId
    && value.failureId === failureId && customerUuid(value.originalPaymentId) && value.actualOn === actualOn
    && dated(actualOn) && dated(value.failedOn) && value.failedOn <= actualOn && typeof value.openPeriod === 'boolean'
    && Array.isArray(value.components) && value.components.length > 0 && value.components.length <= 180
    && Array.isArray(value.channels) && value.channels.length <= 180);
  const mapping = value.fundsMapping;
  check(mapping === null || exact(mapping, ['mappingId', 'accountId', 'label']) && customerUuid(mapping.mappingId)
    && customerUuid(mapping.accountId) && reviewed(mapping.label));
  const components = value.components.map((row: unknown) => {
    check(exact(row, ['failureComponentId', 'sourceKind', 'originalReceivableId', 'originalInvoiceNumber', 'receivableCapacityCents', 'availableRanges'])
      && customerUuid(row.failureComponentId) && sourceKinds.some(kind => kind === row.sourceKind)
      && (row.sourceKind === 'allocation' || row.sourceKind === 'application'
        ? customerUuid(row.originalReceivableId) && reviewed(row.originalInvoiceNumber) && isFinanceCents(row.receivableCapacityCents)
        : row.originalReceivableId === null && row.originalInvoiceNumber === null && row.receivableCapacityCents === null)
      && Array.isArray(row.availableRanges) && row.availableRanges.length > 0 && row.availableRanges.length <= 180);
    return {failureComponentId: row.failureComponentId, sourceKind: row.sourceKind as typeof sourceKinds[number],
      originalReceivableId: customerUuid(row.originalReceivableId)?row.originalReceivableId:null,
      originalInvoiceNumber: reviewed(row.originalInvoiceNumber)?row.originalInvoiceNumber:null,
      receivableCapacityCents: isFinanceCents(row.receivableCapacityCents)?row.receivableCapacityCents:null,
      availableRanges: canonicalRanges(row.availableRanges.map(range))};
  });
  check(new Set(components.map(row => row.failureComponentId)).size === components.length);
  canonicalRanges(components.flatMap(row => row.availableRanges));
  const channels = value.channels.map((item: unknown) => {
    check(exact(item, ['channelId', 'version', 'label', 'kind']) && customerUuid(item.channelId) && customerVersion(item.version)
      && reviewed(item.label) && (item.kind === 'bank' || item.kind === 'wallet'));
    return {channelId: item.channelId, version: item.version, label: item.label, kind: item.kind};
  });
  check(new Set(channels.map(channel => channel.channelId)).size === channels.length);
  return {state: 'ready', failedOn: value.failedOn, actualOn, failureId, originalPaymentId: value.originalPaymentId,
    openPeriod: value.openPeriod, fundsMapping: mapping, components, channels} as const;
}
