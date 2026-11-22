import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {identityFixture} from '../support/business-identity-fixture';
import {currentIdentityInventory,currentIdentityFromEvidence,formatCurrentIdentitySource,captureCurrentIdentitySource,verifyCurrentIdentitySource} from '../../src/security/current-business-identity-source';
import {readCurrentBusinessCsv} from '../../src/security/current-business-source-csv';
function fixture(){
 const f=identityFixture(),binding={businessId:f.businessId,snapshotToken:'b'.repeat(64),observedAt:'2026-10-24T07:00:00.000000Z'},metadata=currentIdentityInventory.map(descriptor=>({source:descriptor.source,columns:descriptor.columns,types:Object.fromEntries(descriptor.columns.map(column=>[column,'text'])),primaryKey:['id']}));
 return{f,binding,metadata,get:()=>currentIdentityFromEvidence(f.encode(),metadata,binding)};
}
it('exports exact scoped actors, role capabilities and retained identity history without rounding large versions',()=>{
 const {get,binding}=fixture(),source=get(),bundle=formatCurrentIdentitySource(source,binding),dictionary=JSON.parse(Buffer.from(bundle.files['current_identity_dictionary.json']!).toString());
 expect(source.sources.map(row=>row.source)).toEqual(currentIdentityInventory.map(row=>row.source));expect(source.sources[0]!.rows.some(row=>row.version==='9007199254740995')).toBe(true);
 const escapes=JSON.parse(Buffer.from(bundle.files['current_identity_escape_map.json']!).toString());for(const item of source.sources){const name=item.source.replace('.','_')+'.csv';expect(readCurrentBusinessCsv(Buffer.from(bundle.files[name]!).toString(),item.columns,escapes[name])).toEqual(item.rows);expect(dictionary[name].records).toBe(item.rows.length);}
 expect(JSON.parse(Buffer.from(bundle.files['current_identity_source_manifest.json']!).toString())).toMatchObject({businessSnapshotToken:binding.snapshotToken,identitySnapshotToken:'a'.repeat(64),completePortableExport:false,completeBackup:false});
});
it.each(['business','snapshot','evidence','row','metadata'])('refuses altered %s material before formatting',issue=>{
 const f=fixture(),source=structuredClone(f.get());if(issue==='business')Object.assign(source,{businessId:'11111111-1111-4111-8111-111111111111'});if(issue==='snapshot')Object.assign(source,{businessSnapshotToken:'c'.repeat(64)});if(issue==='evidence')Object.assign(source,{evidence:source.evidence.replace('Synthetic scope','Different scope')});if(issue==='row')Object.assign(source.sources[0]!.rows[0]!,{display_label:'Changed after capture'});if(issue==='metadata')Object.assign(source.sources[0]!,{primaryKey:['auth_user_id']});expect(()=>verifyCurrentIdentitySource(source,f.binding)).toThrow();
});
it('pages the existing reviewed identity projection and copies metadata within the caller-owned capture',async()=>{
 const f=fixture(),query=vi.fn(async(sql:string,args:unknown[])=>{
  if(sql.includes('business_identity_export_context'))return[{context:f.f.collection.context}];
  if(sql.includes('business_identity_export_page'))return f.f.collection.records.filter(record=>record.kind===args[2]&&(args[3]===null||record.recordId>String(args[3]))).slice(0,20).map(record=>({record_id:record.recordId,representation:record.representation,canonical_evidence:record.canonicalEvidence,evidence_hash:record.evidenceHash}));
  expect(sql).toContain('pg_catalog.pg_class');expect(args[0]).toEqual(currentIdentityInventory.map(value=>value.source));return f.metadata;
 }),check=vi.fn();const source=await captureCurrentIdentitySource(f.binding,query,check);expect(source.sources).toEqual(f.get().sources);expect(query.mock.calls.filter(call=>call[0].includes('business_identity_export_page'))).toHaveLength(3);expect(check).toHaveBeenCalled();
});
