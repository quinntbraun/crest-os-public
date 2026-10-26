import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createBusinessSourceExportWorker,SourceExportWorkerError} from '../../src/security/business-source-export-worker.ts';
import type {SourceExportAck,SourceExportClaim,SourceExportJobPort,SourceExportPartRequest,SourceExportPlan,SourceExportReadyRequest} from '../../src/security/business-source-export-worker.ts';
import {exportPartObjectKey} from '../../src/security/export-part-crypto.ts';
import type {createEncryptedExportPartStore,ExportPartIntent} from '../../src/files/export-part-store.ts';
import {businessSourceFixture} from '../support/business-source-fixture.ts';
import * as formatter from '../../src/security/business-source-bundle.ts';
type Store=Pick<Awaited<ReturnType<typeof createEncryptedExportPartStore>>,'prepare'|'writeCandidate'>;
const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const ack=(stage:SourceExportAck['stage'],request:unknown):SourceExportAck=>({formatVersion:1,stage,requestSha256:hash(JSON.stringify(request))});
const error='SOURCE_EXPORT_RUN_REVIEW_REQUIRED',signal=()=>new AbortController().signal;
function fixture(timeoutMs=900000){
 const f=businessSourceFixture(),events:string[]=[],intents:SourceExportPartRequest[]=[],verified:SourceExportPartRequest[]=[],buffers:Uint8Array[]=[];
 const claim:SourceExportClaim={formatVersion:1,profile:'crest.business-source-bundle.v1',businessId:f.businessId,actorId:f.foundation.identity.owner,exportJobId:randomUUID(),recoveryEpoch:randomUUID(),leaseId:randomUUID()};
 let plan:SourceExportPlan|undefined,ready:SourceExportReadyRequest|undefined;
 const jobs:SourceExportJobPort={
  authorize:vi.fn(async request=>{events.push('authorize');return ack('authorize',request);}),
  snapshot:vi.fn(async request=>{events.push('snapshot');expect(plan).toBeUndefined();plan=request.plan;return ack('snapshot',request);}),
  intent:vi.fn(async request=>{events.push('intent');expect(plan?.generationId).toBe(request.generationId);intents.push(request);return ack('intent',request);}),
  verified:vi.fn(async request=>{events.push('verified');expect(intents).toContain(request);verified.push(request);return ack('verified',request);}),
  ready:vi.fn(async request=>{events.push('ready');expect(request.parts).toEqual(verified);expect(verified).toHaveLength(plan!.parts.length);ready=request;return ack('ready',request);})
 };
 const candidates=new WeakMap<object,ExportPartIntent>();
 const store:Store={
  prepare:vi.fn(async(bytes,binding)=>{events.push('prepare');buffers.push(bytes);const intent:ExportPartIntent=Object.freeze({formatVersion:1,objectKey:exportPartObjectKey(binding),keyId:'synthetic',plaintextBytes:bytes.length,plaintextSha256:hash(bytes),ciphertextBytes:bytes.length+128,ciphertextSha256:'d'.repeat(64)});const sealed={intentForServer:()=>intent,toJSON:()=>{throw Error('PRIVATE');}};candidates.set(sealed,intent);return sealed;}),
  writeCandidate:vi.fn(async sealed=>{events.push('write');const intent=candidates.get(sealed)!;expect(intents.some(record=>record.intent===intent||JSON.stringify(record.intent)===JSON.stringify(intent))).toBe(true);return intent;})
 };
 const collect=vi.fn(async()=>{events.push('capture');return f.seal();}),config={businessId:f.businessId,appReleaseId:f.expected.appReleaseId,timeoutMs};
 const create=()=>createBusinessSourceExportWorker(config,collect,store,jobs);
 return {f,config,claim,jobs,store,collect,events,intents,verified,buffers,create,get plan(){return plan;},get ready(){return ready;}};
}
it('connects one capture to independently verified files, frozen plan, intent-before-write receipts and a final private Ready acknowledgment',async()=>{
 const f=fixture(),result=await f.create().run(f.claim,signal());
 expect(f.events.slice(0,3)).toEqual(['authorize','capture','snapshot']);expect(f.events.slice(3,-1)).toEqual(Array.from({length:95},()=>['prepare','intent','write','verified']).flat());expect(f.events.at(-1)).toBe('ready');
 expect(f.collect).toHaveBeenCalledTimes(1);expect(f.plan?.parts).toHaveLength(95);expect(new Set(f.plan?.parts.map(p=>p.partId)).size).toBe(95);expect(f.plan?.parts.at(-1)?.fileName).toBe('source_manifest.json');
 expect(f.plan).toMatchObject({claim:f.claim,generationId:f.f.value().generationId,observedAt:f.f.value().observedAt,appReleaseId:f.config.appReleaseId,sourceSchemaVersion:42,completePortableExport:false,completeBackup:false,referenceClosureComplete:false});
 expect(f.plan?.totalBytes).toBe(f.plan?.parts.reduce((n,p)=>n+p.bytes,0));
 expect(result.forServer()).toEqual({claim:f.claim,generationId:f.plan?.generationId,planSha256:f.ready?.planSha256,parts:95,completePortableExport:false,completeBackup:false});
 expect(()=>JSON.stringify(result)).toThrow(error);for(const value of [result,result.forServer(),f.plan,f.plan?.claim,f.plan?.parts,...f.plan!.parts,...f.intents])expect(Object.isFrozen(value)).toBe(true);
 expect(f.buffers.every(bytes=>bytes.every(byte=>byte===0))).toBe(true);
});
it.each(['businessId','actorId','exportJobId','leaseId','recoveryEpoch','profile','formatVersion','extra'])('rejects malformed or foreign claim %s before authorization/capture/object effects',async field=>{
 const f=fixture(),input={...f.claim,...(field==='extra'?{extra:'forbidden'}:{[field]:field==='businessId'?randomUUID():'invalid'})};await expect(f.create().run(input,signal())).rejects.toThrow(error);expect(f.events).toEqual([]);
});
it.each(['authorize','snapshot','intent','verified','ready'] as const)('an uncertain %s ledger acknowledgment stops without an automatic retry',async stage=>{
 const f=fixture(),original=vi.mocked(f.jobs[stage]).getMockImplementation()!;vi.mocked(f.jobs[stage]).mockImplementationOnce(async(request,s)=>{await original(request as never,s);throw Error('private database failure');});
 const failure=await f.create().run(f.claim,signal()).then(()=>{throw Error('Expected refusal');},caught=>caught);expect(failure).toBeInstanceOf(SourceExportWorkerError);expect(failure.message).toBe(error);expect(failure.cause).toBeUndefined();expect(f.jobs[stage]).toHaveBeenCalledTimes(1);if(stage==='ready')expect(f.ready).toBeDefined();else expect(f.ready).toBeUndefined();
 if(stage==='authorize'||stage==='snapshot')expect(f.store.prepare).not.toHaveBeenCalled();if(stage==='intent')expect(f.store.writeCandidate).not.toHaveBeenCalled();
 if(stage==='verified')expect(f.store.writeCandidate).toHaveBeenCalledTimes(1);expect(f.buffers.every(bytes=>bytes.every(byte=>byte===0))).toBe(true);
});
it.each(['authorize','snapshot','intent','verified','ready'] as const)('rejects a receipt for another %s request instead of proceeding',async stage=>{
 const f=fixture();vi.mocked(f.jobs[stage]).mockResolvedValue({formatVersion:1,stage,requestSha256:'0'.repeat(64)});
 await expect(f.create().run(f.claim,signal())).rejects.toThrow(error);expect(f.jobs[stage]).toHaveBeenCalledTimes(1);if(stage==='intent')expect(f.store.writeCandidate).not.toHaveBeenCalled();expect(f.ready).toBeUndefined();
});
it.each(['formatVersion','stage','extra'])('requires the exact acknowledgment contract: %s',async field=>{
 const f=fixture();vi.mocked(f.jobs.authorize).mockImplementation(async request=>({...ack('authorize',request),...(field==='extra'?{extra:true}:{[field]:'wrong'})}) as SourceExportAck);
 await expect(f.create().run(f.claim,signal())).rejects.toThrow(error);expect(f.collect).not.toHaveBeenCalled();
});
it('refuses a malformed late captured source before freezing a snapshot or preparing any object',async()=>{
 const f=fixture();f.f.contexts.customers=JSON.stringify({...JSON.parse(f.f.contexts.customers!),rowCount:'2'});await expect(f.create().run(f.claim,signal())).rejects.toThrow(error);expect(f.events).toEqual(['authorize','capture']);
});
it('independently rejects a coherently rehashed wrong CSV from a faulty formatter before freezing any delivery plan',async()=>{
 const f=fixture(),original=formatter.formatBusinessSourceBundle(f.f.seal(),f.f.expected).forServer();
 const parts=original.parts.map(p=>{if(p.name!=='customers.csv')return p;const content=p.content.replace('Synthetic customer','Altered customer');expect(content).not.toBe(p.content);return {...p,content,bytes:Buffer.byteLength(content),sha256:hash(content)};});
 const manifest=JSON.parse(original.manifest);manifest.parts=parts.map(({name,contentType,bytes,sha256})=>({name,contentType,bytes,sha256}));
 const spy=vi.spyOn(formatter,'formatBusinessSourceBundle').mockReturnValueOnce({forServer:()=>({parts,manifest:JSON.stringify(manifest)}),toJSON:()=>{throw Error('PRIVATE');}});
 try{await expect(f.create().run(f.claim,signal())).rejects.toThrow(error);expect(f.jobs.snapshot).not.toHaveBeenCalled();expect(f.store.prepare).not.toHaveBeenCalled();}finally{spy.mockRestore();}
});
it('keeps a lost committed object outcome uncertain with its original intent and never verifies, replaces or publishes it',async()=>{
 const f=fixture();vi.mocked(f.store.writeCandidate).mockRejectedValueOnce(Error('EXPORT_OBJECT_WRITE_UNCERTAIN'));
 await expect(f.create().run(f.claim,signal())).rejects.toThrow(error);expect(f.intents).toHaveLength(1);expect(f.verified).toHaveLength(0);expect(f.store.writeCandidate).toHaveBeenCalledTimes(1);expect(f.jobs.ready).not.toHaveBeenCalled();
});
it('rejects a mismatched encrypted custody result before recording verification',async()=>{
 const f=fixture();vi.mocked(f.store.writeCandidate).mockImplementationOnce(async()=>({...f.intents[0]!.intent,ciphertextSha256:'e'.repeat(64)}));await expect(f.create().run(f.claim,signal())).rejects.toThrow(error);expect(f.jobs.verified).not.toHaveBeenCalled();expect(f.jobs.ready).not.toHaveBeenCalled();
});
it('rejects prepared bytes that differ from the independently checked file plan before recording an intent or writing',async()=>{
 const f=fixture();vi.mocked(f.store.prepare).mockImplementationOnce(async(_bytes,binding)=>({intentForServer:()=>({formatVersion:1,objectKey:exportPartObjectKey(binding),keyId:'synthetic',plaintextBytes:1,plaintextSha256:'d'.repeat(64),ciphertextBytes:128,ciphertextSha256:'e'.repeat(64)}),toJSON:()=>{throw Error('PRIVATE');}}));
 await expect(f.create().run(f.claim,signal())).rejects.toThrow(error);expect(f.jobs.intent).not.toHaveBeenCalled();expect(f.store.writeCandidate).not.toHaveBeenCalled();
});
it('a pre-aborted run performs no authorization or source work',async()=>{
 const f=fixture();await expect(f.create().run(f.claim,AbortSignal.abort())).rejects.toThrow(error);expect(f.events).toEqual([]);
});
it('bounds an unresolved trusted ledger call and ignores its late receipt without collecting or writing',async()=>{
 const f=fixture(15);let late!:(value:SourceExportAck)=>void;vi.mocked(f.jobs.authorize).mockImplementation(request=>new Promise(resolve=>{late=()=>resolve(ack('authorize',request));}));
 await expect(f.create().run(f.claim,signal())).rejects.toThrow(error);late(ack('authorize',f.claim));await new Promise(resolve=>setImmediate(resolve));expect(f.collect).not.toHaveBeenCalled();expect(f.store.prepare).not.toHaveBeenCalled();
});
it('bounds an unresolved capture and never consumes its late private result',async()=>{
 const f=fixture(15);let late!:()=>void;f.collect.mockImplementation(()=>new Promise(resolve=>{late=()=>resolve(f.f.seal());}));await expect(f.create().run(f.claim,signal())).rejects.toThrow(error);late();await new Promise(resolve=>setImmediate(resolve));expect(f.jobs.snapshot).not.toHaveBeenCalled();
});
it('permits only one active invocation of the worker',async()=>{
 const f=fixture();let release!:()=>void;vi.mocked(f.jobs.authorize).mockImplementation(request=>new Promise(resolve=>{release=()=>resolve(ack('authorize',request));}));const worker=f.create(),running=worker.run(f.claim,signal());await expect(worker.run(f.claim,signal())).rejects.toThrow(error);release();await running;expect(f.jobs.authorize).toHaveBeenCalledTimes(1);
});
it('copies the claim/config and fixes method references before asynchronous work',async()=>{
 const f=fixture(),expected={...f.claim},worker=f.create();let release!:()=>void;vi.mocked(f.jobs.authorize).mockImplementation(request=>new Promise(resolve=>{release=()=>resolve(ack('authorize',request));}));
 const running=worker.run(f.claim,signal());Object.assign(f.claim,{actorId:randomUUID(),leaseId:randomUUID()});f.config.appReleaseId='b'.repeat(40);release();await running;expect(f.plan?.claim).toEqual(expected);expect(f.plan?.appReleaseId).toBe('a'.repeat(40));
});
it('a cancellation after Ready may have committed never returns a successful receipt or retries publication',async()=>{
 const f=fixture(),controller=new AbortController();vi.mocked(f.jobs.ready).mockImplementation(async request=>{controller.abort();return ack('ready',request);});await expect(f.create().run(f.claim,controller.signal)).rejects.toThrow(error);expect(f.jobs.ready).toHaveBeenCalledTimes(1);expect(f.verified).toHaveLength(95);
});
it.each([0,900001,1.5,NaN])('rejects an unsupported worker lifetime %s at construction',timeoutMs=>{
 const f=fixture(timeoutMs);expect(f.create).toThrow(SourceExportWorkerError);expect(f.events).toEqual([]);
});
