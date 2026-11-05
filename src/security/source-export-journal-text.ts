import 'server-only';
import {createHash} from 'node:crypto';
import {customerUuid as uuid} from '../customer/customer-contract.ts';

export type JournalTextKind='snapshot'|'intent'|'verification'|'completion';
export type JournalTextDescriptor=Readonly<{column:'request_text';bytes:number;sha256:string;chunkBytes:524288;chunks:number}>;
type Expected=Readonly<{businessId:string;snapshotToken:string;kind:JournalTextKind;recordKey:string;descriptor:JournalTextDescriptor}>;
export class JournalTextError extends Error{constructor(){super('JOURNAL_ORIGINAL_TEXT_REVIEW_REQUIRED');this.name='JournalTextError';}}
function require(value:unknown):asserts value{if(!value)throw new JournalTextError();}
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
 require(value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null));
 const d=Object.getOwnPropertyDescriptors(value);require(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&d[k]!.enumerable&&Object.hasOwn(d[k]!,'value')));
 return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
}
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
const limits={snapshot:1048576,intent:8192,verification:8192,completion:12582912} as const;
const chunkBytes=524288;
const chunkFields=['schemaVersion','scope','businessId','snapshotToken','kind','recordKey','column','textBytes','textSha256','chunkIndex','chunkCount','offsetBytes','bytes','sha256','encoding','data'];

// One bounded original field, standard UTF8 bytes/base64 and SHA256 only.
// This checks included evidence consistency, not authentication or a backup.
// The caller owns one original at a time and the surrounding snapshot/lifetime.
export function createJournalTextAssembler(input:Expected){
 const e=object(input,['businessId','snapshotToken','kind','recordKey','descriptor']);
 require(uuid(e.businessId)&&hash(e.snapshotToken)&&typeof e.kind==='string'&&Object.hasOwn(limits,e.kind)&&typeof e.recordKey==='string');
 const kind=e.kind as JournalTextKind,parts=e.recordKey.split(':');require(parts.length===(kind==='intent'||kind==='verification'?2:1)&&parts.every(uuid));
 const d=object(e.descriptor,['column','bytes','sha256','chunkBytes','chunks']);
 require(d.column==='request_text'&&typeof d.bytes==='number'&&Number.isSafeInteger(d.bytes)&&d.bytes>=1&&d.bytes<=limits[kind]&&hash(d.sha256)&&d.chunkBytes===chunkBytes&&d.chunks===Math.ceil(d.bytes/chunkBytes));
 const expected=Object.freeze({businessId:e.businessId,snapshotToken:e.snapshotToken,recordKey:e.recordKey}),bytes=d.bytes as number,count=d.chunks as number,buffer=Buffer.alloc(bytes);Object.freeze(d);let next=0,closed=false;
 const dispose=()=>{buffer.fill(0);closed=true;};
 return Object.freeze({
  append(input:unknown){
   let piece:Buffer|undefined;
   try{
    require(!closed);const c=object(input,chunkFields),offset=next*chunkBytes,n=Math.min(chunkBytes,bytes-offset);
    require(next<count&&c.schemaVersion===1&&c.scope==='source_export_journal'&&c.businessId===expected.businessId&&c.snapshotToken===expected.snapshotToken&&c.kind===kind&&c.recordKey===expected.recordKey&&c.column==='request_text'&&c.textBytes===bytes&&c.textSha256===d.sha256&&c.chunkIndex===next&&c.chunkCount===count&&c.offsetBytes===offset&&c.bytes===n&&hash(c.sha256)&&c.encoding==='base64'&&typeof c.data==='string'&&c.data.length<=4*Math.ceil(chunkBytes/3)&&c.data.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(c.data));
    piece=Buffer.from(c.data,'base64');require(piece.length===n&&piece.toString('base64')===c.data&&sha(piece)===c.sha256);piece.copy(buffer,offset);next++;
   }catch{dispose();throw new JournalTextError();}
   finally{piece?.fill(0);}
  },
  finish(){
   try{
    require(!closed&&next===count&&sha(buffer)===d.sha256);const text=buffer.toString('utf8');require(Buffer.from(text,'utf8').equals(buffer)&&!text.includes('\0'));
    return Object.freeze({forServer:()=>text,toJSON():never{throw new JournalTextError();}});
   }catch{throw new JournalTextError();}
   finally{dispose();}
  },
  dispose,
  toJSON():never{throw new JournalTextError();}
 });
}
