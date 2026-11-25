// Real private Linux files/attempt journal/controller with controlled PG, pinned
// producer, primary/vault and HTTP ports. No live service or encryption proof.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {createRecoveryCaptureCommand} from '../../src/tooling/recovery-capture-command.ts';
import {runRecoveryCaptureStatusCommand} from '../../src/tooling/recovery-capture-status.ts';
import {createRecoveryAttempt,inspectRecoveryAttempt} from '../../src/tooling/recovery-attempt.ts';
import {createRecoveryMonitorAttempt} from '../../src/tooling/recovery-monitor.ts';
import {recoveryCaptureProfileFixture} from '../support/recovery-capture-profile-fixture.mjs';
import {recoveryConfigurationFixture} from '../support/recovery-configuration-fixture.ts';
assert.equal(process.platform,'linux');assert.equal(process.env.CREST_ENV,'test');
const roots=[];after(async()=>{for(const root of roots){assert.equal(dirname(root),tmpdir());assert(basename(root).startsWith('crest-capture-command-'));await rm(root,{recursive:true,force:true});}});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(options={}){
 const root=await mkdtemp(join(tmpdir(),'crest-capture-command-'));roots.push(root);const profile=recoveryCaptureProfileFixture(root),pointId=randomUUID(),registry=await readFile(new URL('../support/registered140-migration-checksums.json',import.meta.url)),registrySha=sha(registry),recipe=recoveryConfigurationFixture({businessId:profile.businessId,appReleaseId:'a'.repeat(40),migrationRegistrySha256:registrySha,sourceSchemaVersion:140,referenceDirectoryId:profile.referenceDirectoryId});
 await mkdir(profile.stateDirectory,{mode:0o700});await mkdir(profile.workspaceDirectory,{mode:0o700});
 const source=Buffer.from('Synthetic source, not release acceptance.\n'),image=Buffer.from('Synthetic image, never loaded.\n'),manifest={formatVersion:2,sourceCommit:'b'.repeat(40),workingTreeDirty:false,nodeVersion:'24.22.0',packageManager:'npm@11.19.1',lockfileSha256:'1'.repeat(64),migrationRegistrySha256:registrySha,canonicalMaintenanceSha256:'2'.repeat(64),toolchainSha256:'3'.repeat(64),compatibility:JSON.parse(await readFile(new URL('../support/registered140-compatibility.json',import.meta.url),'utf8')),containerImageId:'sha256:'+sha(image),buildIdentity:{schemaVersion:1,appReleaseId:'a'.repeat(40),sourceContentSha256:'a'.repeat(64),migrationRegistrySha256:registrySha,sourceSchemaVersion:140},distributionDigest:'sha256:'+sha(image),imageArchive:{file:'crest-os-image.tar',byteSize:image.length,sha256:sha(image)},sourceArchive:{file:'crest-os-source.tar',byteSize:source.length,sha256:sha(source)},productionActivation:'blocked'};
 const profileFile=join(root,'profile.json');for(const[path,bytes]of[[profileFile,JSON.stringify(profile)],[profile.rootCertificateFile,'-----BEGIN CERTIFICATE-----\nCONTROLLED TLS INPUT ONLY\n-----END CERTIFICATE-----\n'],[profile.recipeFile,recipe.source],[profile.distribution.manifestFile,JSON.stringify(manifest)],[profile.distribution.sourceFile,source],[profile.distribution.imageFile,image]])await writeFile(path,bytes,{flag:'wx',mode:0o600});await chmod(profile.distribution.manifestFile,0o644);
 const counts={tools:0,connected:0,ended:0,primaryOpened:0,primaryClosed:0,vaultClosed:0,published:0,captured:0},signals=[];
 const run=createRecoveryCaptureCommand({makeAttempt:createRecoveryAttempt,
  async makeRun(tools){counts.tools++;assert.deepEqual(tools,profile.tools);if(options.toolFailure)throw Error('PRIVATE_TOOL_PATH');return async(input,ports,signal)=>{
   counts.captured++;assert.equal(input.database.environment,'production');assert.equal(input.database.rootCertificate,profile.rootCertificateFile);assert.equal(input.database.connectionString,profile.databaseUrl);assert.equal(input.distribution.sourcePath,profile.distribution.sourceFile);assert.equal(input.configuration.expected.referenceDirectoryId,profile.referenceDirectoryId);assert.equal(input.migrations.length,140);
   const bytes=Buffer.from('age-encryption.org/v1\nCONTROLLED-CIPHERTEXT\n'),path=join(profile.workspaceDirectory,'cipher-'+randomUUID()+'.age');await writeFile(path,bytes,{flag:'wx',mode:0o600});const artifactId=randomUUID(),artifact=await ports.attempt.publish({artifactId,purpose:'manifest',byteSize:bytes.length,sha256:sha(bytes),retainUntil:input.retainUntil},path,ports.vault,signal);
   return Object.freeze({forRecoveryTools:()=>({profile:'crest.verified-recovery-run-candidate.v1',pointId:ports.attempt.view().header.pointId,snapshotId:'00000001-00000002-1',manifest:artifact,manifestPlaintext:{byteSize:100,sha256:'d'.repeat(64)},completeBackup:false}),toJSON(){throw Error('PRIVATE_CANDIDATE');}});
  };},
  makeClient(config){assert.equal(config.connectionString,profile.databaseUrl);assert.equal(config.ssl.rejectUnauthorized,true);assert(config.ssl.ca.includes('BEGIN CERTIFICATE'));assert.equal(config.options,'-c role=crest_backup_reader');const client=new pg.Client(config);client.connect=async()=>{counts.connected++;if(options.connectFailure)throw Error('PRIVATE_CONNECTION_DETAIL');};client.end=async()=>{counts.ended++;};return client;},
  makePrimary(config,domain){assert.deepEqual(config,profile.sources[domain]);counts.primaryOpened++;return{store:{domain},close:()=>{counts.primaryClosed++;}};},
  makeVault(config){assert.deepEqual(config,profile.vault);return{vault:{async publishEncryptedFile(input){counts.published++;if(options.lostAcknowledgment)throw Error('PRIVATE_VAULT_ACK');const bytes=await readFile(input.path);return{key:input.key,versionId:'controlled-version',byteSize:bytes.length,sha256:sha(bytes),retainUntil:input.retainUntil};}},close:()=>{counts.vaultClosed++;}};},
  makeMonitor(url,identity){assert.equal(url,profile.monitorPingUrl);return createRecoveryMonitorAttempt(url,identity,async(target,request)=>{signals.push({url:String(target),body:JSON.parse(request.body)});return new Response('OK',{status:200});});}
 });
 return{root,profile,profileFile,pointId,counts,signals,run:(id=pointId,args=[profileFile,id])=>run(args,new AbortController().signal),record:name=>readFile(join(profile.stateDirectory,name),'utf8')};
}
test('command composes production settings, durable staging and failure-only monitoring without leaking credentials',async()=>{
 const f=await fixture(),receipt=await f.run();assert.equal(receipt.pointId,f.pointId);assert.equal(receipt.completeBackup,false);assert.equal(receipt.state,'candidate_review_required');assert.equal(f.counts.tools,1);assert.equal(f.counts.connected,1);assert.equal(f.counts.ended,1);assert.equal(f.counts.primaryClosed,3);assert.equal(f.counts.vaultClosed,1);assert.equal(f.signals.length,2);assert(f.signals[0].url.includes('/start?'));assert(f.signals[1].url.includes('/fail?'));assert.equal(f.signals[1].body.category,'recovery_review');
 const final=JSON.parse(await f.record('command-'+f.pointId+'.finished.json'));assert.equal(final.state,'candidate_review_required');assert.equal(final.monitorPhase,'failed');assert.equal(final.completeBackup,false);
 const status=await runRecoveryCaptureStatusCommand([f.profileFile],new AbortController().signal);assert.equal(status.candidatesRequiringReview,1);assert.equal(status.recentAttempts[0].artifactJournal.verified,1);assert.equal(status.protectionLevel,'unknown');assert.equal(status.completeBackup,false);
 const secrets=[f.profile.databaseUrl,f.profile.monitorPingUrl,f.profile.vault.secretAccessKey,...Object.values(f.profile.sources).map(value=>value.secretAccessKey)];for(const name of await readdir(f.profile.stateDirectory)){if(!name.endsWith('.json')&&!name.endsWith('.jsonl'))continue;const text=await f.record(name);for(const secret of secrets)assert(!text.includes(secret));}
});
test('same explicit run ID refuses before another tool/client/provider or monitor dispatch',async()=>{
 const f=await fixture();await f.run();const before={...f.counts},signals=f.signals.length;await assert.rejects(f.run(),{message:'RECOVERY_CAPTURE_COMMAND_REVIEW_REQUIRED',stage:'journal'});assert.deepEqual(f.counts,before);assert.equal(f.signals.length,signals);
});
test('connection failure is durably recorded inside the controller and signals failure independently',async()=>{
 const f=await fixture({connectFailure:true});await assert.rejects(f.run(),{message:'RECOVERY_CAPTURE_COMMAND_REVIEW_REQUIRED',stage:'capture'});assert.equal(f.counts.captured,0);assert.equal(f.counts.ended,1);assert.equal(f.counts.primaryClosed,3);assert.equal(f.counts.vaultClosed,1);assert.equal(f.signals[1].body.category,'capture');const final=JSON.parse(await f.record('command-'+f.pointId+'.finished.json'));assert.equal(final.state,'failed');assert(!JSON.stringify(final).includes('PRIVATE_'));
});
test('uncertain vault publication remains review-required and is never replayed automatically',async()=>{
 const f=await fixture({lostAcknowledgment:true});await assert.rejects(f.run(),{message:'RECOVERY_CAPTURE_COMMAND_REVIEW_REQUIRED',stage:'capture'});assert.equal(f.counts.published,1);const journal=inspectRecoveryAttempt(await f.record(f.pointId+'.jsonl'));assert.equal(journal.reviewRequired,true);assert.equal(journal.artifacts[0].state,'uncertain');await assert.rejects(f.run());assert.equal(f.counts.published,1);
});
test('pinned-tool preflight failure retains the command identity and emits failure without a late start',async()=>{
 const f=await fixture({toolFailure:true});await assert.rejects(f.run(),{message:'RECOVERY_CAPTURE_COMMAND_REVIEW_REQUIRED',stage:'tools'});assert.equal(f.counts.connected,0);assert.equal(f.signals.length,1);assert(f.signals[0].url.includes('/fail?'));assert.equal(JSON.parse(await f.record('command-'+f.pointId+'.finished.json')).stage,'tools');
});
test('non-private profile and invalid arguments refuse before creating a command or contacting services',async()=>{
 const f=await fixture();await chmod(f.profileFile,0o644);await assert.rejects(f.run(),{message:'RECOVERY_CAPTURE_COMMAND_REVIEW_REQUIRED',stage:'profile'});assert.deepEqual(await readdir(f.profile.stateDirectory),[]);assert.equal(f.signals.length,0);await chmod(f.profileFile,0o600);await assert.rejects(f.run(f.pointId,[f.profileFile]),{stage:'input'});assert.deepEqual(await readdir(f.profile.stateDirectory),[]);
});
