import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {randomUUID} from 'node:crypto';
import {collectJournalSources} from '../../src/security/source-export-journal-collection.ts';
import {formatSourceExportJournalCsv} from '../../src/security/source-export-journal-csv.ts';
import {verifyJournalCsv} from '../../src/tooling/verify-journal-csv.ts';
import {journalCollectionFixture,journalDigest as sha} from '../support/journal-collection-fixture.ts';

type File={name:string;contentType:string;content:string;bytes:number;sha256:string};
async function fixture(kind:'snapshot'|'completion'='snapshot',text?:string){
 const f=journalCollectionFixture(undefined,undefined,text,kind),input=f.input(),capture=await collectJournalSources(f.query,()=>{},input),binding={businessId:f.businessId,generationId:input.generationId,appReleaseId:'a'.repeat(40),sourceSchemaVersion:43 as const},out=(await formatSourceExportJournalCsv(capture.journal,binding)).forJournalCsv();
 return {f,binding,files:out.files.map(f=>({...f})) as File[],manifest:out.manifest};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
function edit(f:Fixture,name:string,fn:(s:string)=>string){const file=f.files.find(f=>f.name===name)!;file.content=fn(file.content);file.bytes=Buffer.byteLength(file.content);file.sha256=sha(file.content);const m=JSON.parse(f.manifest);m.files=m.files.map((d:File)=>d.name===name?{name,contentType:file.contentType,bytes:file.bytes,sha256:file.sha256}:d);if(name==='journal_capture.json')m.sourceCaptureSha256=file.sha256;f.manifest=JSON.stringify(m)+'\n';}
function capture(f:Fixture,fn:(j:ReturnType<typeof JSON.parse>)=>void){edit(f,'journal_capture.json',s=>{const j=JSON.parse(s);fn(j);return JSON.stringify(j);});}
it('independently checks six projections and preserves every original request byte and bigint version',async()=>{
 const f=await fixture('completion',' \t{"number":9007199254740993,"formula":"=SUM(A1)","unicode":"é😀é","null":"\\\\N"}\r\n'),verified=verifyJournalCsv(f.manifest,f.files,f.binding),v=verified.forJournalVerification();
 expect(v.rows.completion[0]!.request_text).toBe(f.f.text);expect(v.rows.completion[0]!.expected_version).toBe('9007199254740993');expect(v.recordCount).toBe(1);expect(Object.values(v.rows).reduce((n,rows)=>n+rows.length,0)).toBe(1);
 expect(v.completeBackup).toBe(false);expect(v.referenceClosureComplete).toBe(false);expect(Object.isFrozen(v.rows.completion[0])).toBe(true);expect(()=>JSON.stringify(verified)).toThrow('JOURNAL_CSV_VERIFICATION_REQUIRED');expect(verified).not.toHaveProperty('forServer');
});
it.each(['missing-file','extra-file','duplicate-file','wrong-bytes','wrong-hash','wrong-type','descriptor-duplicate','manifest-profile','manifest-schema','manifest-generation','manifest-complete','dictionary-columns','dictionary-key','dictionary-types','escape-scope','csv-content','capture-count','capture-schema','capture-generation','capture-bytes','capture-original-bytes','capture-wire-bytes','source-evidence-hash','source-scope','source-row-extra','source-row-value','source-key','source-duplicate-key','missing-original','extra-original','changed-chunk','missing-page','extra-page'])('rejects %s without releasing rows, including coherently rehashed substitutions',async issue=>{
 const f=await fixture();
 if(issue==='missing-file')f.files.pop();if(issue==='extra-file')f.files.push({...f.files[0]!,name:'extra.json'});if(issue==='duplicate-file')f.files[1]={...f.files[0]!};if(issue==='wrong-bytes')f.files[0]!.bytes++;if(issue==='wrong-hash')f.files[0]!.sha256='0'.repeat(64);if(issue==='wrong-type')f.files[0]!.contentType='application/json';
 if(issue.startsWith('manifest-')||issue==='descriptor-duplicate'){const m=JSON.parse(f.manifest);if(issue==='manifest-profile')m.profile='crest.business-source-bundle.v1';if(issue==='manifest-schema')m.sourceSchemaVersion=42;if(issue==='manifest-generation')m.generationId=randomUUID();if(issue==='manifest-complete')m.completeBackup=true;if(issue==='descriptor-duplicate')m.files[1]=m.files[0];f.manifest=JSON.stringify(m);}
 if(issue.startsWith('dictionary-'))edit(f,'journal_snapshot_dictionary.json',s=>{const d=JSON.parse(s);if(issue==='dictionary-columns')d.columns.reverse();if(issue==='dictionary-key')d.keyColumns=['business_id'];if(issue==='dictionary-types')d.integerColumns.push('request_text');return JSON.stringify(d);});
 if(issue==='escape-scope')edit(f,'journal_snapshot_escape_map.json',s=>{const d=JSON.parse(s);d.businessId=randomUUID();return JSON.stringify(d);});
 if(issue==='csv-content')edit(f,'journal_snapshot.csv',s=>s.replace('manual','import'));
 if(issue.startsWith('capture-'))capture(f,j=>{if(issue==='capture-count')j.recordCount++;if(issue==='capture-schema')j.sourceSchemaVersion=42;if(issue==='capture-generation')j.generationId=randomUUID();if(issue==='capture-bytes')j.metadataBytes++;if(issue==='capture-original-bytes')j.originalBytes++;if(issue==='capture-wire-bytes')j.wireBytes++;});
 if(issue.startsWith('source-'))capture(f,j=>{const page=JSON.parse(j.pages.snapshot[0]),entry=page[0],body=JSON.parse(entry.canonical_evidence);if(issue==='source-scope')body.businessId=randomUUID();if(issue==='source-row-extra')body.row.unreviewed='new';if(issue==='source-row-value')body.row.origin='import';if(issue==='source-key')body.recordKey=randomUUID();entry.canonical_evidence=JSON.stringify(body);if(issue==='source-duplicate-key')entry.canonical_evidence=entry.canonical_evidence.replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1');entry.evidence_hash=issue==='source-evidence-hash'?'0'.repeat(64):sha(entry.canonical_evidence);j.pages.snapshot[0]=JSON.stringify(page);});
 if(issue==='missing-original')capture(f,j=>{j.originals=[];});if(issue==='extra-original')capture(f,j=>{j.originals.push({...j.originals[0],recordKey:randomUUID()});});if(issue==='changed-chunk')capture(f,j=>{j.originals[0].chunks[0]=j.originals[0].chunks[0].replace('base64','unsafe');});if(issue==='missing-page')capture(f,j=>{j.pages.snapshot=[];});if(issue==='extra-page')capture(f,j=>{j.pages.snapshot.push('[]');});
 expect(()=>verifyJournalCsv(f.manifest,f.files,f.binding)).toThrow('JOURNAL_CSV_VERIFICATION_REQUIRED');
});
it('preserves a genuine maximum12MiB original through the independent reader',async()=>{
 const text=' '+ 'é'.repeat((12582912-2)/2)+'\n',f=await fixture('completion',text),v=verifyJournalCsv(f.manifest,f.files,f.binding).forJournalVerification();expect(Buffer.byteLength(v.rows.completion[0]!.request_text as string)).toBe(12582912);expect(v.rows.completion[0]!.request_text).toBe(text);
},20000);
