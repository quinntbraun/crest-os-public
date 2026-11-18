import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {parseFinanceMappingHistory} from '../../src/bookkeeping/finance-mapping-contract';
import {financeMappingPeriods} from '../../src/bookkeeping/finance-mapping-presentation';
import {MappingApprovalHistory} from '../../src/app/settings/accounts/mappings/history';
const businessId=randomUUID();
function row(version:number,date:string,closed=false){return {schemaVersion:1,id:randomUUID(),purpose:'service_revenue',version:String(version),accountId:closed?null:randomUUID(),accountCode:closed?null:'4000',effectiveFrom:date,reason:'Fictional retained approval',auditEventId:randomUUID()};}
function history(rows:ReturnType<typeof row>[],hasMore=false){return parseFinanceMappingHistory({schemaVersion:1,businessId,purpose:'service_revenue',rows,hasMore},businessId,'service_revenue',null);}
function render(value:ReturnType<typeof history>){return renderToStaticMarkup(createElement(MappingApprovalHistory,{history:value,purpose:'service_revenue',categories:false,heading:null,disabled:false,download:vi.fn(),more:vi.fn()}));}
it('uses the next recorded effective date as the exclusive boundary without changing approved history',()=>{
 const value=history([row(3,'2026-10-01',true),row(2,'2026-04-01'),row(1,'2026-01-01')]),before=JSON.stringify(value);
 const periods=financeMappingPeriods(value.rows);expect(periods.map(({effectiveFrom,effectiveUntil})=>({effectiveFrom,effectiveUntil}))).toEqual([{effectiveFrom:'2026-10-01',effectiveUntil:null},{effectiveFrom:'2026-04-01',effectiveUntil:'2026-10-01'},{effectiveFrom:'2026-01-01',effectiveUntil:'2026-04-01'}]);expect(periods[0]?.row.accountId).toBeNull();expect(JSON.stringify(value)).toBe(before);
 const html=render(value);expect(html).toContain('Before Apr 1, 2026');expect(html).toContain('No posting account assigned by this version');expect(html).toContain('Newest loaded version');expect(html).toContain('No earlier mapping approval is recorded before Jan 1, 2026');
});
it('does not describe unloaded earlier periods as uncovered or the latest loaded version as current',()=>{
 const rows=Array.from({length:25},(_,i)=>row(26-i,'2026-01-'+String(26-i).padStart(2,'0'))),html=render(history(rows,true));
 expect(html).toContain('Versions 26 through 2 loaded.');expect(html).toContain('Older approvals have not been loaded.');expect(html).toContain('Load older approvals');expect(html).not.toContain('No earlier mapping approval is recorded');expect(html).not.toContain('Latest saved version');expect(html).toContain('Reload history to check for newer versions.');
});
it('shows a verified empty history without a download or an invented period',()=>{
 const html=render(history([]));expect(html).toContain('No approved versions for this purpose.');expect(html).not.toContain('Download loaded approvals');expect(html).not.toContain('Before ');expect(financeMappingPeriods([])).toEqual([]);
});
