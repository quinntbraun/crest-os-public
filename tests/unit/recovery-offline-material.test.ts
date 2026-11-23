import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {mkdtemp,readFile,readdir,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {recoveryConfigurationFixture} from '../support/recovery-configuration-fixture.ts';
import {prepareRecoveryConfiguration} from '../../src/tooling/recovery-configuration.ts';
import {readRecoveryOfflineMaterial,materializeRecoveryOfflineConfiguration,createRecoveryOfflineMaterialCapture} from '../../src/tooling/recovery-offline-material.ts';
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex'),signal=()=>new AbortController().signal,error='RECOVERY_OFFLINE_MATERIAL_REVIEW_REQUIRED';
function fixture(){
 const original=recoveryConfigurationFixture(),files=new Map<string,Buffer>(),entries=original.recipe.references.map(ref=>{
  const bytes=Buffer.from(ref.kind==='secret'?original.material.get(ref.referenceId)!:'Synthetic private certificate fixture '+ref.referenceId+'\n');
  if(ref.kind==='file')files.set(ref.referenceId,bytes);
  return{referenceId:ref.referenceId,kind:ref.kind,value:bytes.toString(ref.kind==='file'?'base64':'utf8'),byteSize:bytes.length,sha256:hash(bytes)};
 }),envelope={profile:'crest.offline-material.v1',binding:original.target,recipeSha256:hash(original.source),entries},source=JSON.stringify(envelope),input={source,plaintext:{byteSize:Buffer.byteLength(source),sha256:hash(source)},recipeSource:original.source,expected:original.target};
 return{...original,files,envelope,input};
}
it('reconstructs every exact secret and original file into a fresh private configuration without starting it',async()=>{
 const f=fixture(),parent=await mkdtemp(join(tmpdir(),'crest-offline-'));try{
  const material=readRecoveryOfflineMaterial(f.input);expect(()=>JSON.stringify(material)).toThrow(error);const result=await materializeRecoveryOfflineConfiguration({material,recipeSource:f.source,expected:f.target,parent},signal());expect(()=>JSON.stringify(result)).toThrow(error);
  const proof=result.forRecoveryTools(),profile=JSON.parse(await readFile(proof.profilePath,'utf8'));expect(proof.fileCount).toBe(f.files.size);expect(proof.applicationStarted).toBe(false);expect(proof.completeBackup).toBe(false);expect(proof.certificateValidityVerified).toBe(false);
  for(const ref of f.references){let value:unknown=profile;for(const key of ref.path.slice(1).split('/'))value=(value as Record<string,unknown>)[key];if(ref.kind==='secret')expect(value).toBe(f.material.get(ref.referenceId));else{expect(value).not.toBe(f.material.get(ref.referenceId));expect(await readFile(value as string)).toEqual(f.files.get(ref.referenceId));if(process.platform==='linux')expect((await lstat(value as string)).mode&0o077).toBe(0);}}
  const second=await materializeRecoveryOfflineConfiguration({material,recipeSource:f.source,expected:f.target,parent},signal());expect(second.forRecoveryTools().profilePath).not.toBe(proof.profilePath);expect((await readdir(parent)).length).toBe(2);
 }finally{await rm(parent,{recursive:true,force:true});}
});
it('rejects a wrong whole-kit digest, foreign directory, mixed recipe and duplicate JSON',()=>{
 const f=fixture();expect(()=>readRecoveryOfflineMaterial({...f.input,plaintext:{...f.input.plaintext,sha256:'0'.repeat(64)}})).toThrow(error);
 for(const source of [JSON.stringify({...f.envelope,binding:{...f.target,referenceDirectoryId:randomUUID()}}),JSON.stringify({...f.envelope,recipeSha256:'0'.repeat(64)}),f.input.source.replace('"profile":','"profile":"duplicate","profile":')])expect(()=>readRecoveryOfflineMaterial({...f.input,source,plaintext:{byteSize:Buffer.byteLength(source),sha256:hash(source)}})).toThrow(error);
});
it('rejects missing, reordered, extra and corrupted material even with a recomputed outer digest',()=>{
 const f=fixture(),first=f.envelope.entries[0]!;
 for(const entries of [f.envelope.entries.slice(1),[...f.envelope.entries].reverse(),[...f.envelope.entries,first],f.envelope.entries.map((entry,index)=>index===0?{...entry,value:'wrong',byteSize:5,sha256:hash('wrong')}:entry),f.envelope.entries.map(entry=>entry.kind==='file'?{...entry,value:entry.value+'='}:entry)]){
  const source=JSON.stringify({...f.envelope,entries});expect(()=>readRecoveryOfflineMaterial({...f.input,source,plaintext:{byteSize:Buffer.byteLength(source),sha256:hash(source)}})).toThrow(error);
 }
});
it('refuses copied capabilities, foreign recipes and cancellation before creating destination files',async()=>{
 const f=fixture(),material=readRecoveryOfflineMaterial(f.input),parent=await mkdtemp(join(tmpdir(),'crest-offline-'));try{
  await expect(materializeRecoveryOfflineConfiguration({material:{...material},recipeSource:f.source,expected:f.target,parent},signal())).rejects.toThrow(error);
  await expect(materializeRecoveryOfflineConfiguration({material,recipeSource:f.source+' ',expected:f.target,parent},signal())).rejects.toThrow(error);
  const controller=new AbortController();controller.abort();await expect(materializeRecoveryOfflineConfiguration({material,recipeSource:f.source,expected:f.target,parent},controller.signal)).rejects.toThrow(error);expect(await readdir(parent)).toEqual([]);
 }finally{await rm(parent,{recursive:true,force:true});}
});
it('missing files and a mismatched original profile refuse before launching encryption',async()=>{
 const f=fixture(),launch=vi.fn(),capture=createRecoveryOfflineMaterialCapture(launch),parent=await mkdtemp(join(tmpdir(),'crest-offline-missing-'));try{
  // Never consult an operator's real file paths, even in a missing-file test.
  for(const ref of f.references.filter(item=>item.kind==='file')){let value:Record<string,unknown>=f.profile;const names=ref.path.slice(1).split('/');for(const name of names.slice(0,-1))value=value[name] as Record<string,unknown>;value[names.at(-1)!]=join(parent,ref.referenceId);}
  const profileSource=JSON.stringify(f.profile),recipeSource=JSON.stringify(prepareRecoveryConfiguration({profileSource,binding:f.target,references:f.references}).forRecoveryTools()),input={recipeSource,expected:f.target,profileSource,workspace:parent,recipient:'invalid'};
  await expect(capture(input,signal())).rejects.toThrow(error);await expect(capture({...input,profileSource:JSON.stringify({...f.profile,origin:'https://different.example.com'})},signal())).rejects.toThrow(error);expect(launch).not.toHaveBeenCalled();expect(await readdir(parent)).toEqual([]);
 }finally{await rm(parent,{recursive:true,force:true});}
});
