import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {formatHoldSourceCsv} from '../../src/operations/appointment-hold-csv';
import {holdColumns} from '../../src/operations/appointment-hold-contract';
import type {StoredHold} from '../../src/operations/appointment-hold-contract';
import {decodeCustomerCsv} from '../support/customer-fixture';
const businessId=randomUUID(),customerId=randomUUID(),holdId=randomUUID(),actorId=randomUUID();
const row=(sequence=1,patch:Partial<StoredHold>={}):StoredHold=>({id:randomUUID(),business_id:businessId,hold_id:holdId,sequence:String(sequence),replaces_sequence:sequence===1?null:String(sequence-1),customer_id:customerId,lead_id:null,label:'=SUM(1,2) é 雪 😀',state:'proposed',start_at:'2026-10-29T14:00:00.123456Z',end_at:'2026-10-29T15:00:00.654321Z',timezone:'America/Indiana/Indianapolis',local_start:'2026-10-29T10:00:00.123456',local_end:'2026-10-29T11:00:00.654321',start_offset_minutes:-240,end_offset_minutes:-240,notes:'\t=Private "scope"\r\nliteral \\N',reason:sequence===1?null:"'Retained change reason",created_at:'2026-10-28T12:00:00.000001Z',created_by:actorId,operation_id:randomUUID(),origin:'manual',...patch});
const input=(versions:StoredHold[])=>({businessId,snapshotToken:'a'.repeat(64),expectedVersionCount:String(versions.length),versions});
const decoded=(files:ReturnType<typeof formatHoldSourceCsv>)=>decodeCustomerCsv(files.versionsCsv,files.escapeMap).map(row=>({...row,start_offset_minutes:Number(row.start_offset_minutes),end_offset_minutes:Number(row.end_offset_minutes)}));
it('retains all22 columns, microseconds and exact null/empty/backslash/formula Unicode values',()=>{
 const rows=[row(),row(2,{notes:'',state:'withdrawn'})],files=formatHoldSourceCsv(input(rows));
 expect(decoded(files)).toEqual(rows);expect(Object.keys(decoded(files)[0]!)).toEqual([...holdColumns]);expect(JSON.parse(files.escapeMap).escapes).toContainEqual({entity:'appointment_hold_versions',row_id:rows[0]!.id,column:'label',apostrophe_prefix:true});
 expect(JSON.parse(files.manifest)).toMatchObject({includedVersionCount:'2',snapshotProven:false,sourceCompletenessProven:false,referenceClosureComplete:false,completeCrestExport:false,completeBackup:false});
});
it('includes every independent hold and requires complete contiguous immutable histories',()=>{
 const first=row(),other=row(1,{hold_id:randomUUID(),customer_id:null,lead_id:randomUUID(),notes:null});expect(decoded(formatHoldSourceCsv(input([other,first])))).toEqual([other,first]);
 for(const rows of [[row(2)],[first,{...row(2),customer_id:randomUUID()}],[first,{...row(2),id:first.id}],[first,{...row(2),operation_id:first.operation_id}],[first,row(2,{state:'withdrawn'}),row(3)]])expect(()=>formatHoldSourceCsv(input(rows))).toThrow();
});
it('refuses foreign tenant, omitted count/source, malformed token and overflow instead of partial files',()=>{
 const first=row();for(const data of [{...input([first]),expectedVersionCount:'0'},{...input([first]),businessId:randomUUID()},{...input([first]),snapshotToken:'bad'},{...input([first]),expectedVersionCount:'10001'},input([row(1,{notes:'x'.repeat(2001)})])])expect(()=>formatHoldSourceCsv(data)).toThrow();
});
it('returns header-only parts for an explicitly declared empty domain without backup claims',()=>{
 const files=formatHoldSourceCsv(input([]));expect(decoded(files)).toEqual([]);expect(JSON.parse(files.manifest).completeBackup).toBe(false);expect(JSON.parse(files.dictionary).columns).toEqual([...holdColumns]);
});
