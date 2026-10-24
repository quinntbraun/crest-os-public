import assert from 'node:assert/strict';
import {test,before} from 'node:test';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {heicFixtures,boundaryHeic} from '../support/heic-fixtures.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');let fixtures;
before(async()=>{assert.equal(process.platform,'linux');fixtures=await heicFixtures();});
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:12*1024*1024,...options});
function create(overrides={},type='image/heic'){
  const profile={network:['--network','none'],readonly:['--read-only'],capabilities:['--cap-drop','ALL'],privileges:['--security-opt','no-new-privileges'],
    memory:['--memory','1g','--memory-swap','1g'],cpu:['--cpus','1'],pids:['--pids-limit','32'],user:['--user','node'],...overrides};
  const id=docker(['create','--interactive','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=320m',...Object.values(profile).flat(),'crest-os:ci',
    'node','--max-old-space-size=128','server/heic-worker.mjs',type]).trim();assert.match(id,/^[a-f0-9]{64}$/);return id;
}
function run(bytes,overrides={},type='image/heic'){
  const id=create(overrides,type);
  try{
    let stdout,exit=0;try{stdout=docker(['start','--attach','--interactive',id],{input:bytes});}
    catch(e){assert.equal(e.status,1,'HEIC_CONTAINER_EXECUTION_FAILED');stdout=String(e.stdout??'');exit=1;}
    let result;try{result=JSON.parse(stdout);}catch{throw new Error('HEIC_CONTAINER_PROTOCOL_FAILED');}
    const state=JSON.parse(docker(['inspect','--format','{{json .State}}',id]));assert.equal(state.OOMKilled,false);assert.equal(state.ExitCode,exit);return {result,exit};
  }finally{docker(['rm','--force',id],{stdio:'ignore'});}
}
test('patched same-release decoder handles 8/10-bit, alpha, P3, rotated and tiled originals inside actual kernel limits',async t=>{
  for(const f of fixtures.valid)await t.test(f.name,async()=>{
    const {result:r,exit}=run(f.bytes);assert.equal(exit,0);assert.equal(r.status,'Validated');assert.equal(r.source.sha256,hash(f.bytes));assert.equal(r.source.byteSize,f.bytes.length);
    const preview=Buffer.from(r.preview.bytes,'base64'),m=await sharp(preview).metadata();assert.equal(hash(preview),r.preview.sha256);assert.equal(preview.length,r.preview.byteSize);
    assert.equal(m.format,'jpeg');assert.equal(m.width,f.width);assert.equal(m.height,f.height);if(f.depth)assert.equal(r.source.bitDepth,f.depth);
    for(const key of ['exif','xmp','icc','iptc','orientation'])assert.equal(m[key],undefined);
    const {data}=await sharp(preview).raw().toBuffer({resolveWithObject:true});
    if(f.name==='transparent alpha')assert.deepEqual([...data.subarray(0,3)],[255,255,255]);else for(let i=0;i<3;i++)assert(Math.abs(data[i]-[34,68,102][i])<12);
  });
});
test('same admitted worker quarantines corrupt/excessive/unsupported originals with redacted errors',async t=>{
  for(const f of fixtures.invalid)await t.test(f.name,()=>{const {result,exit}=run(f.bytes);assert.equal(exit,1);assert.equal(result.status,'Quarantined');assert(f.codes.includes(result.code),result.code);assert.deepEqual(Object.keys(result).sort(),['code','status']);});
});
test('combined25 MiB/60MP grid decodes under1 GiB/one CPU/32 PIDs; larger input fails',async()=>{
  const bytes=await boundaryHeic(),{result,exit}=run(bytes);assert.equal(exit,0);assert.equal(result.source.sha256,hash(bytes));assert.equal(result.source.width*result.source.height,60_000_000);
  assert.equal(result.preview.width,2048);assert.equal(result.preview.height,1229);
  const bad=run(Buffer.concat([bytes,Buffer.alloc(1)]));assert.equal(bad.exit,1);assert.deepEqual(bad.result,{status:'Quarantined',code:'HEIC_SIZE_INVALID'});
});
test('HEIC entrypoint refuses weakened network, memory, privilege and user profiles',async t=>{
  const profiles={network:{network:['--network','bridge']},memory:{memory:['--memory','2g','--memory-swap','2g']},
    privileges:{privileges:[]},root:{user:['--user','root']}};
  for(const [name,p] of Object.entries(profiles))await t.test(name,()=>{const {result,exit}=run(fixtures.plain,p);assert.equal(exit,1);assert.deepEqual(result,{status:'Quarantined',code:'HEIC_SANDBOX_REQUIRED'});});
});
test('HEIC watchdog terminates stalled input; exact owned container is cleaned up',async()=>{
  const id=create();
  try{
    const child=spawn('docker',['start','--attach','--interactive',id],{stdio:['pipe','pipe','pipe']});let stdout='';
    child.stdout.on('data',b=>{stdout+=b;if(stdout.length>1024)child.kill();});child.stderr.resume();child.stdin.on('error',()=>{});const timer=setTimeout(()=>child.kill(),55000);
    try{const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});assert.equal(code,1);assert.deepEqual(JSON.parse(stdout),{status:'Quarantined',code:'HEIC_WORKER_TIMEOUT'});}
    finally{clearTimeout(timer);child.stdin.destroy();}
  }finally{docker(['rm','--force',id],{stdio:'ignore'});}
});
