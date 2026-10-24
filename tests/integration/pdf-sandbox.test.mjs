// Real same-release kernel sandbox; no provider, credentials, mounts or real data.
import assert from 'node:assert/strict';
import {test,before} from 'node:test';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {pdf,pdfFixtures} from '../support/pdf-fixtures.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),maximum=25*1024*1024;let fixtures;
before(async()=>{assert.equal(process.platform,'linux');fixtures=await pdfFixtures();});
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',timeout:45000,maxBuffer:12*1024*1024,...options});
function create(page=1,overrides={}){
  const profile={network:['--network','none'],readonly:['--read-only'],capabilities:['--cap-drop','ALL'],privileges:['--security-opt','no-new-privileges'],
    memory:['--memory','512m','--memory-swap','512m'],cpu:['--cpus','1'],pids:['--pids-limit','32'],user:['--user','node'],...overrides};
  const id=docker(['create','--interactive','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=32m',...Object.values(profile).flat(),'crest-os:ci',
    'node','--max-old-space-size=128','server/pdf-worker.mjs',String(page)]).trim();assert.match(id,/^[a-f0-9]{64}$/);return id;
}
function run(bytes,page=1,overrides={}){
  const id=create(page,overrides);
  try{
    let stdout,exit=0;
    try{stdout=docker(['start','--attach','--interactive',id],{input:bytes});}
    catch(error){assert.equal(error.status,1,'PDF_CONTAINER_EXECUTION_FAILED');stdout=String(error.stdout??'');exit=1;}
    let result;try{result=JSON.parse(stdout);}catch{throw new Error('PDF_CONTAINER_PROTOCOL_FAILED');}
    const state=JSON.parse(docker(['inspect','--format','{{json .State}}',id]));assert.equal(state.OOMKilled,false);assert.equal(state.ExitCode,exit);
    return {result,exit};
  }finally{docker(['rm','--force',id],{stdio:'ignore'});}
}
test('same restricted release inspects and renders static, compressed and filled-form PDFs offline',async t=>{
  for(const f of fixtures.valid)await t.test(f.name,async()=>{
    const {result:r,exit}=run(f.bytes);assert.equal(exit,0);assert.equal(r.status,'Validated');assert.equal(r.source.sha256,hash(f.bytes));
    assert.equal(r.source.byteSize,f.bytes.length);assert.equal(r.source.pageCount,1);assert.equal(r.validationVersion,'crest-pdf-v1-qpdf-12.4.2-pdfium-3.0.0');
    const bytes=Buffer.from(r.preview.bytes,'base64'),m=await sharp(bytes).metadata();assert.equal(hash(bytes),r.preview.sha256);assert.equal(bytes.length,r.preview.byteSize);
    assert.equal(m.format,'jpeg');assert.equal(m.width,400);assert.equal(m.height,200);
    for(const key of ['exif','xmp','icc','iptc','orientation'])assert.equal(m[key],undefined);
    const {data}=await sharp(bytes).raw().toBuffer({resolveWithObject:true});
    if(f.name==='filled AcroForm appearance'){let dark=0;for(let i=0;i<data.length;i+=3)if(data[i]<60&&data[i+1]<60&&data[i+2]<60)dark++;assert(dark>200);}
  });
});
test('isolated worker quarantines encrypted, active, malformed and excessive fixtures privately',async t=>{
  for(const f of fixtures.invalid)await t.test(f.name,()=>{
    const {result,exit}=run(f.bytes);assert.equal(exit,1);assert.deepEqual(result,{status:'Quarantined',code:f.code});
  });
});
test('combined 25 MiB/100-page boundary renders within 512 MiB, one CPU and 32 PIDs',async()=>{
  let padding=maximum-pdf({pages:100,padding:1}).length+1,bytes=pdf({pages:100,padding});padding+=maximum-bytes.length;bytes=pdf({pages:100,padding});
  assert.equal(bytes.length,maximum);const {result,exit}=run(bytes,100);assert.equal(exit,0);assert.equal(result.source.pageCount,100);
  assert.equal(result.source.sha256,hash(bytes));assert.equal(result.preview.pageNumber,100);
  const {data}=await sharp(Buffer.from(result.preview.bytes,'base64')).raw().toBuffer({resolveWithObject:true});assert(data[1]>180&&data[0]<10&&data[2]<10);
  const bad=run(Buffer.concat([bytes,Buffer.alloc(1)]));assert.equal(bad.exit,1);assert.deepEqual(bad.result,{status:'Quarantined',code:'PDF_SIZE_INVALID'});
});
test('PDF entry point rejects missing isolation and invalid page selection',()=>{
  for(const profile of [{network:['--network','bridge']},{user:['--user','root']}]){
    const {result,exit}=run(fixtures.simple,1,profile);assert.equal(exit,1);assert.deepEqual(result,{status:'Quarantined',code:'PDF_SANDBOX_REQUIRED'});
  }
  const {result,exit}=run(fixtures.simple,2);assert.equal(exit,1);assert.deepEqual(result,{status:'Quarantined',code:'PDF_PAGE_LIMIT'});
});
test('large vector page obeys the preview raster bound under kernel limits',()=>{
  const {result,exit}=run(pdf({width:10000,height:5000}));assert.equal(exit,0);assert.equal(result.preview.width,2048);assert.equal(result.preview.height,1024);
});
test('PDF watchdog ends stalled stdin; external deadline and exact owned-container cleanup remain enforced',async()=>{
  const id=create();
  try{
    const child=spawn('docker',['start','--attach','--interactive',id],{stdio:['pipe','pipe','pipe']});
    let stdout='';child.stdout.on('data',b=>{stdout+=b;if(stdout.length>1024)child.kill();});child.stderr.resume();child.stdin.on('error',()=>{});
    const timer=setTimeout(()=>child.kill(),40000);
    try{const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
      assert.equal(code,1);assert.deepEqual(JSON.parse(stdout),{status:'Quarantined',code:'PDF_WORKER_TIMEOUT'});
    }finally{clearTimeout(timer);child.stdin.destroy();}
  }finally{docker(['rm','--force',id],{stdio:'ignore'});}
});
