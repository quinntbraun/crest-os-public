import {it,expect,vi,afterEach} from 'vitest';
vi.mock('server-only',()=>({}));
import {randomUUID,createHash} from 'node:crypto';
import {businessSourceFixture} from '../support/business-source-fixture.ts';
import {journalCollectionFixture} from '../support/journal-collection-fixture.ts';
import {collectJournalSources} from '../../src/security/source-export-journal-collection.ts';
import {createBusinessSourceJournalExportWorker} from '../../src/security/business-source-export-worker.ts';
import type {JournalSourceExportClaim,JournalSourceExportPlan,JournalSourceExportJobPort,SourceExportAck} from '../../src/security/business-source-export-worker.ts';
import {bindSourceExportJournalWorker} from '../../src/security/source-export-journal-worker-port.ts';
import {exportPartObjectKey} from '../../src/security/export-part-crypto.ts';
import type {createEncryptedExportPartStore,ExportPartIntent} from '../../src/files/export-part-store.ts';
import * as formatter from '../../src/security/business-source-journal-bundle.ts';
import {verifyBusinessSourceJournalBundle} from '../../src/tooling/verify-business-source-journal-bundle.ts';

afterEach(()=>vi.restoreAllMocks());
const sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex'),signal=()=>new AbortController().signal,error='SOURCE_EXPORT_RUN_REVIEW_REQUIRED';
const ack=(stage:SourceExportAck['stage'],request:unknown):SourceExportAck=>({formatVersion:1,stage,requestSha256:sha(JSON.stringify(request))});
async function fixture(){
 const f=businessSourceFixture(),base=f.value(),j=journalCollectionFixture(f.businessId,base.observedAt),collected=await collectJournalSources(j.query,()=>{},{...j.input(),generationId:base.generationId});
 const source={...base,sourceSchemaVersion:43 as const,journal:collected.journal,metadataBytes:base.evidenceBytes+collected.metadataBytes,wireBytes:collected.wireBytes,originalBytes:collected.originalBytes,evidenceBytes:[base.configuration,base.identity,base.history,base.crm,collected.journal].reduce((n,t)=>n+Buffer.byteLength(t),0),recordCount:base.recordCount+collected.recordCount};
 const claim:JournalSourceExportClaim={formatVersion:1,profile:'crest.business-source-journal-bundle.v1',businessId:f.businessId,actorId:f.foundation.identity.owner,exportJobId:randomUUID(),recoveryEpoch:randomUUID(),leaseId:randomUUID()},events:string[]=[],buffers:Uint8Array[]=[],plain=new Map<string,string>();let plan:JournalSourceExportPlan|undefined;
 const stages=['authorize','snapshot','intent','verified','ready'] as const,jobs=Object.fromEntries(stages.map(stage=>[stage,vi.fn(async(request:unknown)=>{events.push(stage);if(stage==='snapshot')plan=(request as {plan:JournalSourceExportPlan}).plan;return ack(stage,request);})])) as unknown as JournalSourceExportJobPort;
 const candidates=new WeakMap<object,ExportPartIntent>(),store:Pick<Awaited<ReturnType<typeof createEncryptedExportPartStore>>,'prepare'|'writeCandidate'>={
  prepare:vi.fn(async(bytes,binding)=>{events.push('prepare');buffers.push(bytes);plain.set(binding.fileName,Buffer.from(bytes).toString());const intent:ExportPartIntent={formatVersion:1,objectKey:exportPartObjectKey(binding),keyId:'synthetic',plaintextBytes:bytes.length,plaintextSha256:sha(bytes),ciphertextBytes:bytes.length+128,ciphertextSha256:'d'.repeat(64)},sealed={intentForServer:()=>intent,toJSON():never{throw Error('PRIVATE');}};candidates.set(sealed,intent);return sealed;}),
  writeCandidate:vi.fn(async p=>{events.push('write');expect(events.at(-2)).toBe('intent');return candidates.get(p)!;})
 },config={businessId:f.businessId,appReleaseId:f.expected.appReleaseId},collect=vi.fn(async()=>{events.push('capture');return {forJournalServer:()=>source,toJSON():never{throw Error('PRIVATE');}};});
 return {f,source,claim,jobs,store,events,buffers,plain,config,collect,create:()=>createBusinessSourceJournalExportWorker(config,collect,store,jobs),get plan(){return plan;}};
}
it('freezes a schema43 joint plan and verifies every physical file before durable intents and private Ready',async()=>{
 const f=await fixture(),v=await f.create().run(f.claim,signal());expect(f.plan?.sourceSchemaVersion).toBe(43);expect(f.plan?.claim.profile).toBe('crest.business-source-journal-bundle.v1');expect(f.plan?.parts).toHaveLength(118);expect(f.plan?.parts.at(-1)?.fileName).toBe('source_manifest.json');expect(f.events.slice(0,3)).toEqual(['authorize','capture','snapshot']);expect(f.events.slice(3,-1)).toEqual(Array.from({length:118},()=>['prepare','intent','write','verified']).flat());expect(f.events.at(-1)).toBe('ready');
 const manifest=JSON.parse(f.plain.get('source_manifest.json')!);expect(manifest.profile).toBe('crest.source-logical-files.v1');expect(manifest.sourceSchemaVersion).toBe(43);expect(manifest.files).toHaveLength(117);expect(v.forJournalWorker().parts).toBe(118);expect(v).not.toHaveProperty('forServer');expect(()=>JSON.stringify(v)).toThrow(error);expect(f.buffers.every(b=>b.every(v=>v===0))).toBe(true);expect(Object.isFrozen(f.plan?.parts)).toBe(true);
});
it('rejects a legacy42 claim before any authorization, collection or storage',async()=>{const f=await fixture();await expect(f.create().run({...f.claim,profile:'crest.business-source-bundle.v1'},signal())).rejects.toThrow(error);expect(f.events).toEqual([]);});
it.each(['metadataBytes','originalBytes','wireBytes','evidenceBytes','recordCount'])('refuses changed %s before any snapshot or key preparation',async field=>{const f=await fixture();Object.assign(f.source,{[field]:(f.source[field as keyof typeof f.source] as number)+1});await expect(f.create().run(f.claim,signal())).rejects.toThrow(error);expect(f.events).toEqual(['authorize','capture']);});
it.each(['snapshot','intent','ready'] as const)('stops after an uncertain %s acknowledgment with no retry or replacement',async stage=>{
 const f=await fixture();vi.mocked(f.jobs[stage]).mockImplementationOnce(async()=>{f.events.push(stage);throw Error('PRIVATE DATABASE ERROR');});await expect(f.create().run(f.claim,signal())).rejects.toThrow(error);expect(f.jobs[stage]).toHaveBeenCalledTimes(1);if(stage!=='ready')expect(f.store.writeCandidate).not.toHaveBeenCalled();expect(f.buffers.every(b=>b.every(v=>v===0))).toBe(true);
});
it('keeps manifest and plan release bindings frozen while authorization waits',async()=>{
 const f=await fixture();let release=()=>{};const held=new Promise<void>(r=>{release=r;});vi.mocked(f.jobs.authorize).mockImplementationOnce(async request=>{await held;return ack('authorize',request);});const worker=f.create(),pending=worker.run(f.claim,signal());f.config.appReleaseId='b'.repeat(40);release();await pending;expect(f.plan?.appReleaseId).toBe('a'.repeat(40));expect(JSON.parse(f.plain.get('source_manifest.json')!).appReleaseId).toBe(f.plan?.appReleaseId);
});
it('independently refuses a formatter output with changed physical text before snapshot and storage',async()=>{
 const f=await fixture(),original=formatter.formatBusinessSourceJournalBundle;vi.spyOn(formatter,'formatBusinessSourceJournalBundle').mockImplementationOnce(async(...args)=>{const value=(await original(...args)).forJournalBundle(),parts=value.parts.map((p,i)=>i===0?{...p,content:p.content+'x',bytes:p.bytes+1,sha256:sha(p.content+'x')}:p);return {forJournalBundle:()=>({...value,parts}),toJSON():never{throw Error('PRIVATE');}};});await expect(f.create().run(f.claim,signal())).rejects.toThrow(error);expect(f.events).toEqual(['authorize','capture']);
});
it.each(['generation','journal-original'])('rejects an internally consistent substitute %s package before durable or object effects',async issue=>{
 const f=await fixture(),fake={...f.source};
 if(issue==='generation'){fake.generationId=randomUUID();for(const group of ['configuration','identity','history','crm','journal'] as const){const parsed=JSON.parse(fake[group]);parsed.generationId=fake.generationId;fake[group]=JSON.stringify(parsed);}}
 else{const j=journalCollectionFixture(fake.businessId,fake.observedAt,' {"substituted":true}\n'),next=await collectJournalSources(j.query,()=>{},{...j.input(),generationId:fake.generationId}),old=JSON.parse(fake.journal);fake.journal=next.journal;fake.metadataBytes=fake.metadataBytes-old.metadataBytes+next.metadataBytes;fake.wireBytes=next.wireBytes;fake.originalBytes=next.originalBytes;}
 fake.evidenceBytes=[fake.configuration,fake.identity,fake.history,fake.crm,fake.journal].reduce((n,t)=>n+Buffer.byteLength(t),0);
 const binding={...f.config,generationId:fake.generationId,sourceSchemaVersion:43 as const},replacement=await formatter.formatBusinessSourceJournalBundle({forJournalServer:()=>fake,toJSON():never{throw Error('PRIVATE');}},binding),valid=replacement.forJournalBundle();expect(verifyBusinessSourceJournalBundle(valid.manifest,valid.parts,binding).forJournalBundleVerification().originals.journal).toBe(fake.journal);
 vi.spyOn(formatter,'formatBusinessSourceJournalBundle').mockResolvedValueOnce(replacement);
 await expect(f.create().run(f.claim,signal())).rejects.toThrow(error);expect(f.events).toEqual(['authorize','capture']);expect(f.store.prepare).not.toHaveBeenCalled();
});
it('reads and seals the original collector capture once before formatter work',async()=>{
 const f=await fixture(),read=vi.fn(()=>f.source);f.collect.mockResolvedValueOnce({forJournalServer:read,toJSON():never{throw Error('PRIVATE');}});await f.create().run(f.claim,signal());expect(read).toHaveBeenCalledTimes(1);
});
function portFixture(){
 const calls:{stage:string;credential:string;raw:string;signal:AbortSignal}[]=[],methods=Object.fromEntries((['authorize','snapshot','intent','verified','ready'] as const).map(stage=>[stage,vi.fn(async(credential:string,raw:string,signal:AbortSignal)=>{calls.push({stage,credential,raw,signal});return {formatVersion:1 as const,stage,requestSha256:sha(raw)};})])),credential=vi.fn(async()=>'PRIVATE_SEPARATE_CREDENTIAL');
 const port=bindSourceExportJournalWorker(methods as unknown as Parameters<typeof bindSourceExportJournalWorker>[0],credential);return {calls,methods,credential,port};
}
it.each(['authorize','snapshot','intent','verified','ready'] as const)('binds %s to one exact original JSON and a separately acquired credential',async stage=>{
 const f=portFixture(),request={immutable:'original'},s=signal(),response=await f.port[stage](request as never,s);expect(response.requestSha256).toBe(sha(JSON.stringify(request)));expect(f.calls).toEqual([{stage,credential:'PRIVATE_SEPARATE_CREDENTIAL',raw:JSON.stringify(request),signal:s}]);expect(f.calls[0]!.raw).not.toContain('CREDENTIAL');expect(f.credential).toHaveBeenCalledTimes(1);
});
it('copies original request JSON before waiting for credentials and fixes database method references',async()=>{
 const f=portFixture();let release=()=>{};f.credential.mockImplementationOnce(async()=>{await new Promise<void>(r=>{release=r;});return 'PRIVATE';});const request={immutable:'original'},pending=f.port.authorize(request as never,signal());request.immutable='changed';f.methods.authorize=vi.fn(async()=>{throw Error('REPLACED');});release();await pending;expect(f.calls[0]!.raw).toBe('{"immutable":"original"}');
});
it('does not submit a late credential after cancellation',async()=>{
 const f=portFixture(),controller=new AbortController();f.credential.mockImplementationOnce(async()=>{controller.abort();return 'PRIVATE';});await expect(f.port.authorize({} as never,controller.signal)).rejects.toThrow(error);expect(f.calls).toEqual([]);
});
it('sanitizes credential failures without database submission',async()=>{const f=portFixture();f.credential.mockRejectedValueOnce(Error('PRIVATE SECRET'));const caught=await f.port.authorize({} as never,signal()).catch(e=>e);expect(caught.message).toBe(error);expect(caught.cause).toBeUndefined();expect(f.calls).toEqual([]);});
