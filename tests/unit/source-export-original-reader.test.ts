import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createExportOriginalReader} from '../../src/security/source-export-original-reader';
import {exportOriginalAuditScope,parseExportOriginalPermit} from '../../src/security/source-export-original-contract';
import type {ExportOriginalKind,ExportOriginalPermit} from '../../src/security/source-export-original-contract';
function fixture(kind:ExportOriginalKind='expense_receipt'){
 const businessId=randomUUID(),actorId=randomUUID(),attachmentId=randomUUID(),objectId=kind==='condition_photo'?randomUUID():attachmentId,request={exportJobId:randomUUID(),generationId:randomUUID(),kind,attachmentId},bytes=Buffer.from('Exact original evidence'),sha256=createHash('sha256').update(bytes).digest('hex'),micro=(n:number)=>new Date(n).toISOString().replace(/Z$/,'000Z'),completedAt=micro(Date.now()-1000);
 const header={schemaVersion:1,businessId,exportJobId:request.exportJobId,generationId:request.generationId,profile:'crest.current-business-source-bundle.v1',appReleaseId:'a'.repeat(40),sourceSchemaVersion:136,completedAt,expiresAt:micro(Date.parse(completedAt)+604800000),fileCount:2,totalBytes:100,manifestSha256:'b'.repeat(64)};
 const raw={profile:'crest.source-export-original-permit.v1',header,indexSha256:'d'.repeat(64),authority:{currentActorId:actorId,originalActorId:actorId,recoveryEpoch:randomUUID(),planSha256:'c'.repeat(64)},file:{kind,attachmentId,objectId,path:`attachments/${attachmentId}/${objectId}.png`,mediaType:'image/png',byteSize:bytes.length,sha256,recordedAt:completedAt},object:{domain:kind,key:`originals/${businessId}/${objectId}`}};
 const events:string[]=[],copies:Uint8Array[]=[],read=vi.fn(async()=>{events.push('authorize');return{actorId,record:structuredClone(raw)};}),record=vi.fn(async(_credential:string,_request:unknown,permit:ExportOriginalPermit)=>{events.push('commit');return{schemaVersion:1,state:'authorized_handoff',operationId:randomUUID(),auditEventId:randomUUID(),recordedAt:micro(Date.now()),scope:exportOriginalAuditScope(permit)};});
 const object=vi.fn(async():Promise<Uint8Array>=>{events.push('object');const copy=Buffer.from(bytes);copies.push(copy);return copy;}),stores={expense_receipt:object,supplier_document:object,condition_photo:object},reader=()=>createExportOriginalReader(businessId,{read,record},stores);
 return{businessId,actorId,request,raw,events,copies,read,record,object,stores,reader,bytes};
}
it.each(['expense_receipt','supplier_document','condition_photo'] as const)('hands off exact %s bytes only after fresh authority and committed audit, then wipes its copy',async kind=>{
 const f=fixture(kind);await f.reader().deliver('fixture-private-authority',f.request,new AbortController().signal,async value=>{f.events.push('handoff');expect(Buffer.from(value.bytes)).toEqual(f.bytes);expect(value.file.path).toBe(f.raw.file.path);expect(f.events).toEqual(['authorize','object','authorize','commit','handoff']);});expect(f.copies.every(copy=>copy.every(value=>value===0))).toBe(true);
});
it.each(['hash','length','scope','principal','unknown commit','audit scope'])('releases no bytes after %s failure and wipes any retrieved bytes',async issue=>{
 const f=fixture(),consume=vi.fn();
 if(issue==='hash')f.object.mockImplementationOnce(async()=>{const copy=Buffer.from(f.bytes);copy[0]=copy[0]!^1;f.copies.push(copy);return copy;});
 if(issue==='length')f.object.mockImplementationOnce(async()=>{const copy=Buffer.from(f.bytes.subarray(1));f.copies.push(copy);return copy;});
 if(issue==='scope')f.read.mockResolvedValueOnce({actorId:f.actorId,record:{...f.raw,object:{...f.raw.object,key:`originals/${randomUUID()}/${randomUUID()}`}}});
 if(issue==='principal'){const foreign=randomUUID();f.read.mockResolvedValueOnce({actorId:f.actorId,record:structuredClone(f.raw)}).mockResolvedValueOnce({actorId:foreign,record:{...f.raw,authority:{...f.raw.authority,currentActorId:foreign}}});}
 if(issue==='unknown commit')f.record.mockRejectedValueOnce(Error('commit acknowledgement lost'));
 if(issue==='audit scope')f.record.mockImplementationOnce(async(_c,_r,permit)=>({schemaVersion:1,state:'authorized_handoff',operationId:randomUUID(),auditEventId:randomUUID(),recordedAt:new Date().toISOString().replace(/Z$/,'000Z'),scope:{...exportOriginalAuditScope(permit),currentActorId:randomUUID()}}));
 await expect(f.reader().deliver('fixture-private-authority',f.request,new AbortController().signal,consume)).rejects.toThrow('SOURCE_EXPORT_ORIGINAL_UNAVAILABLE');expect(consume).not.toHaveBeenCalled();expect(f.copies.every(copy=>copy.every(value=>value===0))).toBe(true);if(['hash','length','scope','principal'].includes(issue))expect(f.record).not.toHaveBeenCalled();
});
it('wipes a late storage result after cancellation and does not audit or consume it',async()=>{
 const f=fixture(),controller=new AbortController(),consume=vi.fn();let resolve!:(value:Buffer)=>void;f.object.mockImplementationOnce(()=>new Promise<Buffer>(done=>{resolve=done;}));const pending=f.reader().deliver('fixture-private-authority',f.request,controller.signal,consume);await vi.waitFor(()=>expect(f.object).toHaveBeenCalledOnce());controller.abort();await expect(pending).rejects.toThrow();const late=Buffer.from(f.bytes);resolve(late);await vi.waitFor(()=>expect(late.every(value=>value===0)).toBe(true));expect(f.record).not.toHaveBeenCalled();expect(consume).not.toHaveBeenCalled();
});
it('enforces a two-active-original limit without queuing a third read',async()=>{
 const f=fixture(),controller=new AbortController();f.object.mockImplementation(()=>new Promise<Buffer>(()=>{}));const reader=f.reader(),consume=vi.fn(),first=reader.deliver('fixture',f.request,controller.signal,consume),second=reader.deliver('fixture',f.request,controller.signal,consume);await vi.waitFor(()=>expect(f.object).toHaveBeenCalledTimes(2));await expect(reader.deliver('fixture',f.request,controller.signal,consume)).rejects.toThrow();expect(f.read).toHaveBeenCalledTimes(2);controller.abort();await Promise.allSettled([first,second]);
});
it('refuses extra permit fields and preserves exact original object identity',()=>{
 const f=fixture('condition_photo');expect(parseExportOriginalPermit(f.raw,f.businessId,f.actorId,f.request).object.key).toBe(f.raw.object.key);expect(()=>parseExportOriginalPermit({...f.raw,token:'excluded'},f.businessId,f.actorId,f.request)).toThrow();expect(()=>parseExportOriginalPermit({...f.raw,file:{...f.raw.file,objectId:f.request.attachmentId}},f.businessId,f.actorId,f.request)).toThrow();
 expect(parseExportOriginalPermit({...f.raw,file:{...f.raw.file,recordedAt:'2099-01-01T00:00:00.123456Z'}},f.businessId,f.actorId,f.request).file.recordedAt).toBe('2099-01-01T00:00:00.123456Z');
});
