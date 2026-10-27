import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createSourceExportDownloadClient} from '../../src/client/source-export-downloads';
import {sourceExportDownloadFixture} from '../support/source-export-download-fixture';
const error='SOURCE_EXPORT_DOWNLOAD_FAILED',signal=()=>new AbortController().signal;
let f:ReturnType<typeof fixture>;
function fixture(){
 const v=sourceExportDownloadFixture(),bytes=new Uint8Array(32).fill(97),sha=createHash('sha256').update(bytes).digest('hex');v.files[0]!.sha256=sha;
 const fetch=vi.fn<typeof globalThis.fetch>(),proof={csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000};
 vi.stubGlobal('fetch',fetch);
 const headers=()=>({'cache-control':'private, no-store, max-age=0, no-transform','content-type':v.files[0]!.contentType,'content-length':'32','content-disposition':'attachment; filename="'+v.files[0]!.fileName+'"','x-crest-sha256':sha});
 const response=(body:BodyInit|null=new Uint8Array(bytes),patch:Record<string,string>={})=>new Response(body,{headers:{...headers(),...patch}});
 const json=(value:unknown=v.first,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'private, no-store'}});
 return{...v,bytes,sha,fetch,proof,headers,response,json,client:createSourceExportDownloadClient(v.businessId)};
}
beforeEach(()=>{f=fixture();});afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('verifies exact private attachment bytes using WebCrypto before consuming, then clears its owned buffer',async()=>{
 f.fetch.mockResolvedValueOnce(f.response());let retained:Uint8Array|undefined;
 await f.client.receive(f.header,f.files[0],f.proof,signal(),async v=>{retained=v.bytes;expect(v.bytes).toEqual(f.bytes);expect(v.file.sha256).toBe(f.sha);expect(v.header.businessId).toBe(f.businessId);expect(Object.isFrozen(v.file)).toBe(true);});
 expect(retained!.every(b=>b===0)).toBe(true);expect(f.fetch).toHaveBeenCalledTimes(1);
 const [path,init]=f.fetch.mock.calls[0]!;expect(path).toBe('/api/business/exports/file');expect(init).toMatchObject({method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':f.proof.csrfToken}});
 expect(JSON.parse(init!.body as string)).toEqual(f.partRequest);expect(()=>JSON.stringify(f.client)).toThrow(error);
});
it('reads a bounded first catalogue and requires its exact pinned header for the next page',async()=>{
 f.fetch.mockResolvedValueOnce(f.json()).mockResolvedValueOnce(f.json(f.second));expect(await f.client.catalogue(f.pageRequest,f.proof,signal())).toEqual(f.first);
 const request={...f.pageRequest,generationId:f.generationId,afterOrdinal:5};expect(await f.client.catalogue(request,f.proof,signal(),f.header)).toEqual(f.second);expect(JSON.parse(f.fetch.mock.calls[1]![1]!.body as string)).toEqual(request);
});
it.each(['business','size','extra','expired'])('rejects invalid %s file evidence before any request',async issue=>{
 const h={...f.header},file={...f.files[0]!};if(issue==='business')h.businessId=randomUUID();if(issue==='size')file.bytes=8388609;if(issue==='extra')Object.assign(file,{objectKey:'PRIVATE'});if(issue==='expired'){h.completedAt=new Date(Date.now()-8*86400000).toISOString().replace('Z','000Z');h.expiresAt=new Date(Date.parse(h.completedAt)+604800000).toISOString().replace('Z','000Z');}
 await expect(f.client.receive(h,file,f.proof,signal(),async()=>{})).rejects.toMatchObject({kind:'input'});expect(f.fetch).not.toHaveBeenCalled();
});
it.each(['missing pin','foreign pin','wrong generation'])('rejects %s on paginated catalogue input before network work',async issue=>{
 const request={...f.pageRequest,generationId:f.generationId,afterOrdinal:5},pin={...f.header};if(issue==='foreign pin')pin.businessId=randomUUID();if(issue==='wrong generation')request.generationId=randomUUID();
 await expect(f.client.catalogue(request,f.proof,signal(),issue==='missing pin'?undefined:pin)).rejects.toMatchObject({kind:'input'});expect(f.fetch).not.toHaveBeenCalled();
});
it.each(['manifest','release','totals','clock'])('rejects changed %s metadata on the next catalogue page',async issue=>{
 const next={...f.second};if(issue==='manifest')next.manifestSha256='e'.repeat(64);if(issue==='release')next.appReleaseId='b'.repeat(40);if(issue==='totals')next.totalBytes++;if(issue==='clock'){next.completedAt=new Date(Date.parse(next.completedAt)+1000).toISOString().replace('Z','000Z');next.expiresAt=new Date(Date.parse(next.expiresAt)+1000).toISOString().replace('Z','000Z');}
 f.fetch.mockResolvedValueOnce(f.json(next));await expect(f.client.catalogue({...f.pageRequest,generationId:f.generationId,afterOrdinal:5},f.proof,signal(),f.header)).rejects.toThrow(error);
});
it.each(['cache','conflicting cache','type','length','name','checksum','encoding'])('rejects unexpected binary %s headers without consuming the file',async issue=>{
 const patch:Record<string,string>={};if(issue==='cache')patch['cache-control']='public, no-store';if(issue==='conflicting cache')patch['cache-control']='private, public, no-store, no-transform';if(issue==='type')patch['content-type']='text/html';if(issue==='length')patch['content-length']='0032';if(issue==='name')patch['content-disposition']='inline';if(issue==='checksum')patch['x-crest-sha256']='e'.repeat(64);if(issue==='encoding')patch['content-encoding']='gzip';
 const cancelled=vi.fn(),body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(f.bytes));},cancel:cancelled}),consume=vi.fn();f.fetch.mockResolvedValueOnce(f.response(body,patch));
 await expect(f.client.receive(f.header,f.files[0],f.proof,signal(),consume)).rejects.toThrow(error);expect(consume).not.toHaveBeenCalled();await vi.waitFor(()=>expect(cancelled).toHaveBeenCalledTimes(1));
});
it('rehashes actual received data and clears the rejected owned bytes',async()=>{
 const native=globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);let owned:Uint8Array|undefined;vi.spyOn(globalThis.crypto.subtle,'digest').mockImplementation(async(algorithm,data)=>{expect(data).toBeInstanceOf(Uint8Array);owned=data as Uint8Array;return native(algorithm,data);});
 const client=createSourceExportDownloadClient(f.businessId),consume=vi.fn();f.fetch.mockResolvedValueOnce(f.response(new Uint8Array(32).fill(98)));
 await expect(client.receive(f.header,f.files[0],f.proof,signal(),consume)).rejects.toThrow(error);expect(consume).not.toHaveBeenCalled();expect(owned!.every(b=>b===0)).toBe(true);
});
it.each([31,33])('rejects a streamed body of %i bytes despite its claimed length',async length=>{const consume=vi.fn();f.fetch.mockResolvedValueOnce(f.response(new Uint8Array(length).fill(97)));await expect(f.client.receive(f.header,f.files[0],f.proof,signal(),consume)).rejects.toThrow(error);expect(consume).not.toHaveBeenCalled();});
it('rejects an empty response stream',async()=>{f.fetch.mockResolvedValueOnce(f.response(null));await expect(f.client.receive(f.header,f.files[0],f.proof,signal(),async()=>{})).rejects.toThrow(error);});
it.each(['duplicate','oversized','invalid UTF-8'])('rejects %s catalogue JSON',async issue=>{
 let body:BodyInit=JSON.stringify(f.first);if(issue==='duplicate')body=body.replace('{','{"schemaVersion":1,');if(issue==='oversized')body=' '.repeat(16385);if(issue==='invalid UTF-8')body=new Uint8Array([255,254]);
 f.fetch.mockResolvedValueOnce(new Response(body,{headers:{'content-type':'application/json','cache-control':'no-store'}}));await expect(f.client.catalogue(f.pageRequest,f.proof,signal())).rejects.toThrow(error);
});
it.each(['partial','redirect','unavailable'])('rejects a %s response and never retries it',async issue=>{
 const response=issue==='partial'?new Response(new Uint8Array(f.bytes),{status:206,headers:f.headers()}):issue==='redirect'?f.response():f.json({error:'PRIVATE_PROVIDER_DETAIL'},503);if(issue==='redirect')Object.defineProperty(response,'redirected',{value:true});
 const consume=vi.fn();f.fetch.mockResolvedValueOnce(response);await expect(f.client.receive(f.header,f.files[0],f.proof,signal(),consume)).rejects.toThrow(error);expect(consume).not.toHaveBeenCalled();expect(f.fetch).toHaveBeenCalledTimes(1);
});
it('surfaces only the explicit rate limit without retrying the request',async()=>{f.fetch.mockResolvedValueOnce(f.json({error:'SOURCE_EXPORT_DOWNLOAD_LIMITED'},429));await expect(f.client.receive(f.header,f.files[0],f.proof,signal(),async()=>{})).rejects.toMatchObject({kind:'limited',message:error});expect(f.fetch).toHaveBeenCalledTimes(1);});
it.each(['invalid','expired','getter'])('rejects %s session proof before dispatch',async issue=>{
 const proof={...f.proof};if(issue==='invalid')proof.csrfToken='bad';if(issue==='expired')proof.expiresAt=Date.now()-1;if(issue==='getter')Object.defineProperty(proof,'csrfToken',{get(){throw Error('PRIVATE');}});
 await expect(f.client.receive(f.header,f.files[0],proof,signal(),async()=>{})).rejects.toThrow(error);expect(f.fetch).not.toHaveBeenCalled();
});
it('copies evidence and proof before fetch work and captures the trusted fetch reference',async()=>{
 const h={...f.header},file={...f.files[0]!},proof={...f.proof},originalToken=proof.csrfToken;f.fetch.mockImplementationOnce(async()=>{h.manifestSha256='e'.repeat(64);file.sha256='e'.repeat(64);proof.csrfToken='changed';return f.response();});vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('REPLACED');}));
 await f.client.receive(h,file,proof,signal(),async v=>{expect(v.file.sha256).toBe(f.sha);expect(v.header.manifestSha256).toBe(f.header.manifestSha256);});expect((f.fetch.mock.calls[0]![1]!.headers as Record<string,string>)['x-crest-csrf']).toBe(originalToken);
});
it('refuses a previously cancelled request without dispatch',async()=>{const c=new AbortController();c.abort();await expect(f.client.receive(f.header,f.files[0],f.proof,c.signal,async()=>{})).rejects.toThrow(error);expect(f.fetch).not.toHaveBeenCalled();});
it('cancels stalled fetch and disposes a response that arrives after cancellation',async()=>{
 const c=new AbortController(),cancelled=vi.fn();let resolve:(r:Response)=>void=()=>{};f.fetch.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const work=f.client.receive(f.header,f.files[0],f.proof,c.signal,async()=>{});c.abort();await expect(work).rejects.toThrow(error);
 resolve(f.response(new ReadableStream({cancel:cancelled})));await vi.waitFor(()=>expect(cancelled).toHaveBeenCalledTimes(1));f.fetch.mockResolvedValueOnce(f.response());await f.client.receive(f.header,f.files[0],f.proof,signal(),async()=>{});
});
it('cancels a stalled body without delivering bytes',async()=>{const c=new AbortController(),cancelled=vi.fn(),consume=vi.fn();f.fetch.mockResolvedValueOnce(f.response(new ReadableStream({cancel:cancelled})));const work=f.client.receive(f.header,f.files[0],f.proof,c.signal,consume);await vi.waitFor(()=>expect(f.fetch).toHaveBeenCalledTimes(1));c.abort();await expect(work).rejects.toThrow(error);expect(consume).not.toHaveBeenCalled();await vi.waitFor(()=>expect(cancelled).toHaveBeenCalledTimes(1));});
it('wipes received data after a failed save callback without claiming the save completed',async()=>{let owned:Uint8Array|undefined;f.fetch.mockResolvedValueOnce(f.response());await expect(f.client.receive(f.header,f.files[0],f.proof,signal(),async v=>{owned=v.bytes;throw Error('PRIVATE_DISK_ERROR');})).rejects.toThrow(error);expect(owned!.every(b=>b===0)).toBe(true);});
it('wipes received data when an unresponsive consumer is cancelled',async()=>{
 const c=new AbortController();let owned:Uint8Array|undefined;const consume=vi.fn(async(v:{bytes:Uint8Array})=>{owned=v.bytes;await new Promise<void>(()=>{});});f.fetch.mockResolvedValueOnce(f.response());const work=f.client.receive(f.header,f.files[0],f.proof,c.signal,consume);await vi.waitFor(()=>expect(consume).toHaveBeenCalledTimes(1));c.abort();await expect(work).rejects.toThrow(error);expect(owned!.every(b=>b===0)).toBe(true);
});
it('limits concurrent owned downloads and releases the slot after cancellation',async()=>{
 const c=new AbortController();f.fetch.mockImplementationOnce(()=>new Promise(()=>{}));const work=f.client.receive(f.header,f.files[0],f.proof,c.signal,async()=>{});
 await expect(f.client.receive(f.header,f.files[0],f.proof,signal(),async()=>{})).rejects.toThrow(error);expect(f.fetch).toHaveBeenCalledTimes(1);c.abort();await expect(work).rejects.toThrow(error);f.fetch.mockResolvedValueOnce(f.response());await f.client.receive(f.header,f.files[0],f.proof,signal(),async()=>{});
});
it('rechecks proof expiry after the response arrives',async()=>{const consume=vi.fn();f.fetch.mockImplementationOnce(async()=>{vi.spyOn(Date,'now').mockReturnValue(f.proof.expiresAt);return f.response();});await expect(f.client.receive(f.header,f.files[0],f.proof,signal(),consume)).rejects.toThrow(error);expect(consume).not.toHaveBeenCalled();});
it('never consumes file bytes when WebCrypto fails',async()=>{vi.spyOn(globalThis.crypto.subtle,'digest').mockRejectedValueOnce(Error('PRIVATE_CRYPTO'));const client=createSourceExportDownloadClient(f.businessId),consume=vi.fn();f.fetch.mockResolvedValueOnce(f.response());await expect(client.receive(f.header,f.files[0],f.proof,signal(),consume)).rejects.toThrow(error);expect(consume).not.toHaveBeenCalled();});
