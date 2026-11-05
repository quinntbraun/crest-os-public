// Accepted-quote selector and exact selected-family reload. Observed source
// only: no pending reference, draft, URL state or write authority is created.
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {quoteId,quoteResponseLimit,parseStoredQuoteFamily,parseStoredQuoteRevision,parseStoredQuoteAmendmentRevision} from './quote-storage-contract.ts';
import {parseQuoteAmendmentParent} from './quote-amendment-read.ts';
import {QuoteAmendmentContractError} from './quote-amendment-contract.ts';
function check(value:unknown):asserts value{if(!value)throw new QuoteAmendmentContractError();}
export type QuoteAmendmentTargetsRequest=Readonly<{businessId:string;familyId:string|null;search:string;afterId:string|null;pageSize:number}>;
export function parseQuoteAmendmentTargetsRequest(value:unknown):QuoteAmendmentTargetsRequest{
 check(exact(value,['businessId','familyId','search','afterId','pageSize'])&&quoteId(value.businessId)&&(value.familyId===null||quoteId(value.familyId))&&typeof value.search==='string'&&[...value.search].length<=200&&(value.afterId===null||quoteId(value.afterId))&&Number.isSafeInteger(value.pageSize)&&Number(value.pageSize)>=1&&Number(value.pageSize)<=25);
 check(value.familyId===null||value.search===''&&value.afterId===null&&value.pageSize===1);
 return Object.freeze({...value}) as QuoteAmendmentTargetsRequest;
}
async function fingerprint(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function parseQuoteAmendmentTargets(value:unknown,input:QuoteAmendmentTargetsRequest){
 try{
  const request=parseQuoteAmendmentTargetsRequest(input);check(exact(value,['schemaVersion','businessId','targets','hasMore'])&&value.schemaVersion===1&&value.businessId===request.businessId&&Array.isArray(value.targets)&&value.targets.length<=request.pageSize&&typeof value.hasMore==='boolean'&&(!value.hasMore||value.targets.length===request.pageSize));
  check(request.familyId===null||!value.hasMore);check(new TextEncoder().encode(JSON.stringify(value)).byteLength<=quoteResponseLimit);
  let cursor=request.afterId;
  const targets=[];
  for(const raw of value.targets){
   check(exact(raw,['family','revision','parent','control']));const family=parseStoredQuoteFamily(raw.family,request.businessId);check((cursor===null||family.id>cursor)&&(request.familyId===null||family.id===request.familyId));cursor=family.id;
   check(raw.revision!==null&&typeof raw.revision==='object'&&!Array.isArray(raw.revision));
   const revision=Object.hasOwn(raw.revision,'parent_agreement_id')?parseStoredQuoteAmendmentRevision(raw.revision,request.businessId,family.id):parseStoredQuoteRevision(raw.revision,request.businessId,family.id),{parent,control}=parseQuoteAmendmentParent(raw.parent,raw.control,family);
   check(family.current_revision_id===revision.id&&parent.agreementId===control.currentAgreementId&&revision.internal_snapshot.leadId===family.lead_id);
   if(revision.kind==='initial')check(revision.id===parent.revision.id&&revision.state==='Accepted'&&revision.internal_snapshot.customerId===family.customer_id);
   else check(revision.internal_snapshot.customerId===parent.customerId);
   // Both retained documents are independently fingerprinted. A well-shaped
   // altered hash or mixed parent/current read cannot enable a later action.
   check(await fingerprint(revision.canonical_content)===revision.content_hash&&await fingerprint(parent.revision.canonical_content)===parent.revision.content_hash);
   targets.push(Object.freeze({family,revision,parent,control}));
  }
  return Object.freeze({schemaVersion:1 as const,businessId:request.businessId,targets:Object.freeze(targets),hasMore:value.hasMore});
 }catch{throw new QuoteAmendmentContractError();}
}
export type QuoteAmendmentTarget=Awaited<ReturnType<typeof parseQuoteAmendmentTargets>>['targets'][number];
