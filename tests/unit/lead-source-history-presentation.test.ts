import {describe,expect,it} from 'vitest';
import type {LeadSource} from '../../src/customer/lead-contract';
import {leadSourceChanges} from '../../src/app/lead-sources/source-history-presentation';

const source:LeadSource={id:'source',business_id:'business',label:'  Referral  ',label_normalized:'referral',kind:'Customer',active:true,referral_customer_id:null,version:'1',created_at:'2026-11-18T01:00:00.000001Z',updated_at:'2026-11-18T01:00:00.000001Z',created_by:'actor',updated_by:'actor',origin:'manual',operation_id:'operation',import_row_id:null};
describe('retained lead source changed facts',()=>{
 it('shows all changed facts without normalizing names or categories',()=>expect(leadSourceChanges(source,{...source,version:'2',label:'Referral',kind:' Customer ',active:false})).toEqual([{key:'label',label:'Source label',before:'  Referral  ',after:'Referral'},{key:'kind',label:'Source kind',before:'Customer',after:' Customer '},{key:'active',label:'Status',before:true,after:false}]));
 it('refuses cross-record, cross-business, missing and nonadjacent comparisons',()=>{for(const change of [{id:'other'},{business_id:'other'},{version:'3'},{version:'invalid'}])expect(leadSourceChanges(source,{...source,version:'2',...change})).toBeNull();expect(leadSourceChanges(null,source)).toBeNull();});
 it('distinguishes an absent referral and two different linked customers',()=>{const first={...source,referral_customer_id:'customerA'};expect(leadSourceChanges(source,{...first,version:'2'})).toEqual([{key:'referral_customer_id',label:'Referral customer',before:null,after:'customerA'}]);expect(leadSourceChanges(first,{...first,version:'2',referral_customer_id:'customerB'})).toEqual([{key:'referral_customer_id',label:'Referral customer',before:'customerA',after:'customerB'}]);});
 it('does not infer a field change from provenance or timestamp changes',()=>expect(leadSourceChanges(source,{...source,version:'2',operation_id:'new operation',updated_by:'other actor',updated_at:'2026-11-18T01:00:00.000002Z'})).toEqual([]));
 it('compares adjacent versions beyond number precision exactly',()=>expect(leadSourceChanges({...source,version:'9007199254740993'},{...source,version:'9007199254740994',active:false})).toEqual([{key:'active',label:'Status',before:true,after:false}]));
});
