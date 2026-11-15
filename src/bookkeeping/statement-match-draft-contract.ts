import {customerDate,customerInstant,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason} from './finance-account-contract.ts';
import {moneyChannelCents} from './finance-money-channel-contract.ts';

export const statementMatchDraftLimit=200;
export const statementMatchDraftRefusals=[
 'STATEMENT_MATCH_DRAFT_INPUT_REQUIRED','STATEMENT_MATCH_DRAFT_SOURCE_REQUIRED','STATEMENT_MATCH_DRAFT_REVISION_CONFLICT',
 'RECOVERY_REVIEW_REQUIRED','FINANCE_ACCOUNT_SETUP_REQUIRED',
] as const;

function check(condition:unknown):asserts condition{
 if(!condition)throw Error('STATEMENT_MATCH_DRAFT_INPUT_REQUIRED');
}

function parseAllocations(value:unknown){
 check(Array.isArray(value)&&value.length<=statementMatchDraftLimit);
 const pairs=new Set<string>();
 return value.map((row:unknown)=>{
  check(exact(row,['statementRowId','movementId','signedCents'])&&customerUuid(row.statementRowId)
   &&customerUuid(row.movementId)&&moneyChannelCents(row.signedCents)&&row.signedCents!=='0');
  const pair=row.statementRowId+':'+row.movementId;
  check(!pairs.has(pair));
  pairs.add(pair);
  return {statementRowId:row.statementRowId,movementId:row.movementId,signedCents:row.signedCents};
 });
}

export function parseStatementMatchDraftInput(value:unknown){
 check(exact(value,['statementId','recoveryEpoch','operationId','expectedRevision','reason','allocations','movementFromOn'])
  &&customerUuid(value.statementId)&&customerUuid(value.recoveryEpoch)&&customerUuid(value.operationId)
  &&customerVersion(value.expectedRevision,true)&&BigInt(value.expectedRevision)<9223372036854775807n
  &&customerDate(value.movementFromOn)&&financeAccountReviewReason(value.reason));
 const allocations=parseAllocations(value.allocations);
 check(value.expectedRevision!=='0'||allocations.length>0);
 return {statementId:value.statementId,recoveryEpoch:value.recoveryEpoch,operationId:value.operationId,
  expectedRevision:value.expectedRevision,reason:value.reason,allocations,movementFromOn:value.movementFromOn};
}
export type StatementMatchDraftInput=ReturnType<typeof parseStatementMatchDraftInput>;

export function parseStatementMatchDraftReceipt(value:unknown,businessId:string,statementId:string){
 check(exact(value,['schemaVersion','businessId','statementId','revision','operationId','recordedBy','recordedAt','state','reason','allocations','movementFromOn'])
  &&value.schemaVersion===1&&customerUuid(businessId)&&value.businessId===businessId&&customerUuid(statementId)
  &&value.statementId===statementId&&customerVersion(value.revision)&&customerUuid(value.operationId)
  &&customerUuid(value.recordedBy)&&customerInstant(value.recordedAt)&&value.state==='draft'
  &&customerDate(value.movementFromOn)&&financeAccountReviewReason(value.reason));
 const allocations=parseAllocations(value.allocations);
 check(value.revision!=='1'||allocations.length>0);
 return {schemaVersion:1 as const,businessId,statementId,revision:value.revision,operationId:value.operationId,
  recordedBy:value.recordedBy,recordedAt:value.recordedAt,state:'draft' as const,reason:value.reason,allocations,movementFromOn:value.movementFromOn};
}
export type StatementMatchDraftReceipt=ReturnType<typeof parseStatementMatchDraftReceipt>;

export function parseStatementMatchDraftRead(value:unknown,businessId:string,statementId:string,revision:string|null){
 check(exact(value,['draft']));
 if(value.draft===null)return null;
 const draft=parseStatementMatchDraftReceipt(value.draft,businessId,statementId);
 check(revision===null||draft.revision===revision);
 return draft;
}

export function parseStatementMatchDraftSave(value:unknown,businessId:string,input:StatementMatchDraftInput){
 if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')return {state:'conflict'} as const;
 check(exact(value,['state','receipt'])&&value.state==='committed');
 const receipt=parseStatementMatchDraftReceipt(value.receipt,businessId,input.statementId);
 check(receipt.operationId===input.operationId&&receipt.revision===String(BigInt(input.expectedRevision)+1n)
  &&receipt.reason===input.reason&&receipt.movementFromOn===input.movementFromOn&&receipt.allocations.length===input.allocations.length
  &&receipt.allocations.every((row,index)=>{
   const sent=input.allocations[index];
   return !!sent&&row.statementRowId===sent.statementRowId&&row.movementId===sent.movementId&&row.signedCents===sent.signedCents;
  }));
 return {state:'committed',receipt} as const;
}
