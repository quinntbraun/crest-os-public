import {it,expect} from 'vitest';
import {CustomerDataError} from '../../src/customer/customer-contract.ts';
import {parseLeadDraft,leadEstimate} from '../../src/customer/lead-contract.ts';
import type {LeadDraft} from '../../src/customer/lead-contract.ts';

const minimal=():LeadDraft=>({label:'Synthetic inquiry',customerId:null,sourceId:null,referralText:null,phone:null,email:null,requestedScope:null,availability:null,estimatedCents:null,followUpAt:null,notes:null});
const uuid='11111111-1111-4111-8111-111111111111';

it('accepts label-only intake with every unknown retained as null',()=>{
  const value=minimal();expect(parseLeadDraft(value)).toEqual(value);
  expect(Object.isFrozen(parseLeadDraft(value))).toBe(true);
});
it('preserves original Unicode, whitespace, unvalidated contact and empty optional text',()=>{
  const value={...minimal(),label:'  É 😀  ',phone:' Shared household / not yet confirmed ',email:'Unconfirmed contact',sourceId:uuid,customerId:uuid,referralText:'',requestedScope:'\tInterior\nExterior\r\n',availability:'Ask owner; unknown date',notes:'\\N\n=SUM(A1)'};
  const parsed=parseLeadDraft(value);expect(parsed).toEqual(value);
  value.label='Changed after parsing';expect(parsed.label).toBe('  É 😀  ');
});
it('keeps unknown and explicit zero estimates distinct and never rounds bigint cents',()=>{
  expect(parseLeadDraft(minimal()).estimatedCents).toBeNull();
  for(const amount of ['0','1','9007199254740993','9223372036854775807'])expect(parseLeadDraft({...minimal(),estimatedCents:amount}).estimatedCents).toBe(amount);
});
it.each([0,1,9007199254740992,1n,-1,null,'','00','01','+1','-0','-1','1.00','1e3',' 1','1 ','9223372036854775808','9'.repeat(1000)])('rejects ambiguous or overflowing estimate %s',value=>expect(leadEstimate(value)).toBe(false));
it('retains exact follow-up microseconds without device timezone or Date conversion',()=>{
  for(const date of ['0001-01-01T00:00:00.000001Z','2024-02-29T23:59:59.123456Z','9999-12-31T23:59:59.999999Z'])expect(parseLeadDraft({...minimal(),followUpAt:date}).followUpAt).toBe(date);
});
it.each(['2026-02-29T00:00:00.000000Z','2026-10-25','2026-10-25T00:00:00.123Z','2026-10-25T00:00:00.1234567Z','2026-10-25T00:00:00.123456+00:00','2026-10-25T24:00:00.000000Z','infinity',new Date()])('rejects imprecise or invalid follow-up %s',followUpAt=>expect(()=>parseLeadDraft({...minimal(),followUpAt})).toThrow(CustomerDataError));
it.each([null,[],{},'private', {...minimal(),label:''},{...minimal(),label:' \t '},{...minimal(),label:'a\nb'},{...minimal(),label:'\ud800'},{...minimal(),label:'\u0000'},{...minimal(),phone:''},{...minimal(),email:' \t '},{...minimal(),phone:'a\nb'},{...minimal(),notes:'\u0000'},{...minimal(),notes:'\u0001'},{...minimal(),availability:'\udfff'},{...minimal(),sourceId:''},{...minimal(),customerId:123},{...minimal(),sourceId:uuid.toUpperCase().replace('1111','ABCD')},{...minimal(),state:'won'},{...minimal(),lostReason:'invented'},{...minimal(),estimatedCents:0}])('rejects malformed intake or event fields with a fixed private-safe error',value=>{
  try{parseLeadDraft(value);expect.unreachable('Invalid intake accepted');}catch(error){expect(error).toBeInstanceOf(CustomerDataError);expect((error as Error).message).toBe('CUSTOMER_DATA_INVALID');}
});
it('requires explicit optional keys so omission cannot silently clear a prior value',()=>{
  for(const key of Object.keys(minimal())){const value:Record<string,unknown>={...minimal()};delete value[key];expect(()=>parseLeadDraft(value)).toThrow(CustomerDataError);}
});
it.each([['label',200],['phone',512],['email',512],['referralText',2000],['requestedScope',4000],['availability',4000],['notes',4000]] as const)('bounds %s by Unicode code points without truncation', (key,limit)=>{
  expect(parseLeadDraft({...minimal(),[key]:'😀'.repeat(limit)})[key]).toBe('😀'.repeat(limit));
  expect(()=>parseLeadDraft({...minimal(),[key]:'😀'.repeat(limit+1)})).toThrow(CustomerDataError);
});
