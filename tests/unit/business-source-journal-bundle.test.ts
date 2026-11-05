import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {randomUUID,createHash} from 'node:crypto';
import {businessSourceFixture} from '../support/business-source-fixture.ts';
import {journalCollectionFixture} from '../support/journal-collection-fixture.ts';
import {collectJournalSources} from '../../src/security/source-export-journal-collection.ts';
import {formatBusinessSourceJournalBundle} from '../../src/security/business-source-journal-bundle.ts';
import {verifyBusinessSourceJournalBundle} from '../../src/tooling/verify-business-source-journal-bundle.ts';
import {formatBusinessSourceBundle,formatBusinessSourceProjection43} from '../../src/security/business-source-bundle.ts';
import {verifyBusinessSourceBundle} from '../../src/security/business-source-verifier.ts';
import {formatSourceLogicalFiles} from '../../src/security/source-export-logical-files.ts';
import {verifySourceLogicalFiles} from '../../src/tooling/verify-source-logical-files.ts';

const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
async function fixture(text?:string){
 const f=businessSourceFixture(),base=f.value(),j=journalCollectionFixture(f.businessId,base.observedAt,text,'completion'),input={...j.input(),generationId:base.generationId},journal=await collectJournalSources(j.query,()=>{},input);
 const source={...base,sourceSchemaVersion:43 as const,journal:journal.journal,metadataBytes:base.evidenceBytes+journal.metadataBytes,originalBytes:journal.originalBytes,wireBytes:journal.wireBytes,evidenceBytes:[base.configuration,base.identity,base.history,base.crm,journal.journal].reduce((n,s)=>n+Buffer.byteLength(s),0),recordCount:base.recordCount+journal.recordCount};
 const binding={businessId:f.businessId,generationId:base.generationId,appReleaseId:f.expected.appReleaseId,sourceSchemaVersion:43 as const},capture={forJournalServer:()=>source,toJSON():never{throw Error('PRIVATE');}},formatted=await formatBusinessSourceJournalBundle(capture,binding),out=formatted.forJournalBundle();return{f,j,source,binding,capture,formatted,out};
}
it('independently verifies all nineteen source projections and six journal projections under explicit schema43',async()=>{
 const f=await fixture(),v=verifyBusinessSourceJournalBundle(f.out.manifest,f.out.parts,f.binding).forJournalBundleVerification();expect(v.sourceSchemaVersion).toBe(43);expect(Object.keys(v.sourceRows)).toHaveLength(19);expect(Object.keys(v.journalRows)).toHaveLength(6);expect(v.journalRows.completion[0]!.request_text).toBe(f.j.text);expect(v.recordCount).toBe(f.source.recordCount);expect(v.completeBackup).toBe(false);expect(v.consistentCaptureProven).toBe(false);expect(f.out.parts.every(p=>p.bytes<=4194304)).toBe(true);expect(f.formatted).not.toHaveProperty('forServer');expect(()=>JSON.stringify(f.formatted)).toThrow('BUSINESS_SOURCE_JOURNAL_BUNDLE_REVIEW_REQUIRED');
});
it.each(['generation','business','schema','observedAt','recordCount','evidenceBytes','metadataBytes','originalBytes','wireBytes','extra-column'])('refuses inconsistent %s capture before releasing a combined package',async issue=>{
 const f=await fixture(),s={...f.source};if(issue==='generation')s.generationId=randomUUID();if(issue==='business')s.businessId=randomUUID();if(issue==='schema')Object.assign(s,{sourceSchemaVersion:42});if(issue==='observedAt')s.observedAt='2026-10-27T00:00:00.000000Z';if(issue==='recordCount')s.recordCount++;if(issue==='evidenceBytes')s.evidenceBytes++;if(issue==='metadataBytes')s.metadataBytes++;if(issue==='originalBytes')s.originalBytes++;if(issue==='wireBytes')s.wireBytes++;if(issue==='extra-column')Object.assign(s,{unexpected:true});await expect(formatBusinessSourceJournalBundle({...f.capture,forJournalServer:()=>s},f.binding)).rejects.toThrow('BUSINESS_SOURCE_JOURNAL_BUNDLE_REVIEW_REQUIRED');
});
it.each(['root-count','root-metadata','root-original','root-wire','root-evidence','root-time','root-schema','root-complete','root-generation','child-schema42','child-profile42','child-time','journal-generation','extra-logical-file','missing-journal-csv','missing-source-csv'])('independently refuses %s with newly checksummed physical files and manifest bindings',async issue=>{
 const f=await fixture(),files=verifySourceLogicalFiles(f.out.manifest,f.out.parts,f.binding).files.map(({name,contentType,content})=>({name,contentType:contentType as 'application/json'|'text/plain; charset=utf-8'|'text/csv; charset=utf-8',content})),root=files.find(p=>p.name==='source_journal_manifest.json')!,m=JSON.parse(root.content);
 if(issue==='root-count')m.recordCount++;if(issue==='root-metadata')m.metadataBytes++;if(issue==='root-original')m.originalBytes++;if(issue==='root-wire')m.wireBytes++;if(issue==='root-evidence')m.evidenceBytes++;if(issue==='root-time')m.observedAt='2026-10-27T00:00:00.000000Z';if(issue==='root-schema')m.sourceSchemaVersion=42;if(issue==='root-complete')m.completePortableExport=true;if(issue==='root-generation')m.generationId=randomUUID();
 if(issue.startsWith('child-')){const p=files.find(p=>p.name==='source_projection_manifest.json')!,c=JSON.parse(p.content);if(issue==='child-schema42')c.sourceSchemaVersion=42;if(issue==='child-profile42')c.profile='crest.business-source-bundle.v1';if(issue==='child-time')c.observedAt='2026-10-27T00:00:00.000000Z';p.content=JSON.stringify(c)+'\n';m.sourceManifestSha256=sha(p.content);}
 if(issue==='journal-generation'){const p=files.find(p=>p.name==='journal_csv_manifest.json')!,c=JSON.parse(p.content);c.generationId=randomUUID();p.content=JSON.stringify(c)+'\n';m.journalManifestSha256=sha(p.content);}
 if(issue==='extra-logical-file')files.push({name:'unused.json',contentType:'application/json',content:'{}'});if(issue==='missing-journal-csv')files.splice(files.findIndex(p=>p.name==='journal_completion.csv'),1);if(issue==='missing-source-csv')files.splice(files.findIndex(p=>p.name==='crm_customers.csv'),1);
 root.content=JSON.stringify(m)+'\n';const changed=formatSourceLogicalFiles(files,f.binding).forLogicalFiles();expect(()=>verifyBusinessSourceJournalBundle(changed.manifest,changed.parts,f.binding)).toThrow('BUSINESS_SOURCE_JOURNAL_VERIFICATION_REQUIRED');
});
it('retains the closed legacy42 formatter and verifier without silently relabeling a capture',async()=>{
 const f=await fixture(),legacy=formatBusinessSourceBundle(f.f.seal(),f.f.expected).forServer();expect(verifyBusinessSourceBundle({manifest:Buffer.from(legacy.manifest),parts:legacy.parts.map(p=>({name:p.name,bytes:Buffer.from(p.content)}))},f.f.expected).forServer().sourceSchemaVersion).toBe(42);
 expect(()=>formatBusinessSourceProjection43(f.f.value() as Parameters<typeof formatBusinessSourceProjection43>[0],f.binding)).toThrow('BUSINESS_SOURCE_BUNDLE_REVIEW_REQUIRED');expect(()=>formatBusinessSourceBundle(f.f.seal(),f.binding as unknown as typeof f.f.expected)).toThrow('BUSINESS_SOURCE_BUNDLE_REVIEW_REQUIRED');
 const projection=formatBusinessSourceProjection43({...f.f.value(),sourceSchemaVersion:43},f.binding).forProjection43();expect(JSON.parse(projection.manifest).profile).toBe('crest.business-source-projection.v1');expect(()=>verifyBusinessSourceBundle({manifest:Buffer.from(projection.manifest),parts:projection.parts.map(p=>({name:p.name,bytes:Buffer.from(p.content)}))},f.f.expected)).toThrow('SOURCE_EXPORT_REVIEW_REQUIRED');
});
it('reconstructs the maximum12MiB journal original in the same independently verified package',async()=>{
 const text=' '+ 'é'.repeat((12582912-2)/2)+'\n',f=await fixture(text),v=verifyBusinessSourceJournalBundle(f.out.manifest,f.out.parts,f.binding).forJournalBundleVerification();expect(v.journalRows.completion[0]!.request_text).toBe(text);
},20000);
