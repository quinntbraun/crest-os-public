import {describe,expect,it} from 'vitest';
import {leadHistoryChanges} from '../../src/app/leads/history-presentation';
import {leadFixture,leadSourceFixture} from '../support/lead-fixture';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {LeadHistory} from '../../src/app/leads/history';

describe('retained lead changed facts',()=>{
 it('preserves whitespace, null, empty and exact large estimates',()=>{const before=leadFixture({label:' Lead ',notes:null,estimated_cents:'9007199254740993'}),after={...before,version:'2',label:'Lead',notes:'',estimated_cents:'9007199254740994'};expect(leadHistoryChanges(before,after)).toEqual([{key:'label',label:'Lead label',before:' Lead ',after:'Lead'},{key:'estimated_cents',label:'Estimate (USD)',before:'9007199254740993',after:'9007199254740994'},{key:'notes',label:'Notes',before:null,after:''}]);});
 it('refuses unrelated records, businesses, gaps and invalid or overflowing versions',()=>{const before=leadFixture();expect(leadHistoryChanges(null,before)).toBeNull();for(const patch of [{id:'other'},{business_id:'other'},{version:'3'},{version:'bad'},{version:'9223372036854775808'}])expect(leadHistoryChanges(before,{...before,version:'2',...patch})).toBeNull();});
 it('compares adjacent versions beyond number precision',()=>{const before=leadFixture({version:'9007199254740993'});expect(leadHistoryChanges(before,{...before,version:'9007199254740994',follow_up_at:'2026-11-18T12:00:00.000001Z'})).toEqual([{key:'follow_up_at',label:'Follow-up (UTC)',before:null,after:'2026-11-18T12:00:00.000001Z'}]);});
 it('compares attribution values rather than object identity and retains the saved snapshot',()=>{const source=leadSourceFixture(),before=leadFixture({source_id:source.id,source_snapshot:source});expect(leadHistoryChanges(before,{...before,version:'2',source_snapshot:{...source}})).toEqual([]);const changed={...source,version:'2',label:'Renamed source'};expect(leadHistoryChanges(before,{...before,version:'2',source_snapshot:changed})).toEqual([{key:'source_snapshot',label:'Source attribution snapshot',before:source,after:changed}]);expect(before.source_snapshot).toEqual(source);});
 it('shows Lost/reopened state facts without inventing the reopen reason',()=>{const before=leadFixture({state:'lost',lost_reason:' Original reason '});expect(leadHistoryChanges(before,{...before,version:'2',state:'follow_up',lost_reason:null})).toEqual([{key:'state',label:'Status',before:'lost',after:'follow_up'},{key:'lost_reason',label:'Lost reason',before:' Original reason ',after:null}]);});
 it('does not call provenance changes or derived normalization a business-field change',()=>{const before=leadFixture();expect(leadHistoryChanges(before,{...before,version:'2',updated_by:'other',operation_id:'other',updated_at:'2026-11-18T01:02:03.000001Z',phone_normalized:'555'})).toEqual([]);});
 it('gives every scrollable comparison and retained snapshot a distinct accessible name when expanded together',()=>{
  const before=leadFixture({notes:'Original '.repeat(80),requested_scope:'Scope '.repeat(80)}),after={...before,version:'2',notes:'Changed '.repeat(80)};
  const metadata={actorId:before.updated_by,operationId:before.operation_id,at:before.updated_at};
  const markup=renderToStaticMarkup(createElement(LeadHistory,{busy:false,onMore:()=>{},history:{state:'found',lead:after,hasMore:false,history:[{...metadata,version:'1',eventId:before.id,action:'create',before:null,after:before},{...metadata,version:'2',eventId:leadSourceFixture().id,action:'edit',before,after}]}}));
  const names=[...markup.matchAll(/class="lead-history-long-value"[^>]*aria-label="([^"]+)"/g)].map(match=>match[1]);
  expect(names.length).toBeGreaterThan(1);expect(new Set(names).size).toBe(names.length);
 });
});
