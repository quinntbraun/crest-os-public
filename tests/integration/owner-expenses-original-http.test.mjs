// Genuine Auth/TOTP + restricted web login + real PostgreSQL/COMMIT. Direct
// loopback HTTP is an explicit disposable test boundary, not deployed TLS or
// browser cookie acceptance. No traces, credentials or provider response dumps.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {TOTP,URI} from 'otpauth';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {startRealAuthService,authResult} from '../support/real-auth-service.mjs';
import {createProviderBoundary} from '../../src/security/provider-auth.ts';
import {createLiveProviderSessionLookup} from '../../src/security/provider-session-db.ts';
import {createProviderTokenStore} from '../../src/security/provider-token-store.ts';
import {createSessionLifecycle} from '../../src/security/session-lifecycle.ts';
import {createBrowserSessionFlow} from '../../src/security/browser-session-flow.ts';
import {transportFromIncomingMessage} from '../../src/security/trusted-transport.ts';

import {createExpenseDirectory} from '../../src/bookkeeping/expenses/expense-directory.ts';
import {createExpenseHttp} from '../../src/bookkeeping/expenses/expense-http.ts';
let sandbox,target,client,service,login,config,boundary,tokens,lifecycle,bootstrap,ownsRole=false;
const signal=()=>new AbortController().signal;
async function transaction(run){await client.query('BEGIN');try{const r=await run();await client.query('COMMIT');return r;}catch(e){await client.query('ROLLBACK');throw e;}}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);await sandbox.apply(target,await sandbox.prefix(48));
 const sql=await readFile(new URL('../../planning/proposals/owner-expenses.sql',import.meta.url),'utf8');await transaction(()=>client.query(sql));ownsRole=true;for(const file of ['owner-expense-receipts.sql','owner-expenses-activity.sql','owner-expenses-original.sql'])await transaction(async()=>client.query(await readFile(new URL('../../planning/proposals/'+file,import.meta.url),'utf8')));
 login='crest_expense_http_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;config={connectionString:url.toString(),environment:'test'};
 service=await startRealAuthService(target);boundary=createProviderBoundary({issuer:service.issuer,publicKey:service.publicKey,environment:'test'},createLiveProviderSessionLookup(config));tokens=await createProviderTokenStore('synthetic-expense-http',[{id:'synthetic-expense-http',key:randomBytes(32)}]);lifecycle=createSessionLifecycle(config,boundary,tokens);bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
},{timeout:240000});
after(async()=>{try{await service?.close();if(login)await sandbox.admin.query('DROP ROLE '+login);if(ownsRole){await client.query('DROP OWNED BY crest_expense_owner CASCADE');await client.query('DROP ROLE crest_expense_owner');}}finally{await sandbox?.close();}});async function fixture(){
 const email='synthetic-quote-'+randomUUID()+'@example.com',password=randomBytes(32).toString('base64url'),user=authResult(await service.admin.admin.createUser({email,password,email_confirm:true}),'quote_user').user;assert(user?.id);
 const sdk=service.sdk();await sdk.initialize();authResult(await sdk.signInWithPassword({email,password}),'quote_enroll_password');const factor=authResult(await sdk.mfa.enroll({factorType:'totp',friendlyName:'Synthetic quote MFA'}),'quote_enroll'),totp=URI.parse(factor.totp.uri);assert(totp instanceof TOTP);authResult(await sdk.mfa.challengeAndVerify({factorId:factor.id,code:totp.generate()}),'quote_enroll_verify');
 const f=await transaction(async()=>{
  const actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic quote HTTP owner',$1,$2,$3,$3,'manual') RETURNING id",[service.issuer,user.id,bootstrap])).rows[0].id;
  const business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic quote HTTP business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);const epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;return {actor,business,epoch};
 });
 const issued=await lifecycle.login({email,password,factorId:factor.id,code:totp.generate()},{subject:user.id},false,signal()),credential=issued.cookieValueForResponse();
 return {...f,issued,subject:user.id,factorId:factor.id,credential,api:createExpenseDirectory(config,boundary,tokens)};
}async function withHttp(f,run,{enabled=true,businessId=f.business}={}){
 let origin,handler,providerCalls=0;
 // Count calls to the genuine provider verifier; never replace its evidence.
 const counted=Object.freeze({...boundary,verifyAccess:async(...args)=>{providerCalls++;return boundary.verifyAccess(...args);}});
 const server=createServer(async(req,res)=>{try{const incoming=new Request(origin+req.url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:req,duplex:'half'}:{})}),response=await handler(incoming,transportFromIncomingMessage(req));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{
  origin='http://127.0.0.1:'+server.address().port;const httpConfig={...config,origin,businessId,ingress:{kind:'direct'}};handler=createExpenseHttp(httpConfig,counted,tokens,enabled);
  const flow=createBrowserSessionFlow({...httpConfig,loginKey:randomBytes(32),owner:{subject:f.subject,factorId:f.factorId}},counted,tokens),session=await flow.session({method:'POST',headers:new Headers({origin,'content-type':'application/json'})},f.credential,signal());
  const post=async(route,body={},headers={},method='POST')=>{
   const response=await fetch(origin+'/api/business/expenses/'+route,{method,redirect:'error',headers:{origin,'content-type':'application/json',cookie:'__Host-crest_session='+f.credential,'x-crest-csrf':session.csrfTokenForResponse(),...headers},...(!['GET','HEAD'].includes(method)?{body:typeof body==='string'?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(40000)});
   assert.match(response.headers.get('cache-control')??'',/no-store/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');return {status:response.status,value:await response.json(),binding:response.headers.get('x-crest-edit-binding'),allow:response.headers.get('allow')};
  };
  assert(providerCalls>0,'the instrumentation observed genuine session verification');await run(post,()=>providerCalls);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

const payload={paidOn:'2026-10-28',amountCents:'1299',currency:'USD',category:'supplies',description:'Synthetic HTTP wash soap',vendor:null,paymentMethod:'card',reference:null,notes:null,voided:false,changeReason:null};
test('genuine MFA private HTTP save, replay and reopened history retain exact cents',async()=>{const f=await fixture();await withHttp(f,async post=>{const context=await post('context');assert.equal(context.status,200);assert.equal(context.value.writeState,'ready');const headers={'x-crest-edit-binding':context.binding},body={recoveryEpoch:f.epoch,operationId:randomUUID(),expenseId:randomUUID(),expectedRevision:'0',...payload};const first=await post('save',body,headers);assert.equal(first.status,200);assert.equal(first.value.expense.payload.amountCents,'1299');assert.deepEqual((await post('save',body,headers)).value,first.value);const reopened=await post('history',{afterExpenseId:null,afterRevision:'0'},headers);assert.equal(reopened.status,200);assert.equal(reopened.value.rows.length,1);assert.equal(reopened.value.rows[0].operationId,body.operationId);});});
test('missing CSRF, origin, session binding and authority injection fail closed',async()=>{const f=await fixture();await withHttp(f,async post=>{const context=await post('context'),headers={'x-crest-edit-binding':context.binding},body={recoveryEpoch:f.epoch,operationId:randomUUID(),expenseId:randomUUID(),expectedRevision:'0',...payload};for(const override of [{'x-crest-csrf':''},{origin:'https://other.example.com'},{'x-crest-edit-binding':'wrong'}])assert.equal((await post('save',body,{...headers,...override})).status,400);assert.equal((await post('save',{...body,businessId:f.business},headers)).status,400);assert.equal((await post('history',{afterExpenseId:null,afterRevision:'0'},headers)).value.rows.length,0);});});
test('expense route remains absent without explicit construction activation',async()=>{const f=await fixture();await withHttp(f,async post=>{assert.equal((await post('context')).status,404);},{enabled:false});});
test('genuine original lookup confirms the exact earlier expense after correction and paused writes',async()=>{const f=await fixture();await withHttp(f,async post=>{const context=await post('context'),headers={'x-crest-edit-binding':context.binding},reference={recoveryEpoch:f.epoch,operationId:randomUUID(),expenseId:randomUUID(),expectedRevision:'0'},first=await post('save',{...reference,...payload},headers);assert.equal(first.status,200);assert.equal((await post('save',{...reference,operationId:randomUUID(),expectedRevision:'1',...payload,amountCents:'1399',changeReason:'Synthetic corrected receipt amount'},headers)).status,200);await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business]);const original=await post('operation',reference,headers);assert.equal(original.status,200);assert.deepEqual(original.value,first.value);for(const altered of [{...reference,expenseId:randomUUID()},{...reference,expectedRevision:'1'},{...reference,recoveryEpoch:randomUUID()}])assert.equal((await post('operation',altered,headers)).status,400);assert.equal((await post('history',{afterExpenseId:null,afterRevision:'0'},headers)).value.rows.length,2);});});
test('original-expense HTTP lookup rejects forged authority, extra intent, CSRF and foreign origin',async()=>{const f=await fixture();await withHttp(f,async post=>{const context=await post('context'),headers={'x-crest-edit-binding':context.binding},reference={recoveryEpoch:f.epoch,operationId:randomUUID(),expenseId:randomUUID(),expectedRevision:'0'};assert.deepEqual((await post('operation',reference,headers)).value,{state:'absent'});for(const override of [{'x-crest-csrf':''},{origin:'https://foreign-synthetic.example'},{'x-crest-edit-binding':'wrong'}])assert.equal((await post('operation',reference,{...headers,...override})).status,400);for(const extra of [{businessId:f.business},{amountCents:'1299'},{actorId:f.actor}])assert.equal((await post('operation',{...reference,...extra},headers)).status,400);assert.equal((await post('history',{afterExpenseId:null,afterRevision:'0'},headers)).value.rows.length,0);});await withHttp(f,async post=>{assert.equal((await post('operation',{})).status,404);},{enabled:false});});
