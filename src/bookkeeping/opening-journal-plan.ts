// P27 arithmetic over resolved opening sources, never posting authority. The
// future transaction must independently resolve every source/account/review,
// verify complete inventory and approval, and enforce cutover uniqueness.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {customerDate,customerInstant,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason,parseFinanceAccountIdentity} from './finance-account-contract.ts';
import type {FinanceAccount} from './finance-account-contract.ts';

// Type/side/control pins follow ACCOUNTING12/P27 and chart identities. New
// source/mapping registrations still need their database implementation. No
// revenue, expense, contribution, distribution or suspense opening is inferred.
const sources={
 bank:['asset','debit','bank'],wallet:['asset','debit','wallet'],cash:['asset','debit','cash'],
 checks:['asset','debit','checks'],transfer_transit:['asset','debit','transfer_transit'],
 owner_custody:['asset','debit','owner_custody'],receivable:['asset','debit','ar'],
 customer_funds:['liability','credit','customer_funds'],supplier_payable:['liability','credit','payable'],
 tax_liability:['liability','credit','tax_payable'],debt:['liability','credit','debt'],
 due_owner:['liability','credit','due_owner'],equipment_cost:['asset','debit','fixed_asset'],
 accumulated_depreciation:['asset','credit','accumulated_depreciation'],prepaid:['asset','debit','prepaid'],
 other_asset:['asset','debit',null],other_liability:['liability','credit',null],
} as const;
export type OpeningSourceKind=keyof typeof sources;
type Evidence=Readonly<{reference:string;sha256:string}>;
export type OpeningJournalSource=Readonly<{sourceId:string;sourceVersion:string;sourceSha256:string;kind:OpeningSourceKind;
 accountId:string;accountVersion:string;amountCents:string;evidence:Evidence}>;
type Review=Readonly<{accountId:string;state:'verified'|'verified_zero'|'not_applicable'|'unknown';netDebitCents:string|null;evidence:Evidence|null}>;
export type OpeningJournalInput=Readonly<{businessId:string;cutoverId:string;worksheetRevisionId:string;cutoverOn:string;cutoverAt:string;
 timeZone:string;equityBasis:string;equityEvidence:Evidence;openingEquityAccountId:string;
 accounts:readonly FinanceAccount[];reviews:readonly Review[];sources:readonly OpeningJournalSource[]}>;
const maximum=9223372036854775807n;
type Stage='input'|'boundary'|'accounts'|'sources'|'reviews'|'equity';
type JournalLine={sequence:number;sourceId:string;sourceVersion:string;sourceSha256:string;kind:OpeningSourceKind|'opening_equity';accountId:string;accountVersion:string;debitCents:string;creditCents:string};
type DeepReadonly<T>=T extends readonly(infer V)[]?readonly DeepReadonly<V>[]:T extends object?{readonly[P in keyof T]:DeepReadonly<T[P]>}:T;
export class OpeningJournalPlanError extends Error{readonly stage:Stage;constructor(stage:Stage){super('OPENING_JOURNAL_PLAN_REVIEW_REQUIRED');this.name='OpeningJournalPlanError';this.stage=stage;}}
function require(value:unknown):asserts value{if(!value)throw Error('REVIEW_REQUIRED');}
function fields(value:unknown,names:readonly string[]):boolean{return exact(value,names);}
function cents(value:unknown,signed=false):bigint{
 require(typeof value==='string'&&(signed?/^(0|-?[1-9][0-9]{0,18})$/:/^(0|[1-9][0-9]{0,18})$/).test(value));
 const amount=BigInt(value);require(amount>=-maximum&&amount<=maximum);return amount;
}
function evidence(value:unknown):asserts value is Evidence{require(exact(value,['reference','sha256'])&&financeAccountReviewReason(value.reference)&&[...value.reference].length<=200&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256));}
function freeze<T>(value:T):DeepReadonly<T>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value as DeepReadonly<T>;}
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical((value as Record<string,unknown>)[key])]));return value;}

export function prepareOpeningJournalPlan(input:OpeningJournalInput){
 let stage:Stage='input';
 try{
  require(fields(input,['businessId','cutoverId','worksheetRevisionId','cutoverOn','cutoverAt','timeZone','equityBasis','equityEvidence','openingEquityAccountId','accounts','reviews','sources']));
  require(customerUuid(input.businessId)&&customerUuid(input.cutoverId)&&customerUuid(input.worksheetRevisionId)&&customerDate(input.cutoverOn)&&customerInstant(input.cutoverAt)&&financeAccountReviewReason(input.equityBasis));evidence(input.equityEvidence);
  stage='boundary';require(typeof input.timeZone==='string'&&(input.timeZone==='UTC'||/^[A-Za-z0-9_+-]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?$/.test(input.timeZone)));
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:input.timeZone,calendar:'iso8601',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}),parts=formatter.formatToParts(new Date(input.cutoverAt)),part=(type:string)=>parts.find(p=>p.type===type)?.value;
  require(part('year')+'-'+part('month')+'-'+part('day')===input.cutoverOn);
  // Registered worksheet revisions currently represent local midnight only.
  // An intraday boundary needs the canonical full roster/sequence source; do
  // not silently reinterpret it as midnight or pretend that source exists.
  require(part('hour')==='00'&&part('minute')==='00'&&part('second')==='00'&&!/[.]\d*[1-9]\d*Z$/.test(input.cutoverAt));
  stage='accounts';require(Array.isArray(input.accounts)&&input.accounts.length>0&&input.accounts.length<=2048);
  const accounts=new Map<string,FinanceAccount>(),codes=new Set<string>();
  for(const account of input.accounts as readonly FinanceAccount[]){
   require(fields(account,['schemaVersion','id','currency','version','name','active','code','accountType','normalSide','controlKind','reportRole'])&&account.schemaVersion===1&&customerUuid(account.id)&&customerVersion(account.version)&&financeAccountReviewReason(account.name)&&[...account.name].length<=200&&typeof account.active==='boolean'&&account.currency==='USD'&&!accounts.has(account.id));
   parseFinanceAccountIdentity({code:account.code,accountType:account.accountType,normalSide:account.normalSide,controlKind:account.controlKind,reportRole:account.reportRole});
   require(!codes.has(account.code)&&(account.accountType==='asset'||account.accountType==='liability'||account.id===input.openingEquityAccountId));codes.add(account.code);accounts.set(account.id,account);
  }
  const equity=accounts.get(input.openingEquityAccountId);require(equity&&equity.active&&equity.code==='3000'&&equity.accountType==='equity'&&equity.normalSide==='credit'&&equity.controlKind===null&&equity.reportRole!=='contra_equity');
  stage='sources';require(Array.isArray(input.sources)&&input.sources.length<=10000);const sourceIds=new Set<string>(),bookBalances=new Set<string>(),netByAccount=new Map<string,bigint>(),lines:JournalLine[]=[];let net=0n;
  for(const source of input.sources as readonly OpeningJournalSource[]){
   require(fields(source,['sourceId','sourceVersion','sourceSha256','kind','accountId','accountVersion','amountCents','evidence'])&&customerUuid(source.sourceId)&&source.sourceId!==input.cutoverId&&!sourceIds.has(source.sourceId)&&customerVersion(source.sourceVersion)&&typeof source.sourceSha256==='string'&&/^[a-f0-9]{64}$/.test(source.sourceSha256)&&Object.hasOwn(sources,source.kind));sourceIds.add(source.sourceId);evidence(source.evidence);
   const account=accounts.get(source.accountId),rule=sources[source.kind as OpeningSourceKind];require(account&&account.active&&source.accountId!==equity.id&&source.accountVersion===account.version&&isDeepStrictEqual([account.accountType,account.normalSide,account.controlKind],rule));
   if(source.kind==='bank'||source.kind==='wallet'){require(!bookBalances.has(account.id));bookBalances.add(account.id);}
   const amount=cents(source.amountCents);require(amount>0n);const debit=rule[1]==='debit',signed=debit?amount:-amount;net+=signed;netByAccount.set(account.id,(netByAccount.get(account.id)??0n)+signed);
   lines.push({sequence:lines.length+1,sourceId:source.sourceId,sourceVersion:source.sourceVersion,sourceSha256:source.sourceSha256,kind:source.kind,accountId:account.id,accountVersion:account.version,debitCents:debit?amount.toString():'0',creditCents:debit?'0':amount.toString()});
  }
  stage='reviews';require(Array.isArray(input.reviews)&&input.reviews.length===accounts.size-1);const reviewed=new Set<string>();
  for(const review of input.reviews as readonly Review[]){
   require(fields(review,['accountId','state','netDebitCents','evidence'])&&accounts.has(review.accountId)&&review.accountId!==equity.id&&!reviewed.has(review.accountId)&&['verified','verified_zero','not_applicable'].includes(review.state));reviewed.add(review.accountId);evidence(review.evidence);
   const amount=cents(review.netDebitCents,true);require(amount===(netByAccount.get(review.accountId)??0n));
   require(review.state==='verified'?amount!==0n:amount===0n&&!netByAccount.has(review.accountId));
  }
  stage='equity';require(net>=-maximum&&net<=maximum);if(net!==0n)lines.push({sequence:lines.length+1,sourceId:input.cutoverId,sourceVersion:'1',sourceSha256:input.equityEvidence.sha256,kind:'opening_equity',accountId:equity.id,accountVersion:equity.version,debitCents:net<0n?(-net).toString():'0',creditCents:net>0n?net.toString():'0'});
  const debit=lines.reduce((sum,line)=>sum+BigInt(line.debitCents),0n),credit=lines.reduce((sum,line)=>sum+BigInt(line.creditCents),0n);require(debit===credit);
  // Copy all evidence/account pins into the plan: later caller mutation cannot
  // change the material reviewed under this hash. Hashes establish bytes only.
  const basis=canonical(input) as OpeningJournalInput;
  const plan={profile:'crest.opening-journal-plan.v1' as const,template:'P27' as const,basis,lines,totalDebitCents:debit.toString(),totalCreditCents:credit.toString(),profitAndLossCents:'0',openingBeforeOrdinary:true as const,zeroEffect:lines.length===0,posted:false as const,postingAuthorized:false as const,sourceClosureVerified:false as const,completeOpening:false as const};
  const bytes=JSON.stringify(canonical(plan));require(Buffer.byteLength(bytes)<=32*1024*1024);return freeze({...plan,planSha256:createHash('sha256').update(bytes).digest('hex')});
 }catch{throw new OpeningJournalPlanError(stage);}
}
