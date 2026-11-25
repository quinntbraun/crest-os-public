import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runRecoveryCaptureCommand} from '../src/tooling/recovery-capture-command.ts';
import {runRecoveryCaptureStatusCommand} from '../src/tooling/recovery-capture-status.ts';
import {runRecoveryScheduledCapture} from '../src/tooling/recovery-scheduled-capture.ts';
import {runRecoveryOwnerKitCommand} from '../src/tooling/recovery-owner-kit-command.ts';
import {runOperatorSourceCommand} from '../src/tooling/operator-source-command.ts';
import {recoveryRoutineBaseline138} from '../src/tooling/recovery-routine-baseline138.ts';

assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
const pin=JSON.parse(await readFile(new URL('../release/toolchain.json',import.meta.url),'utf8'));
assert.equal(process.versions.node,pin.node);
for(const name of ['pg_dump','pg_restore','psql']){
  const path='/opt/crest-postgres/bin/'+name;
  const stat=await lstat(path);assert(stat.isFile()&&stat.uid===0&&(stat.mode&0o022)===0);
  assert.equal(execFileSync(path,['--version'],{encoding:'utf8',timeout:5000}).trim(),name+' (PostgreSQL) 17.11');
}
for(const name of ['age','age-keygen']){
  const path='/opt/crest-age/'+name,stat=await lstat(path);
  assert(stat.isFile()&&stat.uid===0&&(stat.mode&0o022)===0);
  assert(['v'+pin.age.version,pin.age.version].includes(execFileSync(path,['--version'],{encoding:'utf8',timeout:5000}).trim()));
}
const registry=await readFile(new URL('../supabase/migration-checksums.json',import.meta.url));
assert.equal(createHash('sha256').update(registry).digest('hex'),recoveryRoutineBaseline138.migrationRegistrySha256);
assert.equal(JSON.parse(registry).migrations.length,138);
assert.equal(typeof runRecoveryCaptureCommand,'function');assert.equal(typeof runRecoveryScheduledCapture,'function');
assert.equal(typeof runRecoveryCaptureStatusCommand,'function');
assert.equal(typeof runRecoveryOwnerKitCommand,'function');assert.equal(typeof runOperatorSourceCommand,'function');
console.log(JSON.stringify({profile:'crest.recovery-tool-image.v1',node:pin.node,postgres:'17.11',age:pin.age.version,schemaVersion:138,completeBackup:false}));
