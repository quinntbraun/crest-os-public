import {randomBytes,randomUUID} from 'node:crypto';
import {afterEach,it,expect,vi} from 'vitest';
import {businessSettings,BusinessSettingsError,renameInput} from '../../src/client/business-settings';
const businessId=randomUUID(),operationId=randomUUID(),epoch=randomUUID(),tag=randomBytes(32).toString('base64url'),proof={csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000};
const signal=()=>new AbortController().signal,command=()=>({schemaVersion:1 as const,operationId,recoveryEpoch:epoch,expectedVersion:'9007199254740993',legalName:' Exact synthetic \u00e9 '});
const context=()=>({schemaVersion:1,businessId,legalName:'Current synthetic',businessVersion:'9007199254740993',writeState:'ready',recoveryEpoch:epoch});
const committed=()=>({state:'committed',operationId,recoveryEpoch:epoch,receipt:{schemaVersion:1,businessId,businessVersion:'9007199254740994',auditEventId:randomUUID()}});
const response=(value:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-crest-edit-binding':tag,...headers}});
const mocked=(result:Response)=>{const fetch=vi.fn().mockResolvedValue(result);vi.stubGlobal('fetch',fetch);return fetch;};
afterEach(()=>vi.unstubAllGlobals());
it('uses same-origin/no-store/no-redirect requests and returns only exact frozen settings plus a non-authorizing binding',async()=>{
  const fetch=mocked(response(context()));const result=await businessSettings.settings(proof,signal());expect(result).toEqual({context:context(),binding:tag});expect(Object.isFrozen(result.context)).toBe(true);
  expect(fetch).toHaveBeenCalledWith('/api/business/settings',expect.objectContaining({method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',body:'{}',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken}}));
});
it('preserves paused/null and exact Unicode/decimal versions without normalization',async()=>{
  const paused={...context(),legalName:command().legalName,writeState:'paused',recoveryEpoch:null};mocked(response(paused));expect((await businessSettings.settings(proof,signal())).context).toEqual(paused);expect(renameInput(command())).toBe(true);
});
it('sends only the pinned typed command once and validates commit receipt against original business/version/epoch/ID',async()=>{
  const value=committed(),fetch=mocked(response(value));const result=await businessSettings.rename(businessId,command(),proof,signal());expect(result).toEqual(value);expect(fetch).toHaveBeenCalledTimes(1);expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual(command());expect(Object.isFrozen(result)).toBe(true);
});
it('lookup sends only the original operation ID and never silently replaces historical context',async()=>{
  const fetch=mocked(response({state:'absent'}));expect(await businessSettings.lookup(businessId,command(),proof,signal())).toEqual({state:'absent'});expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({operationId});
  const known=committed();fetch.mockResolvedValue(response(known));expect(await businessSettings.lookup(businessId,command(),proof,signal())).toEqual(known);
});
it.each([{state:'conflict',reason:'operation'},{state:'conflict',reason:'version',currentVersion:'9007199254740994'}])('accepts only explicit409 conflict projections',async value=>{mocked(response(value,409));expect(await businessSettings.rename(businessId,command(),proof,signal())).toEqual(value);});
it.each([['BUSINESS_RENAME_INPUT_REQUIRED',400,'input'],['BUSINESS_RENAME_NOT_SUBMITTED',503,'not_submitted'],['BUSINESS_RENAME_DENIED',403,'denied'],['RECOVERY_REVIEW_REQUIRED',409,'recovery'],['BUSINESS_REQUEST_LIMITED',429,'limited'],['BUSINESS_RENAME_OUTCOME_UNKNOWN',503,'unknown']] as const)('maps only fixed status/code pair %s',async(error,status,kind)=>{
  const fetch=mocked(response({error},status));await expect(businessSettings.rename(businessId,command(),proof,signal())).rejects.toMatchObject({kind,message:'BUSINESS_SETTINGS_FAILED'});expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([null,{}, {...context(),secret:'private'},{...context(),schemaVersion:2},{...context(),businessVersion:Number('9007199254740993')},{...context(),businessVersion:'9223372036854775808'},{...context(),writeState:'paused'},{...context(),legalName:'\ud800'}])('fails closed on malformed settings without reflecting fields',async value=>{mocked(response(value));await expect(businessSettings.settings(proof,signal())).rejects.toBeInstanceOf(BusinessSettingsError);});
it.each([{...committed(),operationId:randomUUID()},{...committed(),recoveryEpoch:randomUUID()},{...committed(),receipt:{...committed().receipt,businessId:randomUUID()}},{...committed(),receipt:{...committed().receipt,businessVersion:'9007199254740995'}},{...committed(),extra:'private'}])('never treats an inconsistent receipt as confirmed success',async value=>{mocked(response(value));await expect(businessSettings.rename(businessId,command(),proof,signal())).rejects.toMatchObject({kind:'unknown'});});
it.each([{'content-type':'text/html'},{'cache-control':'public'}, {'x-crest-edit-binding':'bad'}])('rejects unsafe response metadata',async headers=>{mocked(response(context(),200,headers));await expect(businessSettings.settings(proof,signal())).rejects.toMatchObject({kind:'unknown'});});
it('network failure, unknown error codes and wrong status/code pairs remain uncertain, without automatic retries',async()=>{
  const fetch=vi.fn().mockRejectedValue(new Error('private network detail'));vi.stubGlobal('fetch',fetch);const error=await businessSettings.rename(businessId,command(),proof,signal()).catch((e:unknown)=>e);expect(error).toMatchObject({kind:'unknown'});expect(error).not.toHaveProperty('cause');expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValue(response({error:'BUSINESS_RENAME_NOT_SUBMITTED'},400));await expect(businessSettings.rename(businessId,command(),proof,signal())).rejects.toMatchObject({kind:'unknown'});
});
it('rejects invalid command values before network submission',async()=>{
  const fetch=mocked(response(committed()));await expect(businessSettings.rename(businessId,{...command(),expectedVersion:'01'},proof,signal())).rejects.toMatchObject({kind:'input'});expect(fetch).not.toHaveBeenCalled();
});
it('oversize, malformed UTF8 and duplicate-key responses never become confirmed success',async()=>{
  const headers={'content-type':'application/json','cache-control':'no-store'};for(const body of ['x'.repeat(8193),new Uint8Array([0xff]),JSON.stringify(committed()).replace('"state":"committed"','"state":"absent","state":"committed"')]){mocked(new Response(body,{headers}));await expect(businessSettings.rename(businessId,command(),proof,signal())).rejects.toMatchObject({kind:'unknown'});}
});
it('a stalled response body honors active cancellation even when a source ignores the fetch signal',async()=>{
  const controller=new AbortController();mocked(new Response(new ReadableStream({start(){},cancel(){return new Promise(()=>{});}}),{headers:{'content-type':'application/json','cache-control':'no-store'}}));
  const waiting=businessSettings.rename(businessId,command(),proof,controller.signal);await Promise.resolve();await Promise.resolve();controller.abort();await expect(waiting).rejects.toMatchObject({kind:'unknown'});
});
it('an empty response chunk fails instead of spinning on an unbounded source',async()=>{
  mocked(new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array());},cancel(){}}),{headers:{'content-type':'application/json','cache-control':'no-store'}}));
  await expect(businessSettings.rename(businessId,command(),proof,signal())).rejects.toMatchObject({kind:'unknown'});
});
