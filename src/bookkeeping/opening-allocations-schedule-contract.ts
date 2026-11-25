import {historyJsonEqual,parseHistoryJson} from '../security/history-evidence-json.ts';
import {customerInstant,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {prepareOpeningPayablesAllocations,OpeningPayablesAllocationError} from './opening-payables-allocation.ts';
import type {OpeningPayablesAllocationInput} from './opening-payables-allocation.ts';
import {openingPayablesDraftFromEvidence,parseOpeningPayablesReceipt} from './opening-payables-schedule-contract.ts';
import type {OpeningPayablesReceipt} from './opening-payables-schedule-contract.ts';
function check(value:unknown):asserts value{if(!value)throw new OpeningPayablesAllocationError();}
export function openingAllocationsDraftFromEvidence(value:unknown,parent:OpeningPayablesReceipt):OpeningPayablesAllocationInput{
 check(exact(value,['schemaVersion','cutoverOn','currency','reason','roots','rootCount','reductionCount','remainingPayablesCents','selectedAllocationCapacityChecked','externalEvidenceVerified','historicalAllocationClosureVerified','fullSourceClosureVerified','posted','paymentAuthorized','newExpenseCents','newPaymentCents'])&&value.schemaVersion===1&&value.cutoverOn===parent.evidence.cutoverOn&&Array.isArray(value.roots));
 const roots=value.roots.map((root:unknown)=>{
  check(exact(root,['rootId','sourceNamespace','externalId','vendor','kind','reference','appliedOn','originalCents','evidence','otherAllocatedCents','otherAllocationEvidence','allocations','selectedAllocationCents','unallocatedCents']));
  const {allocations:_allocations,selectedAllocationCents:_selected,unallocatedCents:_unused,...raw}=root;void _allocations;void _selected;void _unused;return raw;
 });
 const draft={schemaVersion:1,roots,reason:value.reason};
 const expected=prepareOpeningPayablesAllocations(openingPayablesDraftFromEvidence(parent.evidence),parent.evidence.cutoverOn,draft);
 check(historyJsonEqual(parseHistoryJson(JSON.stringify(expected)),parseHistoryJson(JSON.stringify(value))));
 return {schemaVersion:1,reason:expected.reason,roots:expected.roots.map(root=>{
  const {allocations:_allocations,selectedAllocationCents:_selected,unallocatedCents:_unused,...raw}=structuredClone(root);void _allocations;void _selected;void _unused;return raw;
 })};
}
export function parseOpeningAllocationsSave(value:unknown,parent:OpeningPayablesReceipt){
 check(exact(value,['worksheetRevision','payablesRevision','expectedRevision','input'])&&customerVersion(value.worksheetRevision)&&value.payablesRevision===parent.revision&&customerVersion(value.expectedRevision,true)&&BigInt(value.expectedRevision)<9223372036854775807n);
 prepareOpeningPayablesAllocations(openingPayablesDraftFromEvidence(parent.evidence),parent.evidence.cutoverOn,value.input);
 return {worksheetRevision:value.worksheetRevision,payablesRevision:parent.revision,expectedRevision:value.expectedRevision,input:structuredClone(value.input) as OpeningPayablesAllocationInput};
}
function receipt(value:unknown,businessId:string,parent:OpeningPayablesReceipt){
 check(exact(value,['schemaVersion','businessId','allocationRevisionId','payablesRevision','worksheetRevisionId','revision','operationId','auditEventId','recordedBy','recordedAt','evidenceSha256','evidence'])&&value.schemaVersion===1&&value.businessId===businessId&&customerUuid(value.allocationRevisionId)&&value.payablesRevision===parent.revision&&value.worksheetRevisionId===parent.worksheetRevisionId&&customerVersion(value.revision)&&customerUuid(value.operationId)&&customerUuid(value.auditEventId)&&customerUuid(value.recordedBy)&&customerInstant(value.recordedAt)&&typeof value.evidenceSha256==='string'&&/^[a-f0-9]{64}$/.test(value.evidenceSha256));
 const input=openingAllocationsDraftFromEvidence(value.evidence,parent);
 const evidence=prepareOpeningPayablesAllocations(openingPayablesDraftFromEvidence(parent.evidence),parent.evidence.cutoverOn,input);
 return {schemaVersion:1 as const,businessId,allocationRevisionId:value.allocationRevisionId,payablesRevision:parent.revision,worksheetRevisionId:parent.worksheetRevisionId,revision:value.revision,operationId:value.operationId,auditEventId:value.auditEventId,recordedBy:value.recordedBy,recordedAt:value.recordedAt,evidenceSha256:value.evidenceSha256,evidence};
}
export type OpeningAllocationsReceipt=ReturnType<typeof receipt>;
export function parseOpeningAllocationsStored(value:unknown,businessId:string){
 check(customerUuid(businessId)&&exact(value,['schemaVersion','businessId','worksheetRevisionId','schedule','supplierSchedule'])&&value.schemaVersion===1&&value.businessId===businessId&&customerUuid(value.worksheetRevisionId));
 if(value.schedule===null){check(value.supplierSchedule===null);return {worksheetRevisionId:value.worksheetRevisionId,schedule:null};}
 const supplierSchedule=parseOpeningPayablesReceipt(value.supplierSchedule,businessId,value.worksheetRevisionId);
 return {worksheetRevisionId:value.worksheetRevisionId,schedule:{receipt:receipt(value.schedule,businessId,supplierSchedule),supplierSchedule}};
}
export function parseOpeningAllocationsOperation(value:unknown,businessId:string,operationId:string){
 check(customerUuid(businessId)&&customerUuid(operationId));
 if(exact(value,['state'])&&(value.state==='absent'||value.state==='review_required'||value.state==='retired'))return {state:value.state} as const;
 if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')return {state:'conflict'} as const;
 check(exact(value,['state','receipt','supplierSchedule'])&&value.state==='committed');
 const supplierSchedule=parseOpeningPayablesReceipt(value.supplierSchedule,businessId),saved=receipt(value.receipt,businessId,supplierSchedule);check(saved.operationId===operationId);
 return {state:'committed',receipt:saved,supplierSchedule} as const;
}
