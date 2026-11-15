import {describe,expect,it} from 'vitest';
import {parseOpeningArInput,previewOpeningReceivables,verifyOpeningArPreview} from '../../src/bookkeeping/opening-receivables-preview';
import type {OpeningArInput,OpeningArLine} from '../../src/bookkeeping/opening-receivables-preview';

const item:OpeningArLine={
 customerId:'10000000-0000-4000-8000-000000000001',legacyReference:'PRE-CREST-1',scope:'Fictional interior service',
 chargedOn:'2026-05-18',originalDueOn:'2026-06-10',originalCents:'15000',remainingCents:'12550',
 chargeEvidence:{reference:'Fictional original charge',sha256:'1'.repeat(64)},taxEvidence:null,
 reductions:[{kind:'payment',appliedOn:'2026-05-31',amountCents:'2450',evidence:{reference:'Fictional payment',sha256:'2'.repeat(64)}}],
};
const review=(...lines:OpeningArLine[])=>parseOpeningArInput({revision:'1',lines});
const cutover='2026-06-01';

describe('opening receivable evidence preview',()=>{
 it('retains the original due date and evidence, treats tax as unknown, and calculates exact remaining AR',()=>{
  const input=review(item),result=previewOpeningReceivables(input,cutover);
  expect(result).toMatchObject({cutoverOn:cutover,posted:false,state:'evidence_preview',totals:{remainingCents:'12550'},
   lines:[{...item,taxReview:'unknown'}]});
  expect(verifyOpeningArPreview(result,input)).toEqual(result);
  expect(()=>verifyOpeningArPreview({...result,totals:{remainingCents:'12549'}},input)).toThrow();
 });
 it('requires unapplied historical balance to reconcile and rejects repeated source identities',()=>{
  expect(()=>review({...item,remainingCents:'12551'})).toThrow();
  expect(()=>review({...item,remainingCents:'0'})).toThrow();
  expect(()=>review(item,{...item,customerId:'10000000-0000-4000-8000-000000000002'})).toThrow();
  const adjustment=item.reductions[0]!;
  expect(()=>review({...item,remainingCents:'10100',reductions:[adjustment,adjustment]})).toThrow();
 });
 it('rejects applied dates before the charge or at or after the proposed cutover',()=>{
  const adjustment=item.reductions[0]!;
  expect(()=>review({...item,reductions:[{...adjustment,appliedOn:'2026-05-17'}]})).toThrow();
  expect(()=>previewOpeningReceivables(review({...item,reductions:[{...adjustment,appliedOn:cutover}]}),cutover)).toThrow();
  expect(()=>previewOpeningReceivables(review({...item,chargedOn:cutover,reductions:[],originalCents:item.remainingCents}),cutover)).toThrow();
 });
 it('uses exact integer cents beyond safe JavaScript floating point values',()=>{
  const line={...item,originalCents:'9007199254740993',remainingCents:'9007199254738543'};
  const preview=previewOpeningReceivables(review(line,{...line,legacyReference:'PRE-CREST-2'}),cutover);
  expect(preview.totals.remainingCents).toBe('18014398509477086');
 });
 it('requires bounded exact request fields and source hashes',()=>{
  const input:OpeningArInput={revision:'1',lines:[item]};
  expect(()=>parseOpeningArInput({...input,approval:true})).toThrow();
  expect(()=>review({...item,chargeEvidence:{...item.chargeEvidence,sha256:'invalid'}})).toThrow();
  expect(()=>parseOpeningArInput({...input,lines:[]})).toThrow();
 });
});
