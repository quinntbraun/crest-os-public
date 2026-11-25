import {randomUUID,createHash} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {openingDocuments} from '../../src/client/opening-documents';
import {receiptDownloadResponse} from '../../src/bookkeeping/expenses/receipt-download-response';
const proof=()=>({csrfToken:'a'.repeat(43),expiresAt:Date.now()+60000}),signal=()=>new AbortController().signal;
function fixture(){const bytes=Buffer.from('Fictional private original'),input={documentId:randomUUID(),operationId:randomUUID(),recoveryEpoch:randomUUID(),reference:'Fictional opening original',sha256:createHash('sha256').update(bytes).digest('hex'),contentType:'image/png' as const,byteSize:bytes.length},status={documentId:input.documentId,reference:input.reference,sha256:input.sha256,contentType:input.contentType,byteSize:input.byteSize,state:'reserved' as 'reserved'|'available'};return {bytes,input,status};}
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json','cache-control':'private, no-store'}});
afterEach(()=>vi.unstubAllGlobals());
it('replays identical reservation identifiers and retains private same-origin transport',async()=>{
 const f=fixture(),fetch=vi.fn(async()=>json(f.status));vi.stubGlobal('fetch',fetch);await openingDocuments.reserve(f.input,proof(),signal());await openingDocuments.reserve(f.input,proof(),signal());
 const first=fetch.mock.calls[0] as unknown as [string,RequestInit],second=fetch.mock.calls[1] as unknown as [string,RequestInit];expect(first[0]).toBe('/api/business/opening-documents/reserve');expect(first[1].body).toBe(second[1].body);expect(JSON.parse(first[1].body as string)).toEqual(f.input);expect(first[1]).toMatchObject({credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
});
it.each(['documentId','reference','sha256','byteSize'])('rejects substituted reservation %s',async field=>{
 const f=fixture(),bad={...f.status,[field]:field==='byteSize'?f.status.byteSize+1:field==='documentId'?randomUUID():field==='sha256'?'b'.repeat(64):'Another document'};vi.stubGlobal('fetch',vi.fn(async()=>json(bad)));await expect(openingDocuments.reserve(f.input,proof(),signal())).rejects.toThrow();
});
it('distinguishes an absent lookup from a published match and rejects pending matches',async()=>{
 const f=fixture(),fetch=vi.fn().mockResolvedValueOnce(json({state:'absent'})).mockResolvedValueOnce(json({...f.status,state:'available'})).mockResolvedValueOnce(json(f.status));vi.stubGlobal('fetch',fetch);
 expect(await openingDocuments.find({reference:f.input.reference,sha256:f.input.sha256},proof(),signal())).toBeNull();expect((await openingDocuments.find({reference:f.input.reference,sha256:f.input.sha256},proof(),signal()))?.documentId).toBe(f.input.documentId);await expect(openingDocuments.find({reference:f.input.reference,sha256:f.input.sha256},proof(),signal())).rejects.toThrow();
});
it('rejects expired or cancelled proof before any request',async()=>{
 const f=fixture(),fetch=vi.fn();vi.stubGlobal('fetch',fetch);await expect(openingDocuments.reserve(f.input,{...proof(),expiresAt:1},signal())).rejects.toThrow();const abort=new AbortController();abort.abort();await expect(openingDocuments.reserve(f.input,proof(),abort.signal)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
});
it('checks the upload file against its retained reservation without sending object keys',async()=>{
 const f=fixture(),fetch=vi.fn(async()=>json({documentId:f.input.documentId,state:'uploaded'}));vi.stubGlobal('fetch',fetch);await openingDocuments.upload(f.input,new File([f.bytes],'original.png',{type:'image/png'}),proof(),signal());const call=fetch.mock.calls[0] as unknown as [string,RequestInit];expect(new Headers(call[1].headers).get('x-crest-opening-document')).toBe(f.input.documentId);expect(call[1].body).toBeInstanceOf(File);await expect(openingDocuments.upload(f.input,new File([f.bytes],'other.txt',{type:'text/plain'}),proof(),signal())).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
});
it('checks exact original bytes and filename before handing them to a browser save control',async()=>{
 const f=fixture();f.status.state='available';const fetch=vi.fn(async()=>receiptDownloadResponse(f.bytes,{name:`receipt-${f.input.documentId}.png`,type:'image/png',byteSize:f.bytes.length,sha256:f.input.sha256},true));vi.stubGlobal('fetch',fetch);const file=await openingDocuments.original(f.status,proof(),signal());expect(Buffer.from(file.bytes)).toEqual(f.bytes);expect(file.fileName).toBe(`opening-original-${f.input.documentId}.png`);file.bytes.fill(0);
 fetch.mockImplementationOnce(async()=>receiptDownloadResponse(f.bytes,{name:`receipt-${randomUUID()}.png`,type:'image/png',byteSize:f.bytes.length,sha256:f.input.sha256},true));await expect(openingDocuments.original(f.status,proof(),signal())).rejects.toThrow();
});
it('refuses oversized metadata rather than buffering an unbounded server response',async()=>{
 const f=fixture();vi.stubGlobal('fetch',vi.fn(async()=>json({...f.status,extra:'x'.repeat(5000)})));await expect(openingDocuments.reserve(f.input,proof(),signal())).rejects.toThrow();
});
