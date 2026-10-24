// Native decoder tests with generated synthetic bytes. Container isolation is a
// separate mandatory gate; this trusted fixture does not admit user uploads.
import assert from 'node:assert/strict';
import {test,before} from 'node:test';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {imageFixtures,chunk} from '../support/image-fixtures.mjs';
import {validateImage,ImageValidationError,imageValidationVersion,maximumImageBytes} from '../../src/files/image-validation.ts';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let fixtures;
before(async()=>{fixtures=await imageFixtures();});
test('generated baseline/progressive/PNG/palette/alpha originals decode completely; previews have independent hashes',async t=>{
  for(const f of fixtures.valid)await t.test(f.name,async()=>{
    const original=Buffer.from(f.bytes),r=await validateImage(f.bytes,f.type),preview=await sharp(r.preview.bytes).metadata();
    assert.equal(r.validationVersion,imageValidationVersion);assert.equal(r.source.sha256,hash(original));assert.equal(r.source.byteSize,original.length);
    assert.equal(r.source.detectedType,f.type);assert.equal(r.preview.sha256,hash(r.preview.bytes));assert.equal(r.preview.byteSize,r.preview.bytes.length);
    assert.equal(preview.format,'jpeg');assert(preview.width<=2048&&preview.height<=2048);
    for(const key of ['exif','xmp','icc','iptc','orientation'])assert.equal(preview[key],undefined);
    assert(f.bytes.equals(original));await sharp(r.preview.bytes,{failOn:'warning'}).raw().toBuffer();
  });
});
test('EXIF rotation affects only preview; private metadata/original hash remain intact',async()=>{
  const before=await sharp(fixtures.withExif).metadata(),result=await validateImage(fixtures.withExif,'image/jpeg');
  assert.equal(before.orientation,6);assert(before.exif);assert.equal(result.source.width,8);assert.equal(result.source.height,4);
  assert.equal(result.preview.width,4);assert.equal(result.preview.height,8);assert.equal(result.source.sha256,hash(fixtures.withExif));
});
test('transparent PNG preview composites white without changing original',async()=>{
  const input=fixtures.valid.find(f=>f.name==='transparent PNG').bytes,result=await validateImage(input,'image/png');
  const {data}=await sharp(result.preview.bytes).raw().toBuffer({resolveWithObject:true});assert.deepEqual([...data.subarray(0,3)],[255,255,255]);
});
test('malformed containers, actual decode errors, wrong type and unsupported formats cannot validate',async t=>{
  for(const f of fixtures.invalid)await t.test(f.name,()=>assert.rejects(validateImage(f.bytes,f.type),error=>{
    assert(error instanceof ImageValidationError);assert.equal(error.code,f.code);assert.equal(error.cause,undefined);assert.equal(error.message,f.code);return true;
  }));
});
test('25 MiB byte boundary is exact and preserves permitted original ancillary bytes',async()=>{
  const base=fixtures.png,padding=chunk('rNDm',Buffer.alloc(maximumImageBytes-base.length-12));
  const bytes=Buffer.concat([base.subarray(0,-12),padding,base.subarray(-12)]);
  assert.equal(bytes.length,maximumImageBytes);assert.equal((await validateImage(bytes,'image/png')).source.sha256,hash(bytes));
  await assert.rejects(validateImage(Buffer.concat([bytes,Buffer.alloc(1)]),'image/png'),{code:'IMAGE_SIZE_INVALID'});
});
test('60 megapixel image fully decodes at the declared pixel boundary',async()=>{
  const bytes=await sharp({create:{width:10000,height:6000,channels:3,background:'#224466'}}).png().toBuffer();
  const result=await validateImage(bytes,'image/png');assert.equal(result.source.width*result.source.height,60_000_000);
  assert.equal(result.preview.width,2048);assert.equal(result.preview.height,1229);
});
test('caller mutation after invocation cannot replace the sealed source snapshot',async()=>{
  const bytes=Buffer.from(fixtures.jpeg),expected=hash(bytes),validating=validateImage(bytes,'image/jpeg');bytes.fill(0);
  assert.equal((await validating).source.sha256,expected);
});
