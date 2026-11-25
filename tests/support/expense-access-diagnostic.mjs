import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {sessionAdmissionDiagnostic} from './session-admission-diagnostic.mjs';
// The fixture has already used a genuine MFA code for its seed session.
// Prepare one fresh browser attempt, never retry a rejected login or a write.
export async function prepareExpenseBrowserCode(fixture){
 assert(Number.isSafeInteger(fixture.nextBrowserCodeAt));
 const now=Date.now(),remaining=30000-now%30000,ready=Math.max(fixture.nextBrowserCodeAt,remaining<6000?now+remaining:0);
 if(ready>=now)await delay(ready-now+250);
}
export function observeExpenseAccess(page,fixture){
 const routes=new Map([['/api/auth/login','login'],['/api/auth/session','session'],['/api/business/expenses/context','expense_context'],['/api/business/expenses/history','expense_history'],['/api/business/finance-accounts/context','finance_context'],['/api/business/finance-accounts/posted-journal','posted_journal']]),events=[];
 function remember(event){if(events.length===32)events.shift();events.push(event);}
 function response(reply){const route=routes.get(new URL(reply.url()).pathname);if(route)remember({route,status:reply.status()});}
 function failed(request){const route=routes.get(new URL(request.url()).pathname);if(route)remember({route,transportFailed:true});}
 page.on('response',response);page.on('requestfailed',failed);
 return {async report(){return {events,session:await sessionAdmissionDiagnostic(fixture)};},stop(){page.off('response',response);page.off('requestfailed',failed);}};
}
