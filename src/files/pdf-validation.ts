import 'server-only';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,readFile,chmod,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {PDFiumLibrary} from '@hyzyla/pdfium';
import sharp from 'sharp';
import toolchain from '../../release/toolchain.json' with {type:'json'};

export const maximumPdfBytes=25*1024*1024,maximumPdfPages=100;
import {pdfValidationVersion} from './validation-contract.ts';
export {pdfValidationVersion};
type Failure='PDF_SIZE_INVALID'|'PDF_CONTAINER_INVALID'|'PDF_ENCRYPTED'|'PDF_ACTIVE_CONTENT'|'PDF_PAGE_LIMIT'
  |'PDF_UNINSPECTABLE'|'PDF_RENDER_FAILED'|'PDF_TOOLS_UNAVAILABLE';
export class PdfValidationError extends Error {
  readonly code:Failure;
  constructor(code:Failure){super(code);this.name='PdfValidationError';this.code=code;}
}
function fail(code:Failure):never{throw new PdfValidationError(code);}
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const execute=promisify(execFile);
const deniedNames=new Set(['/JavaScript','/JS','/EmbeddedFiles','/EmbeddedFile','/EF','/AF','/FileAttachment','/Launch',
  '/OpenAction','/AA','/XFA','/RichMedia','/3D','/Rendition','/SubmitForm','/ImportData','/GoToR','/GoToE']);
type RecordValue=Record<string,unknown>;
function record(v:unknown):v is RecordValue{return !!v&&typeof v==='object'&&!Array.isArray(v);}

// Interpret qpdf's normalized object names, including compressed and unreferenced
// objects. Literal PDF strings use u:/b: prefixes and are never scanned as code.
export function inspectPdfObjects(value:unknown){
  if(!record(value)||value.version!==2||!record(value.encrypt)||value.encrypt.encrypted!==false
    ||!Array.isArray(value.qpdf)||value.qpdf.length!==2||!record(value.qpdf[0])||value.qpdf[0].jsonversion!==2
    ||!record(value.qpdf[1])||!Array.isArray(value.pages))fail('PDF_UNINSPECTABLE');
  if(value.pages.length<1||value.pages.length>maximumPdfPages)fail('PDF_PAGE_LIMIT');
  if(!record(value.attachments)||Object.keys(value.attachments).length)fail('PDF_ACTIVE_CONTENT');
  const objects=value.qpdf[1],stack:{value:unknown;depth:number}[]=[{value:objects,depth:0}];let count=0;
  if(record(objects.trailer)&&record(objects.trailer.value)&&objects.trailer.value['/Encrypt']!==undefined)fail('PDF_ENCRYPTED');
  while(stack.length){
    const item=stack.pop()!;if(++count>100000||item.depth>64)fail('PDF_UNINSPECTABLE');
    const v=item.value;
    if(typeof v==='string'){
      if(deniedNames.has(v))fail('PDF_ACTIVE_CONTENT');
      if(/^\d+ \d+ R$/.test(v)&&!Object.hasOwn(objects,`obj:${v}`))fail('PDF_UNINSPECTABLE');
    }else if(Array.isArray(v))for(const child of v)stack.push({value:child,depth:item.depth+1});
    else if(record(v)){
      if(record(v.stream)&&record(v.stream.dict)&&Object.hasOwn(v.stream.dict,'/F'))fail('PDF_UNINSPECTABLE');
      for(const [key,child] of Object.entries(v)){
        if(deniedNames.has(key))fail('PDF_ACTIVE_CONTENT');
        stack.push({value:child,depth:item.depth+1});
      }
    }else if(typeof v==='number'&&!Number.isFinite(v))fail('PDF_UNINSPECTABLE');
  }
  for(let i=0;i<value.pages.length;i++){
    const page=value.pages[i];
    if(!record(page)||page.pageposfrom1!==i+1||typeof page.object!=='string'||!Object.hasOwn(objects,`obj:${page.object}`))fail('PDF_UNINSPECTABLE');
  }
  return value.pages.length;
}

// Trusted fixture callers may exercise this directly. Untrusted originals must
// use the same-release admitted no-network worker and its external wall deadline.
export async function validatePdf(input:Uint8Array,previewPage=1){
  if(!(input instanceof Uint8Array)||input.byteLength<1||input.byteLength>maximumPdfBytes)fail('PDF_SIZE_INVALID');
  const bytes=Buffer.from(input),sha256=hash(bytes);
  if(!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(bytes.subarray(0,10).toString('latin1'))
    ||! /%%EOF[ \t\r\n]*$/.test(bytes.subarray(-1024).toString('latin1')))fail('PDF_CONTAINER_INVALID');
  if(!Number.isSafeInteger(previewPage)||previewPage<1||previewPage>maximumPdfPages)fail('PDF_PAGE_LIMIT');
  const binary=resolve('.local/tools/pdf/qpdf/bin',process.platform==='win32'?'qpdf.exe':'qpdf');
  const directory=await mkdtemp(join(tmpdir(),'crest-pdf-'));await chmod(directory,0o700);const path=join(directory,'original.pdf');
  let engine:PDFiumLibrary|undefined;
  try{
    await writeFile(path,bytes,{mode:0o600,flag:'wx'});
    const options={timeout:10000,maxBuffer:8*1024*1024,windowsHide:true};
    let version:string;
    try{version=(await execute(binary,['--version'],options)).stdout;}catch{return fail('PDF_TOOLS_UNAVAILABLE');}
    if(version.split(/\r?\n/,1)[0]!==`qpdf version ${toolchain.pdf.qpdfVersion}`)fail('PDF_TOOLS_UNAVAILABLE');
    try{await execute(binary,['--is-encrypted',path],options);return fail('PDF_ENCRYPTED');}
    catch(error){if(error instanceof PdfValidationError)throw error;if(!record(error)||error.code!==2)fail('PDF_UNINSPECTABLE');}
    let inspection:unknown;
    try{
      // Never combine --check with JSON: check output is not JSON, and recovery
      // warnings must not be silently accepted. Neither child output is logged.
      await execute(binary,['--suppress-recovery','--check',path],options);
      const {stdout}=await execute(binary,['--suppress-recovery','--json=2','--json-stream-data=none',path],options);
      inspection=JSON.parse(stdout);
    }catch{return fail('PDF_UNINSPECTABLE');}
    const pageCount=inspectPdfObjects(inspection);if(previewPage>pageCount)fail('PDF_PAGE_LIMIT');
    const wasm=await readFile(new URL(import.meta.resolve('@hyzyla/pdfium/pdfium.wasm')));
    if(hash(wasm)!==toolchain.pdf.pdfiumWasmSha256)fail('PDF_TOOLS_UNAVAILABLE');
    engine=await PDFiumLibrary.init({wasmBinary:wasm});
    const document=await engine.loadDocument(bytes);
    let preview:undefined|{bytes:Buffer;byteSize:number;sha256:string;contentType:'image/jpeg';width:number;height:number;pageNumber:number};
    try{
      if(document.getPageCount()!==pageCount)fail('PDF_UNINSPECTABLE');
      sharp.cache(false);sharp.concurrency(1);
      for(let i=0;i<pageCount;i++){
        const page=document.getPage(i);
        try{
          const {originalWidth,originalHeight}=page.getOriginalSize();
          if(!Number.isFinite(originalWidth)||!Number.isFinite(originalHeight)||originalWidth<=0||originalHeight<=0)fail('PDF_RENDER_FAILED');
          // Vector receipts benefit from 144 dpi, bounded to 2048 pixels/side.
          const scale=Math.min(2,2048/originalWidth,2048/originalHeight);
          const width=Math.floor(originalWidth*scale),height=Math.floor(originalHeight*scale);
          if(width<1||height<1||width>2048||height>2048)fail('PDF_RENDER_FAILED');
          const raster=await page.render({scale,colorSpace:'RGBA',transparent:false,renderFormFields:true});
          if(raster.width<1||raster.height<1||raster.width>2048||raster.height>2048||raster.data.length!==raster.width*raster.height*4)fail('PDF_RENDER_FAILED');
          if(i+1===previewPage){
            let warned=false;
            const result=await sharp(raster.data,{raw:{width:raster.width,height:raster.height,channels:4}}).on('warning',()=>{warned=true;})
              .flatten({background:'#ffffff'}).jpeg({quality:85}).timeout({seconds:10}).toBuffer({resolveWithObject:true});
            if(warned||result.data.length>8*1024*1024)fail('PDF_RENDER_FAILED');
            preview={bytes:result.data,byteSize:result.data.length,sha256:hash(result.data),contentType:'image/jpeg',width:result.info.width,height:result.info.height,pageNumber:previewPage};
          }
        }finally{page.close();}
      }
    }finally{document.destroy();}
    if(!preview)fail('PDF_RENDER_FAILED');
    return {validationVersion:pdfValidationVersion,source:{sha256,byteSize:bytes.length,detectedType:'application/pdf' as const,pageCount},preview};
  }catch(error){if(error instanceof PdfValidationError)throw error;return fail('PDF_RENDER_FAILED');}
  finally{engine?.destroy();await unlink(path).catch(()=>{});await rmdir(directory).catch(()=>{});}
}
