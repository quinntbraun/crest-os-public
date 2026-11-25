import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile,readFile,mkdir,copyFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {serverBuildIdentity} from '../../scripts/server-build-identity.mjs';
import {hashRecoveryReleaseFile} from '../../src/tooling/recovery-release-files.ts';

// Real tracked Git source; deliberately synthetic image bytes, never loaded or
// identified as an accepted Crest image. No real credentials or provider IO.
export async function recoveryDistributionFixture(workspace,candidate){
 let root=new URL('../../',import.meta.url);const sourcePath=join(workspace,randomUUID()+'.source.tar'),imagePath=join(workspace,randomUUID()+'.synthetic-image.tar'),imageBytes=Buffer.from('Synthetic recovery-run image fixture; not an application image.\n'),hash=bytes=>createHash('sha256').update(bytes).digest('hex'),digest=async path=>hash(await readFile(new URL(path,root)));
 execFileSync('git',['archive','--format=tar','--output='+sourcePath,'HEAD'],{cwd:fileURLToPath(root),stdio:'pipe'});await writeFile(imagePath,imageBytes,{flag:'wx',mode:0o600});
 const installedRegistry=JSON.parse(await readFile(new URL('supabase/migration-checksums.json',root),'utf8'));
 if(candidate||installedRegistry.migrations.length!==138){
  if(candidate)assertCandidate(candidate);const directory=join(workspace,'candidate-source-'+randomUUID());await mkdir(directory);execFileSync('tar',['-xf',sourcePath,'-C',directory],{stdio:'pipe'});
  if(candidate){
   await copyFile(join(candidate.directory,'supabase/migration-checksums.json'),join(directory,'supabase/migration-checksums.json'));await copyFile(join(candidate.directory,'supabase/migrations',candidate.file),join(directory,'supabase/migrations',candidate.file));const compatibility=JSON.parse(await readFile(join(directory,'release/compatibility.json'),'utf8'));compatibility.schemaMaximum=candidate.registry.migrations.length;await writeFile(join(directory,'release/compatibility.json'),JSON.stringify(compatibility,null,2)+'\n');await writeFile(join(directory,'planning/SECURITY_EXPORT_COVERAGE.json'),JSON.stringify(candidate.coverage,null,2)+'\n');
  }else{
   if(![139,140,141,142].includes(installedRegistry.migrations.length))throw Error('FROZEN138_DISTRIBUTION_REQUIRED');
   await copyFile(join(directory,'tests/support/registered138-migration-checksums.json'),join(directory,'supabase/migration-checksums.json'));
   await copyFile(join(directory,'tests/support/registered138-compatibility.json'),join(directory,'release/compatibility.json'));
   await copyFile(join(directory,'tests/support/registered138-security-export-coverage.json'),join(directory,'planning/SECURITY_EXPORT_COVERAGE.json'));

  }
  const kept=new Set(JSON.parse(await readFile(join(directory,'supabase/migration-checksums.json'),'utf8')).migrations.map(row=>row.file));for(const row of installedRegistry.migrations)if(!kept.has(row.file))await unlink(join(directory,'supabase/migrations',row.file));
  execFileSync('git',['-c','core.longpaths=true','init','--quiet',directory],{stdio:'pipe'});execFileSync('git',['-C',directory,'config','core.autocrlf','false'],{stdio:'pipe'});execFileSync('git',['-C',directory,'config','core.longpaths','true'],{stdio:'pipe'});await writeFile(join(directory,'.git/info/attributes'),'* -text -filter -ident\n');execFileSync('git',['-C',directory,'add','--force','--all'],{stdio:'pipe'});execFileSync('git',['-C',directory,'-c','user.name=Crest recovery fixture','-c','user.email=crest-recovery-fixture@users.noreply.github.com','commit','--quiet','-m','Isolated version-bound recovery source'],{stdio:'pipe'});execFileSync('git',['-C',directory,'archive','--format=tar','--output='+sourcePath,'HEAD'],{stdio:'pipe'});root=pathToFileURL(directory+'/');
 }
 const buildIdentity=await serverBuildIdentity(root),sourceArchive={file:'crest-os-source.tar',...await hashRecoveryReleaseFile(sourcePath,new AbortController().signal)},imageArchive={file:'crest-os-image.tar',byteSize:imageBytes.length,sha256:hash(imageBytes)},manifest={formatVersion:2,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(root),encoding:'utf8'}).trim(),workingTreeDirty:false,nodeVersion:process.versions.node,packageManager:'npm@11.19.1',lockfileSha256:await digest('package-lock.json'),migrationRegistrySha256:buildIdentity.migrationRegistrySha256,canonicalMaintenanceSha256:await digest('docs/CANONICAL_MAINTENANCE.json'),toolchainSha256:await digest('release/toolchain.json'),compatibility:JSON.parse(await readFile(new URL('release/compatibility.json',root),'utf8')),containerImageId:'sha256:'+hash(imageBytes),buildIdentity,distributionDigest:'sha256:'+imageArchive.sha256,imageArchive,sourceArchive,productionActivation:'blocked'};
 return{sourcePath,imagePath,imageBytes,manifest,partByteSize:8*1024*1024,sourceRoot:fileURLToPath(root)};
}

function assertCandidate(candidate){if(candidate.registered!==false||![139,140,141,142].includes(candidate.registry.migrations.length)||candidate.registry.migrations.at(-1).file!==candidate.file)throw Error('RECOVERY_DISTRIBUTION_CANDIDATE_REQUIRED');}
