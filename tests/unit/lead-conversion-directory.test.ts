import {randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({verify:vi.fn(),read:vi.fn(),query:vi.fn(),transaction:vi.fn(),events:[] as string[]}));
vi.mock('../../src/security/session-database.ts',()=>({sessionDatabase:()=>Object.assign(mock.read,{commandTransaction:mock.transaction})}));
vi.mock('../../src/security/session-lifecycle.ts',()=>({createSessionLifecycle:()=>({verify:mock.verify})}));
import {createLeadConversionDirectory} from '../../src/customer/lead-conversion-directory';
import {conversionRecordFixture,conversionLinkFixture,conversionBusiness as business} from '../support/lead-conversion-record-fixture';
const parent=()=>conversionRecordFixture(),input=()=>parent().request,credential=randomBytes(32).toString('base64url'),signal=()=>new AbortController().signal;
const committed=()=>({state:'committed',operationId:parent().operation_id,recoveryEpoch:input().recoveryEpoch,receipt:{schemaVersion:1,businessId:business,conversionId:parent().id,leadId:parent().lead_id,leadVersion:'2',customerId:parent().customer_id,auditEventId:randomUUID()}});
const factory=()=>createLeadConversionDirectory({connectionString:'mock',environment:'test'},{} as never,{} as never);
beforeEach(()=>{vi.resetAllMocks();mock.events.length=0;mock.verify.mockImplementation(async()=>{mock.events.push('verify');return {sessionId:randomUUID(),actorId:parent().created_by,provider:{issuer:'https://auth.example.com/auth/v1',subject:randomUUID(),sessionId:randomUUID(),expiresAt:Date.now()+60000}};});mock.query.mockResolvedValue(committed());mock.transaction.mockImplementation(async(work,bounded)=>{mock.events.push('begin');const r=await work(mock.query,bounded);mock.events.push('commit');return r;});mock.read.mockResolvedValue({state:'absent'});});
it('verifies fresh authority before one fixed atomic command and exposes the result only after commit',async()=>{
 const request=input(),result=await factory().convert(credential,request,signal());expect(result.forServer()).toMatchObject({state:'committed'});expect(()=>JSON.stringify(result)).toThrow('LEAD_CONVERSION_VALUE_PRIVATE');expect(mock.events).toEqual(['verify','begin','commit']);expect(mock.query).toHaveBeenCalledTimes(1);
 const [sql,args]=mock.query.mock.calls[0]!;expect(sql).toContain('SELECT crest_commands.convert_lead(');expect(args.slice(7)).toEqual([business,request.recoveryEpoch,request.operationId,1,request.conversionId,request.leadId,request.expectedLeadVersion,{customer:request.customer,vehicles:request.vehicles,addresses:request.addresses}]);expect([...args[0]]).toEqual(Array(32).fill(0));
});
it.each(['operation','lead','destination','conversion','source'])('returns definite %s conflict without inventing replacement operations',async reason=>{mock.query.mockResolvedValue({state:'conflict',reason});expect((await factory().convert(credential,input(),signal())).forServer()).toEqual({state:'conflict',reason});expect(mock.query).toHaveBeenCalledTimes(1);});
it('distinguishes malformed/pre-authority, denied, recovery and post-submit unknown outcomes',async()=>{
 await expect(factory().convert(credential,{...input(),expectedLeadVersion:'01'},signal())).rejects.toThrow('LEAD_CONVERSION_NOT_SUBMITTED');expect(mock.verify).not.toHaveBeenCalled();
 mock.verify.mockRejectedValueOnce(new Error('private provider detail'));await expect(factory().convert(credential,input(),signal())).rejects.toThrow('LEAD_CONVERSION_NOT_SUBMITTED');expect(mock.transaction).not.toHaveBeenCalled();
 mock.query.mockResolvedValueOnce({state:'denied'});await expect(factory().convert(credential,input(),signal())).rejects.toThrow('LEAD_CONVERSION_DENIED');
 mock.transaction.mockRejectedValueOnce(new Error('RECOVERY_REVIEW_REQUIRED'));await expect(factory().convert(credential,input(),signal())).rejects.toThrow('RECOVERY_REVIEW_REQUIRED');
 mock.transaction.mockRejectedValueOnce(new Error('private commit detail'));const error=await factory().convert(credential,input(),signal()).catch(e=>e);expect(error.message).toBe('LEAD_CONVERSION_OUTCOME_UNKNOWN');expect(error).not.toHaveProperty('cause');
});
it('snapshots selections before awaiting verification and rejects a substituted receipt after submission',async()=>{
 const request=structuredClone(input());mock.verify.mockImplementationOnce(async()=>{Object.assign(request.customer,{id:randomUUID()});return {sessionId:randomUUID(),actorId:parent().created_by,provider:{issuer:'https://auth.example.com/auth/v1',subject:randomUUID(),sessionId:randomUUID(),expiresAt:Date.now()+60000}};});await factory().convert(credential,request,signal());expect(mock.query.mock.calls[0]![1].at(-1).customer.id).toBe(parent().customer_id);
 const bad=committed();bad.receipt.customerId=randomUUID();mock.query.mockResolvedValueOnce(bad);await expect(factory().convert(credential,input(),signal())).rejects.toThrow('LEAD_CONVERSION_OUTCOME_UNKNOWN');
});
it('uses fresh scoped original lookup without any transaction or write',async()=>{
 expect((await factory().lookup(credential,{businessId:business,operationId:input().operationId},signal())).forServer()).toEqual({state:'absent'});mock.read.mockResolvedValueOnce(committed());expect((await factory().lookup(credential,{businessId:business,operationId:input().operationId},signal())).forServer()).toMatchObject({state:'committed'});expect(mock.transaction).not.toHaveBeenCalled();expect(mock.read.mock.calls[0]![0]).toContain('lookup_lead_conversion_operation');
});
it('parses retained source and exact immutable mapping pages, rejecting omissions and wrong scope',async()=>{
 mock.read.mockResolvedValueOnce({schemaVersion:1,businessId:business,conversion:parent()});expect((await factory().read(credential,{businessId:business,leadId:parent().lead_id},signal())).forServer()).toMatchObject({state:'found',conversion:parent()});
 const page={schemaVersion:1,businessId:business,conversion:parent(),links:[conversionLinkFixture(),conversionLinkFixture('address')],hasMore:false},args={businessId:business,leadId:parent().lead_id,conversionId:parent().id,afterId:null,pageSize:50};
 mock.read.mockResolvedValueOnce(page);expect((await factory().links(credential,args,signal())).forServer()).toMatchObject({links:page.links});
 mock.read.mockResolvedValueOnce({...page,links:page.links.slice(0,1)});await expect(factory().links(credential,args,signal())).rejects.toThrow('LEAD_CONVERSION_REQUEST_FAILED');
 mock.read.mockResolvedValueOnce({...page,businessId:randomUUID()});await expect(factory().links(credential,args,signal())).rejects.toThrow('LEAD_CONVERSION_REQUEST_FAILED');
});
