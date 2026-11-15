import {customerDate,customerInstant,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountCode,financeAccountReviewReason,requireFinanceAccount as check} from './finance-account-contract.ts';

export const openingControls={receivables:'Customer balances owed',customerFunds:'Customer funds held',
 supplierPayables:'Supplier bills',taxLiabilities:'Taxes owed',otherLiabilities:'Other liabilities',
 cashAndChecks:'Cash and checks',wallets:'Payment wallets',otherAssets:'Other assets'} as const;
const controlKeys=Object.keys(openingControls) as (keyof typeof openingControls)[];
const bankKeys=['channelId','channelVersion','state','statementCents','bookCents','evidence','timing','note'] as const;
const selectionKeys=['label','maskedSuffix','accountCode'] as const;
const draftKeys=['cutoverOn','cutoverAt','source','equityBasis','banks','controls'] as const;
const receiptKeys=[...draftKeys,'schemaVersion','businessId','worksheetRevisionId','revision','operationId','auditEventId','recordedBy',
 'recordedAt','evidenceSha256','timeZone','currency','state','posted','bankNetCents','provisionalEquityCents','provisionalEquityAccountCode',
 'debitCents','creditCents','profitAndLossCents'] as const;

export type OpeningDocument={reference:string;sha256:string};
export type OpeningControl={state:'unknown'|'verified_zero'|'not_applicable';evidence:OpeningDocument|null;note:string};
export type OpeningTiming=OpeningDocument&{cents:string};
export type OpeningBank={channelId:string;channelVersion:string;state:'unknown'|'verified_zero'|'verified';
 statementCents:string|null;bookCents:string|null;evidence:OpeningDocument|null;timing:OpeningTiming[];note:string};
export type OpeningBankOption=Pick<OpeningBank,'channelId'|'channelVersion'>&{accountCode:string;label:string;maskedSuffix:string};
export type OpeningDraft={cutoverOn:string;cutoverAt:string;source:OpeningDocument;equityBasis:string;banks:OpeningBank[];
 controls:Record<keyof typeof openingControls,OpeningControl>};
export type OpeningReference={operationId:string;recoveryEpoch:string};
export type OpeningReceipt=Omit<OpeningDraft,'banks'>&{banks:(OpeningBank&OpeningBankOption&{accountId:string;channelVersionId:string})[];
 schemaVersion:1;businessId:string;worksheetRevisionId:string;revision:string;operationId:string;auditEventId:string;recordedBy:string;
 recordedAt:string;evidenceSha256:string;timeZone:string;currency:'USD';state:'incomplete'|'balanced_evidence_only';posted:false;
 bankNetCents:string;provisionalEquityCents:string;provisionalEquityAccountCode:'3000';debitCents:string;creditCents:string;profitAndLossCents:'0'};
export type OpeningProjection={schemaVersion:1;businessId:string;timeZone:string;cutoverOn:string|null;cutoverAt:string|null;
 banks:OpeningBankOption[];worksheet:OpeningReceipt|null};

const validHash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const cents=(value:unknown):value is string=>typeof value==='string'&&/^(0|-?[1-9][0-9]{0,17})$/.test(value);
const boundaryInstant=(value:unknown):value is string=>typeof value==='string'&&customerInstant(value.replace(/Z$/,'.000000Z'));
function document(value:unknown):value is OpeningDocument{
 return exact(value,['reference','sha256'])&&financeAccountReviewReason(value.reference)&&[...value.reference].length<=200&&validHash(value.sha256);
}
function control(value:unknown):value is OpeningControl{
 return exact(value,['state','evidence','note'])&&financeAccountReviewReason(value.note)&&
  (value.state==='unknown'?value.evidence===null:(value.state==='verified_zero'||value.state==='not_applicable')&&document(value.evidence));
}
function timing(value:unknown):value is OpeningTiming{
 return exact(value,['reference','sha256','cents'])&&document({reference:value.reference,sha256:value.sha256})&&cents(value.cents)&&value.cents!=='0';
}
function bank(value:Record<string,unknown>):boolean{
 if(!customerUuid(value.channelId)||!customerVersion(value.channelVersion)||!financeAccountReviewReason(value.note)||
  !Array.isArray(value.timing)||value.timing.length>40||!value.timing.every(timing))return false;
 if(value.state==='unknown')return value.statementCents===null&&value.bookCents===null&&value.evidence===null&&value.timing.length===0;
 if((value.state!=='verified_zero'&&value.state!=='verified')||!document(value.evidence)||!cents(value.statementCents)||!cents(value.bookCents))return false;
 const pending=value.timing.reduce((total,row)=>total+BigInt(row.cents),0n);
 return BigInt(value.bookCents)===BigInt(value.statementCents)+pending&&(value.bookCents==='0')===(value.state==='verified_zero');
}
function option(value:Record<string,unknown>):boolean{
 return customerUuid(value.channelId)&&customerVersion(value.channelVersion)&&financeAccountCode(value.accountCode)
  &&financeAccountReviewReason(value.label)&&typeof value.maskedSuffix==='string'&&/^[A-Z0-9]{4}$/.test(value.maskedSuffix);
}
function core(value:Record<string,unknown>){
 return customerDate(value.cutoverOn)&&boundaryInstant(value.cutoverAt)&&document(value.source)&&financeAccountReviewReason(value.equityBasis)
  &&exact(value.controls,controlKeys)&&controlKeys.every(key=>control((value.controls as Record<string,unknown>)[key]));
}
function banksValid(banks:OpeningBank[]){
 const timingKeys=banks.flatMap(row=>row.timing.map(item=>JSON.stringify([item.reference,item.sha256])));
 return new Set(banks.map(row=>row.channelId)).size===banks.length&&new Set(timingKeys).size===timingKeys.length;
}
export function parseOpeningDraft(value:unknown):OpeningDraft{
 check(exact(value,draftKeys)&&core(value)&&Array.isArray(value.banks)&&value.banks.length<=30&&
  value.banks.every(row=>exact(row,bankKeys)&&bank(row))&&banksValid(value.banks as OpeningBank[]));
 return value as OpeningDraft;
}
export function parseOpeningReference(value:unknown):OpeningReference{
 check(exact(value,['operationId','recoveryEpoch'])&&customerUuid(value.operationId)&&customerUuid(value.recoveryEpoch));
 return value as OpeningReference;
}
export function parseOpeningReceipt(value:unknown,businessId:string):OpeningReceipt{
 check(exact(value,receiptKeys)&&core(value)&&value.schemaVersion===1&&value.businessId===businessId&&customerUuid(value.worksheetRevisionId)
  &&customerVersion(value.revision)&&customerUuid(value.operationId)&&customerUuid(value.auditEventId)&&customerUuid(value.recordedBy)
  &&customerInstant(value.recordedAt)&&validHash(value.evidenceSha256)&&financeAccountCode(value.timeZone)&&value.currency==='USD'
  &&value.posted===false&&value.profitAndLossCents==='0'&&value.provisionalEquityAccountCode==='3000'&&Array.isArray(value.banks)
  &&value.banks.length<=30&&value.banks.every(row=>exact(row,[...bankKeys,...selectionKeys,'accountId','channelVersionId'])&&bank(row)&&option(row)
   &&customerUuid(row.accountId)&&customerUuid(row.channelVersionId)));
 const receipt=value as OpeningReceipt;
 const unknown=receipt.banks.some(row=>row.state==='unknown')||Object.values(receipt.controls).some(row=>row.state==='unknown');
 const net=receipt.banks.reduce((total,row)=>total+BigInt(row.bookCents??'0'),0n);
 const debit=receipt.banks.reduce((total,row)=>total+(row.bookCents&&BigInt(row.bookCents)>0n?BigInt(row.bookCents):0n),net<0n?-net:0n);
 check(banksValid(receipt.banks)&&new Set(receipt.banks.map(row=>row.accountId)).size===receipt.banks.length&&
  receipt.bankNetCents===net.toString()&&receipt.provisionalEquityCents===net.toString()&&receipt.debitCents===debit.toString()&&
  receipt.creditCents===receipt.debitCents&&receipt.state===(unknown?'incomplete':'balanced_evidence_only'));
 return receipt;
}
export function parseOpeningProjection(value:unknown,businessId:string,requestedOn:string|null):OpeningProjection{
 check(exact(value,['schemaVersion','businessId','timeZone','cutoverOn','cutoverAt','banks','worksheet'])&&value.schemaVersion===1
  &&value.businessId===businessId&&financeAccountCode(value.timeZone)&&Array.isArray(value.banks)&&value.banks.length<=30
  &&value.banks.every(row=>exact(row,['channelId','channelVersion',...selectionKeys])&&option(row)));
 const worksheet=value.worksheet===null?null:parseOpeningReceipt(value.worksheet,businessId);
 check(value.cutoverOn===(requestedOn??worksheet?.cutoverOn??null)&&
  (value.cutoverOn===null?value.cutoverAt===null&&value.banks.length===0:boundaryInstant(value.cutoverAt)));
 return {...value,worksheet} as OpeningProjection;
}
export function parseOpeningResult(value:unknown,businessId:string,operationId:string){
 if(exact(value,['state'])&&(value.state==='absent'||value.state==='review_required'||value.state==='retired'))return {state:value.state} as const;
 if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')return {state:'conflict'} as const;
 check(exact(value,['state','receipt'])&&value.state==='committed');
 const receipt=parseOpeningReceipt(value.receipt,businessId);
 check(receipt.operationId===operationId);
 return {state:'committed',receipt} as const;
}
