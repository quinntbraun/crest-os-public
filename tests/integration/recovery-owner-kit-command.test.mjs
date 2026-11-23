import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,readFile,readdir,mkdir,rm,chmod,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {recoveryConfigurationFixture} from '../support/recovery-configuration-fixture.ts';
import {prepareRecoveryConfiguration} from '../../src/tooling/recovery-configuration.ts';
const command=fileURLToPath(new URL('../../scripts/recovery-owner-kit.mjs',import.meta.url)),hash=value=>createHash('sha256').update(value).digest('hex'),error='RECOVERY_OFFLINE_MATERIAL_REVIEW_REQUIRED\n';
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'crest-owner-kit-command-')),original=recoveryConfigurationFixture(),parent=join(directory,'output');await mkdir(parent,{mode:0o700});const files=new Map(),entries=original.recipe.references.map(ref=>{
  const bytes=Buffer.from(ref.kind==='secret'?original.material.get(ref.referenceId):'Synthetic private file '+ref.referenceId+'\n');if(ref.kind==='file')files.set(ref.referenceId,bytes);
  return{referenceId:ref.referenceId,kind:ref.kind,value:bytes.toString(ref.kind==='file'?'base64':'utf8'),byteSize:bytes.length,sha256:hash(bytes)};
 }),material=JSON.stringify({profile:'crest.offline-material.v1',binding:original.target,recipeSha256:hash(original.source),entries}),recipeFile=join(directory,'recipe.json'),materialFile=join(directory,'material.json'),requestFile=join(directory,'request.json');await writeFile(recipeFile,original.source,{flag:'wx',mode:0o600});await writeFile(materialFile,material,{flag:'wx',mode:0o600});const request={schemaVersion:1,expected:original.target,recipeFile,materialFile,plaintext:{byteSize:Buffer.byteLength(material),sha256:hash(material)},parent};
 async function run(value=request,args){await writeFile(requestFile,JSON.stringify(value),{mode:0o600});return spawnSync(process.execPath,['--conditions=react-server',command,...args??['materialize',requestFile]],{encoding:'utf8',timeout:30000,maxBuffer:65536,env:{PATH:process.env.PATH,NODE_ENV:'test'},windowsHide:true});}
 return{directory,original,parent,files,request,requestFile,recipeFile,run,close:()=>rm(directory,{recursive:true,force:true})};
}
test('actual owner-kit CLI rebuilds private files and profile with metadata-only output',async()=>{
 const f=await fixture();try{
  const result=await f.run();assert.equal(result.status,0);assert.equal(result.stderr,'');const proof=JSON.parse(result.stdout);assert.equal(proof.fileCount,f.files.size);assert.equal(proof.applicationStarted,false);assert.equal(proof.completeBackup,false);const profile=JSON.parse(await readFile(proof.profilePath,'utf8'));
  for(const ref of f.original.references){let actual=profile;for(const name of ref.path.slice(1).split('/'))actual=actual[name];if(ref.kind==='secret'){assert.equal(actual,f.original.material.get(ref.referenceId));assert(!result.stdout.includes(actual));}else assert.deepEqual(await readFile(actual),f.files.get(ref.referenceId));}
  assert.deepEqual(await readdir(f.parent),[join(proof.profilePath,'..').split(/[\\/]/).at(-1)]);
 }finally{await f.close();}
});
test('actual CLI rejects malformed requests and mismatched kit identity without exposing supplied fields or creating output',async()=>{
 const f=await fixture();try{
  for(const request of [{...f.request,plaintext:{...f.request.plaintext,sha256:'0'.repeat(64)}},{...f.request,password:'sensitive-request-value'},{...f.request,schemaVersion:2},{...f.request,recipeFile:'relative-recipe.json'}]){
   const result=await f.run(request);assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,error);assert.deepEqual(await readdir(f.parent),[]);
  }
  const result=await f.run(f.request,['unknown',f.requestFile]);assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,error);
 }finally{await f.close();}
});
test('Linux CLI refuses publicly readable request or recipe files and symlinked input',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  await writeFile(f.requestFile,JSON.stringify(f.request),{mode:0o600});await chmod(f.requestFile,0o644);let result=await f.run();assert.equal(result.status,1);assert.equal(result.stderr,error);await chmod(f.requestFile,0o600);
  await chmod(f.recipeFile,0o644);result=await f.run();assert.equal(result.status,1);assert.equal(result.stderr,error);await chmod(f.recipeFile,0o600);
  const link=join(f.directory,'recipe-link.json');await symlink(f.recipeFile,link);result=await f.run({...f.request,recipeFile:link});assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,error);assert.deepEqual(await readdir(f.parent),[]);
 }finally{await f.close();}
});

test('Linux capture and rebuild commands round-trip a real age-encrypted owner kit',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  const tools=process.env.CREST_OWNER_KIT_TEST_AGE_DIR??fileURLToPath(new URL('../../.local/tools/recovery/age/',import.meta.url)),age=join(tools,'age'),keygen=join(tools,'age-keygen'),key=join(f.directory,'identity.txt'),env={PATH:process.env.PATH};
  let tool=spawnSync(keygen,['--output',key],{encoding:'utf8',env,timeout:10000});assert.equal(tool.status,0);await chmod(key,0o600);tool=spawnSync(keygen,['-y',key],{encoding:'utf8',env,timeout:10000});assert.equal(tool.status,0);const recipient=tool.stdout.trim();assert.match(recipient,/^age1[a-z0-9]{58}$/);
  for(const ref of f.original.references.filter(item=>item.kind==='file')){
   const path=join(f.directory,ref.referenceId);await writeFile(path,f.files.get(ref.referenceId),{flag:'wx',mode:0o600});let parent=f.original.profile;const names=ref.path.slice(1).split('/');for(const name of names.slice(0,-1))parent=parent[name];parent[names.at(-1)]=path;
  }
  const profileSource=JSON.stringify(f.original.profile),recipe=prepareRecoveryConfiguration({profileSource,binding:f.original.target,references:f.original.references}).forRecoveryTools(),profileFile=join(f.directory,'profile.json');await writeFile(profileFile,profileSource,{flag:'wx',mode:0o600});await writeFile(f.recipeFile,JSON.stringify(recipe),{mode:0o600});
  const capture=await f.run({schemaVersion:1,expected:f.original.target,recipeFile:f.recipeFile,profileFile,workspace:f.directory,recipient,tools:{age}},['capture',f.requestFile]);assert.equal(capture.status,0);assert.equal(capture.stderr,'');const descriptor=JSON.parse(capture.stdout),ciphertext=await readFile(descriptor.path);assert.equal(hash(ciphertext),descriptor.ciphertext.sha256);assert.equal(ciphertext.length,descriptor.ciphertext.byteSize);assert.equal(descriptor.applicationStarted,false);assert.equal(descriptor.referenceCount,31);
  const decrypted=spawnSync(age,['--decrypt','--identity',key,descriptor.path],{env,timeout:10000,maxBuffer:8388608});assert.equal(decrypted.status,0);const plain=decrypted.stdout;try{
   assert.equal(hash(plain),descriptor.plaintext.sha256);assert.equal(plain.length,descriptor.plaintext.byteSize);await writeFile(f.request.materialFile,plain,{mode:0o600});
   const rebuilt=await f.run({...f.request,plaintext:descriptor.plaintext});assert.equal(rebuilt.status,0);assert.equal(rebuilt.stderr,'');const proof=JSON.parse(rebuilt.stdout);assert.equal(proof.platformDirectoryFlush,true);assert.equal(proof.applicationStarted,false);assert.equal(proof.completeBackup,false);const profile=JSON.parse(await readFile(proof.profilePath,'utf8'));
   for(const ref of f.original.references){let actual=profile,original=f.original.profile;for(const name of ref.path.slice(1).split('/')){actual=actual[name];original=original[name];}if(ref.kind==='secret'){assert.equal(actual,original);assert(!capture.stdout.includes(actual));assert(!rebuilt.stdout.includes(actual));assert(!ciphertext.includes(Buffer.from(actual)));}else assert.deepEqual(await readFile(actual),f.files.get(ref.referenceId));}
  }finally{plain.fill(0);}
 }finally{await f.close();}
});
