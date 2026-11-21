import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {parseFinanceMappingHistory,parseFinanceMappingHistoryEvidence} from '../../src/bookkeeping/finance-mapping-contract';
import {financeMappingPeriods} from '../../src/bookkeeping/finance-mapping-presentation';
import {MappingApprovalHistory} from '../../src/app/settings/accounts/mappings/history';

const businessId=randomUUID(),actorId=randomUUID();
function fixture(){return {schemaVersion:2,businessId,purpose:'service_revenue',hasMore:false,rows:[
 {schemaVersion:1,id:randomUUID(),purpose:'service_revenue',version:'2',accountId:null,accountCode:null,effectiveFrom:'2026-04-01',reason:'Fictional closure',auditEventId:randomUUID(),recording:{recordedAt:'2026-11-21T15:01:02.123456Z',actorId}},
 {schemaVersion:1,id:randomUUID(),purpose:'service_revenue',version:'1',accountId:randomUUID(),accountCode:'4000',effectiveFrom:'2026-01-01',reason:'Fictional original approval',auditEventId:randomUUID(),recording:{recordedAt:'2026-11-21T15:01:02.654321Z',actorId}},
]};}
const parse=(value:unknown)=>parseFinanceMappingHistoryEvidence(value,businessId,'service_revenue',null);

it('keeps actual recording evidence separate from effective dates and retains exact precision through period presentation',()=>{
 const input=fixture(),before=JSON.stringify(input),history=parse(input),periods=financeMappingPeriods(history.rows);
 expect(periods[1]!.effectiveUntil).toBe('2026-04-01');
 expect(periods[1]!.row.recording).toEqual(input.rows[1]!.recording);
 expect(Object.isFrozen(history.rows[0])).toBe(true);expect(Object.isFrozen(history.rows[0]!.recording)).toBe(true);
 expect(JSON.stringify(input)).toBe(before);
 const html=renderToStaticMarkup(createElement(MappingApprovalHistory,{history,purpose:'service_revenue',categories:false,heading:null,disabled:false,download:vi.fn(),more:vi.fn()}));
 expect(html).toContain('Recorded in Crest (UTC)');expect(html).toContain('Recorded by reference');
 expect(html).toContain('2026-11-21T15:01:02.123456Z');expect(html).toContain('2026-01-01');expect(html).toContain(actorId);
 expect(html).not.toContain('Recording time and the approving person are not included');
});

it('retains the strict legacy history and explicitly unavailable recording information without fabricating an actor or timestamp',()=>{
 const input=fixture(),legacy={...input,schemaVersion:1,rows:input.rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=="recording")))};
 const history=parseFinanceMappingHistory(legacy,businessId,'service_revenue',null);
 expect(history.rows[0]).not.toHaveProperty('recording');
 const html=renderToStaticMarkup(createElement(MappingApprovalHistory,{history,purpose:'service_revenue',categories:false,heading:null,disabled:false,download:vi.fn(),more:vi.fn()}));
 expect(html).toContain('Recording time and the approving person are not included');expect(html).not.toContain(actorId);
 expect(()=>parse({...input,schemaVersion:1})).toThrow();
 expect(()=>parseFinanceMappingHistory(input,businessId,'service_revenue',null)).toThrow();
});

it.each([
 null,{}, {recordedAt:'2026-11-21T15:01:02Z',actorId},
 {recordedAt:'2026-02-29T15:01:02.123456Z',actorId},
 {recordedAt:'2026-11-21T25:01:02.123456Z',actorId},
 {recordedAt:'2026-11-21T15:01:02.123456Z',actorId:null},
 {recordedAt:'2026-11-21T15:01:02.123456Z',actorId:'owner@example.com'},
 {recordedAt:'2026-11-21T15:01:02.123456Z',actorId,displayName:'Not authorized'},
 {recordedAt:'2026-11-21T15:01:02.123456Z',actorId,providerSubject:randomUUID()},
])('rejects missing, malformed or private recording extensions (%#)',recording=>{
 const input=fixture();expect(()=>parse({...input,rows:input.rows.map((row,index)=>index===0?{...row,recording}:row)})).toThrow();
});

it('preserves tenant, exact-field, contiguous-version and page-boundary checks for the enriched reader',()=>{
 const input=fixture();
 for(const value of [{...input,businessId:randomUUID()},{...input,purpose:'ar'},{...input,privateActor:{}},{...input,hasMore:true},
  {...input,rows:[{...input.rows[0],version:'3'},input.rows[1]]},
  {...input,rows:[{...input.rows[0],effectiveFrom:'2026-01-01'},input.rows[1]]},
  {...input,rows:[{...input.rows[0],providerTokens:{}},input.rows[1]]}])expect(()=>parse(value)).toThrow();
});
