import 'server-only';
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import sharp from 'sharp';

import {imageValidationVersion} from './validation-contract.ts';
export {imageValidationVersion};
export const maximumImageBytes=25*1024*1024;
export const maximumImagePixels=60_000_000;
export const maximumPreviewBytes=8*1024*1024;
type Failure='IMAGE_SIZE_INVALID'|'IMAGE_FORMAT_UNAVAILABLE'|'IMAGE_TYPE_MISMATCH'|'IMAGE_CONTAINER_INVALID'
  |'IMAGE_PIXELS_EXCEEDED'|'IMAGE_ANIMATION_UNSUPPORTED'|'IMAGE_DECODE_FAILED';
export class ImageValidationError extends Error {
  readonly code:Failure;
  constructor(code:Failure){super(code);this.name='ImageValidationError';this.code=code;}
}
function fail(code:Failure):never{throw new ImageValidationError(code);}
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const pngSignature=Buffer.from([137,80,78,71,13,10,26,10]);
function dimensions(width:number,height:number){
  if(width<1||height<1)fail('IMAGE_CONTAINER_INVALID');
  if(width*height>maximumImagePixels)fail('IMAGE_PIXELS_EXCEEDED');
  return {width,height};
}
function pngContainer(bytes:Buffer){
  let pos=8,width=0,height=0,color=-1,palette=false,data=false,dataEnded=false,idatBytes=0;
  while(pos<bytes.length){
    if(pos+12>bytes.length)fail('IMAGE_CONTAINER_INVALID');
    const size=bytes.readUInt32BE(pos),end=pos+12+size;
    if(end>bytes.length)fail('IMAGE_CONTAINER_INVALID');
    const type=bytes.toString('latin1',pos+4,pos+8);
    if(!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)
      ||crc32(bytes.subarray(pos+4,end-4))!==bytes.readUInt32BE(end-4))fail('IMAGE_CONTAINER_INVALID');
    if(pos===8&&type!=='IHDR')fail('IMAGE_CONTAINER_INVALID');
    if(['acTL','fcTL','fdAT'].includes(type))fail('IMAGE_ANIMATION_UNSUPPORTED');
    if(type==='IHDR'){
      if(pos!==8||size!==13)fail('IMAGE_CONTAINER_INVALID');
      width=bytes.readUInt32BE(pos+8);height=bytes.readUInt32BE(pos+12);dimensions(width,height);
      const depth=bytes[pos+16]!;color=bytes[pos+17]!;
      const depths:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if(!depths[color]?.includes(depth)||bytes[pos+18]!==0||bytes[pos+19]!==0||![0,1].includes(bytes[pos+20]!))fail('IMAGE_CONTAINER_INVALID');
    }else if(type==='PLTE'){
      if(palette||data||color===0||color===4||size<3||size>768||size%3!==0)fail('IMAGE_CONTAINER_INVALID');
      palette=true;
    }else if(type==='IDAT'){
      if(dataEnded||(color===3&&!palette))fail('IMAGE_CONTAINER_INVALID');
      data=true;idatBytes+=size;
    }else if(type==='IEND'){
      if(size!==0||!data||idatBytes===0||end!==bytes.length)fail('IMAGE_CONTAINER_INVALID');
      return {width,height};
    }else{
      if(type[0]===type[0]!.toUpperCase())fail('IMAGE_CONTAINER_INVALID');
      if(data)dataEnded=true;
    }
    pos=end;
  }
  return fail('IMAGE_CONTAINER_INVALID');
}
function jpegContainer(bytes:Buffer){
  let pos=2,width=0,height=0,scans=0;
  const frames=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  while(pos<bytes.length){
    if(bytes[pos++]!==0xff)fail('IMAGE_CONTAINER_INVALID');
    while(bytes[pos]===0xff)pos++;
    const marker=bytes[pos++];
    if(marker===undefined||marker===0||marker===0xd8||marker===0x01||(marker>=0xd0&&marker<=0xd7))fail('IMAGE_CONTAINER_INVALID');
    if(marker===0xd9){
      if(!width||!scans||pos!==bytes.length)fail('IMAGE_CONTAINER_INVALID');
      return {width,height};
    }
    if(pos+2>bytes.length)fail('IMAGE_CONTAINER_INVALID');
    const size=bytes.readUInt16BE(pos),end=pos+size;
    if(size<2||end>bytes.length)fail('IMAGE_CONTAINER_INVALID');
    if(frames.has(marker)){
      if(width||size<11||size!==8+3*bytes[pos+7]!)fail('IMAGE_CONTAINER_INVALID');
      height=bytes.readUInt16BE(pos+3);width=bytes.readUInt16BE(pos+5);dimensions(width,height);
    }
    if(marker===0xda){
      if(!width||size<8||size!==6+2*bytes[pos+2]!)fail('IMAGE_CONTAINER_INVALID');
      scans++;pos=end;
      // Walk the actual scan boundary, respecting stuffed bytes, fill bytes and
      // restart markers. Never search for the first apparent EOI inside metadata.
      while(pos<bytes.length){
        if(bytes[pos]!==0xff){pos++;continue;}
        const start=pos++;while(bytes[pos]===0xff)pos++;
        const next=bytes[pos];
        if(next===0||(next!==undefined&&next>=0xd0&&next<=0xd7)){pos++;continue;}
        pos=start;break;
      }
    }else pos=end;
  }
  return fail('IMAGE_CONTAINER_INVALID');
}

// Only invoke on untrusted bytes inside the isolated worker. Unit/native fixture
// callers supply generated test bytes; importing this does not establish isolation.
export async function validateImage(input:Uint8Array,declaredType:string){
  if(!(input instanceof Uint8Array)||input.byteLength<1||input.byteLength>maximumImageBytes)fail('IMAGE_SIZE_INVALID');
  if(!['image/jpeg','image/png'].includes(declaredType))fail('IMAGE_FORMAT_UNAVAILABLE');
  const bytes=Buffer.from(input),sha256=digest(bytes);
  const type=bytes.subarray(0,8).equals(pngSignature)?'image/png':bytes[0]===0xff&&bytes[1]===0xd8?'image/jpeg':null;
  if(!type)fail('IMAGE_FORMAT_UNAVAILABLE');
  if(type!==declaredType)fail('IMAGE_TYPE_MISMATCH');
  const container=type==='image/png'?pngContainer(bytes):jpegContainer(bytes);
  try{
    sharp.cache(false);sharp.concurrency(1);
    // Some small JPEGs resolve with emitted native warnings even with failOn.
    // Latch warnings separately; never log their potentially sensitive text.
    let warned=false;const warning=()=>{warned=true;};
    const decoder=sharp(bytes,{failOn:'warning',limitInputPixels:maximumImagePixels,limitInputChannels:4}).on('warning',warning);
    const metadata=await decoder.metadata();
    if(warned)fail('IMAGE_DECODE_FAILED');
    if(metadata.width!==container.width||metadata.height!==container.height||(metadata.pages??1)!==1
      ||metadata.format!==(type==='image/png'?'png':'jpeg'))fail('IMAGE_CONTAINER_INVALID');
    // Full raw decode, not a header-only or shrink-on-load validation. Original
    // bytes remain unchanged; orientation is applied only to the raster preview.
    const raw=await decoder.rotate().timeout({seconds:10}).raw().toBuffer({resolveWithObject:true});
    if(warned||raw.info.width*raw.info.height!==container.width*container.height||raw.info.channels>4
      ||raw.data.length!==raw.info.width*raw.info.height*raw.info.channels)fail('IMAGE_DECODE_FAILED');
    const preview=await sharp(raw.data,{raw:{width:raw.info.width,height:raw.info.height,channels:raw.info.channels}}).on('warning',warning)
      .resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'})
      .jpeg({quality:85}).timeout({seconds:10}).toBuffer({resolveWithObject:true});
    if(warned||preview.data.length>maximumPreviewBytes)fail('IMAGE_DECODE_FAILED');
    return {validationVersion:imageValidationVersion,source:{byteSize:bytes.length,sha256,detectedType:type,...container},
      preview:{bytes:preview.data,byteSize:preview.data.length,sha256:digest(preview.data),contentType:'image/jpeg' as const,
        width:preview.info.width,height:preview.info.height}};
  }catch(error){if(error instanceof ImageValidationError)throw error;return fail('IMAGE_DECODE_FAILED');}
}
