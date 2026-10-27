import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {formatSourceLogicalFiles} from '../../src/security/source-export-logical-files.ts';
import {verifySourceLogicalFiles} from '../../src/tooling/verify-source-logical-files.ts';
import {createExportPartCodec} from '../../src/security/export-part-crypto.ts';
const expected={businessId:randomUUID(),generationId:randomUUID(),appReleaseId:'a'.repeat(40),sourceSchemaVersion:43 as const},size=4194304;
const source=()=>[{name:'journal_capture.json',contentType:'application/json' as const,content:' {"original":9007199254740993,"text":"é😀é\\\\N"}\r\n'}, {name:'journal_jobs.csv',contentType:'text/csv; charset=utf-8' as const,content:'"version","original"\r\n"9007199254740993","=SUM(A1)"\r\n'}];
const format=()=>formatSourceLogicalFiles(source(),expected).forLogicalFiles(),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
it('independently reconstructs every exact logical file and exposes no implicit private serialization or worker accessor',()=>{
 const input=source(),wrapped=formatSourceLogicalFiles(input,expected),out=wrapped.forLogicalFiles(),checked=verifySourceLogicalFiles(out.manifest,out.parts,expected);
 expect(checked.files.map(({name,contentType,content})=>({name,contentType,content}))).toEqual(input);expect(checked).toMatchObject({assurance:'byte_consistency_only',completePortableExport:false,completeBackup:false});expect(wrapped).not.toHaveProperty('forServer');expect(()=>JSON.stringify(wrapped)).toThrow('SOURCE_LOGICAL_FILES_REVIEW_REQUIRED');expect(Object.isFrozen(out)).toBe(true);expect(Object.isFrozen(out.parts)).toBe(true);expect(Object.isFrozen(checked.files)).toBe(true);
});
it('splits a genuine12MiB-sized original into bounded physical text without rewriting its whitespace or numbers',()=>{
 const content=' '.repeat(12582911)+'x',input=[{name:'journal_original.txt',contentType:'text/plain; charset=utf-8' as const,content}],out=formatSourceLogicalFiles(input,expected).forLogicalFiles();expect(out.parts).toHaveLength(3);expect(out.parts.every(p=>p.bytes===size)).toBe(true);expect(verifySourceLogicalFiles(out.manifest,out.parts,expected).files[0]!.content).toBe(content);
});
it('never breaks a multibyte code point at a physical boundary or normalizes combining characters',()=>{
 const content='x'.repeat(size-1)+'😀éé\r\n',out=formatSourceLogicalFiles([{name:'journal_original.txt',contentType:'text/plain; charset=utf-8',content}],expected).forLogicalFiles();expect(out.parts).toHaveLength(2);expect(out.parts[0]!.bytes).toBe(size-1);expect(out.parts[1]!.content).toBe('😀éé\r\n');expect(verifySourceLogicalFiles(out.manifest,out.parts,expected).files[0]!.content).toBe(content);
});
it('handles the32MiB logical-file ceiling without increasing existing physical crypto bounds',()=>{
 const content='x'+'😀'.repeat(8388607)+'xyz',out=formatSourceLogicalFiles([{name:'journal_original.txt',contentType:'text/plain; charset=utf-8',content}],expected).forLogicalFiles();expect(Buffer.byteLength(content)).toBe(33554432);expect(out.parts).toHaveLength(9);expect(out.parts.every(p=>p.bytes<=size)).toBe(true);expect(out.parts.at(-1)!.content).toBe('xyz');expect(verifySourceLogicalFiles(out.manifest,out.parts,expected).files[0]!.sha256).toBe(hash(content));
});
it.each(['invalid-name','path','duplicate-name','unsupported-type','empty-content','NUL','surrogate','extra-field','over-file','over-files','over-total','schema42'])('refuses %s without publishing a partial bundle',issue=>{
 const input:Record<string,unknown>[]=source(),binding={...expected};if(issue==='invalid-name')input[0]!.name='Journal.json';if(issue==='path')input[0]!.name='../journal.json';if(issue==='duplicate-name')input[1]!.name=input[0]!.name;if(issue==='unsupported-type')input[0]!.contentType='text/html';if(issue==='empty-content')input[0]!.content='';if(issue==='NUL')input[0]!.content='x\0';if(issue==='surrogate')input[0]!.content='\ud800';if(issue==='extra-field')input[0]!.extra=true;if(issue==='over-file')input[0]!.content='x'.repeat(33554433);if(issue==='over-files')input.push(...Array.from({length:1023},(_,i)=>({name:'source_'+i+'.txt',contentType:'text/plain; charset=utf-8',content:'x'})));if(issue==='over-total'){const text='x'.repeat(33554432);input[0]!.content=text;input[1]!.content=text;}if(issue==='schema42')Object.assign(binding,{sourceSchemaVersion:42});
 expect(()=>formatSourceLogicalFiles(input as unknown as ReturnType<typeof source>,binding)).toThrow('SOURCE_LOGICAL_FILES_REVIEW_REQUIRED');
});
it.each(['missing-part','extra-part','duplicate-part','changed-content','changed-byte-count','changed-hash','offset','order','file-hash','file-length','total','generation','business','release','schema42','complete-claim','duplicate-json-key','extra-descriptor','truncated-file','wrong-type'])('independent reader rejects %s and releases no partial files',issue=>{
 const out=format(),parts=out.parts.map(p=>({...p})),m=JSON.parse(out.manifest);if(issue==='missing-part')parts.pop();if(issue==='extra-part')parts.push({...parts[0]!,name:'unlisted.txt'});if(issue==='duplicate-part')parts.push({...parts[0]!});if(issue==='changed-content')parts[0]!.content+='x';if(issue==='changed-byte-count')parts[0]!.bytes++;if(issue==='changed-hash')parts[0]!.sha256='0'.repeat(64);if(issue==='offset')m.files[0].parts[0].offsetBytes=1;if(issue==='order')m.files.reverse();if(issue==='file-hash')m.files[0].sha256='0'.repeat(64);if(issue==='file-length')m.files[0].bytes++;if(issue==='total')m.totalBytes++;if(issue==='generation')m.generationId=randomUUID();if(issue==='business')m.businessId=randomUUID();if(issue==='release')m.appReleaseId='b'.repeat(40);if(issue==='schema42')m.sourceSchemaVersion=42;if(issue==='complete-claim')m.completeBackup=true;if(issue==='extra-descriptor')m.files[0].extra=true;if(issue==='truncated-file')m.files[0].parts=[];if(issue==='wrong-type')parts[0]!.contentType='application/json' as typeof parts[0]['contentType'];
 let manifest=JSON.stringify(m)+'\n';if(issue==='duplicate-json-key')manifest=manifest.replace('"formatVersion":1','"formatVersion":1,"formatVersion":1');expect(()=>verifySourceLogicalFiles(manifest,parts,expected)).toThrow('SOURCE_LOGICAL_FILE_VERIFICATION_REQUIRED');
});
it('rejects a reordered physical sequence even when included individual parts and descriptors have honest hashes',()=>{
 const content='x'.repeat(size)+'y',out=formatSourceLogicalFiles([{name:'original.txt',contentType:'text/plain; charset=utf-8',content}],expected).forLogicalFiles(),m=JSON.parse(out.manifest);m.files[0].parts.reverse();expect(()=>verifySourceLogicalFiles(JSON.stringify(m)+'\n',out.parts,expected)).toThrow('SOURCE_LOGICAL_FILE_VERIFICATION_REQUIRED');
});
it('does not execute input or physical-part getters',()=>{
 let calls=0;const input=source();Object.defineProperty(input[0],'content',{enumerable:true,get(){calls++;return 'private';}});expect(()=>formatSourceLogicalFiles(input,expected)).toThrow();expect(calls).toBe(0);
 const out=format(),parts=[{...out.parts[0]!,get content(){calls++;return 'private';}},out.parts[1]!];expect(()=>verifySourceLogicalFiles(out.manifest,parts,expected)).toThrow();expect(calls).toBe(0);
});
it('encrypts and independently decrypts every physical part and manifest through the existing bounded JWE codec',async()=>{
 const original='x'.repeat(size-1)+'😀'+String.raw`\N`,out=formatSourceLogicalFiles([{name:'original.txt',contentType:'text/plain; charset=utf-8',content:original}],expected).forLogicalFiles(),codec=await createExportPartCodec('synthetic',[{id:'synthetic',key:randomBytes(32)}]),opened=[];
 const common={businessId:expected.businessId,generationId:expected.generationId,actorId:randomUUID(),exportJobId:randomUUID(),recoveryEpoch:randomUUID()};
 for(const p of [...out.parts,{name:'manifest.json',contentType:'application/json' as const,content:out.manifest}]){const binding={...common,partId:randomUUID(),fileName:p.name,contentType:p.contentType},bytes=Buffer.from(p.content),encrypted=await codec.encrypt(bytes,binding,new AbortController().signal),clear=await codec.decrypt(encrypted,binding,new AbortController().signal);try{expect(clear.forServer().bytes.equals(bytes)).toBe(true);if(p.name!=='manifest.json')opened.push({...p,content:clear.forServer().bytes.toString('utf8')});}finally{clear.dispose();}}
 expect(verifySourceLogicalFiles(out.manifest,opened,expected).files[0]!.content).toBe(original);
});
