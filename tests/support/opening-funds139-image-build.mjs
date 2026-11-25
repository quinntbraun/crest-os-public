// Actual local candidate image build. No application profile or business DB.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,copyFile,chmod,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {workspaceExport140Candidate} from './workspace-export140-candidate.mjs';
import {openingFunds139Candidate} from './opening-funds139-candidate.mjs';
import {recoveryDistributionFixture} from './recovery-distribution-fixture.mjs';
import {privateWorkspace} from './recovery-drill.mjs';
import {hashRecoveryReleaseFile} from '../../src/tooling/recovery-release-files.ts';
import {readRecoveryReleaseManifest} from '../../src/tooling/recovery-release-distribution.ts';
const root=fileURLToPath(new URL('../../',import.meta.url));
export async function buildOpeningFunds139Image(logFile,sourceVersion=139){
 assert([139,140].includes(sourceVersion));
 const workspace=await privateWorkspace(),tag='crest-opening-funds'+sourceVersion+':'+randomUUID(),container='crest-funds'+sourceVersion+'-smoke-'+randomUUID();let launched=false;
 async function docker(args,{timeout=120000,record=false}={}){
  return new Promise((resolve,reject)=>{let stdout='',tail='',bytes=0,aborted=false;const child=spawn('docker',args,{stdio:['ignore','pipe','pipe'],windowsHide:true});const timer=setTimeout(()=>{aborted=true;child.kill('SIGTERM');},timeout);timer.unref();let recording=Promise.resolve();
   child.stdout.on('data',chunk=>{if(!record){bytes+=chunk.length;if(bytes>1048576)child.kill('SIGTERM');else stdout+=chunk;}tail=(tail+chunk).slice(-4096);if(record)recording=recording.then(()=>appendFile(logFile,chunk));});child.stderr.on('data',chunk=>{tail=(tail+chunk).slice(-4096);if(record)recording=recording.then(()=>appendFile(logFile,chunk));});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',async code=>{clearTimeout(timer);try{await recording;if(code!==0||aborted||bytes>1048576)throw Error('CANDIDATE_IMAGE_COMMAND_FAILED:'+args[0]+':'+(aborted?'timeout':code)+'\n'+tail);resolve(stdout.trim());}catch(error){reject(error);}});
  });
 }
 try{
  const candidate=await(sourceVersion===140?workspaceExport140Candidate:openingFunds139Candidate)({root,async prefix(count){assert.equal(count,sourceVersion-1);const directory=join(workspace,'migration-candidate');await mkdir(join(directory,'supabase/migrations'),{recursive:true});const registry=JSON.parse(await readFile(join(root,'supabase/migration-checksums.json'),'utf8'));for(const row of registry.migrations.slice(0,count))await copyFile(join(root,'supabase/migrations',row.file),join(directory,'supabase/migrations',row.file));return directory;}});
  const source=await recoveryDistributionFixture(workspace,candidate);assert.equal(source.manifest.buildIdentity.sourceSchemaVersion,sourceVersion);assert.equal(source.manifest.migrationRegistrySha256,candidate.registrySha256);const iidFile=join(workspace,'image-id.txt');await docker(['build','--pull=false','--progress=plain','--iidfile',iidFile,'--tag',tag,source.sourceRoot],{timeout:900000,record:true});const imageId=(await readFile(iidFile,'utf8')).trim();assert.match(imageId,/^sha256:[a-f0-9]{64}$/);
  const config=JSON.parse(await docker(['image','inspect',imageId]));assert.equal(config.length,1);assert.equal(config[0].Id,imageId);assert.equal(config[0].Config.User,'node');
  const probe="import {readFileSync} from 'node:fs';import {isDeepStrictEqual} from 'node:util';const app=await import('/app/server/application.mjs');const file=JSON.parse(readFileSync('/app/server/build-identity.json','utf8'));const compiled=app.getServerBuildIdentity();if(!isDeepStrictEqual(file,compiled))throw Error('IDENTITY_MISMATCH');console.log(JSON.stringify(compiled));";
  const actual=JSON.parse(await docker(['run','--rm','--pull=never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','node','--no-healthcheck','--entrypoint','node',imageId,'--conditions=react-server','--input-type=module','-e',probe]));assert(isDeepStrictEqual(actual,source.manifest.buildIdentity));
  await docker(['run','--detach','--name',container,'--pull=never','--read-only','--tmpfs','/tmp','--cap-drop','ALL','--security-opt','no-new-privileges','--publish','127.0.0.1::3000',imageId]);launched=true;const bindings=JSON.parse(await docker(['inspect','--format','{{json (index .NetworkSettings.Ports "3000/tcp")}}',container]));assert.equal(bindings.length,1);assert.equal(bindings[0].HostIp,'127.0.0.1');assert.match(bindings[0].HostPort,/^[0-9]+$/);const origin='http://127.0.0.1:'+bindings[0].HostPort;let healthy=false;
  for(let i=0;i<60;i++){try{const response=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)});if(response.ok&&(await response.json()).service==='crest-os'){healthy=true;break;}}catch{/* Only the bounded startup observation is retried. */}await new Promise(resolve=>setTimeout(resolve,500));}assert(healthy,'CANDIDATE_HEALTH_REQUIRED');const page=await fetch(origin+'/');assert.equal(page.status,200);const html=await page.text();assert(html.includes('Checking workspace access'));assert(html.includes('Use fictional records only'));assert(page.headers.get('content-security-policy')?.includes('nonce-'));assert(page.headers.get('cache-control')?.includes('no-store'));
  for(const path of ['bootstrap','login','session','logout']){const response=await fetch(origin+'/api/auth/'+path,{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});assert.equal(response.status,503);assert.equal(response.headers.has('set-cookie'),false);assert.equal((await response.json()).error,'AUTHENTICATION_REQUEST_FAILED');}
  for(const path of ['settings','rename','operation']){const response=await fetch(origin+'/api/business/'+path,{method:'POST',body:'{}'});assert.equal(response.status,503);assert.equal((await response.json()).error,'BUSINESS_REQUEST_FAILED');}
  const imagePath=join(workspace,'candidate'+sourceVersion+'-application-image.tar');await docker(['save','--output',imagePath,imageId],{timeout:180000,record:true});await chmod(imagePath,0o600);const imageArchive={file:'crest-os-image.tar',...await hashRecoveryReleaseFile(imagePath,new AbortController().signal)};const manifest=readRecoveryReleaseManifest({...source.manifest,containerImageId:imageId,distributionDigest:'sha256:'+imageArchive.sha256,imageArchive});const {release:_release,...saved}=manifest;void _release;const manifestPath=join(workspace,'candidate'+sourceVersion+'-application-manifest.json');await writeFile(manifestPath,JSON.stringify(saved,null,2)+'\n',{flag:'wx',mode:0o600});
  return{profile:sourceVersion===140?'crest.actual-candidate140-image-build.v1':'crest.actual-candidate139-image-build.v1',workspace,sourceRoot:source.sourceRoot,sourcePath:source.sourcePath,imagePath,manifestPath,imageId,tag,buildIdentity:actual,imageArchive,sourceArchive:manifest.sourceArchive,nonRoot:true,compiledIdentityVerified:true,closedStartupVerified:true,registeredSourceOnly:true,installed:false,independentHostVerified:false,completeBackup:false};
 }finally{if(launched)await docker(['container','rm','--force',container]);}
}

export function buildOpeningFunds140Image(logFile){return buildOpeningFunds139Image(logFile,140);}
