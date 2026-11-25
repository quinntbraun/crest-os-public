import {describe,it,expect} from 'vitest';
import {normalizeOpeningFundsEvidence,verifyOpeningFundsEvidence} from '../../src/bookkeeping/opening-funds-evidence.ts';
import type {OpeningFundsInput} from '../../src/bookkeeping/opening-funds-evidence.ts';
const id=(n:number)=>'00000000-0000-4000-8000-'+n.toString().padStart(12,'0');
const evidence={reference:'Fictional retained original',sha256:'a'.repeat(64)};
const fixture=()=>({schemaVersion:1 as const,reason:'Retain pre-cutover customer obligations',roots:[{rootId:id(1),sourceNamespace:'legacy.receipts',externalId:'receipt-001',receivedOn:'2026-05-01',receivedCents:'15000',receiptEvidence:{...evidence},reductions:[{kind:'application' as const,reference:'job-001',occurredOn:'2026-05-20',amountCents:'5000',evidence:{...evidence}}],items:[{itemId:id(2),customerId:id(3),heldCents:'10000',obligationEvidence:{...evidence},refundableCeilingCents:null as string|null,refundEvidence:null as typeof evidence|null}]}]});
const normalize=(input:OpeningFundsInput)=>normalizeOpeningFundsEvidence(input,'2026-06-01');
describe('retained opening customer-funds evidence',()=>{
 it('carries remaining obligations without inventing another receipt or refund authority',()=>{
  const result=normalize(fixture());expect(result.totals.heldCents).toBe('10000');expect(result.roots[0]!.openingRootCents).toBe('10000');expect(result.roots[0]!.receivedCents).toBe('15000');expect(result.totals.refundableCeilingCents).toBeNull();expect(result.roots[0]!.items[0]!.refundCeilingState).toBe('needs_review');expect(result.posted).toBe(false);expect(result.refundAuthorized).toBe(false);expect(result.fullSourceClosureVerified).toBe(false);expect(verifyOpeningFundsEvidence(result)).toEqual(result);
 });
 it('retains one money origin split across multiple customer obligations',()=>{
  const input=fixture(),root=input.roots[0]!;root.items[0]!.heldCents='6000';root.items.push({...structuredClone(root.items[0]!),itemId:id(4),customerId:id(5),heldCents:'4000'});expect(normalize(input).totals).toMatchObject({heldCents:'10000',rootCount:1,itemCount:2});
 });
 it('distinguishes evidenced zero refundability from unknown refundability',()=>{
  const input=fixture();input.roots[0]!.items[0]!.refundableCeilingCents='0';input.roots[0]!.items[0]!.refundEvidence={...evidence};expect(normalize(input).totals).toMatchObject({refundableCeilingCents:'0',allItemRefundCeilingsKnown:true});
 });
 it('calculates exact values above the JavaScript safe integer limit',()=>{
  const input=fixture(),root=input.roots[0]!;root.receivedCents='9223372036854775807';root.reductions=[];root.items[0]!.heldCents=root.receivedCents;expect(normalize(input).totals.heldCents).toBe(root.receivedCents);
 });
 const invalid:Record<string,(input:ReturnType<typeof fixture>)=>void>={
  'overallocated origin':x=>{x.roots[0]!.items[0]!.heldCents='10001';},
  'underallocated origin':x=>{x.roots[0]!.items[0]!.heldCents='9999';},
  'negative amount':x=>{x.roots[0]!.receivedCents='-15000';},
  'leading zeros':x=>{x.roots[0]!.receivedCents='015000';},
  'bigint overflow':x=>{x.roots[0]!.receivedCents='9223372036854775808';},
  'boundary day receipt':x=>{x.roots[0]!.receivedOn='2026-06-01';},
  'boundary day reduction':x=>{x.roots[0]!.reductions[0]!.occurredOn='2026-06-01';},
  'reduction preceding receipt':x=>{x.roots[0]!.reductions[0]!.occurredOn='2026-04-30';},
  'invalid calendar date':x=>{x.roots[0]!.receivedOn='2026-02-30';},
  'duplicate root':x=>{x.roots.push(structuredClone(x.roots[0]!));},
  'duplicate external origin':x=>{const root=structuredClone(x.roots[0]!);root.rootId=id(9);root.items[0]!.itemId=id(8);x.roots.push(root);},
  'duplicate item across origins':x=>{const root=structuredClone(x.roots[0]!);root.rootId=id(9);root.externalId='receipt-002';x.roots.push(root);},
  'duplicate reduction reference':x=>{x.roots[0]!.reductions.push(structuredClone(x.roots[0]!.reductions[0]!));},
  'refund above held amount':x=>{x.roots[0]!.items[0]!.refundableCeilingCents='10001';x.roots[0]!.items[0]!.refundEvidence={...evidence};},
  'refund ceiling without evidence':x=>{x.roots[0]!.items[0]!.refundableCeilingCents='100';},
  'unknown ceiling with claimed evidence':x=>{x.roots[0]!.items[0]!.refundEvidence={...evidence};},
  'unretained receipt':x=>{x.roots[0]!.receiptEvidence.sha256='';},
 };
 for(const [name,change] of Object.entries(invalid))it('refuses '+name,()=>{const input=fixture();change(input);expect(()=>normalize(input)).toThrow('OPENING_FUNDS_EVIDENCE_REQUIRED');});
 it('does not turn an empty schedule into proof of a complete opening',()=>{
  const result=normalize({schemaVersion:1,roots:[],reason:'No sources entered yet'});expect(result.totals.heldCents).toBe('0');expect(result.fullSourceClosureVerified).toBe(false);expect(result.posted).toBe(false);
 });
 it('copies and freezes original evidence and detects altered derived amounts',()=>{
  const input=fixture(),result=normalize(input);input.roots[0]!.receiptEvidence.reference='Changed caller input';expect(result.roots[0]!.receiptEvidence.reference).toBe(evidence.reference);expect(Object.isFrozen(result.roots[0]!.items[0])).toBe(true);const changed=structuredClone(result);changed.totals.heldCents='9999';expect(()=>verifyOpeningFundsEvidence(changed)).toThrow();
 });
 it('rejects unknown fields rather than dropping source information',()=>{expect(()=>normalize({...fixture(),hiddenReceipt:'unreviewed'} as OpeningFundsInput)).toThrow();});
});
