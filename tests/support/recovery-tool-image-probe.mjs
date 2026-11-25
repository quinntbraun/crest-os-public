// Runs via stdin inside the immutable recovery image on an internal test network.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createPinnedRecoveryRun} from '/app/src/tooling/recovery-run.ts';
import {setTimeout as delay} from 'node:timers/promises';
const tools={pgDump:'/opt/crest-postgres/bin/pg_dump',age:'/opt/crest-age/age'};
const run=(path,args,input)=>execFileSync(path,args,{input,stdio:['pipe','pipe','pipe'],timeout:20000,maxBuffer:8388608});
const sql=(database,text)=>run('/opt/crest-postgres/bin/psql',['--no-psqlrc','--no-password','--set','ON_ERROR_STOP=1','--tuples-only','--no-align','--dbname',database],text).toString().trim();
let stage='tools';
try{
assert.equal(process.getuid(),1000);assert.equal(typeof await createPinnedRecoveryRun(tools),'function');
run(process.execPath,['--conditions=react-server','scripts/verify-recovery-image.mjs']);
const directory=await mkdtemp('/tmp/crest-image-roundtrip-');
try{
  stage='ready';let ready=false;
  // Local pg_isready can observe the temporary bootstrap server. Require a real
  // read through the probe container's network before any mutation is attempted.
  for(let attempt=0;attempt<40;attempt++){try{assert.equal(sql('crest_test','SELECT 1;'),'1');ready=true;break;}catch{await delay(250);}}
  assert(ready);stage='source';
  sql('crest_test',"CREATE SCHEMA crest_tool_fixture; CREATE TABLE crest_tool_fixture.rows(id bigint PRIMARY KEY, amount numeric(30,8) NOT NULL CHECK(amount>=0), note text NOT NULL, original bytea NOT NULL); INSERT INTO crest_tool_fixture.rows VALUES (9007199254740993,12345678901234567890.12345678,E'Crest ☀\\nline two',decode('0001feff','hex'));");
  const query="SELECT row_to_json(t)::text FROM (SELECT id::text,amount::text,note,encode(original,'hex') AS original FROM crest_tool_fixture.rows ORDER BY id) t;";
  const original=sql('crest_test',query);
  const dump=run(tools.pgDump,['--no-password','--format=custom','--no-owner','--no-privileges','--schema=crest_tool_fixture','--dbname=crest_test']);
  assert.equal(dump.subarray(0,5).toString(),'PGDMP');
  stage='encrypt';const identity=directory+'/identity.txt';await writeFile(identity,run('/opt/crest-age/age-keygen',[]),{flag:'wx',mode:0o600});
  const recipient=run('/opt/crest-age/age-keygen',['-y',identity]).toString().trim();
  const encrypted=run(tools.age,['--recipient',recipient],dump);assert.equal(encrypted.subarray(0,22).toString(),'age-encryption.org/v1\n');
  const decrypted=run(tools.age,['--decrypt','--identity',identity],encrypted);assert.deepEqual(decrypted,dump);
  stage='restore';sql('crest_test','CREATE DATABASE crest_tool_restore TEMPLATE template0;');
  run('/opt/crest-postgres/bin/pg_restore',['--no-password','--exit-on-error','--single-transaction','--no-owner','--no-privileges','--dbname=crest_tool_restore'],decrypted);
  assert.equal(sql('crest_tool_restore',query),original);
  assert.throws(()=>sql('crest_tool_restore',"INSERT INTO crest_tool_fixture.rows VALUES (2,-1,'invalid','');"));
  assert.equal(sql('crest_tool_restore',query),original);
  stage='refusal';const refusal=(()=>{try{run(process.execPath,['--conditions=react-server','scripts/recovery-scheduled-capture.mjs']);return false;}catch(error){return error.status===1&&error.stderr.toString()==='RECOVERY_SCHEDULE_REVIEW_REQUIRED\n';}})();assert(refusal);
  const statusRefusal=(()=>{try{run(process.execPath,['--conditions=react-server','scripts/recovery-capture-status.mjs']);return false;}catch(error){return error.status===1&&error.stderr.toString()==='RECOVERY_CAPTURE_STATUS_REVIEW_REQUIRED\n';}})();assert(statusRefusal);
  console.log(JSON.stringify({profile:'crest.recovery-tool-image-roundtrip.v1',nativeDumpEncryptionRestore:true,exactBigintDecimalTextBinary:true,constraintsPreserved:true,missingProfileRefused:true,missingStatusProfileRefused:true,completeBackup:false}));
}finally{await rm(directory,{recursive:true,force:true});}
}catch{console.error('RECOVERY_IMAGE_PROBE_FAILED:'+stage);process.exitCode=1;}
