import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {verifyBusinessSourceBundle} from '../../src/security/business-source-verifier.ts';
import {formatBusinessSourceBundle} from '../../src/security/business-source-bundle.ts';
import {businessSourceFixture,sourceFixtureInventory} from '../support/business-source-fixture.ts';
const error='SOURCE_EXPORT_REVIEW_REQUIRED',sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function fixture(){
 const source=businessSourceFixture();source.rows.vehicles![0]!.year=2025;source.refresh();const generated=formatBusinessSourceBundle(source.seal(),source.expected).forServer();
 return {source,input:{manifest:Buffer.from(generated.manifest),parts:generated.parts.map(part=>({name:part.name,bytes:Buffer.from(part.content)}))},generated};
}
type Input=ReturnType<typeof fixture>['input'];
const check=(f:ReturnType<typeof fixture>)=>verifyBusinessSourceBundle(f.input,f.source.expected);
function file(input:Input,name:string){const value=input.parts.find(part=>part.name===name);expect(value).toBeDefined();return value!;}
// Recompute both root and nested checksums. Semantic rejection must survive
// a coherently rehashed malicious file, not just detect an old digest.
function rehash(input:Input){
 for(const p of input.parts.filter(p=>p.name.endsWith('_manifest.json'))){
  const m=JSON.parse(p.bytes.toString());if(!Array.isArray(m.parts))continue;
  for(const d of m.parts){const actual=file(input,d.name);d.bytes=actual.bytes.length;d.sha256=sha(actual.bytes);}p.bytes=Buffer.from(JSON.stringify(m)+'\n');
 }
 const root=JSON.parse(input.manifest.toString());for(const d of root.parts){const actual=file(input,d.name);d.bytes=actual.bytes.length;d.sha256=sha(actual.bytes);}input.manifest=Buffer.from(JSON.stringify(root)+'\n');
}
function alter(input:Input,name:string,change:(value:string)=>string){const p=file(input,name);p.bytes=Buffer.from(change(p.bytes.toString()));rehash(input);}
it('independently decodes all nineteen CSVs and reconstructs the unchanged exact source collections',()=>{
 const f=fixture(),sealed=check(f),value=sealed.forServer(),original=f.source.value();
 for(const [name,,,entity]of sourceFixtureInventory)expect(value.rows[entity]).toEqual(f.source.rows[name]!.slice().sort((a,b)=>(a.id as string)<(b.id as string)?-1:1));
 expect(Object.keys(value.rows)).toHaveLength(19);expect(value.rows.vehicles![0]!.year).toBe(2025);expect(value.rows.actors![1]!.version).toBe('9007199254740995');
 for(const name of ['configuration','identity','history','crm'] as const)expect(JSON.parse(value[name])).toEqual(JSON.parse(original[name]));
 expect(value).toMatchObject({csvSourceRowsVerified:true,rawSourceReconstructionVerified:true,assurance:'internal_consistency_only',referenceClosureComplete:false,completePortableExport:false,completeBackup:false});
 expect(()=>JSON.stringify(sealed)).toThrow(error);for(const item of [sealed,value,value.rows,...Object.values(value.rows),...value.rows.lead_conversions!,value.rows.lead_conversions![0]!.request])expect(Object.isFrozen(item)).toBe(true);
});
it('accepts arbitrary supplied file order while retaining ordered source pages and explicit empty CRM/history collections',()=>{
 const source=businessSourceFixture();for(const [name]of sourceFixtureInventory)source.rows[name]=[];source.refresh();source.foundation.history.collection.records=[];source.foundation.history.collection.context.recordCounts={operation:'0',audit_event:'0'};
 const generated=formatBusinessSourceBundle(source.seal(),source.expected).forServer(),input={manifest:Buffer.from(generated.manifest),parts:generated.parts.map(p=>({name:p.name,bytes:Buffer.from(p.content)})).reverse()};
 const result=verifyBusinessSourceBundle(input,source.expected).forServer();expect(Object.values(result.rows).filter(rows=>rows.length===0)).toHaveLength(13);expect(JSON.parse(result.crm)).toEqual(JSON.parse(source.value().crm));
});
it('reconstructed strings and nested records remain isolated from subsequent caller-buffer changes',()=>{
 const f=fixture(),value=check(f).forServer(),crm=value.crm;for(const p of f.input.parts)p.bytes.fill(0);f.input.manifest.fill(0);expect(value.crm).toBe(crm);expect(value.rows.customers![0]!.version).toBe('9007199254740993');
});
it('independently reconstructs full8MiB source evidence, multiple CRM pages and historical snapshots without Number or Date conversion',()=>{
 const f=businessSourceFixture(),existing=f.rows.customers![0]!;f.rows.customers=Array.from({length:40},(_,i)=>({...existing,id:i===39?existing.id:'00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0')}));
 const oldSource={...f.rows.leadSources![0]};f.rows.leadSources![0]={...oldSource,version:'2',label:'Renamed source',label_normalized:'renamed source'};f.refresh();
 let remaining=8*1024*1024-f.value().evidenceBytes;for(const name of Object.keys(f.contexts)){const size=Math.min(remaining,1048576-Buffer.byteLength(f.contexts[name]!));f.contexts[name]+=' '.repeat(size);remaining-=size;}expect(remaining).toBe(0);
 const output=formatBusinessSourceBundle(f.seal(),f.expected).forServer(),verified=verifyBusinessSourceBundle({manifest:Buffer.from(output.manifest),parts:output.parts.map(p=>({name:p.name,bytes:Buffer.from(p.content)}))},f.expected).forServer();
 expect(JSON.parse(verified.crm)).toEqual(JSON.parse(f.value().crm));expect(verified.rows.customers).toHaveLength(40);expect(verified.rows.leads![0]!.source_snapshot).toEqual(oldSource);expect(verified.rows.lead_sources![0]!.version).toBe('2');expect(verified.rows.addresses![0]!.latitude).toBe('-89.00000000000000000001');
});
it.each(['row value','large version','coordinate','missing column','column order','bad quote','bare LF','lost null','missing escape','extra escape','dictionary columns','dictionary sentinel','dictionary entity','dictionary boolean','dictionary JSON text','child count','foundation page order','source generation','source hash','root count','root complete','root release','root business','root profile','source file order','orphan file'])('rejects rehashed %s corruption without returning a partial reconstruction',issue=>{
 const f=fixture(),input=f.input;
 if(issue==='row value')alter(input,'customers.csv',s=>s.replace('Synthetic customer','Changed customer'));
 if(issue==='large version')alter(input,'customers.csv',s=>s.replace('9007199254740993','9007199254740992'));
 if(issue==='coordinate')alter(input,'addresses.csv',s=>s.replace('-89.00000000000000000001','-89'));
 if(issue==='missing column')alter(input,'customers.csv',s=>s.replace('"notes",','').replace('"\'=Private É 😀\\\\N\ntext",',''));
 if(issue==='column order')alter(input,'customers.csv',s=>s.replace('"id","business_id"','"business_id","id"'));
 if(issue==='bad quote')alter(input,'customers.csv',s=>s.replace('"Synthetic customer"','Synthetic customer'));
 if(issue==='bare LF')alter(input,'customers.csv',s=>s.replaceAll('\r\n','\n'));
 if(issue==='lost null')alter(input,'customers.csv',s=>s.replace('"\\N"','"\\\\N"'));
 if(issue==='missing escape')alter(input,'customer_escape_map.json',s=>{const m=JSON.parse(s);m.escapes=[];return JSON.stringify(m);});
 if(issue==='extra escape')alter(input,'customer_escape_map.json',s=>{const m=JSON.parse(s);m.escapes.push({row_id:f.source.rows.customers![0]!.id,column:'display_name',apostrophe_prefix:true});return JSON.stringify(m);});
 if(issue.startsWith('dictionary')){
  const target=issue==='dictionary boolean'?'memberships_dictionary.json':issue==='dictionary JSON text'?'identity_events_dictionary.json':'customer_dictionary.json';
  alter(input,target,s=>{const m=JSON.parse(s);if(issue==='dictionary columns')m.columns.pop();if(issue==='dictionary sentinel')m.null='';if(issue==='dictionary entity')m.entity='other';if(issue==='dictionary boolean')m.booleanColumns=[];if(issue==='dictionary JSON text')m.jsonTextColumns=[];return JSON.stringify(m);});
 }
 if(issue==='child count')alter(input,'crm_customers_manifest.json',s=>{const m=JSON.parse(s);m.rowCount='0';return JSON.stringify(m);});
 if(issue==='foundation page order')alter(input,'foundation_configuration_source_0001.json',s=>{const m=JSON.parse(s);m.page=2;return JSON.stringify(m);});
 if(issue==='source generation')alter(input,'foundation_identity_source_0001.json',s=>{const m=JSON.parse(s);m.generationId=randomUUID();return JSON.stringify(m);});
 if(issue==='source hash')alter(input,'foundation_history_source_0001.json',s=>{const m=JSON.parse(s);m.records[0].evidenceHash='0'.repeat(64);return JSON.stringify(m);});
 if(issue.startsWith('root')||issue==='source file order'||issue==='orphan file'){
  const root=JSON.parse(input.manifest.toString());if(issue==='root count')root.recordCount++;if(issue==='root complete')root.completePortableExport=true;if(issue==='root release')root.appReleaseId='invalid';if(issue==='root business')root.businessId=randomUUID();if(issue==='root profile')root.profile='other';
  if(issue==='source file order')root.sourceCollections.customers.pages=['crm_customers_page_0002.json'];
  if(issue==='orphan file'){const bytes=Buffer.from('private unused');input.parts.push({name:'unused.txt',bytes});root.parts.push({name:'unused.txt',contentType:'text/plain; charset=utf-8',bytes:bytes.length,sha256:sha(bytes)});}
  input.manifest=Buffer.from(JSON.stringify(root));
 }
 expect(()=>check(f)).toThrow(error);
});
it.each(['missing','duplicate','traversal','reserved','extra field','changed bytes','invalid UTF8','oversized file','oversized manifest','duplicate root key','malformed root','wrong expected business','wrong expected release'])('rejects %s downloaded evidence with one redacted error and no private cause',issue=>{
 const f=fixture(),expected={...f.source.expected};
 if(issue==='missing')f.input.parts.pop();if(issue==='duplicate')f.input.parts.push({...f.input.parts[0]!});if(issue==='traversal')f.input.parts[0]!.name='../private.json';if(issue==='reserved')f.input.parts[0]!.name='source_manifest.json';if(issue==='extra field')Object.assign(f.input.parts[0]!,{token_hash:'PRIVATE SENTINEL'});
 if(issue==='changed bytes')f.input.parts[0]!.bytes[0]=f.input.parts[0]!.bytes[0]!^1;if(issue==='invalid UTF8')f.input.parts[0]!.bytes=Buffer.from([255]);if(issue==='oversized file')f.input.parts[0]!.bytes=Buffer.alloc(8*1024*1024+1);if(issue==='oversized manifest')f.input.manifest=Buffer.alloc(8*1024*1024+1);
 if(issue==='duplicate root key')f.input.manifest=Buffer.from(f.input.manifest.toString().replace('"formatVersion":1','"formatVersion":1,"formatVersion":1'));if(issue==='malformed root')f.input.manifest=Buffer.from('{PRIVATE SENTINEL');if(issue==='wrong expected business')expected.businessId=randomUUID();if(issue==='wrong expected release')expected.appReleaseId='b'.repeat(40);
 try{verifyBusinessSourceBundle(f.input,expected);throw Error('accepted');}catch(e){expect((e as Error).message).toBe(error);expect((e as Error).cause).toBeUndefined();expect(String(e)).not.toContain('PRIVATE SENTINEL');}
});
