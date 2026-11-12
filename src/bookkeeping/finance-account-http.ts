import 'server-only';
import {createHash} from 'node:crypto';
import {customerDate,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {readBrowserCookies} from '../security/browser-http.ts';
import {createBusinessSettingsContextReader} from '../security/business-settings-context.ts';
import {privateJsonResponse,readNestedJsonBody} from '../security/private-http.ts';
import {createRequestProtection} from '../security/request-protection.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {financePreviewDatabase} from '../security/session-database.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {createSessionRequestAdmission} from '../security/session-request-admission.ts';
import {createSessionCsrfVerifier} from '../security/session-request-guard.ts';
import {createTrustedTransport} from '../security/trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from '../security/trusted-transport.ts';
import {
 financeAccountCode,financeAccountReviewReason,parseFinanceAccountDraft,parseFinanceAccountHistory,parseFinanceAccountPage,
 parseFinanceAccountReceipt,parseFinanceAccountReference,parseFinanceAccountResolution,requireFinanceAccount as check,
} from './finance-account-contract.ts';
import {
 fixedFinanceMappingPurpose,parseFinanceMappingApproval,parseFinanceMappingAt,parseFinanceMappingEditor,parseFinanceMappingHistory,
 parseFinanceMappingOperation,parseFinanceMappingReference,
} from './finance-mapping-contract.ts';

export const financeAccountPrefix='/api/business/finance-accounts/';
const fields={context:[],list:['afterCode','includeArchived'],history:['accountId','afterVersion'],
 operation:['operationId','recoveryEpoch','accountId','expectedVersion'],save:['reference','draft'],
 retire:['reference','reviewEpoch','reason'], 'mapping-at':['purpose','date'],
 'mapping-history':['purpose','beforeVersion'], 'mapping-editor':['purpose'],
 'mapping-operation':['operationId','recoveryEpoch','purpose','expectedVersion'],
 'mapping-approve':['reference','approval'], 'mapping-retire':['reference','reviewEpoch','reason']} as const;
const authority='$1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid';
type Config=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};

export function financeAccountFailure(status:400|404|405|503=400){
 const response=privateJsonResponse({error:'FINANCE_ACCOUNT_REQUEST_FAILED'},status);
 if(status===405)response.headers.set('Allow','POST');
 return response;
}

export function createFinanceAccountHttp(config:Config,connectionString:string,
 provider:Parameters<typeof createSessionLifecycle>[1],tokens:Parameters<typeof createSessionLifecycle>[2],fixedMappings=false){
 check(config.environment==='test'&&customerUuid(config.businessId));
 const ownerDb=new URL(config.connectionString),financeDb=new URL(connectionString);
 check(ownerDb.hostname===financeDb.hostname&&ownerDb.port===financeDb.port
  &&ownerDb.pathname===financeDb.pathname&&ownerDb.username!==financeDb.username);
 const database=financePreviewDatabase({connectionString,environment:'test'});
 const transport=createTrustedTransport(config),protect=createRequestProtection(config);
 const csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config);
 const sessions=createSessionLifecycle(config,provider,tokens),context=createBusinessSettingsContextReader(config,provider,tokens);
 const businessId=config.businessId;
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>)=>{
  let submitted=false,credentialHash:Buffer|undefined;
  try{
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);
   transport(request,peer);
   const url=new URL(request.url),route=url.pathname.slice(financeAccountPrefix.length) as keyof typeof fields;
   if(url.search||url.hash||!url.pathname.startsWith(financeAccountPrefix)||!Object.hasOwn(fields,route))return financeAccountFailure(404);
   if(!fixedMappings&&route.startsWith('mapping-'))return financeAccountFailure(404);
   if(request.method!=='POST')return financeAccountFailure(405);
   protect.requireOrigin(request);
   const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;
   check(cookie);
   const input=await readNestedJsonBody(bounded,fields[route],8192);
   const sessionId=await csrf(bounded,cookie,signal);
   const binding=createHash('sha256').update('crest.finance.account.edit.v1\0').update(businessId).update('\0')
    .update(sessionId).digest('base64url');
   if(route!=='context')check(request.headers.get('X-Crest-Edit-Binding')===binding);
   if(!await admit(cookie,'ordinary',signal)){
    const response=privateJsonResponse({error:'FINANCE_ACCOUNT_REQUEST_LIMITED'},429);
    response.headers.set('Retry-After','60');return response;
   }
   if(route==='context'){
    const c=(await context(cookie,businessId,signal)).forServer();
    const response=privateJsonResponse({businessId,recoveryEpoch:c.recoveryEpoch,writeState:c.writeState});
    response.headers.set('X-Crest-Edit-Binding',binding);
    if(fixedMappings)response.headers.set('X-Crest-Finance-Fixed-Mappings','1');
    return response;
   }
   credentialHash=sessionCredentialHash(cookie);
   const verified=await sessions.verify(cookie,signal,'background');
   check(!signal.aborted&&sessionId===verified.sessionId);
   const args=[credentialHash,sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,
    verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId];
   if(route==='mapping-at'){
    check(fixedFinanceMappingPurpose(input.purpose)&&customerDate(input.date));
    const value=await database('SELECT crest_commands.resolve_fixed_finance_mapping('+authority+',$9::text,$10::date) AS result',
     [...args,input.purpose,input.date],signal);
    check(parseFinanceMappingAt(value,input.purpose,input.date));
    return privateJsonResponse(value as object);
   }
   if(route==='mapping-history'){
    check(fixedFinanceMappingPurpose(input.purpose)&&(input.beforeVersion===null||customerVersion(input.beforeVersion)));
    const value=await database('SELECT crest_commands.read_fixed_finance_mapping_history('+authority+',$9::text,$10::bigint,25) AS result',
     [...args,input.purpose,input.beforeVersion],signal);
    parseFinanceMappingHistory(value,businessId,input.purpose,input.beforeVersion);
    return privateJsonResponse(value as object);
   }
   if(route==='mapping-editor'){
    check(fixedFinanceMappingPurpose(input.purpose));
    const value=await database('SELECT crest_commands.fixed_finance_mapping_editor('+authority+',$9::text) AS result',
     [...args,input.purpose],signal);
    parseFinanceMappingEditor(value,businessId,input.purpose);
    return privateJsonResponse(value as object);
   }
   if(route==='mapping-operation'||route==='mapping-approve'||route==='mapping-retire'){
    const reference=parseFinanceMappingReference(route==='mapping-operation'?input:input.reference);
    const original=[reference.operationId,reference.recoveryEpoch,reference.purpose,reference.expectedVersion];
    if(route==='mapping-operation'){
     const value=await database('SELECT crest_commands.lookup_fixed_finance_mapping_operation('+authority+',$9::uuid,$10::uuid,$11::text,$12::bigint) AS result',
      [...args,...original],signal);
     parseFinanceMappingOperation(value,businessId,reference);
     return privateJsonResponse(value as object);
    }
    if(route==='mapping-retire'){
     check(customerUuid(input.reviewEpoch)&&financeAccountReviewReason(input.reason));
     const result=await database.commandTransaction(async query=>{
      submitted=true;
      const value=await query('SELECT crest_commands.retire_fixed_finance_mapping_approval('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::text,$13::bigint,$14::text) AS result',
       [...args,input.reviewEpoch,...original,input.reason]);
      const outcome=parseFinanceMappingOperation(value,businessId,reference);
      check(outcome.state!=='absent'&&(outcome.state!=='retired'||outcome.reviewEpoch===input.reviewEpoch));
      return {value:value as object,status:outcome.state==='conflict'?409:200};
     },signal);
     return privateJsonResponse(result.value,result.status);
    }
    const approval=parseFinanceMappingApproval(input.approval);
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.approve_fixed_finance_mapping('+authority+',$9::uuid,$10::uuid,$11::text,$12::bigint,$13::uuid,$14::date,$15::text) AS result',
      [...args,reference.recoveryEpoch,reference.operationId,reference.purpose,reference.expectedVersion,
       approval.accountId,approval.effectiveFrom,approval.reason]);
     const outcome=parseFinanceMappingOperation(value,businessId,reference);
     check(outcome.state==='conflict'||outcome.state==='committed'&&outcome.receipt.accountId===approval.accountId
      &&outcome.receipt.effectiveFrom===approval.effectiveFrom&&outcome.receipt.reason===approval.reason);
     return {value:value as object,status:outcome.state==='conflict'?409:200};
    },signal);
    return privateJsonResponse(result.value,result.status);
   }
   if(route==='list'){
    check((input.afterCode===null||financeAccountCode(input.afterCode))&&typeof input.includeArchived==='boolean');
    const value=await database('SELECT crest_commands.list_finance_accounts('+authority+',$9::text,$10::boolean,25) AS result',
     [...args,input.afterCode,input.includeArchived],signal);
    parseFinanceAccountPage(value,businessId);
    return privateJsonResponse(value as object);
   }
   if(route==='history'){
    check(customerUuid(input.accountId)&&customerVersion(input.afterVersion,true));
    const value=await database('SELECT crest_commands.read_finance_account_history('+authority+',$9::uuid,$10::bigint,25) AS result',
     [...args,input.accountId,input.afterVersion],signal);
    parseFinanceAccountHistory(value,businessId,input.accountId,input.afterVersion);
    return privateJsonResponse(value as object);
   }
   const reference=parseFinanceAccountReference(route==='operation'?input:input.reference);
   const original=[reference.operationId,reference.recoveryEpoch,reference.accountId,reference.expectedVersion];
   if(route==='operation'){
    const value=await database('SELECT crest_commands.lookup_finance_account_operation('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::bigint) AS result',
     [...args,...original],signal);
    return privateJsonResponse(parseFinanceAccountResolution(value,businessId,reference));
   }
   if(route==='retire'){
    check(customerUuid(input.reviewEpoch)&&financeAccountReviewReason(input.reason));
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.retire_finance_account_save('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::bigint,$14::text) AS result',
      [...args,input.reviewEpoch,...original,input.reason]);
     const decision=parseFinanceAccountResolution(value,businessId,reference);
     check(decision.state!=='absent'&&(decision.state!=='retired'||decision.receipt.reviewEpoch===input.reviewEpoch));
     return decision;
    },signal);
    return privateJsonResponse(result,result.state==='conflict'?409:200);
   }
   const draft=parseFinanceAccountDraft(input.draft,reference.expectedVersion);
   const result=await database.commandTransaction(async(query)=>{
    submitted=true;
    const value=await query('SELECT crest_commands.save_finance_account('+authority+',$9::uuid,$10::uuid,1,$11::uuid,$12::bigint,$13::jsonb) AS result',
     [...args,reference.recoveryEpoch,reference.operationId,reference.accountId,reference.expectedVersion,draft]);
    if(exact(value,['state','reason'])&&value.state==='conflict'&&(value.reason==='operation'||value.reason==='account'))return value;
    if(exact(value,['state','reason','currentVersion'])&&value.state==='conflict'&&value.reason==='version'
     &&customerVersion(value.currentVersion,true))return value;
    return parseFinanceAccountReceipt(value,businessId,reference);
   },signal);
   return privateJsonResponse(result,result.state==='conflict'?409:200);
  }catch(error){
   if(error instanceof Error&&error.message==='FINANCE_MAPPING_NOT_READY')return privateJsonResponse({state:'unavailable'});
   if(error instanceof Error&&['RECOVERY_REVIEW_REQUIRED','FINANCE_ACCOUNT_SIGN_IN_REQUIRED','FINANCE_ACCOUNT_SETUP_REQUIRED',
    'FINANCE_MAPPING_VERSION_CONFLICT','FINANCE_MAPPING_EFFECTIVE_ORDER_REQUIRED','FINANCE_MAPPING_ACCOUNT_REQUIRED',
    'FINANCE_MAPPING_CLOSURE_REQUIRED'].includes(error.message))
    return privateJsonResponse({error:error.message},409);
   return submitted?privateJsonResponse({error:'FINANCE_ACCOUNT_OUTCOME_UNKNOWN'},503):financeAccountFailure();
  }finally{credentialHash?.fill(0);}
 };
}
