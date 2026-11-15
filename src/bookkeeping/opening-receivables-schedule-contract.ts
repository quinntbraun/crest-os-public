import {customerDate,customerInstant,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason} from './finance-account-contract.ts';
import {parseOpeningArInput,previewOpeningReceivables,requireOpeningAr as check} from './opening-receivables-preview.ts';

export function parseOpeningArSave(value:unknown){
 check(exact(value,['preview','expectedRevision','reason'])&&customerVersion(value.expectedRevision,true)&&
  BigInt(value.expectedRevision)<9223372036854775807n&&financeAccountReviewReason(value.reason));
 return {preview:parseOpeningArInput(value.preview),expectedRevision:value.expectedRevision,reason:value.reason};
}

function receipt(value:unknown,businessId:string,worksheetRevision?:string){
 check(exact(value,['schemaVersion','businessId','scheduleRevisionId','worksheetRevisionId','revision','operationId',
  'auditEventId','recordedBy','recordedAt','evidenceSha256','evidence'])&&value.schemaVersion===1
  &&value.businessId===businessId&&customerUuid(value.scheduleRevisionId)&&customerUuid(value.worksheetRevisionId)
  &&(worksheetRevision===undefined||value.worksheetRevisionId===worksheetRevision)&&customerVersion(value.revision)
  &&customerUuid(value.operationId)&&customerUuid(value.auditEventId)&&customerUuid(value.recordedBy)&&customerInstant(value.recordedAt)
  &&typeof value.evidenceSha256==='string'&&/^[a-f0-9]{64}$/.test(value.evidenceSha256));
 const evidence=value.evidence;
 check(exact(evidence,['schemaVersion','cutoverOn','state','posted','currency','reason','totals','lines'])&&evidence.schemaVersion===1
  &&customerDate(evidence.cutoverOn)&&evidence.state==='evidence_saved'&&evidence.posted===false&&evidence.currency==='USD'
  &&financeAccountReviewReason(evidence.reason)&&Array.isArray(evidence.lines)&&exact(evidence.totals,['remainingCents']));
 const rawLines=evidence.lines.map((line:unknown)=>{
  check(line&&typeof line==='object'&&'taxReview' in line);
  const {taxReview,...raw}=line;
  check(taxReview===('taxEvidence' in raw&&raw.taxEvidence===null?'unknown':'source_recorded'));
  return raw;
 });
 const input=parseOpeningArInput({revision:'1',lines:rawLines});
 const expected=previewOpeningReceivables(input,evidence.cutoverOn);
 check(expected.totals.remainingCents===evidence.totals.remainingCents);
 return {...value,scheduleRevisionId:value.scheduleRevisionId,revision:value.revision,worksheetRevisionId:value.worksheetRevisionId,operationId:value.operationId,
  recordedBy:value.recordedBy,evidence:{...evidence,lines:expected.lines,totals:expected.totals,cutoverOn:evidence.cutoverOn,reason:evidence.reason}};
}

export function parseOpeningArStored(value:unknown,businessId:string){
 check(exact(value,['schemaVersion','businessId','worksheetRevisionId','schedule'])&&value.schemaVersion===1&&value.businessId===businessId
  &&customerUuid(value.worksheetRevisionId));
 return {worksheetRevisionId:value.worksheetRevisionId,schedule:value.schedule===null?null:receipt(value.schedule,businessId,value.worksheetRevisionId)};
}

export function parseOpeningArOperation(value:unknown,businessId:string,operationId:string){
 if(exact(value,['state'])&&(value.state==='absent'||value.state==='review_required'||value.state==='retired'))return {state:value.state} as const;
 if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')return {state:'conflict'} as const;
 check(exact(value,['state','receipt'])&&value.state==='committed');
 const stored=receipt(value.receipt,businessId);
 check(stored.operationId===operationId);
 return {state:'committed',receipt:stored} as const;
}
