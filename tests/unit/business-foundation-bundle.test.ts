import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {formatBusinessFoundationBundle} from '../../src/security/business-foundation-bundle.ts';
import {verifyBusinessFoundationEvidence} from '../../src/security/business-configuration-evidence.ts';
import {configurationFixture} from '../support/business-configuration-fixture.ts';
import {readCustomerCsv} from '../support/customer-fixture.ts';
import {identityDigest} from '../support/business-identity-fixture.ts';
import {createExportPartCodec} from '../../src/security/export-part-crypto.ts';

type Fixture=ReturnType<typeof configurationFixture>;
type Value=ReturnType<ReturnType<typeof formatBusinessFoundationBundle>['forServer']>;
const error='BUSINESS_FOUNDATION_BUNDLE_REVIEW_REQUIRED';
const input=(f:Fixture)=>({configuration:f.encode(),identity:f.identity.encode(),history:f.history.encode()});
const format=(f:Fixture)=>formatBusinessFoundationBundle(input(f),f.expected).forServer();
function content(value:Value,name:string){const part=value.parts.find(p=>p.name===name);expect(part,'Missing '+name).toBeDefined();return part!.content;}
function decode(value:Value,entity:string){
 const rows=readCustomerCsv(content(value,entity+'.csv')),columns=rows.shift()!;
 const dictionary=JSON.parse(content(value,entity+'_dictionary.json'));
 const escapes=JSON.parse(content(value,entity+'_escape_map.json')).escapes as {row_id:string;column:string}[];
 return rows.map(cells=>Object.fromEntries(columns.map((column,index)=>{
  let cell:string|number|boolean|null=cells[index]!;
  if(cell==='\\N')cell=null;
  else{
   if(escapes.some(e=>e.row_id===cells[columns.indexOf('id')]&&e.column===column)){expect(cell.startsWith("'")).toBe(true);cell=cell.slice(1);}
   cell=cell.replaceAll('\\\\','\\');
   if(dictionary.booleanColumns?.includes(column)){expect(['true','false']).toContain(cell);cell=cell==='true';}
   if(['schema_version','result_schema_version'].includes(column))cell=Number(cell);
  }
  return [column,cell];
 })));
}
function reconstruct(value:Value){
 const manifest=JSON.parse(value.manifest),result:Record<string,string>={};
 for(const group of ['configuration','identity','history']){
  const collection=manifest.sourceCollections[group];
  const records=collection.pages.flatMap((name:string,index:number)=>{
   const page=JSON.parse(content(value,name));expect(page).toMatchObject({formatVersion:1,profile:'crest.foundation-source-page.v1',group,generationId:manifest.generationId,page:index+1,context:collection.context});return page.records;
  });
  expect(records).toHaveLength(collection.recordCount);
  result[group]=JSON.stringify({formatVersion:1,assurance:'snapshot_bytes_only',generationId:manifest.generationId,context:collection.context,evidenceBytes:collection.evidenceBytes,records});
 }
 return result;
}
function changeBusiness(f:Fixture,key:string,value:unknown){
 const row=f.identity.config.businesses![0]!;row[key]=value;
 const event=f.identity.events.find(e=>e.entity_kind==='businesses')!;event.entity_version=row.version;
 f.identity.bind(event,null,{...row,created_at:f.identity.original,updated_at:f.identity.original});f.identity.refresh();f.refresh();
}

it('round-trips every column of all eight foundation entities with exact text, booleans, JSON and nulls',()=>{
 const f=configurationFixture(),value=format(f);
 const rows={...f.identity.config,actors:f.identity.actors,role_capabilities:f.identity.caps,identity_events:f.identity.events,operations:[f.history.operation],audit_events:[f.history.audit]};
 for(const [entity,expected] of Object.entries(rows)){
  expect(decode(value,entity)).toEqual(expected);
  expect(readCustomerCsv(content(value,entity+'.csv'))[0]!.slice().sort()).toEqual(Object.keys(expected[0]!).sort());
 }
 expect(decode(value,'actors')[1]!.version).toBe('9007199254740995');
 expect(decode(value,'identity_events').some(row=>String(row.payload).includes('9007199254740993'))).toBe(true);
 expect(decode(value,'audit_events')[0]!.delta).toContain('0.12345678901234567890123456789');
 expect(decode(value,'businesses')[0]!.created_at).toBe(f.identity.stamp);
});
it.each(['\\N',"'Crest",'=SUM(A1)',' +1','\t-1','\n@SUM(A1)','\ufeff=1','  É 😀 ",\r\n\\N  '])('reverses formula protection, quotes, whitespace and literal backslashes for %j',name=>{
 const f=configurationFixture();changeBusiness(f,'legal_name',name);const value=format(f);
 expect(decode(value,'businesses')[0]!.legal_name).toBe(name);
 const matrix=readCustomerCsv(content(value,'businesses.csv')),cell=matrix[1]![matrix[0]!.indexOf('legal_name')]!;
 if(name.startsWith("'")||['=','+','-','@'].includes(name.trimStart()[0]??''))expect(cell.startsWith("'")).toBe(true);
 expect(JSON.parse(content(value,'memberships_escape_map.json')).escapes).toEqual([]);
});
it('reconstructs all original evidence strings and runs the unchanged joined verifier independently',()=>{
 const f=configurationFixture(),value=format(f),sources=reconstruct(value),original=input(f);
 for(const name of ['configuration','identity','history'] as const)expect(JSON.parse(sources[name]!).records).toEqual(JSON.parse(original[name]).records);
 const verified=verifyBusinessFoundationEvidence(sources.configuration,sources.identity,sources.history,f.expected);
 expect(verified.configurationCurrentRowsVerified).toBe(true);expect(verified.includedActorReferencesVerified).toBe(true);
 expect(verified.consistentCaptureProven).toBe(false);expect(verified.completePortableExport).toBe(false);
});
it('binds exact bytes and stable names, media types, source order and incomplete coverage without a self-referencing manifest',()=>{
 const f=configurationFixture(),value=format(f),manifest=JSON.parse(value.manifest);
 expect(manifest).toMatchObject({formatVersion:1,profile:'crest.foundation-bundle.v1',generationId:f.collection.generationId,businessId:f.expected.businessId,observedAt:f.identity.stamp,assurance:'internal_consistency_only',consistentCaptureProven:false,referenceClosureComplete:false,completePortableExport:false,completeBackup:false});
 expect(value.parts).toHaveLength(28);expect(manifest.parts).toHaveLength(28);expect(new Set(value.parts.map(p=>p.name)).size).toBe(28);
 for(const [index,part] of value.parts.entries()){
  expect(part.name).toMatch(/^[a-z][a-z0-9_]{0,79}\.(csv|json|txt)$/);
  expect(part.bytes).toBe(Buffer.byteLength(part.content));expect(part.bytes).toBeLessThanOrEqual(8*1024*1024);
  expect(part.sha256).toBe(createHash('sha256').update(part.content).digest('hex'));
  expect(manifest.parts[index]).toEqual({name:part.name,contentType:part.contentType,bytes:part.bytes,sha256:part.sha256});
 }
 expect(format(f)).toEqual(value);
});
it('keeps the private handoff immutable and refuses implicit JSON serialization',()=>{
 const f=configurationFixture(),sealed=formatBusinessFoundationBundle(input(f),f.expected),value=sealed.forServer();
 expect(()=>JSON.stringify(sealed)).toThrow(error);
 for(const item of [sealed,value,value.parts,...value.parts])expect(Object.isFrozen(item)).toBe(true);
 expect(sealed.forServer()).toBe(value);
});
it('hands every emitted file and the separate manifest to the actual encrypted part codec without changing bytes',async()=>{
 const f=configurationFixture(),value=format(f),codec=await createExportPartCodec('synthetic',[{id:'synthetic',key:randomBytes(32)}]);
 const fixed={businessId:f.expected.businessId,actorId:f.identity.owner,exportJobId:randomUUID(),generationId:f.collection.generationId,recoveryEpoch:String(f.identity.config.business_recovery_authorities![0]!.active_epoch)};
 for(const part of [...value.parts,{name:'foundation_manifest.json',contentType:'application/json' as const,content:value.manifest}]){
  const bytes=Buffer.from(part.content),binding={...fixed,partId:randomUUID(),fileName:part.name,contentType:part.contentType};
  const encrypted=await codec.encrypt(bytes,binding,new AbortController().signal),opened=await codec.decrypt(encrypted,binding,new AbortController().signal);
  try{expect(opened.metadataForServer()).toEqual({binding,byteSize:bytes.length,sha256:identityDigest(part.content)});expect(Buffer.compare(Buffer.from(opened.forServer().bytes),bytes)).toBe(0);}finally{opened.dispose();}
 }
});
it('includes headers and one source page for explicitly empty operational history',()=>{
 const f=configurationFixture();f.history.collection.records=[];f.history.collection.context.recordCounts={operation:'0',audit_event:'0'};
 const value=format(f);expect(decode(value,'operations')).toEqual([]);expect(decode(value,'audit_events')).toEqual([]);
 const restored=reconstruct(value);expect(JSON.parse(restored.history!).records).toEqual([]);
 verifyBusinessFoundationEvidence(restored.configuration,restored.identity,restored.history,f.expected);
});
it.each(['business','generation','observation','source hash','missing source','extra credential','late state','missing profile','duplicate source key','malformed Unicode'])('rejects %s without a partial result or sensitive error cause',issue=>{
 const f=configurationFixture();let sources=input(f),businessId=f.expected.businessId;
 if(issue==='business')businessId=randomUUID();
 if(issue==='generation'){f.history.collection.generationId=randomUUID();sources=input(f);}
 if(issue==='observation'){f.history.collection.context.observedAt='2026-10-24T07:00:00.123457+00:00';sources=input(f);}
 if(issue==='source hash'){f.collection.records[0]!.evidenceHash='0'.repeat(64);sources=input(f);}
 if(issue==='missing source'){f.collection.records.pop();sources=input(f);}
 if(issue==='extra credential'||issue==='late state'||issue==='malformed Unicode'){
  const record=f.collection.records[0]!,body=JSON.parse(record.canonicalEvidence);
  if(issue==='extra credential')body.row.token_hash='PRIVATE SENTINEL';
  if(issue==='late state')body.row.legal_name='PRIVATE SENTINEL';
  if(issue==='malformed Unicode')body.row.legal_name='\ud800';
  record.canonicalEvidence=JSON.stringify(body);record.evidenceHash=identityDigest(record.canonicalEvidence);sources=input(f);
 }
 if(issue==='missing profile'){f.identity.collection.records.shift();sources=input(f);}
 if(issue==='duplicate source key')sources.configuration=sources.configuration.replace('"formatVersion":1','"formatVersion":1,"formatVersion":1');
 try{formatBusinessFoundationBundle(sources,{businessId});throw Error('accepted');}catch(e){expect((e as Error).message).toBe(error);expect((e as Error).cause).toBeUndefined();expect(String(e)).not.toContain('PRIVATE SENTINEL');}
});
it('bounds the serialized input before formatting and never silently truncates',()=>{
 const f=configurationFixture(),sources=input(f);sources.identity+=' '.repeat(64*1024*1024);
 expect(()=>formatBusinessFoundationBundle(sources,f.expected)).toThrow(error);
});
it('splits a valid full8MiB source into bounded pages and reconstructs every exact evidence byte',()=>{
 const f=configurationFixture(),owner=f.identity.actors[1]!;
 for(let i=0;i<32;i++){const before={...owner};owner.version=String(BigInt(owner.version as string)+1n);f.identity.add('actors',{...owner},before);}
 f.identity.refresh();f.encode();f.history.encode();f.identity.encode();
 let remaining=8*1024*1024-f.collection.evidenceBytes-f.history.collection.evidenceBytes-f.identity.collection.evidenceBytes;
 for(const record of f.identity.collection.records.filter(r=>r.kind==='identity_event')){
  const bytes=Math.min(remaining,262144-Buffer.byteLength(record.canonicalEvidence));record.canonicalEvidence+=' '.repeat(bytes);record.evidenceHash=identityDigest(record.canonicalEvidence);remaining-=bytes;
 }
 expect(remaining).toBe(0);const value=format(f),manifest=JSON.parse(value.manifest);
 expect(manifest.sourceCollections.identity.pages.length).toBeGreaterThan(1);
 const sources=reconstruct(value),verified=verifyBusinessFoundationEvidence(sources.configuration,sources.identity,sources.history,f.expected);
 expect(verified.identity.records).toEqual(f.identity.collection.records);
 expect(verified.configuration.evidenceBytes+verified.identity.evidenceBytes+verified.history.evidenceBytes).toBe(8*1024*1024);
 const extra=f.identity.collection.records.find(r=>Buffer.byteLength(r.canonicalEvidence)<262144)!;extra.canonicalEvidence+=' ';extra.evidenceHash=identityDigest(extra.canonicalEvidence);
 expect(()=>format(f)).toThrow(error);
});
