import {expect,it} from 'vitest';
import {CustomerDataError} from '../../src/customer/customer-contract.ts';
import {leadStates,parseLeadDraft} from '../../src/customer/lead-contract.ts';
import {manualLeadTargets,parseLeadStateDraft,parseLeadEvent,leadEventColumns} from '../../src/customer/lead-state-contract.ts';

// Test the whole canonical graph, including commercially derived states as
// sources. An old quote send/acceptance never authorizes a manual target.
for(const fromState of leadStates)for(const toState of leadStates){
  it(`BR02 manual transition ${fromState} -> ${toState}`,()=>{
    const valid=fromState!==toState&&toState!=='won'&&toState!=='quote_sent'
      &&!(fromState==='won'&&toState==='lost');
    const draft={fromState,toState,reason:'Synthetic explicit owner reason'};
    if(valid)expect(parseLeadStateDraft(draft)).toEqual(draft);
    else expect(()=>parseLeadStateDraft(draft)).toThrow(CustomerDataError);
  });
}
it('requires explicit reason for every Lost and terminal reopen, retaining original Unicode/whitespace',()=>{
  for(const fromState of leadStates)for(const toState of manualLeadTargets){
    if(fromState===toState||fromState==='won'&&toState==='lost')continue;
    const draft={fromState,toState,reason:null};
    if(fromState==='won'||fromState==='lost'||toState==='lost'){
      expect(()=>parseLeadStateDraft(draft)).toThrow(CustomerDataError);
      for(const reason of ['', ' ', '\t\n\r'])expect(()=>parseLeadStateDraft({...draft,reason})).toThrow(CustomerDataError);
    }else expect(parseLeadStateDraft(draft)).toEqual(draft);
    const reason='  Synthetic reason é 😀\nSecond line\tkept\r\n';
    expect(parseLeadStateDraft({...draft,reason}).reason).toBe(reason);
  }
});
it('copies and freezes the original draft before later asynchronous authorization',()=>{
  const draft={fromState:'lost',toState:'follow_up',reason:'Synthetic reopen'};
  const parsed=parseLeadStateDraft(draft);draft.reason='Changed later';draft.toState='won';
  expect(parsed).toEqual({fromState:'lost',toState:'follow_up',reason:'Synthetic reopen'});
  expect(Object.isFrozen(parsed)).toBe(true);
});
it('bounds reasons by code points and rejects corruption instead of truncating evidence',()=>{
  const draft={fromState:'new',toState:'lost',reason:'😀'.repeat(1000)};
  expect(parseLeadStateDraft(draft)).toEqual(draft);
  for(const reason of ['😀'.repeat(1001),'a'.repeat(1001),'\u0000','private\u0001','private\u007f','\ud800','\udfff']){
    expect(()=>parseLeadStateDraft({...draft,reason})).toThrow(CustomerDataError);
  }
});
it.each([null,[],{},'private',
  {fromState:'New',toState:'lost',reason:'Private'},
  {fromState:'new',toState:'Follow-Up',reason:'Private'},
  {fromState:'new',toState:'lost'},
  {fromState:'new',toState:'lost',reason:123},
  {fromState:'new',toState:'lost',reason:undefined},
  {fromState:'new',toState:'lost',reason:{text:'Private'}},
  {fromState:'new',toState:'lost',reason:'Private',quoteSendId:'invented'},
  {fromState:'new',toState:'won',reason:'Private',acceptanceId:'invented'},
  {fromState:'new',toState:'lost',reason:'Private',followUpAt:null},
  {fromState:'lost',toState:'follow_up',reason:'Private',lostReason:null},
  {fromState:'new',toState:'lost',reason:'Private',effectiveAt:'2026-01-01'},
])('rejects malformed/extra authority fields with a fixed private-safe error %#',value=>{
  try{parseLeadStateDraft(value);expect.unreachable('Invalid transition accepted');}
  catch(error){expect(error).toBeInstanceOf(CustomerDataError);expect((error as Error).message).toBe('CUSTOMER_DATA_INVALID');}
});
it('keeps state changes separate from ordinary intake editing and future follow-up evidence',()=>{
  const intake={label:'Synthetic',customerId:null,sourceId:null,referralText:null,phone:null,email:null,requestedScope:null,availability:null,estimatedCents:null,followUpAt:'2026-11-01T12:00:00.123456Z',notes:'Retained'};
  const before=structuredClone(intake);parseLeadStateDraft({fromState:'new',toState:'lost',reason:'Synthetic no response'});
  expect(intake).toEqual(before);expect(parseLeadDraft(intake)).toEqual(before);
  expect(()=>parseLeadDraft({...intake,state:'lost',lostReason:'Synthetic'})).toThrow(CustomerDataError);
});
const uuid='11111111-1111-4111-8111-111111111111',at='2026-10-25T12:00:00.123456Z';
const event=()=>({id:uuid,business_id:uuid,lead_id:uuid,lead_version:'9007199254740993',from_state:'new',to_state:'lost',reason:'Synthetic reason',effective_at:at,quote_send_id:null,acceptance_id:null,version:'1',created_at:at,updated_at:at,created_by:uuid,updated_by:uuid,origin:'manual',operation_id:uuid,import_row_id:null});
it('retains all18 immutable event source columns, exact versions/time and original reason',()=>{
 const row=event(),parsed=parseLeadEvent(row,uuid);expect(Object.keys(parsed).sort()).toEqual([...leadEventColumns].sort());expect(parsed).toEqual(row);expect(Object.isFrozen(parsed)).toBe(true);row.reason='Changed later';expect(parsed.reason).toBe('Synthetic reason');
});
it.each([{business_id:'22222222-2222-4222-8222-222222222222'},{id:''},{lead_id:null},{lead_version:'1'},{lead_version:'01'},{lead_version:2},{lead_version:'9223372036854775808'},{version:'2'},{created_by:null},{updated_by:'22222222-2222-4222-8222-222222222222'},{operation_id:'bad'},{created_at:'2026-10-25T12:00:00.123457Z'},{updated_at:null},{effective_at:'2026-10-25T12:00:00.123Z'},{quote_send_id:uuid},{acceptance_id:uuid},{import_row_id:uuid},{origin:'system'},{to_state:'quote_sent'},{to_state:'won'},{reason:null},{other:'extra'}])('rejects wrong-scope, rewritten, imprecise or commercial event source %#',patch=>{
 expect(()=>parseLeadEvent({...event(),...patch},uuid)).toThrow(CustomerDataError);
});
it('requires every source column and records no substitute for missing evidence',()=>{
 for(const key of leadEventColumns){const row:Record<string,unknown>=event();delete row[key];expect(()=>parseLeadEvent(row,uuid)).toThrow(CustomerDataError);}
});
