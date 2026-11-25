import {it,expect} from 'vitest';
import {prepareOpeningPayablesAllocations as prepare} from '../../src/bookkeeping/opening-payables-allocation';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const document=()=>({reference:'Original bank payment',sha256:'a'.repeat(64)});
function fixture(){
 const bill=(n:number)=>({billId:id(n),sourceNamespace:'legacy.bills',externalId:'BILL-'+n,vendor:'Synthetic supplier',purpose:'Historical supplies',incurredOn:'2026-04-01',originalDueOn:'2026-04-30',unknownDueReason:null,originalCents:'15000',remainingCents:'10000',billEvidence:document(),reductions:[{kind:'payment' as const,reference:'PAY-001',appliedOn:'2026-04-20',amountCents:'5000',evidence:document()}],taxEvidence:null});
 return {schedule:{schemaVersion:1 as const,bills:[bill(1),bill(2)],reason:'Review unpaid bills'},input:{schemaVersion:1 as const,reason:'Review original payment capacity',roots:[{rootId:id(3),sourceNamespace:'legacy.bank',externalId:'TRANSFER-001',vendor:'Synthetic supplier',kind:'payment' as const,reference:'PAY-001',appliedOn:'2026-04-20',originalCents:'10000',evidence:document(),otherAllocatedCents:'0',otherAllocationEvidence:null as ReturnType<typeof document>|null}]}};
}
const run=(x:ReturnType<typeof fixture>)=>prepare(x.schedule,'2026-06-01',x.input);
it('combines allocations across bills without inventing a new payment or closure',()=>{const x=fixture(),result=run(x);expect(result.roots[0]).toMatchObject({selectedAllocationCents:'10000',unallocatedCents:'0',allocations:[{billId:id(1),amountCents:'5000'},{billId:id(2),amountCents:'5000'}]});expect(result).toMatchObject({remainingPayablesCents:'20000',selectedAllocationCapacityChecked:true,externalEvidenceVerified:false,historicalAllocationClosureVerified:false,fullSourceClosureVerified:false,posted:false,paymentAuthorized:false,newPaymentCents:'0',newExpenseCents:'0'});x.input.roots[0]!.vendor='Changed';expect(result.roots[0]!.vendor).toBe('Synthetic supplier');expect(Object.isFrozen(result.roots[0]!.allocations[0])).toBe(true);});
it('retains documented other allocations and unused capacity explicitly',()=>{const x=fixture();x.input.roots[0]!.originalCents='15000';x.input.roots[0]!.otherAllocatedCents='2000';x.input.roots[0]!.otherAllocationEvidence=document();expect(run(x).roots[0]).toMatchObject({otherAllocatedCents:'2000',unallocatedCents:'3000'});});
it('preserves exact amounts above floating point range',()=>{const x=fixture();x.schedule.bills=[x.schedule.bills[0]!];x.schedule.bills[0]!.originalCents='9007199254740994';x.schedule.bills[0]!.remainingCents='1';x.schedule.bills[0]!.reductions[0]!.amountCents='9007199254740993';x.input.roots[0]!.originalCents='9007199254740993';expect(run(x).roots[0]!.selectedAllocationCents).toBe('9007199254740993');});
const failures:Record<string,(x:ReturnType<typeof fixture>)=>void>={
 'cross-bill over-allocation':x=>{x.input.roots[0]!.originalCents='9999';},
 'other allocations exceeding capacity':x=>{x.input.roots[0]!.otherAllocatedCents='1';x.input.roots[0]!.otherAllocationEvidence=document();},
 'missing original root':x=>{x.input.roots=[];},
 'changed supplier':x=>{x.input.roots[0]!.vendor='Other supplier';},
 'changed evidence':x=>{x.input.roots[0]!.evidence.sha256='b'.repeat(64);},
 'changed date':x=>{x.input.roots[0]!.appliedOn='2026-04-21';},
 'missing other allocation evidence':x=>{x.input.roots[0]!.otherAllocatedCents='1';},
 'root alias':x=>{x.input.roots.push({...structuredClone(x.input.roots[0]!),rootId:id(4),externalId:'ALIAS'});},
 'duplicate external identity':x=>{x.input.roots.push({...structuredClone(x.input.roots[0]!),rootId:id(4),reference:'OTHER'});},
 'numeric amount':x=>{Object.assign(x.input.roots[0]!,{originalCents:10000});},
 'cutover-day root':x=>{x.input.roots[0]!.appliedOn='2026-06-01';},
 'unrelated root':x=>{x.input.roots.push({...structuredClone(x.input.roots[0]!),rootId:id(4),reference:'UNRELATED',externalId:'UNRELATED'});},
};
it.each(Object.keys(failures))('refuses %s',name=>{const x=fixture();failures[name]!(x);expect(()=>run(x)).toThrow('OPENING_PAYABLES_ALLOCATION_REVIEW_REQUIRED');});
