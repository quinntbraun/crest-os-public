import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {openingSupplier141SourceProfile as supplier} from '../../src/tooling/opening-supplier141-catalog.ts';
import {recoveryCanonicalSourceProfile,recoverySourceProfileMatches} from '../../src/tooling/recovery-source-profile.ts';
import {readRecoveryCaptureRegistry} from '../../src/tooling/recovery-capture-registry.ts';
import {recoveryConfigurationFixture} from '../support/recovery-configuration-fixture.ts';
import {readRecoveryConfiguration,reconstructRecoveryConfiguration} from '../../src/tooling/recovery-configuration.ts';
import {readRecoveryRunCandidate} from '../../src/tooling/recovery-run-restore.ts';
import {readRecoveryReleaseManifest} from '../../src/tooling/recovery-release-distribution.ts';
const binding=()=>({pointId:randomUUID(),businessId:randomUUID(),appReleaseId:'a'.repeat(40),sourceSchemaVersion:141 as const,migrationRegistrySha256:supplier.migrationRegistrySha256,referenceDirectoryId:randomUUID()});
function release(){
 const digest='a'.repeat(64),registry:string=supplier.migrationRegistrySha256;
 return {formatVersion:2,sourceCommit:'c'.repeat(40),workingTreeDirty:false,nodeVersion:'24.22.0',packageManager:'npm@11.19.1',lockfileSha256:digest,migrationRegistrySha256:registry,canonicalMaintenanceSha256:digest,toolchainSha256:digest,compatibility:{schemaVersion:1,appVersion:'0.1.0',databaseMajor:17,schemaMinimum:0,schemaMaximum:141,reportVersion:0,commandVersion:1,productionActivation:'blocked'},containerImageId:'sha256:'+digest,buildIdentity:{schemaVersion:1,appReleaseId:digest.slice(0,40),sourceContentSha256:digest,migrationRegistrySha256:registry,sourceSchemaVersion:141},distributionDigest:'sha256:'+digest,imageArchive:{file:'crest-os-image.tar',byteSize:100,sha256:digest},sourceArchive:{file:'crest-os-source.tar',byteSize:100,sha256:digest},productionActivation:'blocked'};
}
it('binds coherent141 recovery to its actual observed catalogs without authorizing installation',()=>{
 expect(recoverySourceProfileMatches(141,supplier.migrationRegistrySha256)).toBe(true);
 expect(recoveryCanonicalSourceProfile(141,supplier.migrationRegistrySha256)).toEqual({registered:true,routines:{profile:'crest.application-routine-catalog.v1',sourceSchemaVersion:141,migrationRegistrySha256:supplier.migrationRegistrySha256,routineCount:1323,sha256:supplier.routineSha256},schema:{profile:'crest.application-schema-catalog.v1',sourceSchemaVersion:141,migrationRegistrySha256:supplier.migrationRegistrySha256,objectCount:15859,sha256:supplier.schemaSha256}});
});
it.each([
 [141,'9b3c6009ab6bbbcfabe93803436410cc0ba44507882f1bf0ce079e5f9301a124'],
 [141,'823ffc623e93cc0f2c6122b6a04a47b5b1c776dbd6d9c0f779211869f5e75234'],
 [140,supplier.migrationRegistrySha256],[142,supplier.migrationRegistrySha256],['141',supplier.migrationRegistrySha256],
])('refuses relabelled, preliminary and future recovery pair %s/%s',(version,registry)=>{
 expect(recoverySourceProfileMatches(version,registry)).toBe(false);expect(()=>recoveryCanonicalSourceProfile(version,registry)).toThrow('RECOVERY_SOURCE_PROFILE_REQUIRED');
});
it('reconstructs141 configuration without placing private material in its recipe or claiming availability',async()=>{
 const {pointId,...target}=binding();void pointId;const f=recoveryConfigurationFixture(target);
 expect(readRecoveryConfiguration(f.source,target).binding).toEqual(target);expect(f.recipe.externalMaterialAvailabilityVerified).toBe(false);
 for(const reference of f.references)expect(f.source).not.toContain(f.material.get(reference.referenceId));
 const restored=await reconstructRecoveryConfiguration({source:f.source,expected:target},async reference=>f.material.get(reference.referenceId)!,new AbortController().signal);
 expect(JSON.parse(restored.forRecoveryTools().profileSource)).toEqual(f.profile);
 expect(()=>readRecoveryConfiguration(f.source,{...target,sourceSchemaVersion:140})).toThrow();
});
it('retains an incomplete141 run candidate and refuses a different registry binding',()=>{
 const expected=binding(),value={profile:'crest.verified-recovery-run-candidate.v1',pointId:expected.pointId,snapshotId:'00000003-00000001-1',manifest:{key:'recovery/'+expected.pointId+'/artifacts/'+randomUUID()+'.age',versionId:'synthetic',byteSize:100,sha256:'c'.repeat(64),retainUntil:new Date(Date.now()+400*86400000).toISOString()},manifestPlaintext:{byteSize:100,sha256:'d'.repeat(64)},completeBackup:false};
 expect(readRecoveryRunCandidate(JSON.stringify(value),expected).binding).toEqual(expected);
 expect(()=>readRecoveryRunCandidate(JSON.stringify(value),{...expected,migrationRegistrySha256:'b'.repeat(64)})).toThrow();
});
it('reads a bound141 release but refuses activation, version drift and old registry substitution',()=>{
 expect(readRecoveryReleaseManifest(release()).release.sourceSchemaVersion).toBe(141);
 for(const change of [(v:ReturnType<typeof release>)=>{v.compatibility.productionActivation='ready';},(v:ReturnType<typeof release>)=>{v.productionActivation='ready';},(v:ReturnType<typeof release>)=>{v.compatibility.schemaMaximum=140;},(v:ReturnType<typeof release>)=>{v.migrationRegistrySha256='b'.repeat(64);v.buildIdentity.migrationRegistrySha256=v.migrationRegistrySha256;}]){const value=release();change(value);expect(()=>readRecoveryReleaseManifest(value)).toThrow();}
});
it('selects only the exact registered141 registry and refuses checksum drift',()=>{
 const registry=JSON.parse(readFileSync(new URL('../support/registered140-migration-checksums.json',import.meta.url),'utf8'));
 registry.migrations.push({version:'20270217183000',file:'20270217183000_fictional_opening_supplier_sources.sql',sha256:supplier.migrationSha256});
 const bytes=Buffer.from(JSON.stringify(registry,null,2)+'\n');expect(readRecoveryCaptureRegistry(bytes).sourceSchemaVersion).toBe(141);registry.migrations.at(-1).sha256='a'.repeat(64);expect(()=>readRecoveryCaptureRegistry(Buffer.from(JSON.stringify(registry,null,2)+'\n'))).toThrow();
});
