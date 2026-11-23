import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

assert.equal(process.env.CREST_ENV,'test');
const image=process.env.CREST_TEST_RECOVERY_TOOL_IMAGE_ID;assert.match(image??'',/^sha256:[a-f0-9]{64}$/);
const pins=JSON.parse(await readFile(new URL('../../release/toolchain.json',import.meta.url),'utf8'));
async function docker(args,{input,env=process.env}={}){
  return new Promise((resolve,reject)=>{const child=execFile('docker',args,{env,timeout:90000,maxBuffer:1048576},(error,stdout,stderr)=>{if(error){const stage=stderr.match(/RECOVERY_IMAGE_PROBE_FAILED:(tools|ready|source|encrypt|restore|refusal)/)?.[1];reject(new Error('RECOVERY_IMAGE_TEST_STAGE_FAILED:'+args[0]+(stage?':'+stage:'')));}else resolve(stdout.trim());});child.stdin.on('error',()=>{});child.stdin.end(input);});
}
test('actual isolated recovery image dumps, encrypts and restores exact data with its pinned native tools', {timeout:150000},async()=>{
  const suffix=randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex'),network='crest-tool-image-'+suffix;
  let networkId,databaseId,probeId;
  try{
    const inspected=JSON.parse(await docker(['image','inspect',image]));assert.equal(inspected.length,1);assert.equal(inspected[0].Id,image);assert.equal(inspected[0].Config.User,'node');assert.equal(inspected[0].Config.ExposedPorts,undefined);assert.equal(inspected[0].Config.Healthcheck,undefined);
    networkId=await docker(['network','create','--internal',network]);assert.match(networkId,/^[a-f0-9]{64}$/);
    databaseId=await docker(['create','--pull=never','--network',network,'--network-alias','recovery-database','--name','crest-tool-db-'+suffix,'--env','POSTGRES_USER=supabase_admin','--env','POSTGRES_DB=crest_test','--env','POSTGRES_PASSWORD',pins.testDatabaseImage],{env:{...process.env,POSTGRES_PASSWORD:password}});assert.match(databaseId,/^[a-f0-9]{64}$/);
    await docker(['start',databaseId]);let ready=false;
    for(let attempt=0;attempt<90;attempt++){try{await docker(['exec',databaseId,'pg_isready','-U','supabase_admin','-d','crest_test']);ready=true;break;}catch{await delay(500);}}assert(ready,'owned database must become ready');
    probeId=await docker(['create','--pull=never','--interactive','--network',network,'--name','crest-tool-probe-'+suffix,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=64','--memory=256m','--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=32m,mode=1777','--env','PGHOST=recovery-database','--env','PGUSER=supabase_admin','--env','PGPASSWORD','--entrypoint','node',image,'--conditions=react-server','--input-type=module'],{env:{...process.env,PGPASSWORD:password}});assert.match(probeId,/^[a-f0-9]{64}$/);
    const input=await readFile(new URL('../support/recovery-tool-image-probe.mjs',import.meta.url));
    const receipt=JSON.parse(await docker(['start','--attach','--interactive',probeId],{input}));
    assert.equal(receipt.profile,'crest.recovery-tool-image-roundtrip.v1');assert.equal(receipt.nativeDumpEncryptionRestore,true);assert.equal(receipt.exactBigintDecimalTextBinary,true);assert.equal(receipt.constraintsPreserved,true);assert.equal(receipt.missingProfileRefused,true);assert.equal(receipt.completeBackup,false);
  }finally{
    // Only handles returned and validated by this invocation may be removed.
    if(probeId&&/^[a-f0-9]{64}$/.test(probeId))await docker(['rm','--force','--volumes',probeId]);
    if(databaseId&&/^[a-f0-9]{64}$/.test(databaseId))await docker(['rm','--force','--volumes',databaseId]);
    if(networkId&&/^[a-f0-9]{64}$/.test(networkId))await docker(['network','rm',networkId]);
  }
});
