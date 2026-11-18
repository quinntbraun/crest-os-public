import {describe,expect,it} from 'vitest';
import {tripRevisionChanges} from '../../src/app/schedule/travel/trip-history-presentation';
import type {SupportTrip} from '../../src/operations/support-trip';
const trip=(overrides:Partial<SupportTrip>={}):SupportTrip=>({legId:'10000000-0000-4000-8000-000000000001',legVersionId:'20000000-0000-4000-8000-000000000001',sequence:'1',drivenVehicleId:'30000000-0000-4000-8000-000000000001',jobId:null,purpose:'supply',state:'open',departedAt:'2026-08-18T14:15:00.123456Z',arrivedAt:null,recordedAt:'2026-08-18T14:15:01.123456Z',origin:{schemaVersion:1,kind:'manual',locationText:'Base',instructions:null},destination:{schemaVersion:1,kind:'manual',locationText:'Shop',instructions:null},notes:null,reason:null,...overrides});
describe('retained trip fact comparisons',()=>{
 it('compares only changed facts of adjacent versions without guessing a command',()=>{
  const previous=trip(),current=trip({sequence:'2',state:'closed',arrivedAt:'2026-08-18T15:00:00.123456Z',reason:'A retained reason'});
  expect(tripRevisionChanges(previous,current)).toEqual([{key:'state',label:'Outcome',before:'open',after:'closed'},{key:'arrivedAt',label:'Actual stop time',before:null,after:'2026-08-18T15:00:00.123456Z'}]);
 });
 it('keeps null, whitespace and line breaks exact in changed evidence',()=>{
  const previous=trip({notes:'  original\r\ntext  '}),current=trip({sequence:'2',notes:null,destination:{schemaVersion:1,kind:'manual',locationText:'  New shop  ',instructions:'\tUse side door'}});
  expect(tripRevisionChanges(previous,current)).toEqual([{key:'destination',label:'Destination / actual stop',before:'Shop',after:'  New shop  '},{key:'destinationInstructions',label:'Destination instructions',before:null,after:'\tUse side door'},{key:'notes',label:'Notes',before:'  original\r\ntext  ',after:null}]);
 });
 it('refuses comparisons across trips',()=>expect(tripRevisionChanges(trip(),trip({sequence:'2',legId:'10000000-0000-4000-8000-000000000002'}))).toBeNull());
 it('refuses missing and skipped preceding versions',()=>{expect(tripRevisionChanges(undefined,trip())).toBeNull();expect(tripRevisionChanges(trip(),trip({sequence:'3'}))).toBeNull();});
 it('does not infer chronological events from nonmonotonic recorded times or reasons',()=>{
  expect(tripRevisionChanges(trip(),trip({sequence:'2',recordedAt:'2026-08-18T12:00:00.000001Z',reason:'Reason only'}))).toEqual([]);
 });
 it('retains changes smaller than a displayed second',()=>{
  expect(tripRevisionChanges(trip(),trip({sequence:'2',departedAt:'2026-08-18T14:15:00.123457Z'}))).toEqual([{key:'departedAt',label:'Actual departure',before:'2026-08-18T14:15:00.123456Z',after:'2026-08-18T14:15:00.123457Z'}]);
 });
});
