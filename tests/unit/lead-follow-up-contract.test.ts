import {describe,expect,it} from 'vitest';
import {parseLeadFollowUpPage,parseLeadFollowUpQuery} from '../../src/customer/lead-follow-up-contract';

const businessId='a0000000-0000-4000-8000-000000000000';
const first='f0000000-0000-4000-8000-000000000001';
const second='f0000000-0000-4000-8000-000000000002';
const at='2023-05-12T12:30:45.123456Z';
const row={id:first,label:'Scheduled outreach',state:'lost',followUpAt:at};
const response={schemaVersion:1,businessId,observedAt:'2026-11-16T15:00:01.000001Z',followUps:[row],hasMore:false};
const query=parseLeadFollowUpQuery({afterAt:null,afterId:null,pageSize:2});

describe('lead follow-up pages',()=>{
 it('accepts precise equal-time cursors with increasing lead IDs',()=>{
  const after=parseLeadFollowUpQuery({afterAt:at,afterId:first,pageSize:1});
  const observed=parseLeadFollowUpPage({...response,followUps:[{...row,id:second}]},businessId,after);
  expect(observed.followUps).toEqual([{...row,id:second}]);
  expect(Object.isFrozen(observed.followUps[0])).toBe(true);
  expect(()=>parseLeadFollowUpPage(response,businessId,after)).toThrow();
 });
 it('refuses a partial cursor, duplicate identity, unscoped fields, wrong tenant and false continuation',()=>{
  expect(()=>parseLeadFollowUpQuery({afterAt:at,afterId:null,pageSize:2})).toThrow();
  expect(()=>parseLeadFollowUpQuery({afterAt:null,afterId:null,pageSize:51})).toThrow();
  for(const value of [
   {...response,businessId:first},
   {...response,followUps:[{...row,phone:'Confidential'}]},
   {...response,followUps:[row,{...row,followUpAt:'2024-01-01T00:00:01.000001Z'}]},
   {...response,hasMore:true},
  ])expect(()=>parseLeadFollowUpPage(value,businessId,query)).toThrow();
 });
});
