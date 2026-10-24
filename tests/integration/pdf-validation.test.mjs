import assert from 'node:assert/strict';
import {test,before} from 'node:test';
import {createHash} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {pdf,pdfFixtures} from '../support/pdf-fixtures.mjs';
import {validatePdf,PdfValidationError,pdfValidationVersion,maximumPdfBytes,inspectPdfObjects} from '../../src/files/pdf-validation.ts';
const hash=b=>createHash('sha256').update(b).digest('hex');let fixtures;
before(async()=>{fixtures=await pdfFixtures();});
test('synthetic static, compressed and form originals retain bytes; safe previews strip metadata',async t=>{
  for(const f of fixtures.valid)await t.test(f.name,async()=>{
    const original=Buffer.from(f.bytes),r=await validatePdf(f.bytes),m=await sharp(r.preview.bytes).metadata();
    assert.equal(r.validationVersion,pdfValidationVersion);assert.equal(r.source.sha256,hash(original));assert.equal(r.source.byteSize,original.length);
    assert.equal(r.source.pageCount,1);assert.equal(r.source.detectedType,'application/pdf');assert(f.bytes.equals(original));
    assert.equal(m.format,'jpeg');assert.equal(m.width,400);assert.equal(m.height,200);
    assert.equal(r.preview.sha256,hash(r.preview.bytes));assert.equal(r.preview.byteSize,r.preview.bytes.length);
    for(const key of ['exif','xmp','icc','iptc','orientation'])assert.equal(m[key],undefined);
  });
});
test('encrypted, active, malformed and excessive PDFs fail with stable redacted errors',async t=>{
  for(const f of fixtures.invalid)await t.test(f.name,()=>assert.rejects(validatePdf(f.bytes),e=>{
    assert(e instanceof PdfValidationError);assert.equal(e.code,f.code);assert.equal(e.message,f.code);assert.equal(e.cause,undefined);return true;
  }));
});
test('100 pages all render; only requested last-page preview is returned',async()=>{
  const bytes=pdf({pages:100}),r=await validatePdf(bytes,100);assert.equal(r.source.pageCount,100);assert.equal(r.preview.pageNumber,100);
  const {data}=await sharp(r.preview.bytes).raw().toBuffer({resolveWithObject:true});assert(data[1]>180&&data[0]<10&&data[2]<10);
  assert.deepEqual(Object.keys(r).sort(),['preview','source','validationVersion']);
});
test('filled receipt form remains visible in the raster',async()=>{
  const {preview}=await validatePdf(fixtures.form),{data}=await sharp(preview.bytes).raw().toBuffer({resolveWithObject:true});
  let dark=0;for(let i=0;i<data.length;i+=3)if(data[i]<60&&data[i+1]<60&&data[i+2]<60)dark++;
  assert(dark>200,'filled field text must appear in preview');
});
test('large vector page renders within the 2048-pixel preview bound',async()=>{
  const {preview}=await validatePdf(pdf({width:10000,height:5000}));assert.equal(preview.width,2048);assert.equal(preview.height,1024);
});
test('25 MiB inclusive limit and sealed caller snapshot preserve exact original hash',async()=>{
  let padding=maximumPdfBytes-pdf({padding:1}).length+1,bytes=pdf({padding});
  padding+=maximumPdfBytes-bytes.length;bytes=pdf({padding});assert.equal(bytes.length,maximumPdfBytes);
  const expected=hash(bytes),result=validatePdf(bytes);bytes.fill(0);assert.equal((await result).source.sha256,expected);
  await assert.rejects(validatePdf(Buffer.alloc(maximumPdfBytes+1)),{code:'PDF_SIZE_INVALID'});
});
test('invalid page selections fail; temporary originals are removed after success and quarantine',async()=>{
  const list=async()=>(await readdir(tmpdir())).filter(n=>n.startsWith('crest-pdf-')).sort(),before=await list();
  for(const p of [0,1.5,2,101,NaN])await assert.rejects(validatePdf(fixtures.simple,p),{code:'PDF_PAGE_LIMIT'});
  await validatePdf(fixtures.simple);await assert.rejects(validatePdf(fixtures.javascript),{code:'PDF_ACTIVE_CONTENT'});assert.deepEqual(await list(),before);
});
test('normalized inspection rejects missing objects and bounded graph overflow',()=>{
  const base={version:2,encrypt:{encrypted:false},attachments:{},pages:[{pageposfrom1:1,object:'1 0 R'}],qpdf:[{jsonversion:2},{'obj:1 0 R':{value:{'/Missing':'9 0 R'}}}]};
  assert.throws(()=>inspectPdfObjects(base),{code:'PDF_UNINSPECTABLE'});
  let value={};for(let i=0;i<70;i++)value={next:value};base.qpdf[1]={'obj:1 0 R':{value}};
  assert.throws(()=>inspectPdfObjects(base),{code:'PDF_UNINSPECTABLE'});
});
