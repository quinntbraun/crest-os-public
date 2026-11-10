import {customerUuid as uuid,customerVersion as version,customerInstant as instant} from '../customer/customer-contract.ts';

import {parseQuoteAmendmentDraftReference} from '../commercial/quote-amendment-contract.ts';
import type {QuoteAmendmentDraftReference} from '../commercial/quote-amendment-contract.ts';
import {parseQuoteAmendmentSendReference} from '../commercial/quote-amendment-sharing-contract.ts';
import type {QuoteAmendmentSendReference} from '../commercial/quote-amendment-sharing-contract.ts';
import {parseQuoteAmendmentAcceptReference} from '../commercial/quote-amendment-acceptance-contract.ts';
import type {QuoteAmendmentAcceptReference} from '../commercial/quote-amendment-acceptance-contract.ts';

type Common=Readonly<{operationId:string;recoveryEpoch:string}>;
type Targets={
 'operations.job.field':Readonly<{jobId:string;expectedJobVersion:string;action:'depart'|'arrive'|'direct_arrive'|'pause'|'resume'}>;
 'operations.job.complete':Readonly<{jobId:string;expectedJobVersion:string}>;
 'operations.job.interrupt':Readonly<{jobId:string;expectedJobVersion:string;action:'cancel'|'reschedule'}>;
 'operations.job.cancel_unfulfilled':Readonly<{jobId:string;expectedJobVersion:string}>;
 'operations.job.work_boundary.correct':Readonly<{jobId:string;expectedJobVersion:string;leftVersionId:string;rightVersionId:string}>;
 'operations.job.work_start.correct':Readonly<{jobId:string;expectedJobVersion:string;workVersionId:string;arrivalVersionId:string|null}>;
 'operations.mileage.record':Readonly<{legId:string;expectedLegVersionId:string;expectedEvidenceVersion:string}>;
 'operations.support_trip.record':Readonly<{legId:string;expectedLegVersionId:string|null;action:'depart'|'arrive'|'cancel'}>;
 'operations.support_trip.correct':Readonly<{legId:string;expectedLegVersionId:string|null;action:'record'|'correct'}>;
 'operations.fulfillment_modes.initialize':Readonly<{expectedSequence:'0'}>;
 'operations.fulfillment_modes.save':Readonly<{expectedSequence:string}>;
 'operations.job.book':Readonly<{jobId:string;expectedModeSequence:string}>;
 'operations.job.cancel':Readonly<{jobId:string;expectedJobVersion:string}>;
 'operations.job.reschedule':Readonly<{jobId:string;expectedJobVersion:string;action:'propose'|'confirm'|'withdraw';latestAppointmentId:string}>;
 'bookkeeping.expense.save':Readonly<{expenseId:string;expectedRevision:string}>;
 'bookkeeping.receipt.reserve':Readonly<{receiptId:string;expenseId:string;expenseRevision:string;expectedRevision:'0'}>;
 'bookkeeping.receipt.publish':Readonly<{receiptId:string;expenseId:string;expenseRevision:string;expectedRevision:'1'}>;
 'operations.appointment_hold.save':Readonly<{holdId:string;expectedSequence:string}>;
 'business.rename':Readonly<{expectedVersion:string}>;
 'crm.customer.save':Readonly<{customerId:string;expectedVersion:string}>;
 'crm.address.save':Readonly<{customerId:string;addressId:string;expectedVersion:string}>;
 'crm.vehicle.save':Readonly<{vehicleId:string;expectedVersion:string}>;
 'crm.vehicle.association':Readonly<{action:'open'|'close'|'transfer';associationId:string;vehicleId:string;expectedVersion:'0'|'1';nextAssociationId:string|null}>;
 'crm.lead.source.save':Readonly<{leadSourceId:string;expectedVersion:string}>;
 'crm.lead.save':Readonly<{leadId:string;expectedVersion:string}>;
 'crm.lead.state':Readonly<{leadId:string;expectedVersion:string}>;
 'crm.lead.vehicle.save':Readonly<{leadId:string;leadVehicleId:string;expectedVersion:string}>;
 'crm.lead.address.save':Readonly<{leadId:string;leadAddressId:string;expectedVersion:string}>;
 'crm.lead.convert':Readonly<{conversionId:string;leadId:string;expectedLeadVersion:string;customerId:string}>;
 'catalog.service.save':Readonly<{serviceId:string;expectedRevision:string}>;
 'quote.amendment.create':Omit<QuoteAmendmentDraftReference,keyof Common>;
 'quote.amendment.send':Omit<QuoteAmendmentSendReference,keyof Common>;
 'quote.amendment.accept':Omit<QuoteAmendmentAcceptReference,keyof Common>;
 'quote.draft.save':Readonly<{familyId:string;revisionId:string;expectedFamilyVersion:string;expectedRevisionVersion:string}>;
 'quote.replacement.create':Readonly<{familyId:string;revisionId:string;expectedFamilyVersion:string;expectedRevisionVersion:'0'}>;
 'quote.manual.send':Readonly<{familyId:string;revisionId:string;expectedFamilyVersion:string;expectedRevisionVersion:string;expectedContentVersion:string;sendId:string;approvalId:string}>;
 'quote.confirmation.accept':Readonly<{familyId:string;revisionId:string;expectedFamilyVersion:string;expectedRevisionVersion:string;expectedContentVersion:string;acceptanceId:string;agreementId:string}>;
 'quote.review.submit':Readonly<{familyId:string;revisionId:string;expectedFamilyVersion:string;expectedRevisionVersion:string;expectedContentVersion:string}>;
 'quote.review.approve':Readonly<{familyId:string;revisionId:string;expectedFamilyVersion:string;expectedRevisionVersion:string;expectedContentVersion:string;approvalId:string}>;
};
export type OriginalOperationKind=keyof Targets;
export type OriginalOperationReference={
 [K in OriginalOperationKind]:Readonly<{schemaVersion:1;businessId:string;commandType:K;reference:Common&Targets[K]}>
}[OriginalOperationKind];
export type OriginalOperationRetirement=Readonly<{schemaVersion:1;recoveryEpoch:string;original:OriginalOperationReference;reason:string}>;
export type OriginalOperationOutcome=
 |Readonly<{schemaVersion:1;state:'original_recorded';original:OriginalOperationReference}>
 |Readonly<{schemaVersion:1;state:'retired';original:OriginalOperationReference;retirement:Readonly<{operationRowId:string;auditEventId:string;recoveryEpoch:string;reason:string;recordedAt:string}>}>;

export class OriginalOperationReferenceError extends Error{constructor(){super('ORIGINAL_OPERATION_REVIEW_REQUIRED');this.name='OriginalOperationReferenceError';}}
function require(value:unknown):asserts value{if(!value)throw new OriginalOperationReferenceError();}
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
 require(value!==null&&typeof value==='object'&&!Array.isArray(value));
 require(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
 const descriptors=Object.getOwnPropertyDescriptors(value);
 require(Reflect.ownKeys(descriptors).length===keys.length&&keys.every(key=>Object.hasOwn(descriptors,key)&&descriptors[key]!.enumerable&&Object.hasOwn(descriptors[key]!,'value')));
 return Object.fromEntries(keys.map(key=>[key,descriptors[key]!.value]));
}
const fields={
 'operations.job.field':['jobId','expectedJobVersion','action'],
 'operations.job.complete':['jobId','expectedJobVersion'],
 'operations.job.interrupt':['jobId','expectedJobVersion','action'],
 'operations.job.cancel_unfulfilled':['jobId','expectedJobVersion'],
 'operations.job.work_boundary.correct':['jobId','expectedJobVersion','leftVersionId','rightVersionId'],
 'operations.job.work_start.correct':['jobId','expectedJobVersion','workVersionId','arrivalVersionId'],
 'operations.mileage.record':['legId','expectedLegVersionId','expectedEvidenceVersion'],
 'operations.support_trip.record':['legId','expectedLegVersionId','action'],
 'operations.support_trip.correct':['legId','expectedLegVersionId','action'],
 'operations.fulfillment_modes.initialize':['expectedSequence'],
 'operations.fulfillment_modes.save':['expectedSequence'],
 'operations.job.book':['jobId','expectedModeSequence'],
 'operations.job.cancel':['jobId','expectedJobVersion'],
 'operations.job.reschedule':['jobId','expectedJobVersion','action','latestAppointmentId'],
 'bookkeeping.expense.save':['expenseId','expectedRevision'],
 'bookkeeping.receipt.reserve':['receiptId','expenseId','expenseRevision','expectedRevision'],
 'bookkeeping.receipt.publish':['receiptId','expenseId','expenseRevision','expectedRevision'],
 'operations.appointment_hold.save':['holdId','expectedSequence'],
 'business.rename':['expectedVersion'],
 'crm.customer.save':['customerId','expectedVersion'],
 'crm.address.save':['customerId','addressId','expectedVersion'],
 'crm.vehicle.save':['vehicleId','expectedVersion'],
 'crm.vehicle.association':['action','associationId','vehicleId','expectedVersion','nextAssociationId'],
 'crm.lead.source.save':['leadSourceId','expectedVersion'],
 'crm.lead.save':['leadId','expectedVersion'],
 'crm.lead.state':['leadId','expectedVersion'],
 'crm.lead.vehicle.save':['leadId','leadVehicleId','expectedVersion'],
 'crm.lead.address.save':['leadId','leadAddressId','expectedVersion'],
 'crm.lead.convert':['conversionId','leadId','expectedLeadVersion','customerId'],
 'catalog.service.save':['serviceId','expectedRevision'],
 'quote.amendment.create':['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedParentAgreementId','expectedParentAgreementVersion'],
 'quote.amendment.send':['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','sendId','approvalId','expectedParentAgreementId','expectedParentAgreementVersion','replacesRevisionId'],
 'quote.amendment.accept':['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','acceptanceId','agreementId','sendId','customerId','expectedParentAgreementId','expectedParentAgreementVersion'],
 'quote.draft.save':['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion'],
 'quote.replacement.create':['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion'],
 'quote.manual.send':['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','sendId','approvalId'],
 'quote.confirmation.accept':['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','acceptanceId','agreementId'],
 'quote.review.submit':['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion'],
 'quote.review.approve':['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','approvalId']
} as const satisfies Record<OriginalOperationKind,readonly string[]>;
export const originalOperationKinds=Object.freeze(Object.keys(fields) as OriginalOperationKind[]);
function reason(value:unknown):asserts value is string{
 require(typeof value==='string'&&value.length<=4000&&[...value].length<=2000&&value.trim().length>0);
 require([...value].every(c=>{const n=c.codePointAt(0)!;return n!==0&&!(n>=0xd800&&n<=0xdfff)&&!(n<32||n===127)||n===9||n===10||n===13;}));
}

// Original IDs/versions only. No draft reconstruction, credentials, permission,
// sign-in binding, caller-supplied actor, financial payload or replacement command.
// This is a pure contract: no storage, database, network or retirement action.
export function parseOriginalOperationReference(value:unknown):OriginalOperationReference{
 try{
  const row=object(value,['schemaVersion','businessId','commandType','reference']);
  require(row.schemaVersion===1&&uuid(row.businessId)&&typeof row.commandType==='string'&&Object.hasOwn(fields,row.commandType));
  const kind=row.commandType as OriginalOperationKind,keys=['operationId','recoveryEpoch',...fields[kind]],ref=object(row.reference,keys);
  require(uuid(ref.operationId)&&uuid(ref.recoveryEpoch));
  if(kind==='quote.amendment.create')return Object.freeze({schemaVersion:1,businessId:row.businessId,commandType:kind,reference:parseQuoteAmendmentDraftReference(ref)});
  if(kind==='quote.amendment.send')return Object.freeze({schemaVersion:1,businessId:row.businessId,commandType:kind,reference:parseQuoteAmendmentSendReference(ref)});
  if(kind==='quote.amendment.accept')return Object.freeze({schemaVersion:1,businessId:row.businessId,commandType:kind,reference:parseQuoteAmendmentAcceptReference(ref)});
  for(const key of fields[kind]){
   if(key==='expectedSequence'||key==='expectedVersion'||key==='expectedRevision'||key==='expectedFamilyVersion'||key==='expectedRevisionVersion')require(version(ref[key],!['business.rename','crm.lead.state','quote.review.submit','quote.review.approve','quote.manual.send','quote.confirmation.accept'].includes(kind)));
   else if(key==='expectedModeSequence')require(version(ref[key],true));
   else if(key==='expectedJobVersion'||key==='expectedContentVersion')require(version(ref[key]));
   else if(key==='expenseRevision')require(version(ref[key]));
   else if(key==='expectedLeadVersion')require(version(ref[key]));
   else if(key==='expectedEvidenceVersion')require(version(ref[key],true)&&BigInt(ref[key] as string)<9223372036854775807n);
   else if(key==='expectedLegVersionId'&&kind.startsWith('operations.support_trip.'))require(ref[key]===null||uuid(ref[key]));
   else if(key==='arrivalVersionId'&&kind==='operations.job.work_start.correct')require(ref[key]===null||uuid(ref[key]));
   else if(key!=='action'&&key!=='nextAssociationId')require(uuid(ref[key]));
  }
  if(['operations.job.field','operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled'].includes(kind))require(BigInt(ref.expectedJobVersion as string)<9223372036854775807n);
  if(kind==='operations.job.field')require(['depart','arrive','direct_arrive','pause','resume'].includes(ref.action as string));
  if(kind==='operations.job.interrupt')require(['cancel','reschedule'].includes(ref.action as string));
  if(kind==='operations.job.work_boundary.correct')require(ref.leftVersionId!==ref.rightVersionId);
  if(kind==='operations.job.work_start.correct')require(ref.workVersionId!==ref.arrivalVersionId&&BigInt(ref.expectedJobVersion as string)<9223372036854775807n);
  if(kind==='operations.support_trip.record'||kind==='operations.support_trip.correct')require((kind==='operations.support_trip.record'?['depart','arrive','cancel']:['record','correct']).includes(ref.action as string)&&(['depart','record'].includes(ref.action as string)===(ref.expectedLegVersionId===null)));
  if(kind==='operations.fulfillment_modes.initialize')require(ref.expectedSequence==='0');
  if(kind==='operations.fulfillment_modes.save')require(version(ref.expectedSequence));
  if(kind==='operations.job.reschedule')require(['propose','confirm','withdraw'].includes(ref.action as string));
  if(kind==='bookkeeping.receipt.reserve')require(ref.expectedRevision==='0');
  if(kind==='bookkeeping.receipt.publish')require(ref.expectedRevision==='1');
  if(kind==='crm.vehicle.association')require(['open','close','transfer'].includes(ref.action as string)&&ref.expectedVersion===(ref.action==='open'?'0':'1')&&(ref.action==='transfer'?uuid(ref.nextAssociationId)&&ref.nextAssociationId!==ref.associationId:ref.nextAssociationId===null));
  if(kind==='quote.replacement.create')require(version(ref.expectedFamilyVersion)&&ref.expectedRevisionVersion==='0');
  if(kind==='quote.draft.save')require((ref.expectedFamilyVersion==='0')===(ref.expectedRevisionVersion==='0'));
  if(kind==='quote.review.submit'||kind==='quote.review.approve'||kind==='quote.manual.send'||kind==='quote.confirmation.accept')require(BigInt(ref.expectedContentVersion as string)<=BigInt(ref.expectedRevisionVersion as string));
  return Object.freeze({schemaVersion:1,businessId:row.businessId,commandType:kind,reference:Object.freeze(ref)}) as OriginalOperationReference;
 }catch{throw new OriginalOperationReferenceError();}
}
export function parseOriginalOperationRetirement(value:unknown):OriginalOperationRetirement{
 try{
  const row=object(value,['schemaVersion','recoveryEpoch','original','reason']);
  require(row.schemaVersion===1&&uuid(row.recoveryEpoch));reason(row.reason);
  // The fresh authority epoch is separate from the retained original epoch.
  return Object.freeze({schemaVersion:1,recoveryEpoch:row.recoveryEpoch,original:parseOriginalOperationReference(row.original),reason:row.reason});
 }catch{throw new OriginalOperationReferenceError();}
}
export function parseOriginalOperationOutcome(value:unknown,expected:OriginalOperationReference):OriginalOperationOutcome{
 try{
  require(value!==null&&typeof value==='object'&&Object.hasOwn(value,'state'));
  const descriptor=Object.getOwnPropertyDescriptor(value,'state');require(descriptor&&Object.hasOwn(descriptor,'value'));
  const retired=descriptor.value==='retired',row=object(value,retired?['schemaVersion','state','original','retirement']:['schemaVersion','state','original']);
  require(row.schemaVersion===1&&(retired||row.state==='original_recorded'));
  const original=parseOriginalOperationReference(row.original),pinned=parseOriginalOperationReference(expected);
  require(JSON.stringify(original)===JSON.stringify(pinned));
  // This observation alone NEVER authorizes clearing the original reference.
  // Its existing typed domain lookup must still verify the original receipt.
  if(!retired)return Object.freeze({schemaVersion:1,state:'original_recorded',original});
  const receipt=object(row.retirement,['operationRowId','auditEventId','recoveryEpoch','reason','recordedAt']);
  require(uuid(receipt.operationRowId)&&uuid(receipt.auditEventId)&&uuid(receipt.recoveryEpoch)&&instant(receipt.recordedAt));reason(receipt.reason);
  return Object.freeze({schemaVersion:1,state:'retired',original,retirement:Object.freeze(receipt)}) as OriginalOperationOutcome;
 }catch{throw new OriginalOperationReferenceError();}
}
export function bindOriginalOperationRetirement(value:unknown,input:OriginalOperationRetirement):OriginalOperationOutcome{
 const intent=parseOriginalOperationRetirement(input),outcome=parseOriginalOperationOutcome(value,intent.original);
 if(outcome.state==='retired')require(outcome.retirement.recoveryEpoch===intent.recoveryEpoch&&outcome.retirement.reason===intent.reason);
 return outcome;
}
