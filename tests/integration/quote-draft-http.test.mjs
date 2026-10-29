// Genuine Auth/TOTP + restricted web login + real PostgreSQL/COMMIT. Direct
// loopback HTTP is an explicit disposable test boundary, not deployed TLS or
// browser cookie acceptance. No traces, credentials or provider response dumps.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
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
import {createCustomerDirectory} from '../../src/customer/customer-directory.ts';
import {createQuoteDirectory} from '../../src/commercial/quote-directory.ts';
import {createQuoteHttp} from '../../src/commercial/quote-http.ts';
let sandbox,target,client,service,login,config,boundary,tokens,lifecycle,bootstrap,base44;
const registered45=process.env.CREST_QUOTE_TEST_PROFILE==='registered45';
assert(process.env.CREST_QUOTE_TEST_PROFILE===undefined||registered45,'only explicit quote construction/registered45 fixtures are supported');
const signal=()=>new AbortController().signal;
async function transaction(run){await client.query('BEGIN');try{const result=await run();await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);base44=await sandbox.prefix(44);const prior=(await sandbox.apply(target,base44)).history;assert.equal(prior.length,44);
 if(registered45){const current=await sandbox.apply(target);assert.equal(current.history.length,45);assert.deepEqual(current.history.slice(0,44),prior);assert.deepEqual((await sandbox.apply(target)).history,current.history);}
 else for(const name of ['quote-pricing','quote-draft-storage','quote-draft-commands']){
  const sql=await readFile(new URL('../../planning/proposals/'+name+'.sql',import.meta.url),'utf8'),meta=JSON.parse(await readFile(new URL('../../planning/proposals/'+name+'.json',import.meta.url),'utf8'));assert.equal(meta.registered,false);assert.equal(meta.runtimeEnabled,false);assert.equal(Buffer.byteLength(sql),meta.sqlBytes);assert.equal(createHash('sha256').update(sql).digest('hex'),meta.sqlSha256);await transaction(()=>client.query(sql));
 }
 if(!registered45)assert.deepEqual((await sandbox.apply(target,base44)).history,prior);
 login='crest_quote_http_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;config={connectionString:url.toString(),environment:'test'};
 service=await startRealAuthService(target);boundary=createProviderBoundary({issuer:service.issuer,publicKey:service.publicKey,environment:'test'},createLiveProviderSessionLookup(config));tokens=await createProviderTokenStore('synthetic-quote-http',[{id:'synthetic-quote-http',key:randomBytes(32)}]);lifecycle=createSessionLifecycle(config,boundary,tokens);bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
},{timeout:240000});
after(async()=>{await service?.close();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
async function fixture(){
 const email='synthetic-quote-'+randomUUID()+'@example.com',password=randomBytes(32).toString('base64url'),user=authResult(await service.admin.admin.createUser({email,password,email_confirm:true}),'quote_user').user;assert(user?.id);
 const sdk=service.sdk();await sdk.initialize();authResult(await sdk.signInWithPassword({email,password}),'quote_enroll_password');const factor=authResult(await sdk.mfa.enroll({factorType:'totp',friendlyName:'Synthetic quote MFA'}),'quote_enroll'),totp=URI.parse(factor.totp.uri);assert(totp instanceof TOTP);authResult(await sdk.mfa.challengeAndVerify({factorId:factor.id,code:totp.generate()}),'quote_enroll_verify');
 const f=await transaction(async()=>{
  const actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic quote HTTP owner',$1,$2,$3,$3,'manual') RETURNING id",[service.issuer,user.id,bootstrap])).rows[0].id;
  const business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic quote HTTP business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);const epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;return {actor,business,epoch};
 });
 const issued=await lifecycle.login({email,password,factorId:factor.id,code:totp.generate()},{subject:user.id},false,signal()),credential=issued.cookieValueForResponse(),customer=randomUUID(),customers=createCustomerDirectory(config,boundary,tokens);
 await customers.save(credential,{schemaVersion:1,businessId:f.business,operationId:randomUUID(),recoveryEpoch:f.epoch,customerId:customer,expectedVersion:'0',draft:{displayName:'Synthetic HTTP recipient',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null}},signal());
 return {...f,issued,subject:user.id,factorId:factor.id,credential,customer,api:createQuoteDirectory(config,boundary,tokens)};
}
const line=(grossCents)=>({id:randomUUID(),vehicleId:null,jobWide:true,vehicleLabel:null,serviceVersionId:null,description:'Synthetic job-wide scope',inclusions:'Explicit synthetic work',exclusions:'No exterior protection',condition:'Moderate',grossCents,lineDiscount:null,documentDiscountEligible:true,complimentaryReason:null});
const request=(f,patch={})=>({schemaVersion:1,businessId:f.business,operationId:randomUUID(),recoveryEpoch:f.epoch,familyId:randomUUID(),revisionId:randomUUID(),expectedFamilyVersion:'0',expectedRevisionVersion:'0',content:{schemaVersion:1,title:'Synthetic HTTP quote',recipient:{customerId:f.customer,leadId:null,displayName:'Synthetic HTTP recipient',phone:null,email:null},workLocation:'Synthetic workshop',terms:'',timezone:'UTC',expiryAt:null,proposedSchedule:null,internalNotes:'Private synthetic assumption',documentDiscount:{kind:'fixed',cents:'2500'},lines:[line('25000'),line('30000')]},...patch});
const wire=r=>{const {businessId,...body}=r;void businessId;return body;};
const facts=f=>client.query("SELECT jsonb_build_object('families',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest.quote_families v WHERE business_id=$1),'revisions',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest.quote_revisions v WHERE business_id=$1),'items',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest.quote_items v WHERE business_id=$1),'operations',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest_private.operations v WHERE business_id=$1),'audit',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest_private.audit_events v WHERE business_id=$1))::text AS value",[f.business]).then(result=>result.rows[0].value);
async function withHttp(f,run,{enabled=true,businessId=f.business}={}){
 let origin,handler,providerCalls=0;
 // Count calls to the genuine provider verifier; never replace its evidence.
 const counted=Object.freeze({...boundary,verifyAccess:async(...args)=>{providerCalls++;return boundary.verifyAccess(...args);}});
 const server=createServer(async(req,res)=>{try{const incoming=new Request(origin+req.url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:req,duplex:'half'}:{})}),response=await handler(incoming,transportFromIncomingMessage(req));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{
  origin='http://127.0.0.1:'+server.address().port;const httpConfig={...config,origin,businessId,ingress:{kind:'direct'}};handler=createQuoteHttp(httpConfig,counted,tokens,enabled);
  const flow=createBrowserSessionFlow({...httpConfig,loginKey:randomBytes(32),owner:{subject:f.subject,factorId:f.factorId}},counted,tokens),session=await flow.session({method:'POST',headers:new Headers({origin,'content-type':'application/json'})},f.credential,signal());
  const post=async(route,body={},headers={},method='POST')=>{
   const response=await fetch(origin+'/api/business/quotes/'+route,{method,redirect:'error',headers:{origin,'content-type':'application/json',cookie:'__Host-crest_session='+f.credential,'x-crest-csrf':session.csrfTokenForResponse(),...headers},...(!['GET','HEAD'].includes(method)?{body:typeof body==='string'?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(40000)});
   assert.match(response.headers.get('cache-control')??'',/no-store/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');return {status:response.status,value:await response.json(),binding:response.headers.get('x-crest-edit-binding'),allow:response.headers.get('allow')};
  };
  assert(providerCalls>0,'the instrumentation observed genuine session verification');await run(post,()=>providerCalls);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

test('genuine MFA HTTP context, typed save, reload and retained history form one private workflow',async()=>{
 const f=await fixture(),r=request(f);await withHttp(f,async post=>{
  const context=await post('context');assert.equal(context.status,200);assert.deepEqual(context.value,{schemaVersion:1,businessId:f.business,writeState:'ready',recoveryEpoch:f.epoch});assert.match(context.binding,/^[A-Za-z0-9_-]{43}$/);
  const saved=await post('save',wire(r));assert.equal(saved.status,200);assert.equal(saved.value.state,'committed');assert.equal(saved.value.receipt.familyVersion,'1');assert.equal(saved.value.receipt.revisionVersion,'1');
  const page=await post('list',{search:'HTTP quote',afterId:null,pageSize:20});assert.equal(page.status,200);assert.equal(page.value.quotes.length,1);assert.equal(page.value.quotes[0].revision.total_cents,'52500');
  const history=await post('history',{familyId:r.familyId,revisionId:r.revisionId,afterVersion:'0',pageSize:5});assert.equal(history.status,200);assert.equal(history.value.items.length,2);assert.equal(history.value.history.length,1);assert.deepEqual(history.value.revision.customer_safe_snapshot.recipient,{displayName:'Synthetic HTTP recipient',phone:null,email:null});assert.equal(history.value.revision.internal_snapshot.notes,r.content.internalNotes);
 });
});
test('genuine edit keeps original receipt replay and requires explicit stale-version review',async()=>{
 const f=await fixture(),r=request(f);await withHttp(f,async post=>{
  const first=await post('save',wire(r));assert.equal(first.status,200);const changed={...r,operationId:randomUUID(),expectedFamilyVersion:'1',expectedRevisionVersion:'1',content:{...r.content,terms:'Revised synthetic terms'}};
  const edited=await post('save',wire(changed));assert.equal(edited.status,200);assert.equal(edited.value.receipt.contentVersion,'2');assert.notEqual(edited.value.receipt.contentHash,first.value.receipt.contentHash);
  assert.deepEqual((await post('operation',{operationId:r.operationId})).value,first.value);assert.deepEqual((await post('save',wire(r))).value,first.value);
  const stale=await post('save',wire({...changed,operationId:randomUUID(),content:{...r.content,terms:'Stale edit'}}));assert.equal(stale.status,409);assert.deepEqual(stale.value,{state:'conflict',reason:'version',currentFamilyVersion:'2',currentRevisionVersion:'2'});
  const page1=await post('history',{familyId:r.familyId,revisionId:r.revisionId,afterVersion:'0',pageSize:1});assert.equal(page1.status,200);assert.equal(page1.value.hasMore,true);assert.equal(page1.value.history[0].after.customer_safe_snapshot.terms,'');
  const page2=await post('history',{familyId:r.familyId,revisionId:r.revisionId,afterVersion:'1',pageSize:1});assert.equal(page2.value.hasMore,false);assert.equal(page2.value.history[0].after.customer_safe_snapshot.terms,'Revised synthetic terms');
 });
});
test('nested duplicate keys, excessive bodies and authority injection are refused before provider work',async()=>{
 const f=await fixture(),r=request(f);await withHttp(f,async(post,calls)=>{
  const before=await facts(f),initialCalls=calls(),body=JSON.stringify(wire(r));
  const duplicateTitle=body.replace('"title":"Synthetic HTTP quote"','"title":"Synthetic HTTP quote","ti\\u0074le":"Shadowed title"'),duplicateMoney=body.replace('"grossCents":"25000"','"grossCents":"25000","gross\\u0043ents":"1"');assert.notEqual(duplicateTitle,body);assert.notEqual(duplicateMoney,body);
  const invalid=[duplicateTitle,duplicateMoney,{...wire(r),businessId:randomUUID()},{...wire(r),content:{...r.content,terms:'x'.repeat(131072)}}];
  for(const value of invalid){const rejected=await post('save',value);assert.equal(rejected.status,400);assert.deepEqual(rejected.value,{error:'QUOTE_REQUEST_FAILED'});}
  assert.equal(calls(),initialCalls);assert.equal(await facts(f),before);
 });
});
test('origin, CSRF, session cookie and method checks expose only fixed private failures',async()=>{
 const f=await fixture(),r=request(f);await withHttp(f,async(post,calls)=>{
  const before=await facts(f),initialCalls=calls();for(const headers of [{origin:'https://foreign.example.com'},{'x-crest-csrf':randomBytes(32).toString('base64url')},{cookie:''},{'content-type':'text/plain'}]){const result=await post('save',wire(r),headers);assert.equal(result.status,400);assert.deepEqual(result.value,{error:'QUOTE_REQUEST_FAILED'});assert(!JSON.stringify(result.value).includes(f.credential));}
  const wrongMethod=await post('context',{}, {},'GET');assert.equal(wrongMethod.status,405);assert.equal(wrongMethod.allow,'POST');assert.equal((await post('unknown')).status,404);assert.equal((await post('context?synthetic=1')).status,404);assert.equal(calls(),initialCalls);assert.equal(await facts(f),before);
 });
});
test('another genuine owner session cannot save or read the configured business',async()=>{
 const f=await fixture(),other=await fixture(),r=request(f),before=await facts(f);await withHttp(other,async post=>{
  const save=await post('save',wire(r));assert.equal(save.status,403);assert.deepEqual(save.value,{error:'QUOTE_SAVE_DENIED'});const list=await post('list',{search:'',afterId:null,pageSize:20});assert.equal(list.status,503);assert.deepEqual(list.value,{error:'QUOTE_REQUEST_FAILED'});
 },{businessId:f.business});assert.equal(await facts(f),before);
});
test('paused writes keep retained originals/history readable and return recovery review explicitly',async()=>{
 const f=await fixture(),r=request(f);await withHttp(f,async post=>{
  const first=await post('save',wire(r));assert.equal(first.status,200);await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business]);
  const before=await facts(f),context=await post('context');assert.equal(context.status,200);assert.equal(context.value.writeState,'paused');assert.equal(context.value.recoveryEpoch,null);const blocked=await post('save',wire(request(f)));assert.equal(blocked.status,409);assert.deepEqual(blocked.value,{error:'RECOVERY_REVIEW_REQUIRED'});assert.deepEqual((await post('operation',{operationId:r.operationId})).value,first.value);assert.equal((await post('history',{familyId:r.familyId,revisionId:r.revisionId,afterVersion:'0',pageSize:5})).status,200);assert.equal(await facts(f),before);
 });
});
test('provider revocation cannot claim a quote and returns no provider or database details',async()=>{
 const f=await fixture(),r=request(f);await withHttp(f,async post=>{
  await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.issued.evidence.provider.sessionId]);const before=await facts(f),failed=await post('save',wire(r));assert.equal(failed.status,503);assert.deepEqual(failed.value,{error:'QUOTE_SAVE_NOT_SUBMITTED'});assert.equal(await facts(f),before);
 });
});
test('deferred PostgreSQL refusal withholds success, leaves the original absent and permits only explicit retry',async()=>{
 const f=await fixture(),r=request(f);await withHttp(f,async post=>{
  await client.query("CREATE FUNCTION public.synthetic_quote_http_commit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Synthetic private database diagnostic';END $$");await client.query('CREATE CONSTRAINT TRIGGER synthetic_quote_http_commit_fail AFTER INSERT ON crest.quote_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.synthetic_quote_http_commit_fail()');
  try{const before=await facts(f),failed=await post('save',wire(r));assert.equal(failed.status,503);assert.deepEqual(failed.value,{error:'QUOTE_SAVE_OUTCOME_UNKNOWN'});assert(!JSON.stringify(failed.value).includes('diagnostic'));assert.equal(await facts(f),before);assert.deepEqual((await post('operation',{operationId:r.operationId})).value,{state:'absent'});}finally{await client.query('DROP TRIGGER synthetic_quote_http_commit_fail ON crest.quote_revisions');await client.query('DROP FUNCTION public.synthetic_quote_http_commit_fail()');}
  const retried=await post('save',wire(r));assert.equal(retried.status,200);assert.equal(retried.value.receipt.revisionVersion,'1');assert.equal((await post('list',{search:'',afterId:null,pageSize:20})).value.quotes.length,1);
 });
});
test('quote HTTP stays closed without explicit synthetic composition despite a genuine session',async()=>{
 const f=await fixture();await withHttp(f,async(post,calls)=>{const before=await facts(f),initialCalls=calls();assert.equal((await post('context')).status,404);assert.equal((await post('save',wire(request(f)))).status,404);assert.equal(calls(),initialCalls);assert.equal(await facts(f),before);},{enabled:false});
});
