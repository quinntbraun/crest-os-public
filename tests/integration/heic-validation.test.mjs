import assert from 'node:assert/strict';
import {test,before} from 'node:test';
import {createHash} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {heicFixtures,boundaryHeic} from '../support/heic-fixtures.mjs';
import {validateHeic,HeicValidationError,heicValidationVersion,maximumHeicBytes} from '../../src/files/heic-validation.ts';
const hash=b=>createHash('sha256').update(b).digest('hex');let fixtures;
before(async()=>{assert.equal(process.platform,'linux');fixtures=await heicFixtures();});
test('patched decoder consumes generated HEIC originals and returns correctly oriented metadata-free previews',async t=>{
  for(const f of fixtures.valid)await t.test(f.name,async()=>{
    const copy=Buffer.from(f.bytes),r=await validateHeic(f.bytes,'image/heic'),m=await sharp(r.preview.bytes).metadata();
    assert.equal(r.validationVersion,heicValidationVersion);assert.equal(r.source.sha256,hash(copy));assert.equal(r.source.byteSize,copy.length);assert(f.bytes.equals(copy));
    assert.equal(r.source.detectedType,'image/heic');assert.equal(r.source.displayWidth,f.width);assert.equal(r.source.displayHeight,f.height);
    if(f.depth)assert.equal(r.source.bitDepth,f.depth);assert.equal(m.width,f.width);assert.equal(m.height,f.height);assert.equal(m.format,'jpeg');
    assert.equal(r.preview.sha256,hash(r.preview.bytes));assert.equal(r.preview.byteSize,r.preview.bytes.length);
    for(const key of ['exif','xmp','icc','iptc','orientation'])assert.equal(m[key],undefined);
    const {data}=await sharp(r.preview.bytes).raw().toBuffer({resolveWithObject:true});
    if(f.name==='transparent alpha')assert.deepEqual([...data.subarray(0,3)],[255,255,255]);
    else for(let i=0;i<3;i++)assert(Math.abs(data[i]-[34,68,102][i])<12,`preview color channel ${i}`);
  });
});
test('malformed, unsupported, excessive and corrupt HEIC files quarantine with stable redacted failures',async t=>{
  for(const f of fixtures.invalid)await t.test(f.name,()=>assert.rejects(validateHeic(f.bytes,'image/heic'),e=>{
    assert(e instanceof HeicValidationError);assert(f.codes.includes(e.code),e.code);assert.equal(e.message,e.code);assert.equal(e.cause,undefined);return true;
  }));
});
test('combined25 MiB/60MP tiled HEIC fully decodes; only preview shrinks',async()=>{
  const bytes=await boundaryHeic(),r=await validateHeic(bytes,'image/heif');assert.equal(bytes.length,maximumHeicBytes);
  assert.equal(r.source.sha256,hash(bytes));assert.equal(r.source.width*r.source.height,60_000_000);assert.equal(r.preview.width,2048);assert.equal(r.preview.height,1229);
  await assert.rejects(validateHeic(Buffer.concat([bytes,Buffer.alloc(1)]),'image/heic'),{code:'HEIC_SIZE_INVALID'});
});
test('caller mutation and MIME mismatch cannot replace the sealed original; temporary files are removed',async()=>{
  const list=async()=>(await readdir(tmpdir())).filter(n=>n.startsWith('crest-heic-')).sort(),prior=await list();
  const bytes=Buffer.from(fixtures.plain),expected=hash(bytes),validating=validateHeic(bytes,'image/heic');bytes.fill(0);assert.equal((await validating).source.sha256,expected);
  await assert.rejects(validateHeic(fixtures.plain,'image/jpeg'),{code:'HEIC_TYPE_MISMATCH'});
  await assert.rejects(validateHeic(fixtures.invalid[0].bytes,'image/heic'));assert.deepEqual(await list(),prior);
});
