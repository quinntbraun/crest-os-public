import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {formatBusinessSourceBundle} from '../../src/security/business-source-bundle.ts';
import {createExportPartCodec} from '../../src/security/export-part-crypto.ts';
import {businessSourceFixture,sourceFixtureInventory} from '../support/business-source-fixture.ts';
import {readCustomerCsv} from '../support/customer-fixture.ts';

type Fixture=ReturnType<typeof businessSourceFixture>;
type Value=ReturnType<ReturnType<typeof formatBusinessSourceBundle>['forServer']>;
const error='BUSINESS_SOURCE_BUNDLE_REVIEW_REQUIRED';
const format=(f:Fixture)=>formatBusinessSourceBundle(f.seal(),f.expected).forServer();
function part(value:Value,name:string){const p=value.parts.find(part=>part.name===name);expect(p,'Missing '+name).toBeDefined();return p!.content;}
function decode(value:Value,entity:string){
 const descriptors=value.parts,at=descriptors.findIndex(p=>p.name===entity+'.csv'),csv=descriptors[at]!,escapes=JSON.parse(descriptors[at+1]!.content).escapes as {row_id:string;column:string}[];
 const matrix=readCustomerCsv(csv.content),columns=matrix.shift()!;
 return matrix.map(cells=>Object.fromEntries(columns.map((column,index)=>{
  let value:string|boolean|object|null=cells[index]!;
  if(value==='\\N')value=null;
  else{
   if(escapes.some(e=>e.row_id===cells[columns.indexOf('id')]&&e.column===column)){expect(value.startsWith("'")).toBe(true);value=value.slice(1);}value=value.replaceAll('\\\\','\\');
   if(['outreach_opt_out','is_billing','active'].includes(column)){expect(['true','false']).toContain(value);value=value==='true';}
   if(['source_snapshot','reported_vehicle','requested_services','request'].includes(column))value=JSON.parse(value as string);
  }
  return[column,value];
 })));
}
function reconstructed(value:Value){
 const manifest=JSON.parse(value.manifest),contexts:Record<string,string>={},pages:Record<string,string[]>={};
 for(const [name]of sourceFixtureInventory){const collection=manifest.sourceCollections[name];if(name!=='links')contexts[name]=part(value,collection.context);pages[name]=collection.pages.map((file:string)=>part(value,file));}
 return {formatVersion:1,generationId:manifest.generationId,businessId:manifest.businessId,observedAt:manifest.observedAt,contexts,pages,evidenceBytes:manifest.crmEvidenceBytes,recordCount:manifest.crmRecordCount,completePortableExport:false,completeBackup:false};
}

it('round-trips all eleven CRM entity CSVs and retains all eight foundation entity CSVs from one supplied capture',()=>{
 const f=businessSourceFixture(),value=format(f);
 for(const [name,,,entity]of sourceFixtureInventory)expect(decode(value,entity)).toEqual(f.rows[name]!.slice().sort((a,b)=>(a.id as string)<(b.id as string)?-1:1));
 expect(value.parts.filter(p=>p.name.endsWith('.csv'))).toHaveLength(19);
 expect(decode(value,'customers')[0]!.version).toBe('9007199254740993');expect(decode(value,'leads')[0]!.estimated_cents).toBe('9007199254740993');
 expect(decode(value,'addresses')[0]!.latitude).toBe('-89.00000000000000000001');expect(decode(value,'addresses')[0]!.longitude).toBe('180.00000000000000000000');
 expect(decode(value,'conversion_links')).toHaveLength(2);expect(decode(value,'lead_conversions')[0]!.created_at).toBe('2026-10-25T01:02:03.123456Z');
 expect(part(value,'identity_events.csv')).toContain('9007199254740993');
});
it('preserves every original raw CRM context and page byte, including legal whitespace, without recomputing historical images',()=>{
 const f=businessSourceFixture();f.contexts.customers=' \r\n'+f.contexts.customers+'\t';f.pages.customers![0]='\n'+f.pages.customers![0]+' \r\n';
 const value=format(f),rebuilt=reconstructed(value);expect(rebuilt).toEqual(JSON.parse(f.value().crm));
 const manifest=JSON.parse(value.manifest);expect(manifest.sourceCollections.links.context).toBe(manifest.sourceCollections.conversions.context);
 expect(new Set(Object.values(rebuilt.contexts).map(text=>JSON.parse(text).snapshotToken)).size).toBe(10);
});
it('keeps historical conversion target versions and lead source snapshots when current captured rows are newer',()=>{
 const f=businessSourceFixture(),oldSource={...f.rows.leadSources![0]};f.rows.leadSources![0]={...oldSource,version:'2',label:'Synthetic renamed source',label_normalized:'synthetic renamed source'};f.rows.vehicles![0]={...f.rows.vehicles![0],version:'2'};f.refresh();
 const value=format(f);expect(decode(value,'lead_sources')[0]!.version).toBe('2');expect(decode(value,'leads')[0]!.source_snapshot).toEqual(oldSource);
 expect(decode(value,'vehicles')[0]!.version).toBe('2');expect(decode(value,'conversion_links').find(row=>row.vehicle_id!==null)!.target_version).toBe('1');
 expect(reconstructed(value)).toEqual(JSON.parse(f.value().crm));
});
it('retains full exclusive paging and an explicit terminal empty page for an exact multiple of twenty rows',()=>{
 const f=businessSourceFixture(),existing=f.rows.customers![0]!;
 f.rows.customers=Array.from({length:40},(_,i)=>({...existing,id:i===39?existing.id:'00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0')}));f.refresh();
 const value=format(f),rebuilt=reconstructed(value);expect(rebuilt.pages.customers).toHaveLength(3);expect(JSON.parse(rebuilt.pages.customers![2]!).customers).toEqual([]);
 expect(decode(value,'customers')).toEqual(f.rows.customers);expect(rebuilt).toEqual(JSON.parse(f.value().crm));
});
it('includes every header, dictionary and original empty source page for an empty CRM snapshot',()=>{
 const f=businessSourceFixture();for(const [name]of sourceFixtureInventory)f.rows[name]=[];f.refresh();const value=format(f);
 for(const [,,,entity]of sourceFixtureInventory)expect(decode(value,entity)).toEqual([]);
 expect(reconstructed(value)).toEqual(JSON.parse(f.value().crm));expect(JSON.parse(value.manifest).crmRecordCount).toBe(0);
});
it.each(['\\N',"'Original",'=SUM(A1)',' +1','\t-1','\n@SUM(A1)','\ufeff=1',' É 😀 ",\r\n\\N '])('reverses formula/literal escapes in the customer source %j',text=>{
 const f=businessSourceFixture();f.rows.customers![0]!.notes=text;f.refresh();expect(decode(format(f),'customers')[0]!.notes).toBe(text);
});
it('binds exact file lengths/hashes/media types, declared release/schema and honest incomplete scope in one immutable private handoff',()=>{
 const f=businessSourceFixture(),sealed=formatBusinessSourceBundle(f.seal(),f.expected),value=sealed.forServer(),manifest=JSON.parse(value.manifest);
 expect(()=>JSON.stringify(sealed)).toThrow(error);for(const item of [sealed,value,value.parts,...value.parts])expect(Object.isFrozen(item)).toBe(true);
 expect(manifest).toMatchObject({formatVersion:1,profile:'crest.business-source-bundle.v1',appReleaseId:f.expected.appReleaseId,sourceSchemaVersion:42,generationId:f.foundation.collection.generationId,businessId:f.businessId,observedAt:f.foundation.identity.stamp,assurance:'internal_consistency_only',consistentCaptureProven:false,includedCrmReferencesVerified:true,referenceClosureComplete:false,completePortableExport:false,completeBackup:false,evidenceBytes:f.value().evidenceBytes,recordCount:f.value().recordCount});
 expect(value.parts).toHaveLength(94);expect(new Set(value.parts.map(p=>p.name)).size).toBe(value.parts.length);
 for(const [index,p]of value.parts.entries()){
  expect(p.bytes).toBe(Buffer.byteLength(p.content));expect(p.bytes).toBeLessThanOrEqual(8*1024*1024);expect(p.sha256).toBe(createHash('sha256').update(p.content).digest('hex'));
  expect(manifest.parts[index]).toEqual({name:p.name,contentType:p.contentType,bytes:p.bytes,sha256:p.sha256});
 }
 expect(format(f)).toEqual(value);
});
it('hands every composed file and the separate manifest to the actual encrypted codec with exact bytes and bindings',async()=>{
 const f=businessSourceFixture(),value=format(f),codec=await createExportPartCodec('synthetic',[{id:'synthetic',key:randomBytes(32)}]);
 const fixed={businessId:f.businessId,actorId:f.foundation.identity.owner,exportJobId:randomUUID(),generationId:f.foundation.collection.generationId,recoveryEpoch:randomUUID()};
 for(const p of [...value.parts,{name:'source_manifest.json',contentType:'application/json' as const,content:value.manifest}]){
  const bytes=Buffer.from(p.content),binding={...fixed,partId:randomUUID(),fileName:p.name,contentType:p.contentType},encrypted=await codec.encrypt(bytes,binding,new AbortController().signal),opened=await codec.decrypt(encrypted,binding,new AbortController().signal);
  try{expect(opened.metadataForServer()).toEqual({binding,byteSize:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});expect(Buffer.compare(Buffer.from(opened.forServer().bytes),bytes)).toBe(0);}finally{opened.dispose();}
 }
});
it('formats an actual full8MiB combined evidence capture and rejects one extra source byte without truncation',()=>{
 const f=businessSourceFixture();let remaining=8*1024*1024-f.value().evidenceBytes;
 for(const name of Object.keys(f.contexts)){const bytes=Math.min(remaining,1048576-Buffer.byteLength(f.contexts[name]!));f.contexts[name]+=' '.repeat(bytes);remaining-=bytes;}
 expect(remaining).toBe(0);const original=f.value();expect(original.evidenceBytes).toBe(8*1024*1024);
 const value=format(f);expect(reconstructed(value)).toEqual(JSON.parse(original.crm));expect(JSON.parse(value.manifest).evidenceBytes).toBe(8*1024*1024);
 const available=Object.keys(f.contexts).find(name=>Buffer.byteLength(f.contexts[name]!)<1048576)!;f.contexts[available]+=' ';expect(()=>format(f)).toThrow(error);
});
it('exposes only a redacted fixed error when a malformed late source contains private text',()=>{
 const f=businessSourceFixture(),value={...f.value()},crm=JSON.parse(value.crm);crm.pages.links[0]='{PRIVATE SENTINEL';value.crm=JSON.stringify(crm);
 try{formatBusinessSourceBundle({forServer:()=>value,toJSON:()=>{throw Error();}},f.expected);throw Error('accepted');}catch(e){expect((e as Error).message).toBe(error);expect((e as Error).cause).toBeUndefined();expect(String(e)).not.toContain('PRIVATE SENTINEL');}
});
it('rejects aggregate serialized padding before decoding individually bounded source collections',()=>{
 const f=businessSourceFixture(),value={...f.value()};for(const name of ['configuration','identity','history','crm'] as const)value[name]=value[name].padEnd(16*1024*1024+1,' ');
 expect(()=>formatBusinessSourceBundle({forServer:()=>value,toJSON:()=>{throw Error();}},f.expected)).toThrow(error);
});
it.each(['business','release','schema','capture-generation','capture-time','capture-bytes','capture-count','capture-extra','complete-claim','crm-generation','crm-time','crm-bytes','crm-count','crm-extra','crm-malformed','crm-oversized','foundation-drift'])('rejects %s capture or release metadata without returning partial files',issue=>{
 const f=businessSourceFixture(),value={...f.value()},expected={...f.expected},crm=JSON.parse(value.crm);
 if(issue==='business')expected.businessId=randomUUID();if(issue==='release')expected.appReleaseId='PRIVATE SENTINEL';if(issue==='schema')Object.assign(expected,{sourceSchemaVersion:41});
 if(issue==='capture-generation')value.generationId=randomUUID();if(issue==='capture-time')value.observedAt='2026-10-24T07:00:00.123457+00:00';
 if(issue==='capture-bytes')value.evidenceBytes++;if(issue==='capture-count')value.recordCount++;if(issue==='capture-extra')Object.assign(value,{token_hash:'PRIVATE SENTINEL'});if(issue==='complete-claim')Object.assign(value,{completePortableExport:true});
 if(issue==='crm-generation')crm.generationId=randomUUID();if(issue==='crm-time')crm.observedAt='2026-10-24T07:00:00.123457+00:00';if(issue==='crm-bytes')crm.evidenceBytes++;if(issue==='crm-count')crm.recordCount++;if(issue==='crm-extra')crm.secret='PRIVATE SENTINEL';
 value.crm=JSON.stringify(crm);if(issue==='crm-malformed')value.crm='{PRIVATE SENTINEL';if(issue==='crm-oversized')value.crm+=' '.repeat(64*1024*1024);
 if(issue==='foundation-drift'){const c=JSON.parse(value.configuration);c.records[0].evidenceHash='0'.repeat(64);value.configuration=JSON.stringify(c);}
 expect(()=>formatBusinessSourceBundle({forServer:()=>value,toJSON:()=>{throw Error();}},expected)).toThrow(error);
});
it.each(['context-scope','context-number','context-token','context-business','context-missing','context-extra','context-count','context-duplicate-key','page-token','page-business','page-extra','page-missing-row','page-duplicate','page-reversed','page-unsafe-number','page-duplicate-key','page-unicode','page-oversized','page-missing-terminal','page-after-terminal','invalid-row','row-credential','foreign-row'])('rejects %s source before any complete bundle is returned',issue=>{
 const f=businessSourceFixture(),context=JSON.parse(f.contexts.customers!),page=JSON.parse(f.pages.customers![0]!);
 if(issue==='context-scope')context.scope='lead_directory';if(issue==='context-number')context.rowCount=1;if(issue==='context-token')context.snapshotToken='f'.repeat(64);if(issue==='context-business')context.businessId=randomUUID();if(issue==='context-count')context.rowCount='1001';if(issue==='context-extra')context.token_hash='PRIVATE SENTINEL';
 f.contexts.customers=JSON.stringify(context);if(issue==='context-missing')delete f.contexts.customers;if(issue==='context-duplicate-key')f.contexts.customers=f.contexts.customers!.replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1');
 if(issue==='page-token')page.snapshotToken='f'.repeat(64);if(issue==='page-business')page.businessId=randomUUID();if(issue==='page-extra')page.token_hash='PRIVATE SENTINEL';if(issue==='page-missing-row')page.customers=[];
 if(issue==='page-duplicate')page.customers.push({...page.customers[0]});if(issue==='page-reversed')page.customers.unshift({...page.customers[0],id:'ffffffff-ffff-4fff-8fff-ffffffffffff'});
 if(issue==='invalid-row')page.customers[0].version=9007199254740992;if(issue==='row-credential')page.customers[0].token_hash='PRIVATE SENTINEL';if(issue==='foreign-row')page.customers[0].business_id=randomUUID();if(issue==='page-unicode')page.customers[0].notes='\ud800';
 f.pages.customers=[JSON.stringify(page)];if(issue==='page-unsafe-number')f.pages.customers[0]=f.pages.customers[0]!.replace('"schemaVersion":1','"schemaVersion":9007199254740993');if(issue==='page-duplicate-key')f.pages.customers[0]=f.pages.customers[0]!.replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1');
 if(issue==='page-oversized')f.pages.customers[0]+=' '.repeat(1048576);
 if(issue==='page-missing-terminal'){f.rows.customers=Array.from({length:20},(_,i)=>({...f.rows.customers![0],id:'00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0')}));f.refresh();f.pages.customers!.pop();}
 if(issue==='page-after-terminal')f.pages.customers!.push(JSON.stringify({...page,customers:[]}));
 // Envelope counters are computed from the deliberately changed raw sources;
 // failures must survive otherwise honest byte/count metadata.
 expect(()=>format(f)).toThrow(error);
});
it.each(['address-customer','association-vehicle','lead-source','event-lead','lead-vehicle','lead-address','conversion-customer','missing-link','address-ownership','vehicle-source-lead'])('rejects broken %s references despite honest source counts and hashes',issue=>{
 const f=businessSourceFixture(),r=f.rows;
 if(issue==='address-customer')r.addresses![0]!.customer_id=randomUUID();if(issue==='association-vehicle')r.associations![0]!.vehicle_id=randomUUID();if(issue==='lead-source')r.leadSources=[];if(issue==='event-lead')r.leadEvents![0]!.lead_id=randomUUID();if(issue==='lead-vehicle')r.leadVehicles![0]!.vehicle_id=randomUUID();if(issue==='lead-address')r.leadAddresses![0]!.lead_id=randomUUID();if(issue==='conversion-customer')r.customers=[];if(issue==='missing-link')r.links!.pop();
 if(issue==='address-ownership'){const other={...r.customers![0],id:randomUUID()};r.customers!.push(other);r.addresses![0]!.customer_id=other.id;}
 if(issue==='vehicle-source-lead'){const other={...r.leads![0],id:randomUUID()};r.leads!.push(other);r.leadVehicles![0]!.lead_id=other.id;}
 f.refresh();expect(()=>format(f)).toThrow(error);
});
