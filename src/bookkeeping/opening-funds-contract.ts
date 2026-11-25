// Retained pre-cutover evidence only. Neither an external receipt nor refund
// authority is created by saving/normalizing these proposed opening sources.
import {customerDate,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason} from './finance-account-contract.ts';
type Document=Readonly<{reference:string;sha256:string}>;
type Reduction=Readonly<{kind:'application'|'refund'|'tip_conversion'|'collection_failure'|'noncustomer_reclassification';reference:string;occurredOn:string;amountCents:string;evidence:Document}>;
type Item=Readonly<{itemId:string;customerId:string;heldCents:string;obligationEvidence:Document;refundableCeilingCents:string|null;refundEvidence:Document|null}>;
type Root=Readonly<{rootId:string;sourceNamespace:string;externalId:string;receivedOn:string;receivedCents:string;receiptEvidence:Document;reductions:readonly Reduction[];items:readonly Item[]}>;
export type OpeningFundsInput=Readonly<{schemaVersion:1;roots:readonly Root[];reason:string}>;
const maximum=9223372036854775807n;
export class OpeningFundsEvidenceError extends Error{constructor(){super('OPENING_FUNDS_EVIDENCE_REQUIRED');this.name='OpeningFundsEvidenceError';}}
function require(value:unknown):asserts value{if(!value)throw new OpeningFundsEvidenceError();}
function fields(value:unknown,names:readonly string[]):boolean{return exact(value,names);}
function document(value:unknown):asserts value is Document{require(exact(value,['reference','sha256'])&&financeAccountReviewReason(value.reference)&&[...value.reference].length<=200&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256));}
function cents(value:unknown,positive=false){require(typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value));const amount=BigInt(value);require(amount<=maximum&&(!positive||amount>0n));return amount;}
function freeze<T>(value:T):Readonly<T>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export function normalizeOpeningFundsEvidence(input:unknown,cutoverOn:string){
 try{
  require(exact(input,['schemaVersion','roots','reason'])&&input.schemaVersion===1&&customerDate(cutoverOn)&&financeAccountReviewReason(input.reason)&&Array.isArray(input.roots)&&input.roots.length<=200&&new TextEncoder().encode(JSON.stringify(input)).byteLength<=1048576);
  const rootIds=new Set<string>(),origins=new Set<string>(),itemIds=new Set<string>();let held=0n,refundable=0n,allKnown=true,itemCount=0;
  const roots=[];
  for(const root of input.roots as readonly Root[]){
   require(fields(root,['rootId','sourceNamespace','externalId','receivedOn','receivedCents','receiptEvidence','reductions','items'])&&customerUuid(root.rootId)&&!rootIds.has(root.rootId)&&typeof root.sourceNamespace==='string'&&/^[a-z][a-z0-9_.-]{0,99}$/.test(root.sourceNamespace)&&financeAccountReviewReason(root.externalId)&&[...root.externalId].length<=200&&customerDate(root.receivedOn)&&root.receivedOn<cutoverOn&&Array.isArray(root.reductions)&&root.reductions.length<=100&&Array.isArray(root.items)&&root.items.length>0&&root.items.length<=200);
   rootIds.add(root.rootId);const origin=JSON.stringify([root.sourceNamespace,root.externalId]);require(!origins.has(origin));origins.add(origin);document(root.receiptEvidence);const received=cents(root.receivedCents,true),references=new Set<string>();let removed=0n,rootHeld=0n,rootRefundable=0n,rootKnown=true;
   for(const reduction of root.reductions as readonly Reduction[]){
    require(fields(reduction,['kind','reference','occurredOn','amountCents','evidence'])&&['application','refund','tip_conversion','collection_failure','noncustomer_reclassification'].includes(reduction.kind)&&financeAccountReviewReason(reduction.reference)&&[...reduction.reference].length<=200&&!references.has(reduction.reference)&&customerDate(reduction.occurredOn)&&reduction.occurredOn>=root.receivedOn&&reduction.occurredOn<cutoverOn);references.add(reduction.reference);document(reduction.evidence);removed+=cents(reduction.amountCents,true);
   }
   const items=[];
   for(const item of root.items as readonly Item[]){
    require(fields(item,['itemId','customerId','heldCents','obligationEvidence','refundableCeilingCents','refundEvidence'])&&customerUuid(item.itemId)&&!itemIds.has(item.itemId)&&customerUuid(item.customerId));itemIds.add(item.itemId);document(item.obligationEvidence);const amount=cents(item.heldCents,true);rootHeld+=amount;require(++itemCount<=1000);
    if(item.refundableCeilingCents===null){require(item.refundEvidence===null);rootKnown=false;allKnown=false;}
    else{document(item.refundEvidence);const ceiling=cents(item.refundableCeilingCents);require(ceiling<=amount);rootRefundable+=ceiling;}
    items.push({...structuredClone(item),refundCeilingState:item.refundableCeilingCents===null?'needs_review':'evidenced'});
   }
   require(rootHeld>0n&&received-removed===rootHeld);held+=rootHeld;refundable+=rootRefundable;
   roots.push({...structuredClone(root),items,heldCents:rootHeld.toString(),openingRootCents:rootHeld.toString(),refundableCeilingCents:rootKnown?rootRefundable.toString():null});
  }
  return freeze({schemaVersion:1 as const,cutoverOn,state:'evidence_prepared' as const,posted:false as const,currency:'USD' as const,reason:input.reason,
   totals:{heldCents:held.toString(),refundableCeilingCents:allKnown?refundable.toString():null,rootCount:roots.length,itemCount,allItemRefundCeilingsKnown:allKnown},roots,
   refundAuthorized:false as const,fullSourceClosureVerified:false as const});
 }catch{throw new OpeningFundsEvidenceError();}
}
