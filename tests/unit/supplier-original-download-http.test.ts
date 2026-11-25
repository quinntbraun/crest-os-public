import {randomUUID,createHash} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({csrf:vi.fn(),admit:vi.fn(),download:vi.fn()}));
vi.mock('../../src/security/trusted-transport.ts',()=>({createTrustedTransport:()=>()=>{}}));
vi.mock('../../src/security/session-request-guard.ts',()=>({createSessionCsrfVerifier:()=>mocks.csrf,createPrivateFileCsrfVerifier:()=>mocks.csrf}));
vi.mock('../../src/security/session-request-admission.ts',()=>({createSessionRequestAdmission:()=>mocks.admit}));
vi.mock('../../src/bookkeeping/expenses/supplier-bill-original-directory.ts',()=>({createSupplierOriginalDirectory:()=>({})}));
vi.mock('../../src/bookkeeping/expenses/supplier-bill-original-workflow.ts',()=>({createSupplierOriginalAccess:()=>({download:mocks.download})}));
import {createSupplierBillOriginalHttp} from '../../src/bookkeeping/expenses/supplier-bill-original-http';
import {receiptDownloadResponse,isReceiptDownloadResponse} from '../../src/bookkeeping/expenses/receipt-download-response';
const businessId=randomUUID(),originalId=randomUUID(),content=Buffer.from('Synthetic original evidence'),sha256=createHash('sha256').update(content).digest('hex');
function factory(){return createSupplierBillOriginalHttp({environment:'test',businessId,origin:'https://crest.example',connectionString:'unused',ingress:{} as never},{} as never,{} as never,'unused',{stagingOrigin:'http://127.0.0.1:34343',objects:{} as never,dispatch:vi.fn() as never});}
function request(body:unknown={originalId},path='original',method='POST'){return new Request('https://crest.example/api/business/supplier-original/'+path,{method,headers:{'content-type':'application/json',cookie:'__Host-crest_session='+Buffer.alloc(32,1).toString('base64url')},...method==='POST'?{body:JSON.stringify(body)}:{}});}
beforeEach(()=>{vi.resetAllMocks();mocks.csrf.mockResolvedValue(undefined);mocks.admit.mockResolvedValue(true);mocks.download.mockImplementation(async()=>receiptDownloadResponse(content,{name:`receipt-${originalId}.png`,type:'image/png',byteSize:content.length,sha256},true));});
it('preserves the one-use verified binary response and calls the original variant',async()=>{
 const response=await factory()(request(),{} as never);expect(response.status).toBe(200);expect(isReceiptDownloadResponse(response)).toBe(true);expect(response.headers.get('x-crest-sha256')).toBe(sha256);expect(mocks.csrf).toHaveBeenCalledOnce();expect(mocks.admit).toHaveBeenCalledOnce();expect(mocks.download.mock.calls[0]!.slice(1,4)).toEqual([businessId,originalId,'original']);expect(Buffer.from(await response.arrayBuffer())).toEqual(content);
});
it.each([{originalId:'invalid'},{originalId,objectKey:'originals/foreign/secret'}])('rejects caller-selected scope before any file read: %j',async body=>{expect((await factory()(request(body),{} as never)).status).toBe(400);expect(mocks.download).not.toHaveBeenCalled();});
it('refuses missing CSRF, denied read authority and throttled requests',async()=>{
 mocks.csrf.mockRejectedValueOnce(Error('denied'));expect((await factory()(request(),{} as never)).status).toBe(400);expect(mocks.download).not.toHaveBeenCalled();
 mocks.admit.mockResolvedValueOnce(false);expect((await factory()(request(),{} as never)).status).toBe(429);expect(mocks.download).not.toHaveBeenCalled();
 mocks.download.mockRejectedValueOnce(Error('denied'));expect((await factory()(request(),{} as never)).status).toBe(400);
});
it('retains the two-active-file bound',async()=>{
 const resolvers:Array<(value:Response)=>void>=[];mocks.download.mockImplementation(()=>new Promise<Response>(resolve=>resolvers.push(resolve)));const handler=factory(),first=handler(request(),{} as never),second=handler(request(),{} as never);await vi.waitFor(()=>expect(mocks.download).toHaveBeenCalledTimes(2));expect((await handler(request(),{} as never)).status).toBe(429);for(const resolve of resolvers)resolve(new Response('fixture'));await Promise.all([first,second]);
});
