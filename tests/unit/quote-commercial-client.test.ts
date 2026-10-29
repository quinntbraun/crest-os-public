import {randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {quoteCommercial,QuoteCommercialClientError,parseQuoteCommercialReference} from '../../src/client/quote-commercial';
import {commercialFixture,commercialSend,commercialAccept,commercialCommitted} from './quote-commercial-fixture';
import {quoteResponseLimit} from '../../src/commercial/quote-storage-contract';
const fetcher=vi.fn<typeof fetch>(),signal=()=>new AbortController().signal,proof=()=>({csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000});
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'private, no-store'}});
beforeEach(()=>vi.stubGlobal('fetch',fetcher));afterEach(()=>{vi.unstubAllGlobals();vi.resetAllMocks();});
function reference(input:ReturnType<typeof commercialSend>|ReturnType<typeof commercialAccept>){const common={operationId:input.operationId,recoveryEpoch:input.recoveryEpoch,familyId:input.familyId,revisionId:input.revisionId,expectedFamilyVersion:input.expectedFamilyVersion,expectedRevisionVersion:input.expectedRevisionVersion,expectedContentVersion:input.expectedContentVersion};return parseQuoteCommercialReference('sendId'in input?{...common,action:'send',sendId:input.sendId,approvalId:input.approvalId}:{...common,action:'accept',acceptanceId:input.acceptanceId,agreementId:input.agreementId});}
it.each(['send','accept'] as const)('sends one explicit %s over the private bounded route and binds its exact commit',async action=>{
 const f=commercialFixture('Sent'),request=action==='send'?commercialSend(f):commercialAccept(f),committed=commercialCommitted(request);fetcher.mockResolvedValueOnce(response(committed));const result=action==='send'?await quoteCommercial.send(request as ReturnType<typeof commercialSend>,proof(),signal()):await quoteCommercial.accept(request as ReturnType<typeof commercialAccept>,proof(),signal());expect(result).toEqual(committed);
 const [url,options]=fetcher.mock.calls[0]!;expect(url).toBe('/api/business/quotes/commercial/'+action);expect(options).toMatchObject({method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});const {businessId:omitted,...body}=request;expect(omitted).toBe(f.f.business);expect(JSON.parse(String(options?.body))).toEqual(body);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('refuses substituted commit targets, row/content versions, hashes and acceptance sources as unknown',async()=>{
 const f=commercialFixture('Sent'),send=commercialSend(f),accept=commercialAccept(f),saved=commercialCommitted(send),accepted=commercialCommitted(accept);
 for(const receipt of [{...saved.receipt,sendId:randomUUID()},{...saved.receipt,approvalId:randomUUID()},{...saved.receipt,revisionVersion:'8'},{...saved.receipt,contentHash:'c'.repeat(64)}]){fetcher.mockResolvedValueOnce(response({...saved,receipt}));await expect(quoteCommercial.send(send,proof(),signal())).rejects.toMatchObject({kind:'unknown'});}
 for(const receipt of [{...accepted.receipt,acceptanceId:randomUUID()},{...accepted.receipt,agreementId:randomUUID()},{...accepted.receipt,sendId:randomUUID()},{...accepted.receipt,customerId:randomUUID()}]){fetcher.mockResolvedValueOnce(response({...accepted,receipt}));await expect(quoteCommercial.accept(accept,proof(),signal())).rejects.toMatchObject({kind:'unknown'});}
});
it('looks up only the opaque original and never invents a stored expected hash',async()=>{
 const f=commercialFixture('Sent'),request=commercialAccept(f),initial=commercialCommitted(request),committed={...initial,receipt:{...initial.receipt,contentHash:'d'.repeat(64)}};fetcher.mockResolvedValueOnce(response(committed));expect(await quoteCommercial.lookup(f.f.business,reference(request),proof(),signal())).toEqual(committed);expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({operationId:request.operationId});
 fetcher.mockResolvedValueOnce(response({state:'absent'}));expect(await quoteCommercial.lookup(f.f.business,reference(request),proof(),signal())).toEqual({state:'absent'});
 fetcher.mockResolvedValueOnce(response({...committed,recoveryEpoch:randomUUID()}));await expect(quoteCommercial.lookup(f.f.business,reference(request),proof(),signal())).rejects.toMatchObject({kind:'unavailable'});
});
it('validates actual32-byte SHA256 over the retained presentation before exposing read facts',async()=>{
 const f=commercialFixture('Accepted');fetcher.mockResolvedValueOnce(response(f.packet));expect(await quoteCommercial.read(f.f.business,{familyId:f.f.family.id,revisionId:f.f.revision.id},proof(),signal())).toEqual(f.packet);
 fetcher.mockResolvedValueOnce(response({...f.packet,approval:{...f.approval,presentationHash:'a'.repeat(64)},latestSend:{...f.send,presentationHash:'a'.repeat(64)},acceptanceSend:{...f.send,presentationHash:'a'.repeat(64)}}));await expect(quoteCommercial.read(f.f.business,{familyId:f.f.family.id,revisionId:f.f.revision.id},proof(),signal())).rejects.toMatchObject({kind:'unavailable'});
});
it('rejects duplicate decoded keys, oversized bodies and missing private headers without retry or partial facts',async()=>{
 const f=commercialFixture('Sent'),raw=JSON.stringify(f.packet),input={familyId:f.f.family.id,revisionId:f.f.revision.id},headers={'content-type':'application/json','cache-control':'no-store'};
 for(const value of [new Response(raw.replace('"schemaVersion":1','"schemaVersion":1,"schema\\u0056ersion":1'),{headers}),new Response(raw,{headers:{'content-type':'application/json'}}),new Response(' '.repeat(quoteResponseLimit+1),{headers}),new Response(new Uint8Array([0xc3,0x28]),{headers})]){fetcher.mockResolvedValueOnce(value);await expect(quoteCommercial.read(f.f.business,input,proof(),signal())).rejects.toMatchObject({kind:'unavailable'});}
 fetcher.mockRejectedValueOnce(Error('PRIVATE transport'));await expect(quoteCommercial.send(commercialSend(f),proof(),signal())).rejects.toMatchObject({kind:'unknown'});expect(fetcher).toHaveBeenCalledTimes(5);
});
it('keeps typed definite conflicts/errors separate from uncertain submission',async()=>{
 const f=commercialFixture('Sent'),request=commercialSend(f);
 for(const reason of ['version','operation','accepted','expired']){const value=reason==='version'?{state:'conflict',reason,currentFamilyVersion:'7',currentRevisionVersion:'7'}:{state:'conflict',reason};fetcher.mockResolvedValueOnce(response(value,409));expect(await quoteCommercial.send(request,proof(),signal())).toEqual(value);}
 for(const [error,status,kind]of [['QUOTE_COMMERCIAL_NOT_SUBMITTED',503,'not_submitted'],['QUOTE_COMMERCIAL_DENIED',403,'denied'],['RECOVERY_REVIEW_REQUIRED',409,'recovery'],['QUOTE_COMMERCIAL_REQUEST_LIMITED',429,'limited']] as const){fetcher.mockResolvedValueOnce(response({error},status));await expect(quoteCommercial.send(request,proof(),signal())).rejects.toMatchObject({kind});}
 expect(new QuoteCommercialClientError('unknown').message).not.toContain('PRIVATE');
});
