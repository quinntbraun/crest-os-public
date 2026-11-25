import {isDeepStrictEqual} from 'node:util';
import {customerDate,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {prepareOpeningPayablesAllocations,OpeningPayablesAllocationError} from './opening-payables-allocation.ts';
import {openingPayablesDraftFromEvidence} from './opening-payables-schedule-contract.ts';

export function verifyPreparedOpeningAllocationsEvidence(value:unknown,parent:unknown){
 try{
  if(!exact(value,['schemaVersion','cutoverOn','currency','reason','roots','rootCount','reductionCount','remainingPayablesCents','selectedAllocationCapacityChecked','externalEvidenceVerified','historicalAllocationClosureVerified','fullSourceClosureVerified','posted','paymentAuthorized','newExpenseCents','newPaymentCents'])||value.schemaVersion!==1||!customerDate(value.cutoverOn)||!Array.isArray(value.roots))throw Error();
  const roots=value.roots.map((root:unknown)=>{
   if(!exact(root,['rootId','sourceNamespace','externalId','vendor','kind','reference','appliedOn','originalCents','evidence','otherAllocatedCents','otherAllocationEvidence','allocations','selectedAllocationCents','unallocatedCents']))throw Error();
   const {allocations:_allocations,selectedAllocationCents:_selected,unallocatedCents:_unused,...raw}=root;void _allocations;void _selected;void _unused;return raw;
  });
  const draft=openingPayablesDraftFromEvidence(parent);
  if(!parent||typeof parent!=='object'||!('cutoverOn'in parent)||parent.cutoverOn!==value.cutoverOn)throw Error();
  const expected=prepareOpeningPayablesAllocations(draft,value.cutoverOn,{schemaVersion:1,roots,reason:value.reason});
  if(!isDeepStrictEqual(expected,value))throw Error();return expected;
 }catch{throw new OpeningPayablesAllocationError();}
}
