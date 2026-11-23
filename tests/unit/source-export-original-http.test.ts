import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const calls=vi.hoisted(()=>({csrf:vi.fn(),admit:vi.fn(),api:undefined as unknown}));
vi.mock('../../src/security/session-request-guard.ts',()=>({createSessionCsrfVerifier:()=>calls.csrf}));
vi.mock('../../src/security/session-request-admission.ts',()=>({createSessionRequestAdmission:()=>calls.admit}));
vi.mock('../../src/security/source-export-owner-access.ts',()=>({createSourceExportOwnerAccess:()=>calls.api}));
import {createSourceExportOriginalHttp} from '../../src/security/source-export-original-http';
import {parseExportOriginalPermit,exportOriginalAuditScope} from '../../src/security/source-export-original-contract';
import {isReceiptDownloadResponse,writeReceiptDownloadResponse} from '../../src/bookkeeping/expenses/receipt-download-response';
import {sourceExportDownloadFixture} from '../support/source-export-download-fixture';
import {DownloadOutgoing} from '../support/source-export-delivery-fixture';
import {transportFixture} from '../support/transport';
const origin='https://crest.example.com',cookie='__Host-crest_session='+randomBytes(32).toString('base64url');
function fixture(){
 const f=sourceExportDownloadFixture(),attachmentId=randomUUID(),request={exportJobId:f.jobId,generationId:f.generationId,kind:'condition_photo',attachmentId},objectId=randomUUID(),bytes=Buffer.from('Private original fixture');
 const permit=parseExportOriginalPermit({profile:'crest.source-export-original-permit.v1',header:{...f.header,profile:'crest.current-business-source-bundle.v1',sourceSchemaVersion:136},authority:f.authority,indexSha256:'d'.repeat(64),file:{kind:request.kind,attachmentId,objectId,path:`attachments/${attachmentId}/${objectId}.png`,mediaType:'image/png',byteSize:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),recordedAt:f.header.completedAt},object:{domain:request.kind,key:`originals/${f.businessId}/${objectId}`}},f.businessId,f.actorId,request);
 const copies:Buffer[]=[],object=vi.fn(async()=>{const copy=Buffer.from(bytes);copies.push(copy);return copy;}),readOriginal=vi.fn(async()=>({forServer:()=>({actorId:f.actorId,record:permit})})),recordOriginalAccess=vi.fn(async()=>({forServer:()=>({schemaVersion:1,state:'authorized_handoff',operationId:randomUUID(),auditEventId:randomUUID(),recordedAt:new Date().toISOString().replace('Z','000Z'),scope:exportOriginalAuditScope(permit)})}));
 return{...f,request,permit,bytes,copies,object,readOriginal,recordOriginalAccess,stores:{expense_receipt:object,supplier_document:object,condition_photo:object}};
}
let f:ReturnType<typeof fixture>;
const req=(body:unknown=f.request,headers:Record<string,string>={},route='original-file',method='POST')=>new Request(origin+'/api/business/exports/'+route,{method,headers:{origin,cookie,'content-type':'application/json',...headers},...method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{}});
const handler=()=>createSourceExportOriginalHttp({origin,businessId:f.businessId,connectionString:'unused',environment:'production',ingress:{kind:'direct'}},{} as never,{} as never,f.stores);
beforeEach(()=>{vi.resetAllMocks();f=fixture();calls.api=f;calls.csrf.mockResolvedValue('valid');calls.admit.mockResolvedValue(true);});
it('delivers exact private bytes after CSRF, admission, two authority reads and acknowledged audit, retaining them until transport completion',async()=>{
 const response=await handler()(req(),transportFixture());expect(isReceiptDownloadResponse(response)).toBe(true);expect(f.readOriginal).toHaveBeenCalledTimes(2);expect(f.recordOriginalAccess).toHaveBeenCalledOnce();expect(f.copies[0]).toEqual(f.bytes);
 expect(calls.csrf.mock.invocationCallOrder[0]).toBeLessThan(calls.admit.mock.invocationCallOrder[0]!);expect(f.readOriginal.mock.invocationCallOrder[1]).toBeLessThan(f.recordOriginalAccess.mock.invocationCallOrder[0]!);
 const out=new DownloadOutgoing();await writeReceiptDownloadResponse(out.asResponse(),response,new AbortController().signal);await vi.waitFor(()=>expect(f.copies[0]!.every(byte=>byte===0)).toBe(true));expect(out.received).toEqual(f.bytes);expect(response.headers.get('x-crest-sha256')).toBe(f.permit.file.sha256);
});
it.each(['origin','cookie','csrf','type','extra','path','method'])('rejects invalid %s before object reads or audits',async issue=>{
 const headers:Record<string,string>={};if(issue==='origin')headers.origin='https://other.example.com';if(issue==='cookie')headers.cookie='';if(issue==='type')headers['content-type']='text/plain';if(issue==='csrf')calls.csrf.mockRejectedValueOnce(Error('denied'));
 const response=await handler()(req(issue==='extra'?{...f.request,key:'originals/another-business/file'}:f.request,headers,issue==='path'?'original-file?key=value':'original-file',issue==='method'?'GET':'POST'),transportFixture());expect(response.ok).toBe(false);expect(f.readOriginal).not.toHaveBeenCalled();expect(f.object).not.toHaveBeenCalled();expect(f.recordOriginalAccess).not.toHaveBeenCalled();expect(response.headers.get('cache-control')).toContain('no-store');
});
it('limits admission before private metadata and object work',async()=>{calls.admit.mockResolvedValueOnce(false);const response=await handler()(req(),transportFixture());expect(response.status).toBe(429);expect(response.headers.get('retry-after')).toBe('60');expect(f.object).not.toHaveBeenCalled();expect(f.readOriginal).not.toHaveBeenCalled();});
it('leaves the retained interrupted-request original lookup outside the file route',async()=>{const response=await handler()(req(f.request,{},'original'),transportFixture());expect(response.status).toBe(404);expect(calls.csrf).not.toHaveBeenCalled();expect(f.readOriginal).not.toHaveBeenCalled();});
it.each(['authority','hash','commit'])('returns no binary response after %s failure',async issue=>{
 if(issue==='authority')f.readOriginal.mockRejectedValueOnce(Error('private provider detail'));if(issue==='hash')f.object.mockImplementationOnce(async()=>{const copy=Buffer.alloc(f.bytes.length);f.copies.push(copy);return copy;});if(issue==='commit')f.recordOriginalAccess.mockRejectedValueOnce(Error('commit outcome unknown'));
 const response=await handler()(req(),transportFixture());expect(response.status).toBe(503);expect(isReceiptDownloadResponse(response)).toBe(false);expect(await response.json()).toEqual({error:'SOURCE_EXPORT_ORIGINAL_UNAVAILABLE'});expect(f.copies.every(copy=>copy.every(byte=>byte===0))).toBe(true);
});

