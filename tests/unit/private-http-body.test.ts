import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {readFlatJsonBody} from '../../src/security/private-http.ts';
const request=(text:string,headers:Record<string,string>={})=>new Request('https://crest.example.com/private',{method:'POST',headers,body:text});
it('default8KiB and explicitly bounded larger bodies count exact UTF8 bytes',async()=>{
 const text=JSON.stringify({notes:'😀'.repeat(4000)}),bytes=Buffer.byteLength(text);
 await expect(readFlatJsonBody(request(text),['notes'])).rejects.toThrow('PRIVATE_HTTP_FAILED');
 expect(await readFlatJsonBody(request(text,{'content-length':String(bytes)}),['notes'],bytes)).toEqual({notes:'😀'.repeat(4000)});
 await expect(readFlatJsonBody(request(text),['notes'],bytes-1)).rejects.toThrow('PRIVATE_HTTP_FAILED');
});
it.each([0,-1,131073,NaN,Infinity,1.5])('refuses an unbounded or invalid configured cap: %s',async size=>{await expect(readFlatJsonBody(request('{}'),[],size)).rejects.toThrow('PRIVATE_HTTP_FAILED');});
it('larger allowance retains declared length, encoding and duplicate-key rejection',async()=>{
 for(const [text,headers] of [[JSON.stringify({notes:'é'}),{'content-length':'13'}],['{"notes":"first","no\\u0074es":"second"}',{}],['{"notes":"value"}',{'content-encoding':'gzip'}]] as const)await expect(readFlatJsonBody(request(text,headers),['notes'],131072)).rejects.toThrow('PRIVATE_HTTP_FAILED');
});
it('chunked oversized bodies are cancelled without accepting partial content',async()=>{
 const cancel=vi.fn(),stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('{"notes":"'));controller.enqueue(new Uint8Array(131072).fill(32));},cancel});
 const value=new Request('https://crest.example.com/private',{method:'POST',body:stream,duplex:'half'} as RequestInit);
 await expect(readFlatJsonBody(value,['notes'],131072)).rejects.toThrow('PRIVATE_HTTP_FAILED');expect(cancel).toHaveBeenCalledTimes(1);
});
