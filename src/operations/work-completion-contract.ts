import {customerInstant,customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseFieldOriginal,parseFieldOriginalResult} from './field-original-contract.ts';
import type {CompletionAllocation,CompletionPiece} from './work-completion.ts';

type Amounts=Readonly<{grossInclusiveCents:string;discountInclusiveCents:string;amountCents:string}>;
export type CompletionAssignment=Amounts&Readonly<{
 assignedPartId:string;partitionId:string;planId:string;planSequence:string;scopeDescription:string;
}>;
export type CompletionContext=Readonly<{
 schemaVersion:1;businessId:string;jobId:string;jobVersion:string;jobState:'in_progress'|'paused';
 customerVersion:string;assignments:readonly CompletionAssignment[];duplicateRequestIds:readonly string[];
 contactReviewRequired:boolean;
}>;
type Walkthrough=Readonly<{state:'done'|'unavailable';reason:string|null}>;
const suppressionReasons=['owner_skipped','outreach_opt_out','no_contact','missing_review_url','contact_review_required','duplicate_encounter','template_disabled'] as const;
type SuppressionReason=typeof suppressionReasons[number];
export type CompletionSummary=Readonly<{
 schemaVersion:1;businessId:string;jobId:string;jobVersion:string;jobState:'completed';
 completedAt:string;completionOutcome:'full'|'partial';walkthrough:Walkthrough;reason:string|null;
 outcomes:readonly Readonly<{id:string;outcome:CompletionPiece['outcome'];scopeDescription:string;completedCents:string;reason:string|null}>[];
 review:Readonly<{state:'prepared'|'pending'|'skipped';suppressionReason:SuppressionReason|null;reason:string|null;
  message:Readonly<{channel:'text'|'email';text:string}>|null}>;
 tasks:readonly Readonly<{kind:'invoice_finalization'|'commercial_resolution';state:'open'}>[];
}>;
export type CompletionReview=Readonly<{
 reviewUrl:string|null;skipReason:string|null;additionalRequestReason:string|null;
 expectedDuplicateRequestIds:readonly string[];expectedCustomerVersion:string;contactReviewReason:string|null;
}>;
export type CompletionBody=Readonly<{
 scope:readonly CompletionAllocation[];reason:string|null;
 walkthrough:Walkthrough;review:CompletionReview;
}>;
export type CompletionSave=Readonly<{
 schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;
 jobId:string;expectedJobVersion:string;body:CompletionBody;
}>;

export class CompletionContractError extends Error {
 constructor(){super('WORK_COMPLETION_REVIEW_REQUIRED');this.name='CompletionContractError';}
}
function check(value:unknown):asserts value {if(!value)throw new CompletionContractError();}
function record(value:unknown,keys:readonly string[]):Record<string,unknown> {
 check(value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null));
 const descriptors=Object.getOwnPropertyDescriptors(value);
 check(Reflect.ownKeys(descriptors).length===keys.length&&keys.every(key=>
  Object.hasOwn(descriptors,key)&&descriptors[key]!.enumerable&&Object.hasOwn(descriptors[key]!,'value')));
 return Object.fromEntries(keys.map(key=>[key,descriptors[key]!.value]));
}
function list<T>(value:unknown,parse:(entry:unknown)=>T):readonly T[] {
 check(Array.isArray(value)&&value.length<=10000&&Reflect.ownKeys(value).length===value.length+1);
 return Object.freeze(Array.from({length:value.length},(_,index)=>{
  const entry=Object.getOwnPropertyDescriptor(value,String(index));
  check(entry?.enumerable&&Object.hasOwn(entry,'value'));
  return parse(entry.value);
 }));
}
function text(value:unknown,max:number,allowBlank=false):value is string {
 return typeof value==='string'&&(allowBlank||value.trim().length>0)&&[...value].length<=max
  &&[...value].every(char=>{
   const code=char.codePointAt(0)!;
   return !(code>=0xd800&&code<=0xdfff)&&(!(code<32||code===127)||[9,10,13].includes(code));
  });
}
function optionalText(value:unknown,max:number,allowBlank=false):value is string|null {
 return value===null||text(value,max,allowBlank);
}
const amountKeys=['grossInclusiveCents','discountInclusiveCents','amountCents'] as const;
function amounts(row:Record<string,unknown>) {
 const [gross,discount,total]=amountKeys.map(key=>row[key]);
 check(version(gross,true)&&version(discount,true)&&version(total,true));
 check(BigInt(gross as string)===BigInt(discount as string)+BigInt(total as string));
}
function nextVersion(value:unknown) {
 return version(value)&&BigInt(value as string)<9223372036854775807n;
}
function unique(values:readonly unknown[]) {check(new Set(values).size===values.length);}
function uuidList(value:unknown) {
 const values=list(value,id=>{check(uuid(id));return id;});
 unique(values);
 return values;
}
function walkthroughEvidence(value:unknown):Walkthrough {
 const row=record(value,['state','reason']);
 check(row.state==='done'&&row.reason===null||row.state==='unavailable'&&text(row.reason,1000));
 return Object.freeze(row) as Walkthrough;
}

function parseSummary(value:unknown,businessId:string,jobId:string):CompletionSummary {
 const summary=record(value,['schemaVersion','businessId','jobId','jobVersion','jobState','completedAt',
  'completionOutcome','walkthrough','reason','outcomes','review','tasks']);
 check(summary.schemaVersion===1&&summary.businessId===businessId&&summary.jobId===jobId
  &&summary.jobState==='completed'&&version(summary.jobVersion)&&customerInstant(summary.completedAt)
  &&(summary.completionOutcome==='full'||summary.completionOutcome==='partial')&&optionalText(summary.reason,1000));
 const walkthrough=walkthroughEvidence(summary.walkthrough);
 const outcomes=list(summary.outcomes,value=>{
  const row=record(value,['id','outcome','scopeDescription','completedCents','reason']);
  check(uuid(row.id)&&['completed','unfulfilled','cancelled'].includes(row.outcome as string)
   &&text(row.scopeDescription,2000)&&version(row.completedCents,true)&&optionalText(row.reason,1000)
   &&(row.outcome==='completed'||row.completedCents==='0'&&row.reason!==null));
  return Object.freeze(row) as CompletionSummary['outcomes'][number];
 });
 unique(outcomes.map(row=>row.id));
 check(outcomes.some(row=>row.outcome==='completed')
  &&outcomes.some(row=>row.outcome!=='completed')===(summary.completionOutcome==='partial'));
 const review=record(summary.review,['state','suppressionReason','reason','message']);
 check(['prepared','pending','skipped'].includes(review.state as string)&&optionalText(review.reason,1000));
 let message:CompletionSummary['review']['message']=null;
 if(review.state==='prepared'){
  check(review.suppressionReason===null&&review.reason===null);
  const draft=record(review.message,['channel','text']);
  check((draft.channel==='text'||draft.channel==='email')&&text(draft.text,10000));
  message=Object.freeze(draft) as NonNullable<CompletionSummary['review']['message']>;
 }else{
  check(review.message===null&&suppressionReasons.includes(review.suppressionReason as SuppressionReason)
   &&(review.state==='skipped')===['owner_skipped','outreach_opt_out'].includes(review.suppressionReason as string));
 }
 const tasks=list(summary.tasks,value=>{
  const row=record(value,['kind','state']);
  check(row.state==='open'&&(row.kind==='invoice_finalization'||row.kind==='commercial_resolution'));
  return Object.freeze(row) as CompletionSummary['tasks'][number];
 });
 unique(tasks.map(row=>row.kind));
 check(tasks.some(row=>row.kind==='invoice_finalization')
  &&tasks.some(row=>row.kind==='commercial_resolution')===(summary.completionOutcome==='partial'));
 return Object.freeze({...summary,walkthrough,outcomes,review:Object.freeze({...review,message}),tasks}) as CompletionSummary;
}

export function parseCompletionContext(value:unknown,businessId:string,jobId:string) {
 check(uuid(businessId)&&uuid(jobId));
 if(exact(value,['state'])&&record(value,['state']).state==='absent')return Object.freeze({state:'absent' as const});
 if(value!==null&&typeof value==='object'&&Object.getOwnPropertyDescriptor(value,'jobState')?.value==='completed')
  return parseSummary(value,businessId,jobId);
 const context=record(value,['schemaVersion','businessId','jobId','jobVersion','jobState','customerVersion','assignments','duplicateRequestIds','contactReviewRequired']);
 check(context.schemaVersion===1&&context.businessId===businessId&&context.jobId===jobId
  &&version(context.jobVersion)&&version(context.customerVersion)&&['in_progress','paused'].includes(context.jobState as string)
  &&typeof context.contactReviewRequired==='boolean');
 const assignments=list(context.assignments,entry=>{
  const row=record(entry,['assignedPartId','partitionId','planId','planSequence','scopeDescription',...amountKeys]);
  check([row.assignedPartId,row.partitionId,row.planId].every(uuid)&&version(row.planSequence)&&text(row.scopeDescription,2000));
  amounts(row);
  return Object.freeze(row) as CompletionAssignment;
 });
 check(assignments.length>0);
 unique(assignments.map(row=>row.assignedPartId));
 unique(assignments.map(row=>row.partitionId));
 return Object.freeze({...context,assignments,duplicateRequestIds:uuidList(context.duplicateRequestIds)}) as CompletionContext;
}

export function parseCompletionSave(value:unknown):CompletionSave {
 const request=record(value,['schemaVersion','businessId','operationId','recoveryEpoch','jobId','expectedJobVersion','body']);
 check(request.schemaVersion===1&&[request.businessId,request.operationId,request.recoveryEpoch,request.jobId].every(uuid)
  &&nextVersion(request.expectedJobVersion));
 const body=record(request.body,['scope','reason','walkthrough','review']);
 check(optionalText(body.reason,1000));
 const walkthrough=walkthroughEvidence(body.walkthrough);
 const review=record(body.review,['reviewUrl','skipReason','additionalRequestReason','expectedDuplicateRequestIds','expectedCustomerVersion','contactReviewReason']);
 check(optionalText(review.reviewUrl,2048,true)&&optionalText(review.skipReason,1000)
  &&optionalText(review.additionalRequestReason,1000)&&optionalText(review.contactReviewReason,1000)
  &&version(review.expectedCustomerVersion));
 const duplicateIds=uuidList(review.expectedDuplicateRequestIds);
 const scope=list(body.scope,entry=>{
  const row=record(entry,['assignedPartId','expectedPlanId','expectedPlanSequence','pieces']);
  check(uuid(row.assignedPartId)&&uuid(row.expectedPlanId)&&nextVersion(row.expectedPlanSequence));
  const pieces=list(row.pieces,item=>{
   const piece=record(item,['partitionId','outcome','scopeDescription',...amountKeys,'reason']);
   check(uuid(piece.partitionId)&&['completed','unfulfilled','cancelled'].includes(piece.outcome as string)
    &&text(piece.scopeDescription,2000)&&optionalText(piece.reason,1000)
    &&(piece.outcome==='completed'||piece.reason!==null));
   amounts(piece);
   return Object.freeze(piece) as CompletionPiece;
  });
  check(pieces.length>0);
  return Object.freeze({...row,pieces}) as CompletionAllocation;
 });
 check(scope.length>0&&scope.some(row=>row.pieces.some(piece=>piece.outcome==='completed')));
 unique(scope.map(row=>row.assignedPartId));
 unique(scope.flatMap(row=>row.pieces.map(piece=>piece.partitionId)));
 const parsed=Object.freeze({...request,body:Object.freeze({...body,scope,walkthrough:Object.freeze(walkthrough),
  review:Object.freeze({...review,expectedDuplicateRequestIds:duplicateIds})})}) as CompletionSave;
 check(new TextEncoder().encode(JSON.stringify(parsed.body)).byteLength<=1048576);
 return parsed;
}

export function completionOriginal(request:CompletionSave) {
 return parseFieldOriginal({schemaVersion:1,businessId:request.businessId,commandType:'operations.job.complete',
  reference:{operationId:request.operationId,recoveryEpoch:request.recoveryEpoch,
   jobId:request.jobId,expectedJobVersion:request.expectedJobVersion}});
}
export function parseCompletionCommitted(value:unknown,request:CompletionSave) {
 const original=completionOriginal(request);
 const result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}
export const completionConflicts=Object.freeze(['operation','job','version','state'] as const);
