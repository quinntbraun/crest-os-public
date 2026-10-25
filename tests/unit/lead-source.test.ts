import {it,expect} from 'vitest';
import {parseLeadSource,parseLeadSourceDraft,draftFromLeadSource,parseLead,draftFromLead,leadColumns,leadSourceColumns} from '../../src/customer/lead-contract.ts';
import {CustomerDataError} from '../../src/customer/customer-contract.ts';
import {leadFixture,leadSourceFixture,leadBusiness} from '../support/lead-fixture.ts';

it('retains explicit source kind, inactive history and genuine referral IDs without inventing a classification',()=>{
 const source=leadSourceFixture({kind:'  Observed custom source  ',active:false,referral_customer_id:leadFixture().id});
 expect(parseLeadSource(source,leadBusiness)).toEqual(source);expect(Object.isFrozen(parseLeadSource(source,leadBusiness))).toBe(true);expect(draftFromLeadSource(source)).toEqual({label:source.label,kind:source.kind,active:false,referralCustomerId:source.referral_customer_id});
});
it.each([{},null,[],{...draftFromLeadSource(leadSourceFixture()),kind:''},{...draftFromLeadSource(leadSourceFixture()),label:'\u00a0'},{...draftFromLeadSource(leadSourceFixture()),active:'true'},{...draftFromLeadSource(leadSourceFixture()),referralCustomerId:'unknown'},{...draftFromLeadSource(leadSourceFixture()),extra:1}])('rejects malformed source draft',value=>expect(()=>parseLeadSourceDraft(value)).toThrow(CustomerDataError));
it.each([{business_id:'33333333-3333-4333-8333-333333333333'},{label_normalized:''},{version:'01'},{updated_at:'0001-01-01T00:00:00.000000Z'},{operation_id:null},{created_by:'invalid'},{import_row_id:''},{origin:'guessed'},{extra:'private'}])('rejects wrong or malformed source provenance',patch=>expect(()=>parseLeadSource({...leadSourceFixture(),...patch},leadBusiness)).toThrow(CustomerDataError));
it('parses exactly26 lead columns and retains empty, unknown, bigint and microsecond source values',()=>{
 const source=leadFixture({notes:'',estimated_cents:'9007199254740993',follow_up_at:'9999-12-31T23:59:59.999999Z',version:'9007199254740993'});
 expect(leadColumns).toHaveLength(26);expect(leadSourceColumns).toHaveLength(15);expect(parseLead(source,leadBusiness)).toEqual(source);expect(draftFromLead(source).estimatedCents).toBe('9007199254740993');
});
it('pins the original source snapshot independently of later directory edits and caller mutation',()=>{
 const snapshot=leadSourceFixture(),source={...leadFixture(),source_id:snapshot.id,source_snapshot:snapshot},parsed=parseLead(source,leadBusiness);
 expect(Object.isFrozen(parsed)).toBe(true);expect(Object.isFrozen(parsed.source_snapshot)).toBe(true);
 const changed={...snapshot,label:'Later source label',version:'2'};source.source_snapshot=changed;
 expect(parsed.source_snapshot?.label).toBe(snapshot.label);expect(parsed.source_snapshot?.version).toBe('1');
});
it('retains follow-up on Lost and reason independently of the contact/estimate unknowns',()=>{
 const row=leadFixture({state:'lost',lost_reason:'Reviewed\nreason',follow_up_at:'2026-10-25T00:00:00.123456Z'});
 expect(parseLead(row,leadBusiness)).toEqual(row);expect(draftFromLead(row).followUpAt).toBe(row.follow_up_at);
});
it.each([{state:'lost',lost_reason:null},{state:'lost',lost_reason:' \n '},{state:'new',lost_reason:'Unexplained reason'},{state:'invented'},{estimated_cents:100},{estimated_cents:'9223372036854775808'},{phone_raw:'317-001',phone_normalized:'999'},{email_normalized:''},{source_id:leadSourceFixture().id,source_snapshot:null},{source_id:null,source_snapshot:leadSourceFixture()},{source_id:leadFixture().id,source_snapshot:leadSourceFixture()},{source_id:leadSourceFixture().id,source_snapshot:leadSourceFixture({business_id:'33333333-3333-4333-8333-333333333333'})},{follow_up_at:'2026-10-25T00:00:00.123Z'},{created_at:'2026-02-30T00:00:00.000000Z'},{business_id:'33333333-3333-4333-8333-333333333333'},{extra:'private'}])('rejects malformed or unbound lead history',patch=>expect(()=>parseLead({...leadFixture(),...patch},leadBusiness)).toThrow(CustomerDataError));
