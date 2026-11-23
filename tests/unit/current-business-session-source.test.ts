import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {identityFixture} from '../support/business-identity-fixture';
import {sessionMetadataFixture} from '../support/session-metadata-fixture';
import {currentIdentityInventory,currentIdentityFromEvidence} from '../../src/security/current-business-identity-source';
import {currentSessionSource,currentSessionsFromEvidence,formatCurrentSessionSource,captureCurrentSessionSource,verifyCurrentSessionSource} from '../../src/security/current-business-session-source';
import {readCurrentBusinessCsv} from '../../src/security/current-business-source-csv';
function fixture(){
 const f=identityFixture(),binding={businessId:f.businessId,snapshotToken:'b'.repeat(64),observedAt:'2026-10-24T07:00:00.000000Z'},identity=currentIdentityFromEvidence(f.encode(),currentIdentityInventory.map(descriptor=>({source:descriptor.source,columns:descriptor.columns,types:Object.fromEntries(descriptor.columns.map(column=>[column,'text'])),primaryKey:['id']})),binding),s=sessionMetadataFixture();
 const old=s.expected.actorId;Object.assign(s.expected,{actorId:f.owner});Object.assign(s.collection.context,{actorId:f.owner});for(const column of ['actor_id','created_by','updated_by'])if(s.row[column]===old)s.row[column]=f.owner;s.row.version='9007199254740993';s.refresh();
 const metadata={columns:currentSessionSource.columns,types:Object.fromEntries(currentSessionSource.columns.map(column=>[column,column==='trusted'?'boolean':'text'])),primaryKey:['id']},scopes=()=>[{actorId:f.owner,issuer:s.expected.issuer,evidence:s.encodeMetadata()}];
 return{f,binding,identity,s,metadata,scopes,get:()=>currentSessionsFromEvidence(scopes(),metadata,identity,binding)};
}
it('round-trips exact noncredential session fields, booleans, microseconds, nulls and bigint versions',()=>{
 const f=fixture(),source=f.get(),bundle=formatCurrentSessionSource(source,f.identity,f.binding),csv=Buffer.from(bundle.files['crest_private_app_sessions.csv']!).toString(),escapes=JSON.parse(Buffer.from(bundle.files['current_session_escape_map.json']!).toString());
 expect(readCurrentBusinessCsv(csv,source.source.columns,escapes['crest_private_app_sessions.csv'])).toEqual(source.source.rows);expect(source.source.rows[0]!.version).toBe('9007199254740993');expect(source.source.rows[0]!.trusted).toBe(String(f.s.row.trusted));expect(source.source.rows[0]!.created_at).toBe(f.s.row.created_at);expect(source.source.columns).not.toContain('credential_hash');expect(JSON.parse(Buffer.from(bundle.files['current_session_source_manifest.json']!).toString())).toMatchObject({completePortableExport:false,completeBackup:false,recordCount:1});
});
it.each(['business','snapshot','actor','issuer','extra secret','unknown updater','row'])('refuses %s corruption without returning a portable claim',issue=>{
 const f=fixture(),source=structuredClone(f.get());if(issue==='business')Object.assign(source,{businessId:'11111111-1111-4111-8111-111111111111'});if(issue==='snapshot')Object.assign(source,{businessSnapshotToken:'d'.repeat(64)});if(issue==='actor')Object.assign(source.scopes[0]!,{actorId:f.f.bootstrap});if(issue==='issuer')Object.assign(source.scopes[0]!,{issuer:'https://another.example.com/auth/v1'});if(issue==='row')Object.assign(source.source.rows[0]!,{version:'1'});
 if(issue==='extra secret'||issue==='unknown updater'){if(issue==='extra secret')f.s.row.credential_hash='excluded';else f.s.row.updated_by='11111111-1111-4111-8111-111111111111';f.s.refresh();Object.assign(source.scopes[0]!,{evidence:f.s.encodeMetadata()});}
 expect(()=>verifyCurrentSessionSource(source,f.identity,f.binding)).toThrow();
});
it('collects only reviewed actor scopes with fixed metadata columns on the caller-owned transaction',async()=>{
 const f=fixture(),query=vi.fn(async(sql:string,args:unknown[])=>{
  if(sql.includes('session_metadata_export_context')){expect(args).toEqual([f.f.owner,f.s.expected.issuer]);return[{context:f.s.collection.context}];}
  if(sql.includes('session_metadata_export_page'))return args[3]===null?f.s.collection.records.map(record=>({record_id:record.recordId,representation:record.representation,canonical_evidence:record.canonicalEvidence,evidence_hash:record.evidenceHash})):[];
  expect(sql).toContain("n.nspname='crest_private' AND c.relname='app_sessions'");expect(args).toEqual([currentSessionSource.columns]);return[f.metadata];
 });const source=await captureCurrentSessionSource(f.identity,f.binding,query,()=>{});expect(source.source).toEqual(f.get().source);expect(source.scopes).toHaveLength(1);expect(query).toHaveBeenCalledTimes(3);
});
it('retains an explicitly empty actor session collection without inventing a source row',()=>{const f=fixture();f.s.collection.records=[];f.s.collection.context.recordCount='0';const source=f.get(),bundle=formatCurrentSessionSource(source,f.identity,f.binding);expect(source.recordCount).toBe(0);expect(source.scopes).toHaveLength(1);expect(Buffer.from(bundle.files['crest_private_app_sessions.csv']!).toString().split('\r\n')).toHaveLength(2);});
