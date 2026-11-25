import {it,expect} from 'vitest';
import {normalizeOpeningBalanceDetails,openingBalanceDetailKinds} from '../../src/bookkeeping/opening-balance-details-contract';
import type {OpeningBalanceDetailsInput,OpeningBalanceDetailItem,OpeningBalanceDetailKind} from '../../src/bookkeeping/opening-balance-details-contract';
import {openingSourceAccountRules} from '../../src/bookkeeping/opening-source-account-rules';
import type {FinanceAccount} from '../../src/bookkeeping/finance-account-contract';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const evidence={reference:'Fictional retained source',sha256:'a'.repeat(64)};
const boundary={cutoverOn:'2026-01-01',cutoverAt:'2026-01-01T06:00:00.000000Z'};
function fixture(){
 const details={
  wallet:{channelId:id(501),channelVersion:'1',scope:'dedicated_business'},
  cash:{location:'Business cash box',countedAt:'2026-01-01T05:59:59.999999Z'},
  checks:{payer:'Fictional payer',checkReference:'Retained check A',receivedAt:'2025-12-31T16:00:00.000000Z',datedOn:'2025-12-31'},
  transfer_transit:{originAccountId:id(502),destinationAccountId:id(503),departedAt:'2025-12-31T16:00:00.000000Z',transferReference:'Transfer A',originalCents:'1000',creditedBeforeCutoverCents:'200',returnedBeforeCutoverCents:'100',feesBeforeCutover:[]},
  owner_custody:{ownerId:id(504),channelId:id(505),channelVersion:'1',scope:'business_only',basisEvidence:evidence},
  tax_liability:{profileId:id(506),profileVersion:'1',jurisdiction:'Fictional jurisdiction',periodFrom:'2025-12-01',periodThrough:'2025-12-31',classificationEvidence:evidence},
  debt:{lender:'Fictional business lender',agreementReference:'Agreement A',principalEvidence:evidence},
  due_owner:{ownerId:id(504),obligationReference:'Documented reimbursement A',basisEvidence:evidence},
  equipment_cost:{assetId:id(507),description:'Fictional equipment',acquiredOn:'2025-01-01',historicalCostEvidence:evidence,classificationEvidence:evidence},
  accumulated_depreciation:{assetId:id(507),costItemId:id(9),calculationEvidence:evidence},
  prepaid:{purpose:'Remaining prepaid benefit',paidOn:'2025-12-01',benefitFrom:'2025-12-01',benefitThrough:'2026-12-01',originalCents:'500',remainingBasisEvidence:evidence},
  other_asset:{description:'Supported noncontrol asset',basisEvidence:evidence},
  other_liability:{description:'Supported noncontrol liability',basisEvidence:evidence},
 };
 const accounts:FinanceAccount[]=openingBalanceDetailKinds.map((kind,i)=>{const [accountType,normalSide,controlKind]=openingSourceAccountRules[kind];return{schemaVersion:1,id:id(100+i),currency:'USD',version:'1',name:kind,active:true,code:String(1000+i),accountType,normalSide,controlKind,reportRole:kind==='accumulated_depreciation'?'contra_asset':kind==='owner_custody'?'owner_custody':'balance_sheet'};});
 const input:OpeningBalanceDetailsInput={schemaVersion:1,reason:'Fictional opening evidence only',reviews:openingBalanceDetailKinds.map(kind=>({kind,state:'source_recorded',evidence,note:'Retained source, not posting approval'})),items:openingBalanceDetailKinds.map((kind,i)=>({itemId:id(i+1),kind,sourceNamespace:kind==='accumulated_depreciation'?'fixture.equipment_cost':'fixture.'+kind,externalId:kind==='accumulated_depreciation'?'equipment_cost':'equipment_cost'===kind?'equipment_cost':kind,accountId:accounts[i]!.id,accountVersion:'1',amountCents:kind==='transfer_transit'?'700':kind==='equipment_cost'?'30000':kind==='accumulated_depreciation'?'10000':'100',evidence,detail:details[kind]})) as OpeningBalanceDetailItem[]};
 return {input:structuredClone(input),accounts:structuredClone(accounts)};
}
const normalize=(f:ReturnType<typeof fixture>)=>normalizeOpeningBalanceDetails(f.input,boundary,f.accounts);
function change(f:ReturnType<typeof fixture>,kind:OpeningBalanceDetailKind,patch:Record<string,unknown>){const index=f.input.items.findIndex(item=>item.kind===kind);Object.assign(f.input.items[index]!,patch);}
it('retains all thirteen additional source classes with exact separate totals and no opening authority',()=>{
 const f=fixture(),result=normalize(f);
 expect(result.items.map(item=>item.kind)).toEqual(openingBalanceDetailKinds);
 expect(result.totals.equipment_cost).toEqual({amountCents:'30000',itemCount:1});
 expect(result.totals.accumulated_depreciation).toEqual({amountCents:'10000',itemCount:1});
 expect(result.totals.transfer_transit.amountCents).toBe('700');
 expect(result.unresolvedKinds).toEqual([]);expect(result.warnings).toEqual([]);
 expect(result.completeOpening).toBe(false);expect(result.fullSourceClosureVerified).toBe(false);expect(result.posted).toBe(false);expect(result.postingAuthorized).toBe(false);
 expect(Object.isFrozen(result.items[0]!.detail)).toBe(true);
 change(f,'cash',{amountCents:'999'});expect(result.totals.cash.amountCents).toBe('100');
});
it.each(openingBalanceDetailKinds)('requires the pinned active USD account identity and version for %s',kind=>{
 for(const patch of [{active:false},{version:'2'},{currency:'EUR'},{controlKind:'unexpected'}]){
  const f=fixture(),index=openingBalanceDetailKinds.indexOf(kind);Object.assign(f.accounts[index]!,patch);
  expect(()=>normalize(f)).toThrow('OPENING_BALANCE_DETAILS_REVIEW_REQUIRED');
 }
});
it('keeps unknown and explicitly evidenced zero classes distinct from an omitted review',()=>{
 const f=fixture(),empty={...f.input,items:[],reviews:f.input.reviews.map(review=>({...review,state:'unknown' as const,evidence:null}))};
 const result=normalizeOpeningBalanceDetails(empty,boundary,f.accounts);expect(result.unresolvedKinds).toEqual(openingBalanceDetailKinds);
 const zeros={...empty,reviews:empty.reviews.map(review=>({...review,state:'verified_zero' as const,evidence}))};
 expect(normalizeOpeningBalanceDetails(zeros,boundary,f.accounts).completeOpening).toBe(false);
 expect(()=>normalizeOpeningBalanceDetails({...empty,reviews:empty.reviews.slice(1)},boundary,f.accounts)).toThrow();
 const contradictory={...f.input,reviews:f.input.reviews.map(review=>({...review,state:'verified_zero' as const}))};
 expect(()=>normalizeOpeningBalanceDetails(contradictory,boundary,f.accounts)).toThrow();
});
it('allows evidenced signed dedicated-wallet balances but forbids negative cash, custody or obligations',()=>{
 const f=fixture();change(f,'wallet',{amountCents:'-9007199254740993'});
 const result=normalize(f);expect(result.totals.wallet.amountCents).toBe('-9007199254740993');expect(result.warnings).toContainEqual({itemId:id(1),code:'negative_wallet'});
 for(const kind of openingBalanceDetailKinds.filter(kind=>kind!=='wallet')){const f=fixture();change(f,kind,{amountCents:'-1'});expect(()=>normalize(f)).toThrow();}
});
it('ties depreciation to one retained cost item without netting away cost or allowing excess depreciation',()=>{
 for(const patch of [{amountCents:'30001'},{detail:{assetId:id(507),costItemId:id(999),calculationEvidence:evidence}},{externalId:'unrelated asset'}]){
  const f=fixture();change(f,'accumulated_depreciation',patch);expect(()=>normalize(f)).toThrow();
 }
 const f=fixture();change(f,'accumulated_depreciation',{amountCents:'30000'});expect(normalize(f).totals.equipment_cost.amountCents).toBe('30000');
});
it('reconciles remaining transit to principal already arrived or returned before the boundary',()=>{
 const f=fixture();change(f,'transfer_transit',{amountCents:'701'});expect(()=>normalize(f)).toThrow();
 const source=fixture().input.items.find(item=>item.kind==='transfer_transit')!;
 const same=fixture();change(same,'transfer_transit',{detail:{...source.detail,destinationAccountId:id(502)}});expect(()=>normalize(same)).toThrow();
});
it('refuses duplicate identities, unknown fields, forged authority and invalid amount representations',()=>{
 for(const patch of [{posted:true},{amountCents:'0'},{amountCents:'-0'},{amountCents:'01'},{amountCents:'1.5'},{amountCents:'9223372036854775808'},{itemId:id(1)}]){
  const f=fixture();change(f,'cash',patch);expect(()=>normalize(f)).toThrow();
 }
 const f=fixture(),first=f.input.items[0]!;change(f,'cash',{sourceNamespace:first.sourceNamespace,externalId:first.externalId});expect(()=>normalize(f)).toThrow();
 expect(()=>normalizeOpeningBalanceDetails({...f.input,approved:true},boundary,f.accounts)).toThrow();
});
it('preserves review warnings without claiming tax, capitalization or expired-prepaid policy was approved',()=>{
 const f=fixture(),tax=f.input.items.find(item=>item.kind==='tax_liability')!,asset=f.input.items.find(item=>item.kind==='equipment_cost')!,prepaid=f.input.items.find(item=>item.kind==='prepaid')!;
 change(f,'tax_liability',{detail:{...tax.detail,profileId:null,profileVersion:null,classificationEvidence:null}});
 change(f,'equipment_cost',{detail:{...asset.detail,classificationEvidence:null}});
 change(f,'prepaid',{detail:{...prepaid.detail,benefitThrough:'2025-12-31'}});
 expect(normalize(f).warnings.map(warning=>warning.code)).toEqual(['tax_classification_unresolved','asset_classification_unresolved','expired_prepaid']);
 expect(normalize(f).postingAuthorized).toBe(false);
});
it('compares complete microsecond instants and does not include a check or transfer arriving after the boundary',()=>{
 for(const kind of ['cash','checks','transfer_transit'] as const){
  const f=fixture(),item=f.input.items.find(item=>item.kind===kind)!;
  const field=kind==='cash'?'countedAt':kind==='checks'?'receivedAt':'departedAt';
  change(f,kind,{detail:{...item.detail,[field]:'2026-01-01T06:00:00.000001Z'}});expect(()=>normalize(f)).toThrow();
 }
});
it('retains actual historical transit fees and never invents a fee from a difference',()=>{
 const fee={reference:'Confirmed fee A',occurredAt:'2025-12-31T17:00:00.000000Z',amountCents:'30',evidence};
 const f=fixture(),source=f.input.items.find(item=>item.kind==='transfer_transit')!;
 change(f,'transfer_transit',{amountCents:'670',detail:{...source.detail,feesBeforeCutover:[fee]}});
 expect(normalize(f).totals.transfer_transit.amountCents).toBe('670');
 for(const fees of [[],[fee,fee],[{...fee,occurredAt:'2026-01-01T06:00:00.000001Z'}]]){
  const f=fixture();change(f,'transfer_transit',{amountCents:'670',detail:{...source.detail,feesBeforeCutover:fees}});expect(()=>normalize(f)).toThrow();
 }
});
it('refuses the same wallet channel assigned to two different account openings',()=>{
 const f=fixture(),wallet=f.input.items[0]!;
 const account={...f.accounts[0]!,id:id(801),code:'1098'};f.accounts.push(account);
 const input={...f.input,items:[...f.input.items,{...wallet,itemId:id(901),externalId:'second',accountId:account.id} as OpeningBalanceDetailItem]};
 expect(()=>normalizeOpeningBalanceDetails(input,boundary,f.accounts)).toThrow();
});
it('does not mutate account-rule pins or change results with offsetting wallet source order',()=>{
 expect(Object.isFrozen(openingSourceAccountRules)).toBe(true);expect(Object.isFrozen(openingSourceAccountRules.wallet)).toBe(true);
 const f=fixture(),wallet=f.input.items[0]!;
 const wallets=['9223372036854775807','9223372036854775807','-9223372036854775807'].map((amount,i)=>{
  const account={...f.accounts[0]!,id:id(800+i),code:String(1097+i)};f.accounts.push(account);
  return {...wallet,itemId:id(900+i),externalId:'wallet-'+i,accountId:account.id,amountCents:amount,detail:{channelId:id(700+i),channelVersion:'1',scope:'dedicated_business'}} as OpeningBalanceDetailItem;
 });
 const input={...f.input,items:[...f.input.items.slice(1),...wallets]};
 const expected=normalizeOpeningBalanceDetails(input,boundary,f.accounts).totals.wallet;
 expect(expected).toEqual({amountCents:'9223372036854775807',itemCount:3});
 expect(normalizeOpeningBalanceDetails({...input,items:[...input.items].reverse()},boundary,f.accounts).totals.wallet).toEqual(expected);
});
