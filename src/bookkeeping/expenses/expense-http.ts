import 'server-only';
import {createHash} from 'node:crypto';
import {createTrustedTransport} from '../../security/trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from '../../security/trusted-transport.ts';
import {createRequestProtection} from '../../security/request-protection.ts';
import {readBrowserCookies} from '../../security/browser-http.ts';
import {privateJsonResponse,readFlatJsonBody} from '../../security/private-http.ts';
import {createSessionCsrfVerifier} from '../../security/session-request-guard.ts';
import {createSessionRequestAdmission} from '../../security/session-request-admission.ts';
import {createBusinessSettingsContextReader} from '../../security/business-settings-context.ts';
import type {SessionDatabaseConfiguration} from '../../security/session-database.ts';
import {createExpenseDirectory,ExpenseDirectoryError} from './expense-directory.ts';
import {expenseCheck,expenseId,parseExpenseSave,parseExpenseOriginal} from './expense-contract.ts';
const payloadKeys=['paidOn','amountCents','currency','category','description','vendor','paymentMethod','reference','notes','voided','changeReason'] as const;
const fields={context:[],history:['afterExpenseId','afterRevision'],operation:['operationId','recoveryEpoch','expenseId','expectedRevision'],save:['recoveryEpoch','operationId','expenseId','expectedRevision',...payloadKeys]} as const;
type Config=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
export function expenseFailureResponse(status:400|404|405|503=400){const response=privateJsonResponse({error:'EXPENSE_REQUEST_FAILED'},status);if(status===405)response.headers.set('Allow','POST');return response;}
// Disabled until registered source/recovery/receipt integration is independently accepted.
export function createExpenseHttp(config:Config,provider:Parameters<typeof createExpenseDirectory>[1],tokens:Parameters<typeof createExpenseDirectory>[2],enabled=false){
 expenseCheck(expenseId(config.businessId)&&typeof enabled==='boolean');const resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config),directory=enabled?createExpenseDirectory(config,provider,tokens):undefined,context=enabled?createBusinessSettingsContextReader(config,provider,tokens):undefined;
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>)=>{let submitted=false;try{
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);resolve(request,peer);const url=new URL(request.url),prefix='/api/business/expenses/',route=url.pathname.slice(prefix.length) as keyof typeof fields;
  if(!enabled||url.search||url.hash||!url.pathname.startsWith(prefix)||!Object.hasOwn(fields,route))return privateJsonResponse({error:'EXPENSE_REQUEST_FAILED'},404);
  if(request.method!=='POST'){const r=privateJsonResponse({error:'EXPENSE_REQUEST_FAILED'},405);r.headers.set('Allow','POST');return r;}
  protect.requireOrigin(request);const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;expenseCheck(cookie);const input=await readFlatJsonBody(bounded,fields[route],32768);
  const save=route==='save'?parseExpenseSave({businessId:config.businessId,recoveryEpoch:input.recoveryEpoch,operationId:input.operationId,expenseId:input.expenseId,expectedRevision:input.expectedRevision,payload:Object.fromEntries(payloadKeys.map(k=>[k,input[k]]))}):undefined;
  if(route==='history')expenseCheck(input.afterExpenseId===null&&input.afterRevision==='0');
  const original=route==='operation'?parseExpenseOriginal(input):undefined;
  const sessionId=await csrf(bounded,cookie,signal),binding=createHash('sha256').update('crest.expense.edit.v1\0').update(config.businessId).update('\0').update(sessionId).digest('base64url');
  if(route!=='context')expenseCheck(request.headers.get('X-Crest-Edit-Binding')===binding);
  if(!await admit(cookie,'ordinary',signal)){const r=privateJsonResponse({error:'EXPENSE_REQUEST_LIMITED'},429);r.headers.set('Retry-After','60');return r;}
  if(route==='context'){const c=(await context!(cookie,config.businessId,signal)).forServer();const response=privateJsonResponse({businessId:c.businessId,recoveryEpoch:c.recoveryEpoch,writeState:c.writeState});response.headers.set('X-Crest-Edit-Binding',binding);return response;}
  if(route==='save'){submitted=true;const result=await directory!.save(cookie,save!,signal);expenseCheck(!signal.aborted);return privateJsonResponse(result,result.state==='conflict'?409:200);}
  if(route==='operation'){const result=await directory!.lookup(cookie,config.businessId,original!,signal);expenseCheck(!signal.aborted);return privateJsonResponse(result);}
  const rows=await directory!.history(cookie,config.businessId,input.afterExpenseId===null?null:{expenseId:input.afterExpenseId as string,revision:input.afterRevision as string},signal);expenseCheck(!signal.aborted);return privateJsonResponse({rows});
 }catch(error){if(error instanceof ExpenseDirectoryError&&error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:error.message},409);return privateJsonResponse({error:submitted?'EXPENSE_OUTCOME_UNKNOWN':'EXPENSE_REQUEST_FAILED'},submitted?503:400);}};
}
