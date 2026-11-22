// Session/database seams test request sealing and freshness selection only.
import {randomBytes,randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const boundary=vi.hoisted(()=>{
 const query=vi.fn();return {verify:vi.fn(),query,database:Object.assign(query,{commandTransaction:async(work:(run:typeof query)=>Promise<unknown>)=>work(query)})};
});
vi.mock('../../src/security/session-lifecycle.ts',()=>({createSessionLifecycle:()=>({verify:boundary.verify})}));
vi.mock('../../src/security/session-database.ts',()=>({financePreviewDatabase:()=>boundary.database,productionFinanceDatabase:()=>boundary.database,supplierDocumentWorkerDatabase:()=>boundary.database}));
import {createSupplierOriginalDirectory} from '../../src/bookkeeping/expenses/supplier-bill-original-directory';
import {createProductionCapabilities} from '../../src/security/production-capabilities';

it('seals the supplier business and command values across fresh session verification',async()=>{
 const businessId=randomUUID(),epoch=randomUUID(),foreign=randomUUID(),values=[epoch,randomUUID(),randomUUID(),randomUUID(),'1','image/png',4];
 const config={environment:'production' as const,connectionString:'postgresql://crest_runtime:fixture-only@database.example.com/crest',businessId,productionCapabilities:createProductionCapabilities({productionActivation:'ready'},businessId,['operationResolution','finance','supplierOriginals'])};
 let enter!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{enter=resolve;}),barrier=new Promise<void>(resolve=>{release=resolve;});
 boundary.verify.mockImplementationOnce(async()=>{enter();await barrier;return {sessionId:randomUUID(),actorId:randomUUID(),provider:{issuer:'https://identity.example.com/auth/v1',subject:randomUUID(),sessionId:randomUUID(),expiresAt:Date.now()+60000}};});boundary.query.mockResolvedValueOnce(null);
 const directory=createSupplierOriginalDirectory(config,{} as Parameters<typeof createSupplierOriginalDirectory>[1],{} as Parameters<typeof createSupplierOriginalDirectory>[2],'postgresql://crest_finance_runtime:fixture-only@database.example.com/crest');
 const pending=directory.reserve(randomBytes(32).toString('base64url'),values,new AbortController().signal);await started;values[0]=randomUUID();config.businessId=foreign;release();await pending;
 const parameters=boundary.query.mock.calls[0]![1] as unknown[];expect(parameters[7]).toBe(businessId);expect(parameters[8]).toBe(epoch);
 expect(boundary.verify.mock.calls[0]!.slice(2)).toEqual(['background',true]);
 await expect(directory.read('not-a-session',foreign,randomUUID(),new AbortController().signal)).rejects.toThrow('SUPPLIER_ORIGINAL_AUTHORITY_REQUIRED');expect(boundary.verify).toHaveBeenCalledTimes(1);
});
