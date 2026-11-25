import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {identityFixture} from '../support/business-identity-fixture';
import {currentIdentityFromEvidence,currentIdentityInventory} from '../../src/security/current-business-identity-source';
import {currentProviderSourceInventory} from '../../src/security/current-provider-source-inventory';
import {captureCurrentProviderSource,currentProviderFromRows,formatCurrentProviderSource,verifyCurrentProviderSource} from '../../src/security/current-business-provider-source';
import {readCurrentBusinessCsv} from '../../src/security/current-business-source-csv';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
function fixture(){
 const original=identityFixture(),binding={businessId:original.businessId,snapshotToken:'b'.repeat(64),observedAt:'2026-10-24T07:00:00.000000Z'};
 const identity=currentIdentityFromEvidence(original.encode(),currentIdentityInventory.map(value=>({...value,types:Object.fromEntries(value.columns.map(column=>[column,'text'])),primaryKey:['id']})),binding);
 const issuer=String(original.actors[1]!.auth_provider_issuer),scope={actorId:original.owner,issuer,snapshotToken:'c'.repeat(64),observedAt:binding.observedAt};
 const sources=currentProviderSourceInventory.map(value=>{
  const primaryKey=[value.columns.includes('id')?'id':value.columns.includes('request_id')?'request_id':'attempt_id'];
  const row:Record<string,string|null>=Object.fromEntries(value.columns.map(column=>[column,null]));
  Object.assign(row,{[primaryKey[0]!]:original.owner,actor_id:original.owner});if(value.columns.includes('provider_issuer'))row.provider_issuer=issuer;
  if(value.columns.includes('canonical_evidence'))row.canonical_evidence='{"exact":9007199254740993,"timestamp":"2026-10-24T07:00:00.123456Z"}';
  if(value.columns.includes('payload'))row.payload='{"exact":9007199254740993}';
  if(value.columns.includes('event_hash'))row.event_hash=digest((row.canonical_evidence??row.payload)!);
  return{...value,types:Object.fromEntries(value.columns.map(column=>[column,'text'])),primaryKey,rows:[row]};
 });
 return{original,binding,identity,issuer,scope,sources,get:()=>currentProviderFromRows(sources,[scope],identity,binding)};
}
it('preserves all eight closed sources and exact text through CSV with no credential columns',()=>{
 const f=fixture();f.sources[1]!.rows[0]!.state="'=SUM(1,2)\\N\r\nprivate";f.sources[1]!.rows[0]!.source_version='9007199254740993';f.sources[1]!.rows[0]!.origin='';
 const value=f.get(),bundle=formatCurrentProviderSource(value,f.identity,f.binding),escapes=JSON.parse(Buffer.from(bundle.files['current_provider_escape_map.json']!).toString());
 expect(value.recordCount).toBe(8);expect(value.sources).toHaveLength(8);
 for(const source of value.sources){const name=source.source.replace('.','_')+'.csv';expect(readCurrentBusinessCsv(Buffer.from(bundle.files[name]!).toString(),source.columns,escapes[name])).toEqual(source.rows);expect(source.columns).not.toContain('credential_hash');expect(source.columns).not.toContain('token_hash');}
 expect(JSON.parse(Buffer.from(bundle.files['current_provider_source_manifest.json']!).toString())).toMatchObject({recordCount:8,completePortableExport:false,completeBackup:false});
});
it.each(['foreign actor','foreign issuer','hash','extra credential','duplicate key','null key','source','columns','snapshot','scope order'])('rejects %s before producing files',issue=>{
 const f=fixture(),source=f.sources[0]!,row=source.rows[0]!;
 if(issue==='foreign actor')row.actor_id=f.original.bootstrap;
 if(issue==='foreign issuer')row.provider_issuer='https://other.example.com/auth/v1';
 if(issue==='hash')row.canonical_evidence='changed';
 if(issue==='extra credential')row.credential_hash='excluded';
 if(issue==='duplicate key')source.rows.push({...row});
 if(issue==='null key')row[source.primaryKey[0]!]=null;
 if(issue==='source')source.source='crest_private.unreviewed';
 if(issue==='columns')source.columns=[...source.columns,'credential_hash'];
 if(issue==='snapshot')f.scope.observedAt='2026-10-25T07:00:00.000000Z';
 if(issue==='scope order')f.scope.actorId=f.original.bootstrap;
 expect(f.get).toThrow();
});
it('retains empty tables and rejects a corrupted immutable envelope',()=>{
 const f=fixture();for(const source of f.sources)source.rows=[];const source=f.get();expect(source.recordCount).toBe(0);expect(source.sources).toHaveLength(8);
 expect(()=>verifyCurrentProviderSource({...source,completeBackup:true} as never,f.identity,f.binding)).toThrow();
 expect(()=>verifyCurrentProviderSource({...source,recordCount:1},f.identity,f.binding)).toThrow();
});
it('pages under one actor snapshot and keeps exact composite keys',async()=>{
 const f=fixture(),source=f.sources[1]!;source.primaryKey=['id','source_version'];source.rows=Array.from({length:101},(_,index)=>({...source.rows[0]!,source_version:String(index).padStart(3,'0')}));
 const query=vi.fn(async(sql:string,args:unknown[])=>{
  expect(sql).toContain('crest_commands.provider_source_page_v1');expect(args[0]).toBe(f.binding.businessId);expect(args[1]).toBe(f.original.owner);expect(args[2]).toBe(f.issuer);expect(args[6]).toBe(100);
  const selected=f.sources.find(value=>value.source===args[3])!,later=args[5]!==null,rows=selected===source?(later?selected.rows.slice(100):selected.rows.slice(0,100)):selected.rows;
  expect(args[4]).toBe(query.mock.calls.length===1?null:f.scope.snapshotToken);
  return[{page:{schemaVersion:1,businessId:f.binding.businessId,actorId:f.original.owner,providerIssuer:f.issuer,source:selected.source,snapshotToken:f.scope.snapshotToken,observedAt:f.binding.observedAt,columns:selected.columns,types:selected.types,primaryKey:selected.primaryKey,rows,nextCursor:selected===source&&!later?source.primaryKey.map(column=>rows.at(-1)![column]):null}}];
 });
 const value=await captureCurrentProviderSource(f.identity,f.binding,query,()=>{});expect(value.recordCount).toBe(108);expect(query).toHaveBeenCalledTimes(9);expect(value.sources[1]!.rows.at(-1)!.source_version).toBe('100');
});
it.each(['snapshot','actor','cursor'])('rejects changed %s during collection',async issue=>{
 const f=fixture(),source=f.sources[0]!;
 const query=async()=>[{page:{schemaVersion:1,businessId:f.binding.businessId,actorId:issue==='actor'?f.original.bootstrap:f.original.owner,providerIssuer:f.issuer,source:source.source,snapshotToken:issue==='snapshot'?'invalid':f.scope.snapshotToken,observedAt:f.binding.observedAt,columns:source.columns,types:source.types,primaryKey:source.primaryKey,rows:source.rows,nextCursor:issue==='cursor'?['unconfirmed']:null}}];
 await expect(captureCurrentProviderSource(f.identity,f.binding,query,()=>{})).rejects.toThrow();
});
