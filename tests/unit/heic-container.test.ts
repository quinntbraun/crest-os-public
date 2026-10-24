import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {inspectHeicContainer,validateHeic,maximumHeicBytes} from '../../src/files/heic-validation';
function box(type:string,data=Buffer.alloc(0)){const h=Buffer.alloc(8);h.writeUInt32BE(data.length+8);h.write(type,4);return Buffer.concat([h,data]);}
const ftyp=(brand='heic')=>box('ftyp',Buffer.concat([Buffer.from(brand),Buffer.alloc(4),Buffer.from('mif1'+brand)]));
const envelope=(brand='heic')=>Buffer.concat([ftyp(brand),box('meta'),box('mdat')]);
describe('HEIC byte/container admission before native decoding',()=>{
  it.each(['heic','heix'])('accepts bounded static %s framing only as a parser candidate',brand=>{expect(()=>inspectHeicContainer(envelope(brand))).not.toThrow();});
  const invalid: [string,()=>Buffer,string][]=[
    ['short header',()=>Buffer.alloc(7),'HEIC_CONTAINER_INVALID'],
    ['truncated tail',()=>envelope().subarray(0,-1),'HEIC_CONTAINER_INVALID'],
    ['trailing payload',()=>Buffer.concat([envelope(),Buffer.from('payload')]),'HEIC_CONTAINER_INVALID'],
    ['duplicate ftyp',()=>Buffer.concat([envelope(),ftyp()]),'HEIC_CONTAINER_INVALID'],
    ['missing metadata',()=>Buffer.concat([ftyp(),box('mdat')]),'HEIC_CONTAINER_INVALID'],
    ['duplicate metadata',()=>Buffer.concat([envelope(),box('meta')]),'HEIC_CONTAINER_INVALID'],
    ['missing coded data',()=>Buffer.concat([ftyp(),box('meta')]),'HEIC_CONTAINER_INVALID'],
    ['AVIF',()=>envelope('avif'),'HEIC_FORMAT_UNAVAILABLE'],
    ['HEVC sequence',()=>envelope('hevc'),'HEIC_FORMAT_UNAVAILABLE'],
    ['video',()=>Buffer.concat([envelope(),box('moov')]),'HEIC_FORMAT_UNAVAILABLE'],
    ['zero-size metadata',()=>{const b=box('meta');b.writeUInt32BE(0);return Buffer.concat([ftyp(),b]);},'HEIC_CONTAINER_INVALID'],
    ['oversized64-bit box',()=>{const b=Buffer.alloc(16);b.writeUInt32BE(1);b.write('free',4);b.writeBigUInt64BE(2n**63n,8);return Buffer.concat([envelope(),b]);},'HEIC_CONTAINER_INVALID'],
    ['too many boxes',()=>Buffer.concat([envelope(),...Array.from({length:4096},()=>box('free'))]),'HEIC_CONTAINER_INVALID'],
    ['too many brands',()=>Buffer.concat([box('ftyp',Buffer.concat([Buffer.from('heic'),Buffer.alloc(4),Buffer.from('heic'.repeat(65))])),box('meta'),box('mdat')]),'HEIC_CONTAINER_INVALID']
  ];
  it.each(invalid)('rejects %s',(_label,make,code)=>{expect(()=>inspectHeicContainer(make())).toThrow(code);});
  it('rejects byte limits and MIME mismatch before calling native tools',async()=>{
    await expect(validateHeic(Buffer.alloc(0),'image/heic')).rejects.toMatchObject({code:'HEIC_SIZE_INVALID'});
    await expect(validateHeic(Buffer.alloc(maximumHeicBytes+1),'image/heic')).rejects.toMatchObject({code:'HEIC_SIZE_INVALID'});
    await expect(validateHeic(envelope(),'image/jpeg')).rejects.toMatchObject({code:'HEIC_TYPE_MISMATCH'});
  });
});
