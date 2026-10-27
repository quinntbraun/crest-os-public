import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {randomUUID,createHash} from 'node:crypto';
import {createJournalTextAssembler} from '../../src/security/source-export-journal-text.ts';
const size=524288,sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),error='JOURNAL_ORIGINAL_TEXT_REVIEW_REQUIRED';
function fixture(text=' {"original":"é😀é"}\r\n',kind:'snapshot'|'intent'|'verification'|'completion'='completion'){
 const bytes=Buffer.from(text),count=Math.ceil(bytes.length/size),expected={businessId:randomUUID(),snapshotToken:'a'.repeat(64),kind,recordKey:(kind==='intent'||kind==='verification'?randomUUID()+':':'')+randomUUID(),descriptor:{column:'request_text' as const,bytes:bytes.length,sha256:sha(bytes),chunkBytes:524288 as const,chunks:count}};
 const chunks=Array.from({length:count},(_,i)=>{const piece=bytes.subarray(i*size,Math.min(bytes.length,(i+1)*size));return {schemaVersion:1,scope:'source_export_journal',businessId:expected.businessId,snapshotToken:expected.snapshotToken,kind,recordKey:expected.recordKey,column:'request_text',textBytes:bytes.length,textSha256:sha(bytes),chunkIndex:i,chunkCount:count,offsetBytes:i*size,bytes:piece.length,sha256:sha(piece),encoding:'base64',data:piece.toString('base64')};});return{expected,chunks,text};
}
it.each(['snapshot','intent','verification','completion'] as const)('reconstructs the exact original %s bytes and refuses implicit plaintext serialization',kind=>{
 const f=fixture(undefined,kind),reader=createJournalTextAssembler(f.expected);for(const c of f.chunks)reader.append(c);const result=reader.finish();expect(result.forServer()).toBe(f.text);expect(Object.isFrozen(result)).toBe(true);expect(()=>JSON.stringify(result)).toThrow(error);expect(()=>reader.finish()).toThrow(error);expect(()=>reader.append(f.chunks[0])).toThrow(error);
});
it('preserves UTF8 characters split across byte chunks, combining characters, whitespace and escapes without normalization',()=>{
 const text=' '.repeat(size-1)+'😀éé\\\r\n',f=fixture(text),reader=createJournalTextAssembler(f.expected);expect(f.chunks).toHaveLength(2);for(const c of f.chunks)reader.append(c);expect(reader.finish().forServer()).toBe(text);
});
it('handles a maximum12MiB original with24bounded chunks without increasing physical export-file limits',()=>{
 const f=fixture(' '.repeat(12582912)),reader=createJournalTextAssembler(f.expected);expect(f.chunks).toHaveLength(24);expect(f.chunks.every(c=>c.bytes===size&&c.data.length<=699052)).toBe(true);for(const c of f.chunks)reader.append(c);expect(reader.finish().forServer()).toBe(f.text);
});
it.each(['snapshot','intent','verification','completion'] as const)('rejects an extra byte beyond the bounded %s original before allocating output',kind=>{
 const f=fixture(undefined,kind),maximum={snapshot:1048576,intent:8192,verification:8192,completion:12582912}[kind];expect(()=>createJournalTextAssembler({...f.expected,descriptor:{...f.expected.descriptor,bytes:maximum+1,chunks:Math.ceil((maximum+1)/size)}})).toThrow(error);
});
it.each(['businessId','snapshotToken','kind','recordKey','descriptor'])('rejects malformed expected %s without accepting caller authority',field=>{const f=fixture();expect(()=>createJournalTextAssembler({...f.expected,[field]:'invalid'} as unknown as typeof f.expected)).toThrow(error);});
it.each(['column','bytes','sha256','chunkBytes','chunks'])('rejects malformed expected original descriptor %s',field=>{const f=fixture();expect(()=>createJournalTextAssembler({...f.expected,descriptor:{...f.expected.descriptor,[field]:'invalid'}} as unknown as typeof f.expected)).toThrow(error);});
it.each(['schemaVersion','scope','businessId','snapshotToken','kind','recordKey','column','textBytes','textSha256','chunkIndex','chunkCount','offsetBytes','bytes','sha256','encoding','data','extra'])('refuses changed chunk %s and closes the whole assembler',field=>{
 const f=fixture(),reader=createJournalTextAssembler(f.expected);expect(()=>reader.append({...f.chunks[0],[field]:'invalid'})).toThrow(error);expect(()=>reader.append(f.chunks[0])).toThrow(error);expect(()=>reader.finish()).toThrow(error);
});
it.each(['missing','reordered','duplicate'])('refuses %s chunks instead of silently completing a partial original',mode=>{
 const f=fixture(' '.repeat(size+1)),reader=createJournalTextAssembler(f.expected);if(mode==='reordered')expect(()=>reader.append(f.chunks[1])).toThrow(error);else{reader.append(f.chunks[0]);if(mode==='duplicate')expect(()=>reader.append(f.chunks[0])).toThrow(error);}expect(()=>reader.finish()).toThrow(error);
});
it('checks the complete original hash even when every included chunk hash is self-consistent',()=>{
 const f=fixture(),reader=createJournalTextAssembler({...f.expected,descriptor:{...f.expected.descriptor,sha256:'b'.repeat(64)}});reader.append({...f.chunks[0],textSha256:'b'.repeat(64)});expect(()=>reader.finish()).toThrow(error);
});
it.each(['padding','whitespace','url-alphabet','extra-byte'])('refuses noncanonical or altered base64 %s',mode=>{
 const f=fixture('x'),reader=createJournalTextAssembler(f.expected),c={...f.chunks[0]!};if(mode==='padding')c.data=c.data.replace(/=+$/,'');if(mode==='whitespace')c.data+='\n';if(mode==='url-alphabet')c.data='_'+c.data.slice(1);if(mode==='extra-byte')c.data=Buffer.concat([Buffer.from(c.data,'base64'),Buffer.from('x')]).toString('base64');expect(()=>reader.append(c)).toThrow(error);
});
it('refuses invalid UTF8 and NUL even when unkeyed byte hashes match',()=>{
 for(const bytes of [Buffer.from([0xff]),Buffer.from([0])]){const f=fixture('x'),hash=sha(bytes),reader=createJournalTextAssembler({...f.expected,descriptor:{...f.expected.descriptor,sha256:hash}});reader.append({...f.chunks[0],textSha256:hash,sha256:hash,data:bytes.toString('base64')});expect(()=>reader.finish()).toThrow(error);}
});
it('does not execute getters or accept hidden fields, custom prototypes or symbols',()=>{
 const f=fixture();let reads=0;expect(()=>createJournalTextAssembler({...f.expected,get descriptor(){reads++;return f.expected.descriptor;}})).toThrow(error);expect(reads).toBe(0);
 for(const c of [{...f.chunks[0],[Symbol('extra')]:1},Object.assign(Object.create({extra:true}),f.chunks[0]),Object.defineProperty({...f.chunks[0]},'hidden',{value:1})]){const reader=createJournalTextAssembler(f.expected);expect(()=>reader.append(c)).toThrow(error);}
});
it('copies expected scalar references and supports explicit idempotent disposal without exposing unfinished bytes',()=>{
 const f=fixture(),reader=createJournalTextAssembler(f.expected);f.expected.snapshotToken='b'.repeat(64);f.expected.descriptor.sha256='c'.repeat(64);reader.append(f.chunks[0]);expect(reader.finish().forServer()).toBe(f.text);const second=createJournalTextAssembler(fixture().expected);second.dispose();second.dispose();expect(()=>second.finish()).toThrow(error);expect(()=>JSON.stringify(second)).toThrow(error);
});
