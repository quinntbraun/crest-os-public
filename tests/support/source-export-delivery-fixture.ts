import {createHash,randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {vi} from 'vitest';
import {sourceExportDownloadFixture} from './source-export-download-fixture.ts';
import {parseSourceExportDownloadPermit,sourceExportDownloadAccessScope} from '../../src/security/source-export-download-permit.ts';
import {createSourceExportDownloadReader} from '../../src/security/source-export-download-reader.ts';
import type {createSourceExportOwnerAccess} from '../../src/security/source-export-owner-access.ts';
import type {createEncryptedExportPartStore} from '../../src/files/export-part-store.ts';
import type {ServerResponse} from 'node:http';
export function sourceExportDeliveryFixture(timeoutMs=60000){
 const f=sourceExportDownloadFixture(),source=Buffer.alloc(32,97),digest=createHash('sha256').update(source).digest('hex'),events:string[]=[],original=Buffer.from(source),copies:Buffer[]=[];
 f.files[0]!.sha256=digest;f.intent.plaintextSha256=digest;const p=parseSourceExportDownloadPermit(f.permit,f.businessId,f.actorId,f.partRequest);
 const opened={metadataForServer:vi.fn(()=>({binding:p.binding,byteSize:32,sha256:digest})),forServer:vi.fn(()=>{const bytes=Buffer.from(original);copies.push(bytes);return{binding:p.binding,byteSize:32,sha256:digest,bytes};}),dispose:vi.fn(()=>{original.fill(0);})};
 type Access=ReturnType<typeof createSourceExportOwnerAccess>;
 const privateValue=(value:typeof p)=>({forServer:()=>value,toJSON():never{throw Error('PRIVATE');}}),api={downloadPart:vi.fn<Access['downloadPart']>().mockImplementation(async()=>{events.push('authorize');return privateValue(p);})},store={readVerified:vi.fn<Awaited<ReturnType<typeof createEncryptedExportPartStore>>['readVerified']>().mockImplementation(async()=>{events.push('read');return opened as never;})};
 const accessReceipt=()=>({schemaVersion:1 as const,state:'authorized_handoff' as const,operationId:randomUUID(),auditEventId:randomUUID(),recordedAt:new Date().toISOString().replace('Z','000Z'),scope:sourceExportDownloadAccessScope(p)}),auditedApi={...api,recordDownloadAccess:vi.fn<Access['recordDownloadAccess']>().mockImplementation(async()=>{events.push('audit-commit');const value=accessReceipt();return{forServer:()=>value,toJSON():never{throw Error('PRIVATE');}};})};
 const reader=createSourceExportDownloadReader(f.businessId,auditedApi,store,timeoutMs);
 return{...f,source,digest,p,events,original,copies,opened,api:auditedApi,store,reader,privateValue,accessReceipt};
}
// Unit-only socket acknowledgements. Genuine socket delivery is tested separately.
export class DownloadOutgoing extends EventEmitter{
 headersSent=false;destroyed=false;status=0;headers=new Map<string,string>();body:Buffer|undefined;received:Buffer|undefined;onEnd:(()=>void)|undefined;
 setHeader(k:string,v:string){this.headers.set(k.toLowerCase(),v);return this;}
 writeHead(status:number){this.status=status;this.headersSent=true;return this;}
 end(body:Buffer){this.body=body;if(this.onEnd){this.onEnd();return this;}this.received=Buffer.from(body);this.emit('finish');return this;}
 destroy(){this.destroyed=true;this.emit('close');return this;}
 asResponse(){return this as unknown as ServerResponse;}
}
