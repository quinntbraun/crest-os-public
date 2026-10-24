import {mkdtemp,writeFile,readFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';
const execute=promisify(execFile),encoder=resolve('.local/tools/heic-fixtures/bin/heif-enc');
export function box(type,data=Buffer.alloc(0)){const b=Buffer.alloc(8);b.writeUInt32BE(data.length+8);b.write(type,4,'latin1');return Buffer.concat([b,data]);}
export function envelope(brand='heic'){return Buffer.concat([box('ftyp',Buffer.concat([Buffer.from(brand),Buffer.alloc(4),Buffer.from('mif1'+brand)])),box('meta'),box('mdat')]);}
export function padHeic(b,size){if(size-b.length<8)throw Error('Fixture padding');return Buffer.concat([b,box('free',Buffer.alloc(size-b.length-8))]);}
export async function encodeHeic(pngs,args=[]){
  const directory=await mkdtemp(join(tmpdir(),'crest-heic-fixture-')),paths=pngs.map((_,i)=>join(directory,`input${i}.png`)),output=join(directory,'output.heic');
  try{
    for(let i=0;i<paths.length;i++)await writeFile(paths[i],pngs[i]);
    await execute(encoder,['-L','-p','x265:pools=none','-p','x265:frame-threads=1',...args,...paths,'-o',output],{timeout:120000,maxBuffer:4*1024*1024});
    return await readFile(output);
  }finally{for(const p of [...paths,output])await unlink(p).catch(()=>{});await rmdir(directory);}
}
export async function heicFixtures(){
  const create=()=>sharp({create:{width:96,height:48,channels:3,background:'#224466'}});
  const png=await create().withExif({IFD0:{Copyright:'Synthetic test only'}}).png().toBuffer();
  const plain=await encodeHeic([png]),p3=await encodeHeic([await create().withIccProfile('p3').png().toBuffer()]),
    alpha=await encodeHeic([await sharp({create:{width:96,height:48,channels:4,background:{r:30,g:70,b:110,alpha:0}}}).png().toBuffer()]),
    ten=await encodeHeic([await create().toColourspace('rgb16').png().toBuffer()],['-b','10']),
    rotated=await encodeHeic([png],['--rotate-cw','90']),grid=await encodeHeic([png],['--cut-tiles','64']);
  const corrupt=Buffer.from(plain);let pos=0;while(pos<corrupt.length){const n=corrupt.readUInt32BE(pos);if(corrupt.toString('latin1',pos+4,pos+8)==='mdat'){corrupt.fill(0,pos+8,n===0?corrupt.length:pos+n);break;}pos+=n;}
  const huge=Buffer.from(plain),ispe=huge.indexOf(Buffer.from('ispe'));if(ispe<0)throw Error('Fixture ispe absent');huge.writeUInt32BE(20000,ispe+8);huge.writeUInt32BE(20000,ispe+12);
  return {plain,png,valid:[{name:'8-bit private EXIF original',bytes:plain,width:96,height:48},
    {name:'Display P3 ICC',bytes:p3,width:96,height:48},{name:'transparent alpha',bytes:alpha,width:96,height:48},
    {name:'10-bit HEVC',bytes:ten,width:96,height:48,depth:10},{name:'90-degree transformation',bytes:rotated,width:48,height:96},
    {name:'HEIC grid',bytes:grid,width:96,height:48}],
    invalid:[{name:'damaged coded pixels',bytes:corrupt,codes:['HEIC_DECODE_FAILED']},
      {name:'excessive signalled dimensions',bytes:huge,codes:['HEIC_PIXEL_LIMIT','HEIC_DECODE_FAILED']},
      {name:'multiple independent images',bytes:await encodeHeic([png,png]),codes:['HEIC_FORMAT_UNAVAILABLE']},
      {name:'truncated box',bytes:plain.subarray(0,-1),codes:['HEIC_CONTAINER_INVALID']},
      {name:'trailing payload',bytes:Buffer.concat([plain,Buffer.from('payload')]),codes:['HEIC_CONTAINER_INVALID']},
      {name:'AVIF brand',bytes:envelope('avif'),codes:['HEIC_FORMAT_UNAVAILABLE']},
      {name:'video track',bytes:Buffer.concat([envelope(),box('moov')]),codes:['HEIC_FORMAT_UNAVAILABLE']},
      {name:'empty original',bytes:Buffer.alloc(0),codes:['HEIC_SIZE_INVALID']}]};
}
export async function boundaryHeic(){
  const png=await sharp({create:{width:10000,height:6000,channels:3,background:'#224466'}}).png().toBuffer();
  return padHeic(await encodeHeic([png],['--cut-tiles','1024']),25*1024*1024);
}
