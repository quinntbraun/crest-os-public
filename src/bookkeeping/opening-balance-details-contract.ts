// Proposed nonposting evidence boundary for the remaining P27 source classes.
// Accounts/boundary must eventually be resolved under the database finance fence;
// caller-supplied context cannot prove completeness, ownership or approval.
import {customerDate,customerInstant,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason,parseFinanceAccountIdentity} from './finance-account-contract.ts';
import type {FinanceAccount} from './finance-account-contract.ts';
import {openingSourceAccountRules} from './opening-source-account-rules.ts';
export const openingBalanceDetailKinds=['wallet','cash','checks','transfer_transit','owner_custody','tax_liability','debt','due_owner','equipment_cost','accumulated_depreciation','prepaid','other_asset','other_liability'] as const;
export type OpeningBalanceDetailKind=typeof openingBalanceDetailKinds[number];
type Document=Readonly<{reference:string;sha256:string}>;
type Details={
 wallet:{channelId:string;channelVersion:string;scope:'dedicated_business'};
 cash:{location:string;countedAt:string};
 checks:{payer:string;checkReference:string;receivedAt:string;datedOn:string};
 transfer_transit:{originAccountId:string;destinationAccountId:string;departedAt:string;transferReference:string;originalCents:string;creditedBeforeCutoverCents:string;returnedBeforeCutoverCents:string;feesBeforeCutover:readonly {reference:string;occurredAt:string;amountCents:string;evidence:Document}[]};
 owner_custody:{ownerId:string;channelId:string;channelVersion:string;scope:'business_only';basisEvidence:Document};
 tax_liability:{profileId:string|null;profileVersion:string|null;jurisdiction:string;periodFrom:string;periodThrough:string;classificationEvidence:Document|null};
 debt:{lender:string;agreementReference:string;principalEvidence:Document};
 due_owner:{ownerId:string;obligationReference:string;basisEvidence:Document};
 equipment_cost:{assetId:string;description:string;acquiredOn:string;historicalCostEvidence:Document;classificationEvidence:Document|null};
 accumulated_depreciation:{assetId:string;costItemId:string;calculationEvidence:Document};
 prepaid:{purpose:string;paidOn:string;benefitFrom:string;benefitThrough:string;originalCents:string;remainingBasisEvidence:Document};
 other_asset:{description:string;basisEvidence:Document};
 other_liability:{description:string;basisEvidence:Document};
};
export type OpeningBalanceDetailItem={ [K in OpeningBalanceDetailKind]:Readonly<{itemId:string;kind:K;sourceNamespace:string;externalId:string;accountId:string;accountVersion:string;amountCents:string;evidence:Document;detail:Details[K]}> }[OpeningBalanceDetailKind];
type Review=Readonly<{kind:OpeningBalanceDetailKind;state:'unknown'|'verified_zero'|'not_applicable'|'source_recorded';evidence:Document|null;note:string}>;
export type OpeningBalanceDetailsInput=Readonly<{schemaVersion:1;reason:string;items:readonly OpeningBalanceDetailItem[];reviews:readonly Review[]}>;
type Boundary=Readonly<{cutoverOn:string;cutoverAt:string}>;
const maximum=9223372036854775807n;
const fields={
 wallet:['channelId','channelVersion','scope'],cash:['location','countedAt'],checks:['payer','checkReference','receivedAt','datedOn'],
 transfer_transit:['originAccountId','destinationAccountId','departedAt','transferReference','originalCents','creditedBeforeCutoverCents','returnedBeforeCutoverCents','feesBeforeCutover'],
 owner_custody:['ownerId','channelId','channelVersion','scope','basisEvidence'],
 tax_liability:['profileId','profileVersion','jurisdiction','periodFrom','periodThrough','classificationEvidence'],
 debt:['lender','agreementReference','principalEvidence'],due_owner:['ownerId','obligationReference','basisEvidence'],
 equipment_cost:['assetId','description','acquiredOn','historicalCostEvidence','classificationEvidence'],
 accumulated_depreciation:['assetId','costItemId','calculationEvidence'],
 prepaid:['purpose','paidOn','benefitFrom','benefitThrough','originalCents','remainingBasisEvidence'],
 other_asset:['description','basisEvidence'],other_liability:['description','basisEvidence'],
} as const;
export class OpeningBalanceDetailsError extends Error{constructor(){super('OPENING_BALANCE_DETAILS_REVIEW_REQUIRED');this.name='OpeningBalanceDetailsError';}}
function require(value:unknown):asserts value{if(!value)throw new OpeningBalanceDetailsError();}
function label(value:unknown):value is string{return financeAccountReviewReason(value)&&[...value].length<=200;}
function document(value:unknown):asserts value is Document{require(exact(value,['reference','sha256'])&&label(value.reference)&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256));}
function cents(value:unknown,signed=false){require(typeof value==='string'&&(signed?/^(0|-?[1-9][0-9]{0,18})$/:/^(0|[1-9][0-9]{0,18})$/).test(value));const result=BigInt(value);require(result>=-maximum&&result<=maximum);return result;}
type DeepReadonly<T>=T extends readonly(infer U)[]?readonly DeepReadonly<U>[]:T extends object?{readonly[K in keyof T]:DeepReadonly<T[K]>}:T;
function freeze<T>(value:T):DeepReadonly<T>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value as DeepReadonly<T>;}
export function normalizeOpeningBalanceDetails(input:unknown,boundary:Boundary,accountInventory:readonly FinanceAccount[]){
 try{
  require(exact(boundary,['cutoverOn','cutoverAt'])&&customerDate(boundary.cutoverOn)&&customerInstant(boundary.cutoverAt));
  require(exact(input,['schemaVersion','reason','items','reviews'])&&input.schemaVersion===1&&financeAccountReviewReason(input.reason)&&Array.isArray(input.items)&&input.items.length<=1000&&Array.isArray(input.reviews)&&input.reviews.length===openingBalanceDetailKinds.length&&new TextEncoder().encode(JSON.stringify(input)).byteLength<=2097152);
  require(Array.isArray(accountInventory)&&accountInventory.length<=2048);
  const accounts=new Map<string,FinanceAccount>(),codes=new Set<string>();
  for(const account of accountInventory as readonly FinanceAccount[]){
   require(exact(account,['schemaVersion','id','currency','version','name','active','code','accountType','normalSide','controlKind','reportRole'])&&account.schemaVersion===1&&customerUuid(account.id)&&customerVersion(account.version)&&account.currency==='USD'&&label(account.name)&&typeof account.active==='boolean'&&!accounts.has(account.id)&&!codes.has(account.code));
   parseFinanceAccountIdentity({code:account.code,accountType:account.accountType,normalSide:account.normalSide,controlKind:account.controlKind,reportRole:account.reportRole});accounts.set(account.id,account);codes.add(account.code);
  }
  const items=structuredClone(input.items) as OpeningBalanceDetailItem[],ids=new Map<string,OpeningBalanceDetailItem>(),origins=new Map<string,OpeningBalanceDetailItem[]>(),assets=new Map<string,OpeningBalanceDetailItem>(),depreciated=new Set<string>(),wallets=new Set<string>(),walletChannels=new Set<string>(),custody=new Set<string>();
  const totals=Object.fromEntries(openingBalanceDetailKinds.map(kind=>[kind,0n])) as Record<OpeningBalanceDetailKind,bigint>;
  const counts=Object.fromEntries(openingBalanceDetailKinds.map(kind=>[kind,0])) as Record<OpeningBalanceDetailKind,number>;
  const warnings:{itemId:string;code:'negative_wallet'|'postdated_check'|'tax_classification_unresolved'|'asset_classification_unresolved'|'expired_prepaid'}[]=[];
  const before=(value:unknown):value is string=>customerInstant(value)&&value<boundary.cutoverAt;
  for(const item of items){
   require(exact(item,['itemId','kind','sourceNamespace','externalId','accountId','accountVersion','amountCents','evidence','detail'])&&customerUuid(item.itemId)&&!ids.has(item.itemId)&&openingBalanceDetailKinds.includes(item.kind)&&typeof item.sourceNamespace==='string'&&/^[a-z][a-z0-9_.-]{0,99}$/.test(item.sourceNamespace)&&label(item.externalId));document(item.evidence);ids.set(item.itemId,item);
   const account=accounts.get(item.accountId),rule=openingSourceAccountRules[item.kind];
   require(account?.active&&account.version===item.accountVersion&&account.accountType===rule[0]&&account.normalSide===rule[1]&&account.controlKind===rule[2]);
   const amount=cents(item.amountCents,item.kind==='wallet');require(amount!==0n&&(item.kind==='wallet'||amount>0n));
   totals[item.kind]+=amount;counts[item.kind]++;
   const key=JSON.stringify([item.sourceNamespace,item.externalId]),same=origins.get(key)??[];same.push(item);origins.set(key,same);
   require(exact(item.detail,fields[item.kind]));
   switch(item.kind){
    case 'wallet':{const d=item.detail;require(customerUuid(d.channelId)&&customerVersion(d.channelVersion)&&d.scope==='dedicated_business'&&!wallets.has(item.accountId)&&!walletChannels.has(d.channelId));wallets.add(item.accountId);walletChannels.add(d.channelId);if(amount<0n)warnings.push({itemId:item.itemId,code:'negative_wallet'});break;}
    case 'cash':require(label(item.detail.location)&&customerInstant(item.detail.countedAt)&&item.detail.countedAt<=boundary.cutoverAt);break;
    case 'checks':{const d=item.detail;require(label(d.payer)&&label(d.checkReference)&&before(d.receivedAt)&&customerDate(d.datedOn));if(d.datedOn>boundary.cutoverOn)warnings.push({itemId:item.itemId,code:'postdated_check'});break;}
    case 'transfer_transit':{
     const d=item.detail;require(customerUuid(d.originAccountId)&&customerUuid(d.destinationAccountId)&&d.originAccountId!==d.destinationAccountId&&before(d.departedAt)&&label(d.transferReference)&&Array.isArray(d.feesBeforeCutover)&&d.feesBeforeCutover.length<=100);
     const original=cents(d.originalCents),credited=cents(d.creditedBeforeCutoverCents),returned=cents(d.returnedBeforeCutoverCents),references=new Set<string>();let fees=0n;
     for(const fee of d.feesBeforeCutover){require(exact(fee,['reference','occurredAt','amountCents','evidence'])&&label(fee.reference)&&!references.has(fee.reference)&&before(fee.occurredAt)&&fee.occurredAt>=d.departedAt);document(fee.evidence);const value=cents(fee.amountCents);require(value>0n);fees+=value;references.add(fee.reference);}
     require(original>0n&&original-credited-returned-fees===amount);break;
    }
    case 'owner_custody':{const d=item.detail;require(customerUuid(d.ownerId)&&customerUuid(d.channelId)&&customerVersion(d.channelVersion)&&d.scope==='business_only');document(d.basisEvidence);const key=JSON.stringify([d.ownerId,d.channelId]);require(!custody.has(key));custody.add(key);break;}
    case 'tax_liability':{const d=item.detail;require(label(d.jurisdiction)&&customerDate(d.periodFrom)&&customerDate(d.periodThrough)&&d.periodFrom<=d.periodThrough&&d.periodFrom<=boundary.cutoverOn&&(d.profileId===null?d.profileVersion===null:customerUuid(d.profileId)&&customerVersion(d.profileVersion)));if(d.classificationEvidence!==null)document(d.classificationEvidence);if(d.profileId===null||d.classificationEvidence===null)warnings.push({itemId:item.itemId,code:'tax_classification_unresolved'});break;}
    case 'debt':require(label(item.detail.lender)&&label(item.detail.agreementReference));document(item.detail.principalEvidence);break;
    case 'due_owner':require(customerUuid(item.detail.ownerId)&&label(item.detail.obligationReference));document(item.detail.basisEvidence);break;
    case 'equipment_cost':{const d=item.detail;require(customerUuid(d.assetId)&&!assets.has(d.assetId)&&label(d.description)&&customerDate(d.acquiredOn)&&d.acquiredOn<boundary.cutoverOn);document(d.historicalCostEvidence);if(d.classificationEvidence!==null)document(d.classificationEvidence);else warnings.push({itemId:item.itemId,code:'asset_classification_unresolved'});assets.set(d.assetId,item);break;}
    case 'accumulated_depreciation':require(customerUuid(item.detail.assetId)&&customerUuid(item.detail.costItemId)&&!depreciated.has(item.detail.assetId));document(item.detail.calculationEvidence);depreciated.add(item.detail.assetId);break;
    case 'prepaid':{const d=item.detail;require(financeAccountReviewReason(d.purpose)&&customerDate(d.paidOn)&&d.paidOn<boundary.cutoverOn&&customerDate(d.benefitFrom)&&customerDate(d.benefitThrough)&&d.benefitFrom<=d.benefitThrough&&cents(d.originalCents)>=amount);document(d.remainingBasisEvidence);if(d.benefitThrough<boundary.cutoverOn)warnings.push({itemId:item.itemId,code:'expired_prepaid'});break;}
    case 'other_asset':case 'other_liability':require(financeAccountReviewReason(item.detail.description));document(item.detail.basisEvidence);break;
   }
  }
  for(const item of items)if(item.kind==='accumulated_depreciation'){
   const cost=ids.get(item.detail.costItemId);require(cost?.kind==='equipment_cost'&&cost.detail.assetId===item.detail.assetId&&cost.sourceNamespace===item.sourceNamespace&&cost.externalId===item.externalId&&cost.accountId!==item.accountId&&cents(item.amountCents)<=cents(cost.amountCents));
  }
  for(const same of origins.values())require(same.length===1||same.length===2&&same.some(item=>item.kind==='equipment_cost')&&same.some(item=>item.kind==='accumulated_depreciation'));
  for(const amount of Object.values(totals))require(amount>=-maximum&&amount<=maximum);
  const reviews=structuredClone(input.reviews) as Review[],reviewed=new Set<string>();
  for(const review of reviews){
   require(exact(review,['kind','state','evidence','note'])&&openingBalanceDetailKinds.includes(review.kind)&&!reviewed.has(review.kind)&&financeAccountReviewReason(review.note)&&['unknown','verified_zero','not_applicable','source_recorded'].includes(review.state));reviewed.add(review.kind);
   if(review.state==='unknown')require(review.evidence===null);
   else{document(review.evidence);require(review.state==='source_recorded'?counts[review.kind]>0:counts[review.kind]===0);}
  }
  return freeze({schemaVersion:1 as const,profile:'crest.opening-balance-details-candidate.v1' as const,...boundary,currency:'USD' as const,state:'evidence_prepared' as const,reason:input.reason,items,reviews,
   totals:Object.fromEntries(openingBalanceDetailKinds.map(kind=>[kind,{amountCents:totals[kind].toString(),itemCount:counts[kind]}])) as Record<OpeningBalanceDetailKind,{amountCents:string;itemCount:number}>,warnings,
   unresolvedKinds:reviews.filter(review=>review.state==='unknown').map(review=>review.kind),posted:false as const,postingAuthorized:false as const,fullSourceClosureVerified:false as const,completeOpening:false as const});
 }catch{throw new OpeningBalanceDetailsError();}
}
