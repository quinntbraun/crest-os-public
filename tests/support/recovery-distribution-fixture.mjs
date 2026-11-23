import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {serverBuildIdentity} from '../../scripts/server-build-identity.mjs';
import {hashRecoveryReleaseFile} from '../../src/tooling/recovery-release-files.ts';

// Real tracked Git source; deliberately synthetic image bytes, never loaded or
// identified as an accepted Crest image. No real credentials or provider IO.
export async function recoveryDistributionFixture(workspace){
 const root=new URL('../../',import.meta.url),sourcePath=join(workspace,randomUUID()+'.source.tar'),imagePath=join(workspace,randomUUID()+'.synthetic-image.tar'),imageBytes=Buffer.from('Synthetic recovery-run image fixture; not an application image.\n'),hash=bytes=>createHash('sha256').update(bytes).digest('hex'),digest=async path=>hash(await readFile(new URL(path,root)));
 execFileSync('git',['archive','--format=tar','--output='+sourcePath,'HEAD'],{cwd:fileURLToPath(root),stdio:'pipe'});await writeFile(imagePath,imageBytes,{flag:'wx',mode:0o600});
 const buildIdentity=await serverBuildIdentity(),sourceArchive={file:'crest-os-source.tar',...await hashRecoveryReleaseFile(sourcePath,new AbortController().signal)},imageArchive={file:'crest-os-image.tar',byteSize:imageBytes.length,sha256:hash(imageBytes)},manifest={formatVersion:2,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(root),encoding:'utf8'}).trim(),workingTreeDirty:false,nodeVersion:process.versions.node,packageManager:'npm@11.19.1',lockfileSha256:await digest('package-lock.json'),migrationRegistrySha256:buildIdentity.migrationRegistrySha256,canonicalMaintenanceSha256:await digest('docs/CANONICAL_MAINTENANCE.json'),toolchainSha256:await digest('release/toolchain.json'),compatibility:JSON.parse(await readFile(new URL('release/compatibility.json',root),'utf8')),containerImageId:'sha256:'+hash(imageBytes),buildIdentity,distributionDigest:'sha256:'+imageArchive.sha256,imageArchive,sourceArchive,productionActivation:'blocked'};
 return{sourcePath,imagePath,imageBytes,manifest,partByteSize:8*1024*1024};
}
