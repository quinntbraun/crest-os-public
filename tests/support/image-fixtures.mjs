import sharp from 'sharp';
import {crc32} from 'node:zlib';

export function chunk(type,payload=Buffer.alloc(0)){
  const bytes=Buffer.alloc(12+payload.length);bytes.writeUInt32BE(payload.length);bytes.write(type,4,'latin1');payload.copy(bytes,8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4,-4)),bytes.length-4);return bytes;
}
export function chunks(bytes){
  const list=[];let pos=8;
  while(pos<bytes.length){const length=bytes.readUInt32BE(pos);list.push({type:bytes.toString('latin1',pos+4,pos+8),data:bytes.subarray(pos+8,pos+8+length)});pos+=length+12;}
  return list;
}
export function png(list){return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),...list.map(c=>chunk(c.type,c.data))]);}
export async function imageFixtures(){
  const input={create:{width:8,height:4,channels:3,background:'#224466'}};
  const jpeg=await sharp(input).jpeg().toBuffer(),progressive=await sharp(input).jpeg({progressive:true}).toBuffer();
  const normalPng=await sharp(input).png().toBuffer(),parts=chunks(normalPng);
  const withExif=await sharp(input).withMetadata({orientation:6}).withExifMerge({IFD0:{Artist:'Synthetic camera',ImageDescription:'private original metadata'}}).jpeg().toBuffer();
  const alpha=await sharp({create:{width:4,height:4,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
  const palette=await sharp(input).png({palette:true}).toBuffer();
  const altered=(type,fn)=>png(parts.map(c=>c.type===type?{...c,data:fn(Buffer.from(c.data))}:c));
  const append=Buffer.from('<html>synthetic unrelated trailing data</html>');
  const crc=Buffer.from(normalPng);crc[crc.length-1]^=1;
  const huge=Buffer.from(normalPng);huge.writeUInt32BE(0x7fffffff,8);
  const sos=jpeg.indexOf(Buffer.from([0xff,0xda])),entropy=sos+2+jpeg.readUInt16BE(sos+2);
  const brokenJpeg=Buffer.concat([jpeg.subarray(0,entropy+1),Buffer.from([0xff,0xd9])]);
  const oversizedJpeg=Buffer.from(jpeg),sof=jpeg.indexOf(Buffer.from([0xff,0xc0]));
  oversizedJpeg.writeUInt16BE(65000,sof+5);oversizedJpeg.writeUInt16BE(65000,sof+7);
  const split=[];
  for(const c of parts){if(c.type==='IDAT'){split.push({type:'IDAT',data:c.data.subarray(0,2)},{type:'rNDm',data:Buffer.alloc(0)},{type:'IDAT',data:c.data.subarray(2)});}else split.push(c);}
  const highType=png([parts[0],{type:'\u00c9HDR',data:Buffer.alloc(0)},...parts.slice(1)]);
  return {jpeg,png:normalPng,withExif,valid:[
    {name:'baseline JPEG',bytes:jpeg,type:'image/jpeg'},
    {name:'progressive JPEG',bytes:progressive,type:'image/jpeg'},
    {name:'JPEG marker-looking bytes inside APP metadata',bytes:Buffer.concat([jpeg.subarray(0,2),Buffer.from([0xff,0xef,0,6,0xff,0xd9,0xff,0xd8]),jpeg.subarray(2)]),type:'image/jpeg'},
    {name:'RGB PNG',bytes:normalPng,type:'image/png'},
    {name:'palette PNG',bytes:palette,type:'image/png'},
    {name:'transparent PNG',bytes:alpha,type:'image/png'},
    {name:'oriented private EXIF JPEG',bytes:withExif,type:'image/jpeg'}
  ],invalid:[
    {name:'JPEG trailing HTML-like bytes',bytes:Buffer.concat([jpeg,append]),type:'image/jpeg',code:'IMAGE_CONTAINER_INVALID'},
    {name:'PNG trailing HTML-like bytes',bytes:Buffer.concat([normalPng,append]),type:'image/png',code:'IMAGE_CONTAINER_INVALID'},
    {name:'concatenated JPEGs',bytes:Buffer.concat([jpeg,jpeg]),type:'image/jpeg',code:'IMAGE_CONTAINER_INVALID'},
    {name:'concatenated PNGs',bytes:Buffer.concat([normalPng,normalPng]),type:'image/png',code:'IMAGE_CONTAINER_INVALID'},
    {name:'missing JPEG EOI',bytes:jpeg.subarray(0,-2),type:'image/jpeg',code:'IMAGE_CONTAINER_INVALID'},
    {name:'truncated PNG chunk',bytes:normalPng.subarray(0,-1),type:'image/png',code:'IMAGE_CONTAINER_INVALID'},
    {name:'wrong PNG CRC',bytes:crc,type:'image/png',code:'IMAGE_CONTAINER_INVALID'},
    {name:'high-bit PNG chunk name',bytes:highType,type:'image/png',code:'IMAGE_CONTAINER_INVALID'},
    {name:'oversized PNG chunk declaration',bytes:huge,type:'image/png',code:'IMAGE_CONTAINER_INVALID'},
    {name:'zero PNG width',bytes:altered('IHDR',d=>{d.writeUInt32BE(0);return d;}),type:'image/png',code:'IMAGE_CONTAINER_INVALID'},
    {name:'PNG exceeds60 megapixels',bytes:altered('IHDR',d=>{d.writeUInt32BE(10001);d.writeUInt32BE(6000,4);return d;}),type:'image/png',code:'IMAGE_PIXELS_EXCEEDED'},
    {name:'JPEG exceeds60 megapixels',bytes:oversizedJpeg,type:'image/jpeg',code:'IMAGE_PIXELS_EXCEEDED'},
    {name:'APNG animation',bytes:png([parts[0],{type:'acTL',data:Buffer.from([0,0,0,2,0,0,0,0])},...parts.slice(1)]),type:'image/png',code:'IMAGE_ANIMATION_UNSUPPORTED'},
    {name:'unknown PNG critical chunk',bytes:png([parts[0],{type:'ZZZZ',data:Buffer.alloc(0)},...parts.slice(1)]),type:'image/png',code:'IMAGE_CONTAINER_INVALID'},
    {name:'nonconsecutive PNG data chunks',bytes:png(split),type:'image/png',code:'IMAGE_CONTAINER_INVALID'},
    {name:'CRC-correct broken PNG compressed pixels',bytes:altered('IDAT',d=>{d.fill(0);return d;}),type:'image/png',code:'IMAGE_DECODE_FAILED'},
    {name:'CRC-correct junk within PNG compressed data',bytes:altered('IDAT',d=>Buffer.concat([d,Buffer.from('trailing unrelated data')])),type:'image/png',code:'IMAGE_DECODE_FAILED'},
    {name:'JPEG truncated pixel scan with intact EOI',bytes:brokenJpeg,type:'image/jpeg',code:'IMAGE_DECODE_FAILED'},
    {name:'PNG declared JPEG',bytes:normalPng,type:'image/jpeg',code:'IMAGE_TYPE_MISMATCH'},
    {name:'JPEG declared PNG',bytes:jpeg,type:'image/png',code:'IMAGE_TYPE_MISMATCH'},
    {name:'SVG masquerading as PNG',bytes:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),type:'image/png',code:'IMAGE_FORMAT_UNAVAILABLE'},
    {name:'PDF needs separate validator',bytes:Buffer.from('%PDF-1.7\nsynthetic'),type:'application/pdf',code:'IMAGE_FORMAT_UNAVAILABLE'},
    {name:'HEIC needs proven decoder',bytes:Buffer.from('synthetic HEIC placeholder; no phone proof'),type:'image/heic',code:'IMAGE_FORMAT_UNAVAILABLE'},
    {name:'empty input',bytes:Buffer.alloc(0),type:'image/png',code:'IMAGE_SIZE_INVALID'}
  ]};
}
