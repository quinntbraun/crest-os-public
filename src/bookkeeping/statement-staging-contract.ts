import {customerDate,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason} from './finance-account-contract.ts';
import {moneyChannelCents} from './finance-money-channel-contract.ts';
import {assessStatementRows} from './statement-reconciliation.ts';

export const statementDraftRowLimit=250;
export const statementStagingRefusals=['STATEMENT_IMPORT_INPUT_REQUIRED','STATEMENT_IMPORT_DEDICATED_CHANNEL_REQUIRED',
 'STATEMENT_IMPORT_FILE_ALREADY_RETAINED','RECOVERY_REVIEW_REQUIRED','FINANCE_ACCOUNT_SETUP_REQUIRED'] as const;
const dateAndEvidence=['startsOn','endsOn','openingCents','closingCents','fileSha256','dateConvention','completenessEvidence'] as const;
const statementFields=['channelId','channelVersion',...dateAndEvidence,'rows'] as const;
const refFields=['operationId','recoveryEpoch','statementId'] as const;
const receiptFields=['schemaVersion','businessId','statementId','accountId','channelVersionId','operationId',...dateAndEvidence,
 'rowCount','signedRowsCents','rowsSha256','statementDifferenceCents'] as const;
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const wideCents=(value:unknown):value is string=>typeof value==='string'&&/^(0|-?[1-9][0-9]{0,23})$/.test(value);
function check(condition:unknown):asserts condition{if(!condition)throw Error('STATEMENT_IMPORT_INPUT_REQUIRED');}
function details(value:Record<string,unknown>){
 const {startsOn,endsOn,openingCents,closingCents,fileSha256,dateConvention,completenessEvidence}=value;
 check(customerDate(startsOn)&&customerDate(endsOn)&&startsOn<=endsOn&&moneyChannelCents(openingCents)&&moneyChannelCents(closingCents)
  &&hash(fileSha256)&&financeAccountReviewReason(dateConvention)&&financeAccountReviewReason(completenessEvidence));
 return {startsOn,endsOn,openingCents,closingCents,fileSha256,dateConvention,completenessEvidence};
}
export function parseStatementReference(value:unknown){
 check(exact(value,refFields)&&customerUuid(value.operationId)&&customerUuid(value.recoveryEpoch)&&customerUuid(value.statementId));
 return {operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,statementId:value.statementId};
}
export type StatementReference=ReturnType<typeof parseStatementReference>;
export function parseStatementDraft(value:unknown){
 check(exact(value,statementFields)&&customerUuid(value.channelId)&&customerVersion(value.channelVersion)&&Array.isArray(value.rows)&&value.rows.length<=statementDraftRowLimit);
 const evidence=details(value),rows=(value.rows as unknown[]).map(row=>{
  check(exact(row,['id','statementOn','signedCents'])&&customerUuid(row.id)&&customerDate(row.statementOn)&&moneyChannelCents(row.signedCents));
  return {id:row.id,statementOn:row.statementOn,signedCents:row.signedCents};
 });
 try{assessStatementRows(evidence,rows);}catch{throw Error('STATEMENT_IMPORT_INPUT_REQUIRED');}
 return {channelId:value.channelId,channelVersion:value.channelVersion,...evidence,rows};
}
export type StatementDraft=ReturnType<typeof parseStatementDraft>;
export function parseStatementResult(value:unknown,businessId:string,reference:StatementReference){
 if(exact(value,['state'])&&value.state==='absent')return {state:'absent'} as const;
 if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')return {state:'conflict'} as const;
 check(exact(value,['state','receipt'])&&value.state==='committed');
 const receipt=value.receipt;
 check(exact(receipt,receiptFields)&&receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.statementId===reference.statementId
  &&receipt.operationId===reference.operationId&&customerUuid(receipt.accountId)&&customerUuid(receipt.channelVersionId)
  &&typeof receipt.rowCount==='number'&&Number.isInteger(receipt.rowCount)&&receipt.rowCount>=0&&receipt.rowCount<=10000
  &&hash(receipt.rowsSha256)&&wideCents(receipt.signedRowsCents)&&wideCents(receipt.statementDifferenceCents));
 const evidence=details(receipt);
 check(BigInt(evidence.closingCents)-BigInt(evidence.openingCents)-BigInt(receipt.signedRowsCents)===BigInt(receipt.statementDifferenceCents));
 return {state:'committed',receipt:{...evidence,statementId:reference.statementId,operationId:reference.operationId,
  accountId:receipt.accountId,channelVersionId:receipt.channelVersionId,rowCount:receipt.rowCount,rowsSha256:receipt.rowsSha256,
  signedRowsCents:receipt.signedRowsCents,statementDifferenceCents:receipt.statementDifferenceCents}} as const;
}
