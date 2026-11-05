// In-memory review of exact accepted roots and current allocation observations.
// No permission, automatic allocation, save, retry or durable draft is created.
import {quoteId} from '../commercial/quote-storage-contract';
import type {QuoteAmendmentRead} from '../commercial/quote-amendment-read';
import {parseQuoteAmendmentScopePlans} from '../commercial/quote-amendment-scope-plan';
import type {QuoteAmendmentScopePlan} from '../commercial/quote-amendment-scope-plan';
import {quoteDollarsInput} from '../commercial/quote-pricing';
import type {AllocationPart} from '../operations/scope-allocation-plan';
import {bindAmendmentAllocationReview} from './amendment-allocation-review';
import {scheduling} from './scheduling';
import {parseAcceptanceScope} from '../commercial/quote-amendment-acceptance-context';
import {quoteAmendments} from './quote-amendments';
import type {Proof} from './authentication';
type Saved=Exclude<QuoteAmendmentRead,{state:'absent'}>;
export type AcceptancePortion=Readonly<{partitionId:string;gross:string;discount:string;description:string}>;
export type AcceptanceLine=Readonly<{label:string;vehicle:string;plan:Omit<QuoteAmendmentScopePlan,'parts'>;fixed:readonly AllocationPart[];portions:readonly AcceptancePortion[]}>;
export type AcceptancePreparation=Readonly<{lines:readonly AcceptanceLine[]}>;
const check=(v:unknown):void=>{if(!v)throw Error('AMENDMENT_ACCEPTANCE_REVIEW_REQUIRED');};
export const acceptanceDollars=(cents:string)=>{const n=BigInt(cents);return (n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');};
const freeze=(lines:readonly AcceptanceLine[]):AcceptancePreparation=>Object.freeze({lines:Object.freeze(lines.map(line=>Object.freeze({...line,plan:Object.freeze({...line.plan}),fixed:Object.freeze(line.fixed.map(part=>Object.freeze({...part}))),portions:Object.freeze(line.portions.map(part=>Object.freeze({...part})))})))});
export const acceptanceScopeBinding=(saved:Saved)=>Object.freeze({businessId:saved.businessId,familyId:saved.family.id,revisionId:saved.revision.id,familyVersion:saved.family.version,contentHash:saved.revision.content_hash,parentAgreementId:saved.parent.agreementId,parentAgreementVersion:saved.parent.versionNo,parentAcceptedHash:saved.parent.revision.content_hash});
export function prepareAmendmentAcceptance(saved:Saved,current:unknown,parent:unknown,id=()=>crypto.randomUUID()):AcceptancePreparation{
 check(saved.parentIsCurrent&&saved.revision.state==='Sent'&&saved.approval&&saved.latestSend&&saved.control.activeOfferId===saved.revision.id);
 const review=bindAmendmentAllocationReview(current,{businessId:saved.businessId,familyId:saved.family.id,familyVersion:saved.family.version,agreementId:saved.parent.agreementId,agreementVersion:saved.parent.versionNo,customerId:saved.parent.customerId,totalCents:saved.parent.revision.total_cents}),bindings=parseAcceptanceScope(parent,acceptanceScopeBinding(saved)).roots,sources=review.agreement.sources;
 check(bindings.length===sources.length&&new Set(bindings.map(r=>r.stableLineKey)).size===bindings.length&&new Set(bindings.map(r=>r.entitlementId)).size===bindings.length);
 const activeKeys=new Set(saved.parent.revision.internal_snapshot.sources.map(s=>s.stableLineKey));check(bindings.filter(r=>r.authorizationState==='active').length===activeKeys.size&&bindings.filter(r=>r.authorizationState==='active').every(r=>activeKeys.has(r.stableLineKey)));
 const items=new Map(saved.items.map(item=>[item.stable_line_key,item])),lines:AcceptanceLine[]=[];
 for(const root of bindings){
  const source=sources.find(s=>s.entitlementId===root.entitlementId);if(!source)throw Error('AMENDMENT_ACCEPTANCE_REVIEW_REQUIRED');
  check(source.sourceAllocationId===root.sourceAllocationId&&source.sourcePartitionId===root.sourcePartitionId&&source.entitlementVersionId===root.entitlementVersionId&&('authorizationState'in source?source.authorizationState:'active')===root.authorizationState);
  const item=items.get(root.stableLineKey);items.delete(root.stableLineKey);if(item)check(item.vehicle_id===source.vehicleId&&item.job_wide===source.jobWide);
  // Cancelled visits retain their prior plan/history, but do not reserve current work.
  // Only actually assigned or completed portions must remain in the new plan.
  const fixed=source.parts.filter(p=>p.state==='assigned'||p.state==='completed'),plan={stableLineKey:root.stableLineKey,entitlementId:root.entitlementId,expectedEntitlementVersionId:root.entitlementVersionId,entitlementVersionId:id(),sourceAllocationId:root.sourceAllocationId,sourcePartitionId:root.sourcePartitionId,expectedPlanId:source.planId,expectedPlanSequence:source.planSequence,authorizationState:item?'active' as const:'withdrawn' as const,grossInclusiveCents:item?.gross_cents??'0',discountInclusiveCents:item?(BigInt(item.line_discount_cents)+BigInt(item.allocated_discount_cents)).toString():'0',amountCents:item?.final_cents??'0'};
  lines.push({label:item?.customer_snapshot.description??source.scopeDescription,vehicle:source.jobWide?'Job-wide work':review.agreement.vehicles.find(v=>v.id===source.vehicleId)!.label,plan,fixed,portions:item?source.parts.filter(p=>p.state==='unassigned').map(p=>({partitionId:p.partitionId,gross:acceptanceDollars(p.grossInclusiveCents),discount:acceptanceDollars(p.discountInclusiveCents),description:p.scopeDescription})):[]});
 }
 for(const item of items.values()){
  const partition=id();lines.push({label:item.customer_snapshot.description,vehicle:item.job_wide?'Job-wide work':item.customer_snapshot.vehicle??'Vehicle work',plan:{stableLineKey:item.stable_line_key,entitlementId:id(),expectedEntitlementVersionId:null,entitlementVersionId:id(),sourceAllocationId:id(),sourcePartitionId:partition,expectedPlanId:null,expectedPlanSequence:'0',authorizationState:'active',grossInclusiveCents:item.gross_cents,discountInclusiveCents:(BigInt(item.line_discount_cents)+BigInt(item.allocated_discount_cents)).toString(),amountCents:item.final_cents},fixed:[],portions:[]});
 }
 check(lines.length>0&&lines.length<=1000&&lines.every(l=>[l.plan.entitlementId,l.plan.entitlementVersionId,l.plan.sourceAllocationId,l.plan.sourcePartitionId].every(quoteId)));return freeze(lines);
}
export async function readAmendmentAcceptance(saved:Saved,proof:Proof,signal:AbortSignal,deps:{read?:typeof scheduling.agreement;scope?:typeof quoteAmendments.acceptanceScope;id?:()=>string}={}){
 const [current,parent]=await Promise.all([(deps.read??scheduling.agreement)(saved.businessId,saved.family.id,proof,signal),(deps.scope??quoteAmendments.acceptanceScope)(acceptanceScopeBinding(saved),proof,signal)]);if(signal.aborted)throw Error('AMENDMENT_ACCEPTANCE_REVIEW_REQUIRED');return prepareAmendmentAcceptance(saved,current,parent,deps.id);
}
function parts(line:AcceptanceLine):readonly AllocationPart[]{return [...line.fixed,...line.portions.map(p=>{const gross=quoteDollarsInput(p.gross),discount=quoteDollarsInput(p.discount);check(BigInt(discount)<=BigInt(gross));return {partitionId:p.partitionId,jobId:null,state:'unassigned' as const,grossInclusiveCents:gross,discountInclusiveCents:discount,amountCents:(BigInt(gross)-BigInt(discount)).toString(),scopeDescription:p.description};})];}
export function acceptancePlans(value:AcceptancePreparation){return parseQuoteAmendmentScopePlans(value.lines.map(line=>({...line.plan,parts:parts(line)})));}
export function acceptancePreparationIssue(value:AcceptancePreparation):string{
 if(value.lines.some(l=>l.plan.authorizationState==='withdrawn'&&l.fixed.length))return 'Assigned or completed work prevents this withdrawal. Resolve it through its own work or scheduling workflow first.';
 if(value.lines.some(l=>l.plan.authorizationState==='active'&&!l.fixed.length&&!l.portions.length))return 'Choose the remaining work portions before recording acceptance.';
 try{acceptancePlans(value);return '';}catch{return 'Portions must exactly match the approved amounts and discount shares. Check their amounts and scope descriptions.';}
}
export function changeAcceptancePortion(value:AcceptancePreparation,key:string,partition:string,patch:Partial<Pick<AcceptancePortion,'gross'|'discount'|'description'>>){check(Object.keys(patch).every(k=>['gross','discount','description'].includes(k))&&Object.values(patch).every(v=>typeof v==='string'&&v.length<=8000));return freeze(value.lines.map(l=>l.plan.stableLineKey!==key?l:{...l,portions:l.portions.map(p=>p.partitionId===partition?{...p,...patch}:p)}));}
export function balanceAcceptanceLine(value:AcceptancePreparation,key:string,id=()=>crypto.randomUUID()){
 return freeze(value.lines.map(l=>{
  if(l.plan.stableLineKey!==key||l.plan.authorizationState!=='active')return l;
  const remaining=(field:'grossInclusiveCents'|'discountInclusiveCents'|'amountCents')=>BigInt(l.plan[field])-l.fixed.reduce((n,p)=>n+BigInt(p[field]),0n),gross=remaining('grossInclusiveCents'),discount=remaining('discountInclusiveCents'),net=remaining('amountCents');check(gross>=0n&&discount>=0n&&net>=0n&&gross-discount===net);
  if(gross===0n&&discount===0n&&net===0n&&l.fixed.length)return {...l,portions:[]};
  const rootAvailable=!l.fixed.some(p=>p.partitionId===l.plan.sourcePartitionId),partition=rootAvailable?l.plan.sourcePartitionId:l.portions[0]?.partitionId??id();return {...l,portions:[{partitionId:partition,gross:acceptanceDollars(gross.toString()),discount:acceptanceDollars(discount.toString()),description:l.label}]};
 }));
}
export function addAcceptancePortion(value:AcceptancePreparation,key:string,id=()=>crypto.randomUUID()){return freeze(value.lines.map(l=>l.plan.stableLineKey!==key||l.plan.authorizationState!=='active'||l.portions.length>=1000?l:{...l,portions:[...l.portions,{partitionId:!l.fixed.length&&!l.portions.length?l.plan.sourcePartitionId:id(),gross:'',discount:'0.00',description:l.label}]}));}
export function removeAcceptancePortion(value:AcceptancePreparation,key:string,partition:string){return freeze(value.lines.map(l=>l.plan.stableLineKey!==key?l:{...l,portions:l.portions.filter(p=>p.partitionId!==partition)}));}
