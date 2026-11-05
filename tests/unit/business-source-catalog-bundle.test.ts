import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createHash,randomUUID} from 'node:crypto';
import {businessSourceFixture} from '../support/business-source-fixture';
import {journalCollectionFixture} from '../support/journal-collection-fixture';
import {serviceStorageFixture} from '../support/service-storage-fixture';
import {collectJournalSources} from '../../src/security/source-export-journal-collection';
import {collectServiceCatalogSources} from '../../src/security/service-catalog-collection';
import {formatBusinessSourceCatalogBundle} from '../../src/security/business-source-catalog-bundle';
import {verifyBusinessSourceCatalogBundle} from '../../src/tooling/verify-business-source-catalog-bundle';
import {verifySourceLogicalFiles} from '../../src/tooling/verify-source-logical-files';
import {formatSourceLogicalFiles} from '../../src/security/source-export-logical-files';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
async function fixture(){
 const f=businessSourceFixture(),base=f.value(),j=journalCollectionFixture(f.businessId,base.observedAt,undefined,'completion'),journal=await collectJournalSources(j.query,()=>{},{...j.input(),generationId:base.generationId});
 const source={...base,sourceSchemaVersion:43 as const,journal:journal.journal,metadataBytes:base.evidenceBytes+journal.metadataBytes,originalBytes:journal.originalBytes,wireBytes:journal.wireBytes,evidenceBytes:[base.configuration,base.identity,base.history,base.crm,journal.journal].reduce((n,s)=>n+Buffer.byteLength(s),0),recordCount:base.recordCount+journal.recordCount};
 const service=serviceStorageFixture(),rows={services:[{...service.service,business_id:f.businessId}],versions:[{...service.content,business_id:f.businessId,inclusions:'=SUM(A1)\nScope, "quoted"',exclusions:'\\N',internal_guidance:"'literal\\slash",range_low_cents:'9007199254740993',range_high_cents:'9223372036854775807',estimated_seconds:'9007199254740993'}]},context={schemaVersion:1,scope:'service_catalog',businessId:f.businessId,snapshotToken:'e'.repeat(64),serviceCount:'1',versionCount:'1'};
 const catalog=await collectServiceCatalogSources(async(sql)=>{const entity=sql.includes('_services(')?'services':'versions';return{rows:[{page:JSON.stringify({schemaVersion:1,businessId:f.businessId,snapshotToken:context.snapshotToken,[entity]:rows[entity]})}]};},()=>{},{rawContext:JSON.stringify(context),businessId:f.businessId,generationId:base.generationId,observedAt:base.observedAt,remainingRecords:10000-source.recordCount,remainingMetadataBytes:8388608-source.metadataBytes});
 const value={formatVersion:1 as const,registeredSourceSchemaVersion:43 as const,catalogRegistered:false as const,source,catalog:catalog.catalog,metadataBytes:source.metadataBytes+catalog.metadataBytes,evidenceBytes:source.evidenceBytes+catalog.serializedBytes,recordCount:source.recordCount+catalog.recordCount,completePortableExport:false as const,completeBackup:false as const},binding={businessId:f.businessId,generationId:base.generationId,appReleaseId:f.expected.appReleaseId,sourceSchemaVersion:43 as const},capture={forCatalogServer:()=>value,toJSON():never{throw new Error('PRIVATE');}};
 const formatted=await formatBusinessSourceCatalogBundle(capture,binding),out=formatted.forCatalogBundle();return{f,source,rows,value,binding,capture,formatted,out};
}
it('independently decodes the complete joint package with exact source originals, catalog values and honest construction status',async()=>{
 const f=await fixture(),v=verifyBusinessSourceCatalogBundle(f.out.manifest,f.out.parts,f.binding).forCatalogBundleVerification();
 expect(v.catalogRows.services).toEqual(f.rows.services);expect(v.catalogRows.versions).toEqual(f.rows.versions);expect(v.originals.catalog).toBe(f.value.catalog);expect(v.originals.journal).toBe(f.source.journal);expect(v.originals.history).toBe(f.source.history);
 expect(v.recordCount).toBe(f.value.recordCount);expect(v.registeredSourceSchemaVersion).toBe(43);expect(v.catalogRegistered).toBe(false);expect(v.completeBackup).toBe(false);expect(v.referenceClosureComplete).toBe(false);
 expect(()=>JSON.stringify(f.formatted)).toThrow('BUSINESS_SOURCE_CATALOG_BUNDLE_REVIEW_REQUIRED');expect(()=>JSON.stringify(verifyBusinessSourceCatalogBundle(f.out.manifest,f.out.parts,f.binding))).toThrow('BUSINESS_SOURCE_CATALOG_VERIFICATION_REQUIRED');
 expect(f.formatted).not.toHaveProperty('forJournalBundle');expect(f.out.parts.every(p=>p.bytes<=4194304)).toBe(true);
});
it.each(['registered','extra','count','metadata','bytes','generation'])('refuses inconsistent %s capture before releasing files',async issue=>{
 const f=await fixture(),value={...f.value};if(issue==='registered')Object.assign(value,{catalogRegistered:true});if(issue==='extra')Object.assign(value,{authority:'bad'});if(issue==='count')value.recordCount++;if(issue==='metadata')value.metadataBytes++;if(issue==='bytes')value.evidenceBytes++;if(issue==='generation'){const c=JSON.parse(value.catalog);c.generationId=randomUUID();value.catalog=JSON.stringify(c);}
 await expect(formatBusinessSourceCatalogBundle({...f.capture,forCatalogServer:()=>value},f.binding)).rejects.toThrow('BUSINESS_SOURCE_CATALOG_BUNDLE_REVIEW_REQUIRED');
});
it.each(['root-count','root-registration','root-complete','root-generation','source-bytes','catalog-count','catalog-value','dictionary','escape','escape-removal','escape-duplicate','csv-value','column-order','missing-file','extra-file','reorder-source'])('independently refuses %s even with freshly checksummed outer files',async issue=>{
 const f=await fixture(),files=verifySourceLogicalFiles(f.out.manifest,f.out.parts,f.binding).files.map(({name,contentType,content})=>({name,contentType:contentType as 'application/json'|'text/csv; charset=utf-8'|'text/plain; charset=utf-8',content})),find=(name:string)=>files.find(p=>p.name===name)!,root=find('source_catalog_manifest.json'),m=JSON.parse(root.content);
 if(issue==='root-count')m.recordCount++;if(issue==='root-registration')m.catalogRegistered=true;if(issue==='root-complete')m.completePortableExport=true;if(issue==='root-generation')m.generationId=randomUUID();
 if(issue==='source-bytes'){const p=find('journal_container_manifest.json'),s=JSON.parse(p.content);s.files[0].bytes++;p.content=JSON.stringify(s)+'\n';m.journalContainerSha256=sha(p.content);}
 if(issue==='catalog-count'||issue==='catalog-value'){const p=find('catalog_capture.json'),c=JSON.parse(p.content);if(issue==='catalog-count')c.recordCount++;else{const page=JSON.parse(c.pages.versions[0]);page.versions[0].name='Different but valid source scope';c.pages.versions[0]=JSON.stringify(page);c.metadataBytes=Buffer.byteLength(c.context)+[...c.pages.services,...c.pages.versions].reduce((n:number,s:string)=>n+Buffer.byteLength(s),0);}p.content=JSON.stringify(c);m.catalogCaptureSha256=sha(p.content);}
 if(['dictionary','escape','escape-removal','escape-duplicate','csv-value','column-order'].includes(issue)){
  const name=issue==='dictionary'?'service_catalog_dictionary.json':['csv-value','column-order'].includes(issue)?'service_versions.csv':'service_catalog_escape_map.json',p=find(name);if(name.endsWith('.csv'))p.content=issue==='csv-value'?p.content.replace('Synthetic interior','Changed scope'):p.content.replace('"id","business_id"','"business_id","id"');else{const c=JSON.parse(p.content);if(issue==='dictionary')c.tables.service_versions.scalarTypes.sequence='number';else if(issue==='escape-removal')c.escapes.shift();else if(issue==='escape-duplicate')c.escapes.push({...c.escapes[0]});else c.escapes.push({entity:'unreviewed',row_id:f.rows.services[0]!.id,column:'name',apostrophe_prefix:true});p.content=JSON.stringify(c)+'\n';}
  const manifest=find('service_catalog_manifest.json'),cm=JSON.parse(manifest.content),part=cm.parts.find((d:{name:string})=>d.name===name);part.bytes=Buffer.byteLength(p.content);part.sha256=sha(p.content);manifest.content=JSON.stringify(cm)+'\n';m.catalogManifestSha256=sha(manifest.content);
 }
 if(issue==='missing-file')files.splice(files.findIndex(p=>p.name==='service_versions.csv'),1);
 if(issue==='extra-file')files.push({name:'unreviewed.json',contentType:'application/json',content:'{}'});
 root.content=JSON.stringify(m)+'\n';if(issue==='reorder-source')[files[0],files[1]]=[files[1]!,files[0]!];
 const damaged=formatSourceLogicalFiles(files,f.binding).forLogicalFiles();expect(()=>verifyBusinessSourceCatalogBundle(damaged.manifest,damaged.parts,f.binding)).toThrow('BUSINESS_SOURCE_CATALOG_VERIFICATION_REQUIRED');
});
