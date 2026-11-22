import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {captureCurrentBusinessRows} from '../../src/security/current-business-source';
import {currentBusinessSourceInventory} from '../../src/security/current-business-source-inventory';
const businessId='11111111-1111-4111-8111-111111111111',stamp='2026-11-22T20:00:00.000000Z',token='a'.repeat(64);
function page(source:string){const descriptor=currentBusinessSourceInventory.find(item=>item.source===source)!;return {schemaVersion:1,businessId,source,snapshotToken:token,observedAt:stamp,columns:descriptor.columns,types:Object.fromEntries(descriptor.columns.map(column=>[column,'text'])),primaryKey:descriptor.columns.includes('id')?['id']:[descriptor.columns[0]!],rows:[] as Record<string,string|null>[],nextCursor:null as string[]|null};}
it('retains all 101 rows across pages and rejects a different snapshot before publishing capture',async()=>{
 const values=Array.from({length:101},(_,index)=>Object.fromEntries(currentBusinessSourceInventory.find(item=>item.source==='crest.customers')!.columns.map(column=>[column,column==='id'?'00000000-0000-4000-8000-'+String(index).padStart(12,'0'):column==='business_id'?businessId:null])));
 const query=vi.fn(async(_sql:string,args:unknown[])=>{const out=page(args[1] as string);if(out.source==='crest.customers'){out.rows=args[3]===null?values.slice(0,100):values.slice(100);out.nextCursor=args[3]===null?[values[99]!.id!]:null;}return [{page:out}];});
 const capture=await captureCurrentBusinessRows(businessId,query,()=>{});expect(capture.recordCount).toBe(101);expect(capture.sources.find(item=>item.source==='crest.customers')!.rows).toEqual(values);
 expect(query.mock.calls.some(call=>Array.isArray(call[1][3])&&call[1][2]===token)).toBe(true);
 const changed=vi.fn(async(_sql:string,args:unknown[])=>{const out=page(args[1] as string);if(out.source==='crest.customers')out.snapshotToken='b'.repeat(64);return [{page:out}];});
 await expect(captureCurrentBusinessRows(businessId,changed,()=>{})).rejects.toThrow('CURRENT_BUSINESS_SOURCE_REVIEW_REQUIRED');
});
it('rejects another business row, extra credential fields and a cursor that drops rows',async()=>{
 for(const fault of ['business','credential','cursor']){
  const query=async(_sql:string,args:unknown[])=>{const out=page(args[1] as string);if(out.source==='crest.customers'){
   const row=Object.fromEntries(out.columns.map(column=>[column,column==='id'?businessId:column==='business_id'?businessId:null]));
   if(fault==='business')row.business_id='22222222-2222-4222-8222-222222222222';if(fault==='credential')row.envelope='secret';out.rows=[row];if(fault==='cursor')out.nextCursor=[businessId];
  }return [{page:out}];};
  await expect(captureCurrentBusinessRows(businessId,query,()=>{})).rejects.toThrow('CURRENT_BUSINESS_SOURCE_REVIEW_REQUIRED');
 }
});
