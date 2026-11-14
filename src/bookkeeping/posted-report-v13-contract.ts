import { customerUuid } from '../customer/customer-contract.ts';
import { requireFinanceAccount as check } from './finance-account-contract.ts';
import { fictionalJournalV12PageSize, parseFictionalJournalV12 } from './posted-report-v12-contract.ts';

export const fictionalJournalV13PageSize = fictionalJournalV12PageSize;

type Recredit = {
  collectionFailureRecreditId: string;
  recreditedFailureId: string;
  recreditedFailureComponentId: string;
  recreditedPaymentId: string;
} & (
  { purpose: 'collection_recredit_money'; fundLotId: null } |
  { purpose: 'collection_recredit_funds'; fundLotId: string }
);

function project(input: unknown) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input));
  const { collectionFailureRecreditId, recreditedFailureId, recreditedFailureComponentId, recreditedPaymentId, ...row } =
    input as Record<string, unknown>;
  if (collectionFailureRecreditId === null) {
    check(recreditedFailureId === null && recreditedFailureComponentId === null && recreditedPaymentId === null);
    return { row, recredit: null };
  }
  check(customerUuid(collectionFailureRecreditId) && customerUuid(recreditedFailureId)
    && customerUuid(recreditedFailureComponentId) && customerUuid(recreditedPaymentId)
    && row.template === 'P11' && ['invoiceId','paymentId','postedExpenseId','unapplicationId','fundApplicationId',
      'tipRealizationId','invoiceCreditId','serviceRefundId','excessReturnId','tipReturnId','collectionFailureId',
      'collectionFailureComponentId','collectionFailureKind','originalPaymentId','refundTransferAdjustmentId',
      'refundTransferKind','priorRefundEventId','originalRefundEventId'].every(field => row[field] === null));
  const { purpose, fundLotId, code, debitCents, creditCents } = row;
  const source = {collectionFailureRecreditId,recreditedFailureId,recreditedFailureComponentId,recreditedPaymentId};
  let recredit: Recredit;
  if (purpose === 'collection_recredit_money') {
    check(fundLotId === null && creditCents === '0');
    recredit = {...source,purpose,fundLotId};
  } else {
    check(purpose === 'collection_recredit_funds' && customerUuid(fundLotId) && code === '2000' && debitCents === '0');
    recredit = {...source,purpose,fundLotId};
  }
  return {recredit,row:{...row,template:'P03',paymentId:collectionFailureRecreditId,fundLotId:null,
    purpose:purpose==='collection_recredit_money'?'receipt_money':'receipt_ar'}};
}

export function parseFictionalJournalV13(input: unknown, businessId: string, throughOn: string,
  accountId: string | null, afterLineId: string | null, pageSize = fictionalJournalV13PageSize) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input));
  const report = input as Record<string, unknown>;
  check(report.schemaVersion === 13 && Array.isArray(report.rows) && report.rows.length <= pageSize);
  const candidates = report.rows.map(project);
  const previous = parseFictionalJournalV12({...report,schemaVersion:12,rows:candidates.map(candidate=>candidate.row)},
    businessId,throughOn,accountId,afterLineId,pageSize);
  const rows = previous.rows.map((row,index)=>{
    const {recredit}=candidates[index]!;
    if(recredit===null)return {...row,collectionFailureRecreditId:null,recreditedFailureId:null,
      recreditedFailureComponentId:null,recreditedPaymentId:null};
    check(row.template==='P03'&&row.paymentId===recredit.collectionFailureRecreditId);
    return {...row,...recredit,template:'P11' as const,paymentId:null};
  });
  type RecreditRow=Extract<(typeof rows)[number],{collectionFailureRecreditId:string}>;
  const eventSources=new Map<string,string|null>();
  const components=new Map<string,RecreditRow[]>();
  for(const row of rows){
    const source=eventSources.get(row.eventId);
    check(source===undefined||source===row.collectionFailureRecreditId);
    eventSources.set(row.eventId,row.collectionFailureRecreditId);
    if(row.collectionFailureRecreditId===null)continue;
    const peers=components.get(row.collectionFailureRecreditId)??[];
    const peer=peers[0];
    if(peer)check(peers.length===1&&peer.purpose!==row.purpose&&peer.eventId===row.eventId&&peer.entryId===row.entryId
      &&peer.operationId===row.operationId&&peer.effectiveOn===row.effectiveOn&&peer.commitSequence===row.commitSequence
      &&peer.eventSequence===row.eventSequence&&peer.entrySequence===row.entrySequence
      &&peer.recreditedFailureId===row.recreditedFailureId&&peer.recreditedFailureComponentId===row.recreditedFailureComponentId
      &&peer.recreditedPaymentId===row.recreditedPaymentId&&row.debitCents===peer.creditCents&&row.creditCents===peer.debitCents);
    peers.push(row);
    components.set(row.collectionFailureRecreditId,peers);
  }
  if(accountId===null&&afterLineId===null&&!previous.hasMore)check([...components.values()].every(lines=>lines.length===2));
  return {...previous,schemaVersion:13 as const,rows};
}

export type FictionalJournalV13=ReturnType<typeof parseFictionalJournalV13>;
