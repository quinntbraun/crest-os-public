import {randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
import {leadConversions} from '../../src/client/lead-conversions';
import {conversionRecordFixture,conversionLinkFixture,conversionBusiness as business} from '../support/lead-conversion-record-fixture';
import {leadConversionToWire} from '../../src/customer/lead-conversion-command-contract';
const fetcher=vi.fn(),signal=()=>new AbortController().signal,proof=()=>({csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000});
const parent=()=>conversionRecordFixture(),command=()=>{const {businessId,...r}=parent().request;void businessId;return r;};
const ref=()=>({operationId:parent().operation_id,recoveryEpoch:parent().request.recoveryEpoch,leadId:parent().lead_id,conversionId:parent().id,expectedLeadVersion:parent().expected_lead_version,customerId:parent().customer_id});
const receipt=()=>({state:'committed',operationId:ref().operationId,recoveryEpoch:ref().recoveryEpoch,receipt:{schemaVersion:1,businessId:business,leadId:ref().leadId,conversionId:ref().conversionId,leadVersion:'2',customerId:ref().customerId,auditEventId:randomUUID()}});
const response=(v:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'private, no-store',...headers}});
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',fetcher);fetcher.mockResolvedValue(response(receipt()));});
it('sends one complete private original conversion without business authority or generated replacement identity',async()=>{
 const p=proof(),c=command();expect(await leadConversions.convert(business,c,p,signal())).toMatchObject({state:'committed'});expect(fetcher).toHaveBeenCalledTimes(1);const [url,options]=fetcher.mock.calls[0]!;expect(url).toBe('/api/business/leads/convert');expect(options).toMatchObject({credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':p.csrfToken}});expect(JSON.parse(options.body)).toEqual(leadConversionToWire({...c,businessId:business}));expect(JSON.parse(options.body)).not.toHaveProperty('businessId');
});
it.each(['operation','lead','destination','conversion','source'])('preserves definite %s conflicts without retrying',async reason=>{fetcher.mockResolvedValue(response({state:'conflict',reason},409));expect(await leadConversions.convert(business,command(),proof(),signal())).toEqual({state:'conflict',reason});expect(fetcher).toHaveBeenCalledTimes(1);});
it.each([['LEAD_CONVERSION_NOT_SUBMITTED',503,'not_submitted'],['LEAD_CONVERSION_DENIED',403,'denied'],['RECOVERY_REVIEW_REQUIRED',409,'recovery'],['LEAD_REQUEST_LIMITED',429,'limited'],['LEAD_CONVERSION_OUTCOME_UNKNOWN',503,'unknown']] as const)('keeps fixed %s status semantics',async(error,status,kind)=>{fetcher.mockResolvedValue(response({error},status));await expect(leadConversions.convert(business,command(),proof(),signal())).rejects.toMatchObject({kind});expect(fetcher).toHaveBeenCalledTimes(1);});
it.each(['customerId','conversionId','leadId','leadVersion','businessId','operationId','recoveryEpoch'])('rejects a substituted %s receipt as unknown',async field=>{
 const r=receipt();if(field==='operationId'||field==='recoveryEpoch')r[field]=randomUUID();else Object.assign(r.receipt,{[field]:field==='leadVersion'?'9007199254740994':randomUUID()});fetcher.mockResolvedValue(response(r));await expect(leadConversions.convert(business,command(),proof(),signal())).rejects.toMatchObject({kind:'unknown'});
});
it('rejects malformed or oversized complete requests before any fetch',async()=>{
 await expect(leadConversions.convert(business,{...command(),expectedLeadVersion:'01'},proof(),signal())).rejects.toMatchObject({kind:'input'});expect(fetcher).not.toHaveBeenCalled();
 const c=command();Object.assign(c.customer,{kind:'new',draft:{displayName:'Explicit customer',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:'😀'.repeat(2001),customerSince:null,archived:false,archiveReason:null}});await expect(leadConversions.convert(business,c,proof(),signal())).rejects.toMatchObject({kind:'input'});expect(fetcher).not.toHaveBeenCalled();
});
it('network loss remains unknown; lookup uses only the original operation and validates every retained reference',async()=>{
 fetcher.mockRejectedValueOnce(new Error('private network detail'));await expect(leadConversions.convert(business,command(),proof(),signal())).rejects.toMatchObject({kind:'unknown',message:'LEAD_CONVERSION_REQUEST_FAILED'});expect(fetcher).toHaveBeenCalledTimes(1);
 fetcher.mockResolvedValueOnce(response({state:'absent'}));expect(await leadConversions.lookup(business,ref(),proof(),signal())).toEqual({state:'absent'});expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({operationId:ref().operationId});
 fetcher.mockResolvedValueOnce(response(receipt()));expect(await leadConversions.lookup(business,ref(),proof(),signal())).toMatchObject({state:'committed'});
});
it('checks immutable source and complete mapping pages before exposing them',async()=>{
 fetcher.mockResolvedValueOnce(response({schemaVersion:1,businessId:business,conversion:parent()}));expect(await leadConversions.read(business,parent().lead_id,proof(),signal())).toMatchObject({conversion:parent()});
 const p={schemaVersion:1,businessId:business,conversion:parent(),links:[conversionLinkFixture(),conversionLinkFixture('address')],hasMore:false},args={leadId:parent().lead_id,conversionId:parent().id,afterId:null,pageSize:50};
 fetcher.mockResolvedValueOnce(response(p));expect(await leadConversions.links(business,args,proof(),signal())).toMatchObject({links:p.links});fetcher.mockResolvedValueOnce(response({...p,links:[]}));await expect(leadConversions.links(business,args,proof(),signal())).rejects.toMatchObject({kind:'unavailable'});
});
it.each(['content-type','cache-control','duplicate','oversize'])('rejects a %s response without interpreting it as a successful save',async defect=>{
 let r=response(receipt());if(defect==='content-type')r=response(receipt(),200,{'content-type':'text/plain'});if(defect==='cache-control')r=response(receipt(),200,{'cache-control':'public'});if(defect==='duplicate')r=new Response(JSON.stringify(receipt()).replace('"state":','"state":"committed","state":'),{headers:{'content-type':'application/json','cache-control':'no-store'}});if(defect==='oversize')r=response({private:'x'.repeat(1048576)});fetcher.mockResolvedValue(r);await expect(leadConversions.convert(business,command(),proof(),signal())).rejects.toMatchObject({kind:'unknown'});
});
