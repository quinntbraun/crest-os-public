import 'server-only';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,stat,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import sharp from 'sharp';
export const maximumHeicBytes=25*1024*1024,maximumHeicPixels=60_000_000;
import {heicValidationVersion} from './validation-contract.ts';
export {heicValidationVersion};
type Code='HEIC_SIZE_INVALID'|'HEIC_CONTAINER_INVALID'|'HEIC_TYPE_MISMATCH'|'HEIC_FORMAT_UNAVAILABLE'|'HEIC_PIXEL_LIMIT'|'HEIC_DECODE_FAILED'|'HEIC_TOOLS_UNAVAILABLE';
export class HeicValidationError extends Error {readonly code:Code;constructor(code:Code){super(code);this.name='HeicValidationError';this.code=code;}}
const fail=(code:Code):never=>{throw new HeicValidationError(code);};
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),execute=promisify(execFile);
export function inspectHeicContainer(b:Buffer){
  let pos=0,count=0,meta=0,mdat=0;const brands:string[]=[];
  while(pos<b.length){
    if(++count>4096||b.length-pos<8)fail('HEIC_CONTAINER_INVALID');
    let size=b.readUInt32BE(pos),header=8;const kind=b.toString('latin1',pos+4,pos+8);
    if(size===1){if(b.length-pos<16)fail('HEIC_CONTAINER_INVALID');const large=b.readBigUInt64BE(pos+8);if(large>BigInt(b.length))fail('HEIC_CONTAINER_INVALID');size=Number(large);header=16;}
    else if(size===0){if(kind!=='mdat')fail('HEIC_CONTAINER_INVALID');size=b.length-pos;}
    if(size<header||size>b.length-pos)fail('HEIC_CONTAINER_INVALID');
    if(pos===0&&kind!=='ftyp')fail('HEIC_CONTAINER_INVALID');
    if(kind==='ftyp'){
      if(pos!==0||size<header+8||(size-header)%4)fail('HEIC_CONTAINER_INVALID');
      brands.push(b.toString('latin1',pos+header,pos+header+4));
      for(let i=pos+header+8;i<pos+size;i+=4)brands.push(b.toString('latin1',i,i+4));
      if(brands.length>64)fail('HEIC_CONTAINER_INVALID');
    }
    if(kind==='meta')meta++;if(kind==='mdat')mdat++;
    if(['moov','trak','mvhd'].includes(kind))fail('HEIC_FORMAT_UNAVAILABLE');pos+=size;
  }
  if(!brands.some(b=>b==='heic'||b==='heix')||brands.some(b=>['avif','avis','hevc','hevx','msf1'].includes(b)))fail('HEIC_FORMAT_UNAVAILABLE');
  if(meta!==1||mdat<1)fail('HEIC_CONTAINER_INVALID');
}
export async function validateHeic(input:Uint8Array,declaredType:string){
  if(!(input instanceof Uint8Array)||input.byteLength<1||input.byteLength>maximumHeicBytes)fail('HEIC_SIZE_INVALID');
  if(!['image/heic','image/heif'].includes(declaredType))fail('HEIC_TYPE_MISMATCH');
  const bytes=Buffer.from(input),sha256=hash(bytes);inspectHeicContainer(bytes);
  if(process.platform!=='linux')fail('HEIC_TOOLS_UNAVAILABLE');
  const directory=await mkdtemp(join(tmpdir(),'crest-heic-')),original=join(directory,'original.heic'),raster=join(directory,'decoded.png');
  const binary=resolve('.local/tools/heic/bin/crest-heic-decode'),env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:directory,NODE_ENV:'production' as const};
  try{
    await writeFile(original,bytes,{mode:0o600,flag:'wx'});
    try{const r=await execute(binary,['--version'],{env,timeout:5000,maxBuffer:65536});if(r.stdout.trim()!=='crest-heic-v1 libheif1.23.6 libde2651.1.3')fail('HEIC_TOOLS_UNAVAILABLE');}
    catch{return fail('HEIC_TOOLS_UNAVAILABLE');}
    let report:Record<string,unknown>;
    try{const r=await execute(binary,[original,raster],{env,timeout:25000,maxBuffer:65536});report=JSON.parse(r.stdout);}
    catch(error){
      try{const code=JSON.parse((error as {stdout:string}).stdout).code;if(['HEIC_PIXEL_LIMIT','HEIC_FORMAT_UNAVAILABLE','HEIC_TOOLS_UNAVAILABLE'].includes(code))return fail(code as Code);}catch(e){if(e instanceof HeicValidationError)throw e;}
      return fail('HEIC_DECODE_FAILED');
    }
    if(!report||typeof report!=='object'||Object.keys(report).sort().join()!=='bitDepth,encodedHeight,encodedWidth,height,width')fail('HEIC_DECODE_FAILED');
    const {width,height,encodedWidth,encodedHeight,bitDepth}=report;
    for(const [w,h] of [[width,height],[encodedWidth,encodedHeight]])if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||Number(w)<1||Number(h)<1||Number(w)*Number(h)>maximumHeicPixels)fail('HEIC_PIXEL_LIMIT');
    if(!Number.isSafeInteger(bitDepth)||Number(bitDepth)<8||Number(bitDepth)>16)fail('HEIC_DECODE_FAILED');
    const size=(await stat(raster)).size;if(size<1||size>256*1024*1024)fail('HEIC_DECODE_FAILED');
    const png=await readFile(raster);sharp.cache(false);sharp.concurrency(1);let warned=false;
    const image=sharp(png,{limitInputPixels:maximumHeicPixels,failOn:'warning'}).on('warning',()=>{warned=true;});
    const metadata=await image.metadata();if(warned||metadata.format!=='png'||metadata.width!==width||metadata.height!==height)fail('HEIC_DECODE_FAILED');
    const preview=await image.resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'})
      .jpeg({quality:85}).timeout({seconds:10}).toBuffer({resolveWithObject:true});
    if(warned||preview.data.length>8*1024*1024)fail('HEIC_DECODE_FAILED');
    return {validationVersion:heicValidationVersion,source:{sha256,byteSize:bytes.length,detectedType:'image/heic' as const,
      width:encodedWidth as number,height:encodedHeight as number,displayWidth:width as number,displayHeight:height as number,bitDepth:bitDepth as number},
      preview:{bytes:preview.data,sha256:hash(preview.data),byteSize:preview.data.length,contentType:'image/jpeg' as const,width:preview.info.width,height:preview.info.height}};
  }catch(e){if(e instanceof HeicValidationError)throw e;return fail('HEIC_DECODE_FAILED');}
  finally{await unlink(original).catch(()=>{});await unlink(raster).catch(()=>{});await rmdir(directory).catch(()=>{});}
}
