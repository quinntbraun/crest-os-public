// Actual same-release image, native decoder and kernel isolation. No provider,
// production credentials, mounted workspace, network or real customer files.
import assert from 'node:assert/strict';
import {before,test} from 'node:test';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {imageFixtures,chunk} from '../support/image-fixtures.mjs';
const image='crest-os:ci',maximum=25*1024*1024,hash=b=>createHash('sha256').update(b).digest('hex');
let fixtures;
before(async()=>{assert.equal(process.platform,'linux');fixtures=await imageFixtures();});
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',timeout:30000,maxBuffer:12*1024*1024,...options});
function create(overrides={},type='image/png'){
  const profile={network:['--network','none'],readonly:['--read-only'],capabilities:['--cap-drop','ALL'],privileges:['--security-opt','no-new-privileges'],
    memory:['--memory','512m','--memory-swap','512m'],cpu:['--cpus','1'],pids:['--pids-limit','32'],user:['--user','node'],...overrides};
  const id=docker(['create','--interactive','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=16m',...Object.values(profile).flat(),image,
    'node','--max-old-space-size=128','server/image-worker.mjs',type]).trim();
  assert.match(id,/^[a-f0-9]{64}$/);return id;
}
function run(bytes,type,overrides={}){
  // create/start separately records our exact owned ID before any cleanup.
  const id=create(overrides,type);
  try{
    let stdout,exit=0;
    try{stdout=docker(['start','--attach','--interactive',id],{input:bytes,timeout:25000});}
    catch(error){assert.equal(error.status,1,'IMAGE_CONTAINER_EXECUTION_FAILED');stdout=String(error.stdout??'');exit=1;}
    let result;try{result=JSON.parse(stdout);}catch{throw new Error('IMAGE_CONTAINER_PROTOCOL_FAILED');}
    const state=JSON.parse(docker(['inspect','--format','{{json .State}}',id]));
    assert.equal(state.OOMKilled,false);assert.equal(state.ExitCode,exit);
    return {result,exit};
  }finally{docker(['rm','--force',id],{stdio:'ignore'});}
}
test('same release worker validates generated originals and strips metadata under actual kernel limits',async t=>{
  for(const f of fixtures.valid)await t.test(f.name,async()=>{
    const {result:r,exit}=run(f.bytes,f.type);assert.equal(exit,0);assert.equal(r.status,'Validated');assert.equal(r.source.sha256,hash(f.bytes));
    assert.equal(r.source.byteSize,f.bytes.length);assert.equal(r.validationVersion,'crest-image-v1-sharp-0.35.5');
    const bytes=Buffer.from(r.preview.bytes,'base64');assert.equal(hash(bytes),r.preview.sha256);assert.equal(bytes.length,r.preview.byteSize);
    const metadata=await sharp(bytes).metadata();for(const key of ['exif','xmp','icc','iptc','orientation'])assert.equal(metadata[key],undefined);
    assert(metadata.width<=2048&&metadata.height<=2048);await sharp(bytes,{failOn:'warning'}).raw().toBuffer();
  });
});
test('same isolated worker quarantines every adversarial byte fixture with redacted verdict',async t=>{
  for(const f of fixtures.invalid)await t.test(f.name,()=>{
    const {result,exit}=run(f.bytes,f.type);assert.equal(exit,1);assert.deepEqual(result,{status:'Quarantined',code:f.code});
  });
});
test('combined25 MiB/60MP four-channel PNG decodes within512 MiB, one CPU and32 PIDs',async()=>{
  const core=await sharp({create:{width:10000,height:6000,channels:4,background:{r:34,g:68,b:102,alpha:0.5}}}).png().toBuffer();
  const bytes=Buffer.concat([core.subarray(0,-12),chunk('rNDm',Buffer.alloc(maximum-core.length-12)),core.subarray(-12)]);
  assert.equal(bytes.length,maximum);
  const {result,exit}=run(bytes,'image/png');assert.equal(exit,0);assert.equal(result.source.width*result.source.height,60_000_000);
  assert.equal(result.source.sha256,hash(bytes));
});
test('isolated input byte limit includes exact25 MiB and rejects a larger stream',()=>{
  const base=fixtures.png,padding=chunk('rNDm',Buffer.alloc(maximum-base.length-12));
  const bytes=Buffer.concat([base.subarray(0,-12),padding,base.subarray(-12)]);
  const good=run(bytes,'image/png');assert.equal(good.exit,0);assert.equal(good.result.source.sha256,hash(bytes));
  const bad=run(Buffer.concat([bytes,Buffer.alloc(1)]),'image/png');assert.equal(bad.exit,1);assert.deepEqual(bad.result,{status:'Quarantined',code:'IMAGE_SIZE_INVALID'});
});
test('worker refuses weakened network/memory/CPU/PID/privilege/read-only/user isolation before reading bytes',async t=>{
  const profiles={network:{network:['--network','bridge']},memory:{memory:[]},swap:{memory:['--memory','512m','--memory-swap','1g']},
    cpu:{cpu:[]},pids:{pids:[]},capabilities:{capabilities:[]},privileges:{privileges:[]},writable:{readonly:[]},root:{user:['--user','root']},
    seccomp:{privileges:['--security-opt','no-new-privileges','--security-opt','seccomp=unconfined']}};
  for(const [name,profile] of Object.entries(profiles))await t.test(name,()=>{
    const {result,exit}=run(fixtures.png,'image/png',profile);assert.equal(exit,1);assert.deepEqual(result,{status:'Quarantined',code:'IMAGE_SANDBOX_REQUIRED'});
  });
});
test('worker wall watchdog ends stalled open stdin and owned container is removed',async()=>{
  const id=create();
  try{
    const child=spawn('docker',['start','--attach','--interactive',id],{stdio:['pipe','pipe','pipe']});
    let stdout='';child.stdout.on('data',b=>{stdout+=b;if(stdout.length>1024)child.kill();});child.stderr.resume();child.stdin.on('error',()=>{});
    const timer=setTimeout(()=>child.kill(),22000);
    try{
      const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
      assert.equal(code,1);assert.deepEqual(JSON.parse(stdout),{status:'Quarantined',code:'IMAGE_WORKER_TIMEOUT'});
    }finally{clearTimeout(timer);child.stdin.destroy();}
  }finally{docker(['rm','--force',id],{stdio:'ignore'});}
});
