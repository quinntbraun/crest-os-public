import {describe,expect,it} from 'vitest';
import {rolldown} from 'rolldown';
import {normalizeOpeningFundsEvidence} from '../../src/bookkeeping/opening-funds-contract.ts';
import {verifyOpeningFundsEvidence} from '../../src/bookkeeping/opening-funds-evidence.ts';
import {openingFundsDraftFromEvidence,parseOpeningFundsEvidence,parseOpeningFundsOperation,parseOpeningFundsSave,parseOpeningFundsStored} from '../../src/bookkeeping/opening-funds-schedule-contract.ts';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const document={reference:'Retained fictional source',sha256:'a'.repeat(64)};
const input=()=>({schemaVersion:1 as const,reason:'Review historical customer obligations',roots:[{rootId:id(1),sourceNamespace:'legacy.receipts',externalId:'receipt-001',receivedOn:'2026-05-01',receivedCents:'15000',receiptEvidence:{...document},reductions:[{kind:'application' as const,reference:'job-001',occurredOn:'2026-05-20',amountCents:'5000',evidence:{...document}}],items:[{itemId:id(2),customerId:id(3),heldCents:'10000',obligationEvidence:{...document},refundableCeilingCents:null as string|null,refundEvidence:null as typeof document|null}]}]});
const evidence=()=>normalizeOpeningFundsEvidence(input(),'2026-06-01');
const receipt=()=>({schemaVersion:1,businessId:id(10),scheduleRevisionId:id(11),worksheetRevisionId:id(12),revision:'9007199254740993',operationId:id(13),auditEventId:id(14),recordedBy:id(15),recordedAt:'2026-06-02T12:30:00.123456Z',evidenceSha256:'b'.repeat(64),evidence:evidence()});
const stored=()=>({schemaVersion:1,businessId:id(10),worksheetRevisionId:id(12),schedule:receipt()});
describe('opening-funds private-screen contract',()=>{
 it('reopens saved evidence as editable raw inputs without losing identity or inventing source fields',()=>{
  const original=evidence(),draft=openingFundsDraftFromEvidence(original);
  expect(draft).toEqual(input());expect(normalizeOpeningFundsEvidence(draft,'2026-06-01')).toEqual(original);
  expect(Object.hasOwn(draft.roots[0]!,'openingRootCents')).toBe(false);
  expect(Object.hasOwn(draft.roots[0]!.items[0]!,'refundCeilingState')).toBe(false);
 });
 it('bundles the actual input and receipt validators for a browser without Node shims',async()=>{
  const bundle=await rolldown({input:'src/bookkeeping/opening-funds-schedule-contract.ts',platform:'browser',onwarn(warning){throw Error(warning.message);}});
  try{const result=await bundle.generate({format:'esm'});expect(result.output[0]!.type).toBe('chunk');}
  finally{await bundle.close();}
 });
 it('retains exact historical balances and gives the server verifier identical evidence',()=>{
  const parsed=parseOpeningFundsStored(stored(),id(10));
  expect(parsed.schedule!.revision).toBe('9007199254740993');
  expect(verifyOpeningFundsEvidence(parsed.schedule!.evidence)).toEqual(evidence());
  expect(parsed.schedule!.evidence).toMatchObject({posted:false,refundAuthorized:false,fullSourceClosureVerified:false,totals:{heldCents:'10000',refundableCeilingCents:null}});
 });
 it('accepts reordered PostgreSQL JSON keys without relying on serialized key order',()=>{
  const value=evidence();const reordered=Object.fromEntries(Object.entries(value).reverse());
  expect(parseOpeningFundsEvidence(reordered)).toEqual(value);
 });
 it('distinguishes an unsaved schedule and a recorded empty schedule',()=>{
  expect(parseOpeningFundsStored({...stored(),schedule:null},id(10)).schedule).toBeNull();
  const empty=normalizeOpeningFundsEvidence({schemaVersion:1,roots:[],reason:'No deposits entered'},'2026-06-01');
  expect(parseOpeningFundsStored({...stored(),schedule:{...receipt(),evidence:empty}},id(10)).schedule!.evidence.totals.heldCents).toBe('0');
 });
 it('keeps evidenced zero refundability distinct from missing evidence',()=>{
  const raw=input();raw.roots[0]!.items[0]!.refundableCeilingCents='0';raw.roots[0]!.items[0]!.refundEvidence={...document};
  const parsed=parseOpeningFundsEvidence(normalizeOpeningFundsEvidence(raw,'2026-06-01'));
  expect(parsed.totals.refundableCeilingCents).toBe('0');expect(parsed.roots[0]!.items[0]!.refundCeilingState).toBe('evidenced');
 });
 it('validates the save against its cutover and copies the raw input without derived fields',()=>{
  const value={worksheetRevision:'2',expectedRevision:'0',input:input()},parsed=parseOpeningFundsSave(value,'2026-06-01');
  value.input.roots[0]!.receivedCents='5';expect(parsed.input.roots[0]!.receivedCents).toBe('15000');
  expect(()=>parseOpeningFundsSave(parsed,'2026-05-01')).toThrow();
  expect(()=>parseOpeningFundsSave({...parsed,expectedRevision:'9223372036854775807'},'2026-06-01')).toThrow();
 });
 const invalid:Record<string,(value:ReturnType<typeof stored>)=>void>={
  'foreign business':x=>{x.schedule.businessId=id(99);},
  'foreign worksheet':x=>{x.schedule.worksheetRevisionId=id(99);},
  'invalid timestamp':x=>{x.schedule.recordedAt='2026-02-30T12:30:00.123456Z';},
  'numeric revision':x=>{Object.assign(x.schedule,{revision:Number('9007199254740993')});},
  'forged posted state':x=>{Object.assign(x.schedule.evidence,{posted:true});},
  'forged refund authority':x=>{Object.assign(x.schedule.evidence,{refundAuthorized:true});},
  'forged complete sources':x=>{Object.assign(x.schedule.evidence,{fullSourceClosureVerified:true});},
  'altered totals':x=>{x.schedule.evidence.totals.heldCents='9999';},
  'altered root':x=>{x.schedule.evidence.roots[0]!.openingRootCents='9999';},
  'invented refund ceiling':x=>{x.schedule.evidence.roots[0]!.refundableCeilingCents='0';},
  'invented refund review':x=>{x.schedule.evidence.roots[0]!.items[0]!.refundCeilingState='evidenced';},
  'unknown source field':x=>{Object.assign(x.schedule.evidence.roots[0]!,{newReceipt:true});},
  'unknown receipt field':x=>{Object.assign(x.schedule,{posted:true});},
 };
 for(const [label,mutate]of Object.entries(invalid))it('refuses '+label,()=>{const value=structuredClone(stored());mutate(value);expect(()=>parseOpeningFundsStored(value,id(10))).toThrow();});
 it('binds committed interrupted saves to the original operation',()=>{
  const result={state:'committed',receipt:receipt()};
  expect(parseOpeningFundsOperation(result,id(10),id(13)).state).toBe('committed');
  expect(()=>parseOpeningFundsOperation(result,id(10),id(99))).toThrow();
  for(const state of ['absent','review_required','retired'])expect(parseOpeningFundsOperation({state},id(10),id(13)).state).toBe(state);
  expect(parseOpeningFundsOperation({state:'conflict',reason:'operation'},id(10),id(13)).state).toBe('conflict');
  expect(()=>parseOpeningFundsOperation({state:'absent',receipt:receipt()},id(10),id(13))).toThrow();
 });
});
