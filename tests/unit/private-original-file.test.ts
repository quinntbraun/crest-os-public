import {createHash,randomUUID} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {readPrivateOriginalFile} from '../../src/client/private-original-file';
import {downloadSupplierOriginal} from '../../src/client/supplier-original-file';
const content=new TextEncoder().encode('Exact private original bytes'),sha=createHash('sha256').update(content).digest('hex'),id=randomUUID();
function response(headers:Record<string,string>={},bytes:Uint8Array<ArrayBuffer>=content.slice()){
 return new Response(bytes,{headers:{'content-type':'image/png','content-length':String(content.length),'content-disposition':`attachment; filename="receipt-${id}.png"`,'cache-control':'private, no-store','x-content-type-options':'nosniff','x-crest-sha256':sha,...headers}});
}
const signal=()=>new AbortController().signal,proof=()=>({csrfToken:'a'.repeat(42)+'A',expiresAt:Date.now()+60000});
afterEach(()=>vi.unstubAllGlobals());
it('returns exact bytes only after size, media, filename and digest checks',async()=>{
 const file=await readPrivateOriginalFile(response(),signal(),{byteSize:content.length,mediaType:'image/png',sha256:sha});expect(file.bytes).toEqual(content);expect(file.sha256).toBe(sha);expect(file.fileName).toBe(`receipt-${id}.png`);file.bytes.fill(0);
});
it.each([
 {'content-length':'01'},{'content-length':'26214401'},{'content-length':String(content.length-1)},{'content-length':String(content.length+1)},
 {'content-type':'image/svg+xml'},{'content-disposition':'attachment; filename="../../private.png"'},{'content-disposition':'attachment; filename="receipt.pdf"'},
 {'cache-control':'public'},{'x-content-type-options':''},{'x-crest-sha256':'0'.repeat(64)},
])('rejects invalid response metadata or body without returning original bytes: %j',async headers=>{await expect(readPrivateOriginalFile(response(headers),signal())).rejects.toThrow();});
it('refuses an original that differs from the frozen export inventory',async()=>{await expect(readPrivateOriginalFile(response(),signal(),{byteSize:content.length,mediaType:'image/png',sha256:'0'.repeat(64)})).rejects.toThrow();});
it('cancels a stalled body when the view loses access',async()=>{
 const cancelled=vi.fn(),controller=new AbortController(),body=new ReadableStream<Uint8Array>({start(stream){stream.enqueue(content.slice(0,1));},cancel:cancelled}),r=response();
 const pending=readPrivateOriginalFile(new Response(body,{headers:r.headers}),controller.signal);controller.abort();await expect(pending).rejects.toThrow();expect(cancelled).toHaveBeenCalled();
});
it('uses the same-origin supplier route with fresh proof and preserves an optional snapshot expectation',async()=>{
 const fetch=vi.fn<typeof globalThis.fetch>().mockResolvedValue(response());vi.stubGlobal('fetch',fetch);const file=await downloadSupplierOriginal(id,proof(),signal(),{byteSize:content.length,mediaType:'image/png',sha256:sha});
 expect(file.fileName).toBe(`supplier-original-${id}.png`);expect(file.bytes).toEqual(content);expect(fetch.mock.calls[0]![0]).toBe('/api/business/supplier-original/original');const init=fetch.mock.calls[0]![1] as RequestInit;expect(init.credentials).toBe('same-origin');expect(init.cache).toBe('no-store');expect(init.redirect).toBe('error');expect(JSON.parse(String(init.body))).toEqual({originalId:id});file.bytes.fill(0);
});
it('refuses stale proof before I/O and another original identity after I/O',async()=>{
 const fetch=vi.fn(async()=>response({'content-disposition':`attachment; filename="receipt-${randomUUID()}.png"`}));vi.stubGlobal('fetch',fetch);
 await expect(downloadSupplierOriginal(id,{...proof(),expiresAt:0},signal())).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();await expect(downloadSupplierOriginal(id,proof(),signal())).rejects.toThrow();
});
