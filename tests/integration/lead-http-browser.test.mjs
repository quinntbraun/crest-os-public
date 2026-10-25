// Genuine HTTPS + compiled Next/Node + real disposable Auth/PG. No traces,
// HAR, video, storageState exports or credential-bearing failure artifacts.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {chromium,webkit,expect} from '@playwright/test';
import {rolldown} from 'rolldown';
import {URI,TOTP} from 'otpauth';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {startRealAuthService,authResult} from '../support/real-auth-service.mjs';

let sandbox,client,service,app,origin,fixture,actor,business,login,loginOwned=false,browserClient='';
const sessionName='__Host-crest_session';
before(async()=>{
  assert.equal(process.platform,'linux','the disposable container/HTTPS fixture requires Linux CI');
  process.env.NODE_ENV='production';
  for(const [input,name] of [['src/client/leads.ts','crestLeadFixture'],['src/client/lead-sources.ts','crestLeadSourceFixture'],['src/client/lead-states.ts','crestLeadStateFixture'],['src/client/lead-vehicles.ts','crestLeadVehicleFixture'],['src/client/lead-addresses.ts','crestLeadAddressFixture']]){
    const bundle=await rolldown({input,platform:'browser',onwarn(warning){throw new Error('LEAD_CLIENT_FIXTURE_BUILD_FAILED:'+warning.code);}});
    try{const result=await bundle.generate({format:'iife',name,sourcemap:false});assert.equal(result.output.length,1);assert.equal(result.output[0].type,'chunk');browserClient+=result.output[0].code+'\n';}finally{await bundle.close();}
  }
  sandbox=await migrationSandbox();const target=await sandbox.database();client=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);await sandbox.apply(target);
  login=`crest_probe_${randomBytes(8).toString('hex')}`;const password=randomBytes(32).toString('hex');
  assert.match(login,/^crest_probe_[a-f0-9]{16}$/);assert.match(password,/^[a-f0-9]{64}$/);
  await sandbox.admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);loginOwned=true;
  await sandbox.admin.query(`GRANT crest_web TO ${login}`);const database=new URL(target);database.username=login;database.password=password;
  service=await startRealAuthService(target);
  const email=`synthetic-${randomUUID()}@example.com`,secret=randomBytes(32).toString('base64url');
  const user=authResult(await service.admin.admin.createUser({email,password:secret,email_confirm:true}),'browser_provision').user;assert(user?.id,'synthetic subject required');
  const sdk=service.sdk();await sdk.initialize();authResult(await sdk.signInWithPassword({email,password:secret}),'browser_enrollment_password');
  const factor=authResult(await sdk.mfa.enroll({factorType:'totp',friendlyName:'Synthetic browser fixture'}),'browser_enroll');
  const totp=URI.parse(factor.totp.uri);assert(totp instanceof TOTP,'synthetic TOTP required');
  authResult(await sdk.mfa.challengeAndVerify({factorId:factor.id,code:totp.generate()}),'browser_enrollment_verify');fixture={email,password:secret,totp};
  const bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  await client.query('BEGIN');try{
    actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic browser owner',$1,$2,$3,$3,'manual') RETURNING id",[service.issuer,user.id,bootstrap])).rows[0].id;
    business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic browser business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;
    await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
    await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,actor]);await client.query('COMMIT');
  }catch{await client.query('ROLLBACK');throw new Error('SYNTHETIC_BROWSER_OWNER_FAILED');}
  const keyPath=join(sandbox.workspace,'ephemeral.key'),certPath=join(sandbox.workspace,'ephemeral.pem');
  await chmod(sandbox.workspace,0o700);
  try{execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-noenc','-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore',timeout:15000});}
  catch{throw new Error('SYNTHETIC_TLS_FIXTURE_FAILED');}
  await chmod(keyPath,0o600);
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));origin=`https://127.0.0.1:${port}`;
  // Normal Node resolution: react-server is only a build-time marker condition.
  const {createCrestApplication,createAuthenticationRuntime}=await import('../../.local/server/application.mjs');
  const runtime=await createAuthenticationRuntime({database:{connectionString:database.toString(),environment:'test'},provider:{issuer:service.issuer,publicKey:service.publicKey,environment:'test'},
    owner:{subject:user.id,factorId:factor.id},loginKey:randomBytes(32),ingress:{kind:'direct'},activeKeyId:'synthetic',keys:[{id:'synthetic',key:randomBytes(32)}]});
  assert.throws(()=>JSON.stringify(runtime),/AUTHENTICATION_RUNTIME_PRIVATE/);
  app=await createCrestApplication({origin,environment:'test',tls:{key:await readFile(keyPath),cert:await readFile(certPath)},authentication:runtime.forServer(),business:{businessId:business},leads:true,vehicles:true});
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',resolve);});
  await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[business]);
});
after(async()=>{try{await app?.close();}finally{try{await service?.close();}finally{if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();}}});

async function fill(page,{trusted=false,password=fixture.password}={}){
  await page.getByLabel('Email',{exact:true}).fill(fixture.email);await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByLabel('Authenticator code',{exact:true}).fill(fixture.totp.generate());await page.getByLabel('Trust this personal device').setChecked(trusted);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
}
async function send(page,route,body={},proof=null){
  return page.evaluate(async input=>{
    const response=await fetch('/api/'+input.route,{method:'POST',headers:{'content-type':'application/json',...(input.proof?{'x-crest-csrf':input.proof}:{})},body:JSON.stringify(input.body)}),text=await response.text();
    return {status:response.status,body:JSON.parse(text),bytes:new TextEncoder().encode(text).byteLength,cache:response.headers.get('cache-control'),binding:response.headers.get('x-crest-edit-binding')};
  },{route,body,proof});
}
const root='business/leads/',sources='business/lead-sources/';
const sourceDraft=(epoch,label)=>({schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,leadSourceId:randomUUID(),expectedVersion:'0',label,kind:'Owner recorded referral',active:true,referralCustomerId:null});
const leadDraft=(epoch,label)=>({schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,leadId:randomUUID(),expectedVersion:'0',label,customerId:null,sourceId:null,referralText:null,phone:null,email:null,requestedScope:null,availability:null,estimatedCents:null,followUpAt:null,notes:null});
const vehicleDraft=(epoch,leadId,label)=>({schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,leadId,leadVehicleId:randomUUID(),expectedVersion:'0',vehicleId:null,reportedLabel:label,reportedYear:null,reportedMake:null,reportedModel:null,reportedColor:null,reportedVin:null,reportedPlate:null,reportedNotes:null,requestedServicesText:null,conditionNotes:null,archived:false,archiveReason:null});
const addressDraft=(epoch,leadId)=>({schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,leadId,leadAddressId:randomUUID(),expectedVersion:'0',line1:null,line2:null,city:null,region:null,postalCode:null,country:null,exactLocationText:null,instructions:null,latitude:null,longitude:null,geocodeSource:null,geocodeAccuracy:null,verifiedAt:null,archived:false,archiveReason:null});
for(const [name,engine,viewport] of [['chromium',chromium,{width:1280,height:900}],['webkit',webkit,{width:360,height:800}]]){
 test('genuine private lead/source HTTP '+name,async t=>{
  const browser=await engine.launch();let first,second,proof,otherProof,epoch,source,input,created,sourceCreated,otherSource,vehicleOriginal,vehicleReceipt,addressOriginal,addressReceipt;
  try{
   first=await browser.newContext({ignoreHTTPSErrors:true,viewport});second=await browser.newContext({ignoreHTTPSErrors:true,viewport});const page=await first.newPage(),other=await second.newPage();
   await t.test('two devices establish genuine MFA and separate private provider-backed sessions',async()=>{
    for(const [p,trusted] of [[page,false],[other,true]]){await p.goto(origin+'/sign-in');await expect(p.getByRole('status')).toHaveText('Sign in to continue.');await fill(p,{trusted});await expect(p.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();}
    const a=(await first.cookies()).find(c=>c.name===sessionName),b=(await second.cookies()).find(c=>c.name===sessionName);assert(a?.httpOnly&&a.secure&&b?.httpOnly&&b.secure&&a.value!==b.value);
    proof=(await send(page,'auth/session')).body.csrfToken;otherProof=(await send(other,'auth/session')).body.csrfToken;
   });
   await t.test('actual intake preserves complete large Unicode, unknown contact, exact cents/microseconds and original source receipts',async()=>{
    assert.equal((await send(page,root+'context')).status,400);assert.equal((await send(page,'business/customers/context',{},proof)).status,503);
    const context=await send(page,root+'context',{},proof),different=await send(other,root+'context',{},otherProof),sourceContext=await send(page,sources+'context',{},proof);
    assert.equal(context.status,200);assert.equal(context.body.writeState,'ready');assert.match(context.cache,/no-store/);assert.match(context.binding,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(context.binding,different.binding);assert.notEqual(context.binding,sourceContext.binding);epoch=context.body.recoveryEpoch;
    source=sourceDraft(epoch,'Synthetic source '+name);sourceCreated=await send(page,sources+'save',source,proof);assert.equal(sourceCreated.status,200);assert.equal(sourceCreated.body.receipt.leadSourceVersion,'1');
    assert.deepEqual((await send(page,sources+'save',source,proof)).body,sourceCreated.body);assert.deepEqual((await send(page,sources+'operation',{operationId:source.operationId},proof)).body,sourceCreated.body);
    input={...leadDraft(epoch,'Synthetic inquiry %_ '+name),sourceId:source.leadSourceId,estimatedCents:'9007199254740993',followUpAt:'2026-10-25T10:00:00.123456Z',notes:'😀'.repeat(4000),availability:'é'.repeat(4000),requestedScope:'\n'.repeat(4000)};
    assert(Buffer.byteLength(JSON.stringify(input))>8192);created=await send(page,root+'save',input,proof);assert.equal(created.status,200);assert.equal(created.body.receipt.leadId,input.leadId);assert.equal(created.body.receipt.leadVersion,'1');
    const row=(await client.query('SELECT state,phone_raw,email_raw,estimated_cents::text,to_char(follow_up_at AT TIME ZONE $2,\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS follow_up,notes,source_snapshot FROM crest.leads WHERE id=$1',[input.leadId,'UTC'])).rows[0];assert.equal(row.state,'new');assert.equal(row.phone_raw,null);assert.equal(row.email_raw,null);assert.equal(row.estimated_cents,input.estimatedCents);assert.equal(row.follow_up,input.followUpAt);assert.equal(row.notes,input.notes);assert.equal(row.source_snapshot.label,source.label);
    for(const patch of [{businessId:randomUUID()},{actorId:randomUUID()},{state:'won'},{sourceSnapshot:{}},{estimatedCents:1.5}])assert.equal((await send(page,root+'save',{...input,...patch},proof)).status,400);
   });
   await t.test('source rename/deactivation preserves selected attribution until explicit reselection and retains large exact history',async()=>{
    assert.equal((await send(page,sources+'save',{...source,operationId:randomUUID(),expectedVersion:'1',label:source.label+' renamed',kind:'Changed classification',active:false},proof)).status,200);
    assert.equal((await send(page,root+'save',{...input,operationId:randomUUID(),expectedVersion:'1',notes:'Retained original source'},proof)).status,200);
    const retained=await send(page,root+'history',{leadId:input.leadId,afterVersion:'0',pageSize:20},proof);assert.equal(retained.status,200);assert(retained.bytes>8192);assert.equal(retained.body.lead.source_snapshot.label,source.label);assert.equal(retained.body.lead.source_snapshot.active,true);assert.equal(retained.body.history[0].after.notes,input.notes);
    otherSource=sourceDraft(epoch,'Synthetic replacement '+name);assert.equal((await send(page,sources+'save',otherSource,proof)).status,200);
    const changed={...input,operationId:randomUUID(),expectedVersion:'2',sourceId:otherSource.leadSourceId,notes:'Explicit source selection'};assert.equal((await send(page,root+'save',changed,proof)).status,200);
    const history=await send(page,root+'history',{leadId:input.leadId,afterVersion:'0',pageSize:20},proof);assert.equal(history.body.lead.source_snapshot.label,otherSource.label);assert.equal(history.body.history[2].before.source_snapshot.label,source.label);assert.deepEqual(history.body.history.map(e=>e.action),['create','edit','edit']);
    assert.deepEqual((await send(page,root+'save',input,proof)).body,created.body);assert.deepEqual((await send(page,root+'operation',{operationId:input.operationId},proof)).body,created.body);
    const listing=await send(page,root+'list',{search:input.label,afterId:null,includeLost:false,pageSize:50},proof);assert.equal(listing.status,200);assert.equal(listing.body.leads.length,1);assert.equal(listing.body.leads[0].id,input.leadId);
    const sourceHistory=await send(page,sources+'history',{leadSourceId:source.leadSourceId,afterVersion:'0',pageSize:20},proof);assert.equal(sourceHistory.status,200);assert.equal(sourceHistory.body.leadSource.active,false);assert.deepEqual(sourceHistory.body.history.map(e=>e.action),['create','deactivate']);
    const inactive=await send(page,sources+'list',{search:source.label,afterId:null,includeInactive:false,pageSize:50},proof);assert.equal(inactive.status,200);assert.equal(inactive.body.leadSources.length,0);
   });
   await t.test('two authorized devices cannot overwrite an expected version or retain the losing operation',async()=>{
    const changes=[{...input,operationId:randomUUID(),expectedVersion:'3',notes:'Device one'},{...input,operationId:randomUUID(),expectedVersion:'3',notes:'Device two'}],results=await Promise.all([send(page,root+'save',changes[0],proof),send(other,root+'save',changes[1],otherProof)]);
    assert.equal(results.filter(r=>r.status===200&&r.body.state==='committed').length,1);assert.equal(results.filter(r=>r.status===409&&r.body.reason==='version'&&r.body.currentVersion==='4').length,1);
    const loser=results[0].status===409?changes[0]:changes[1];assert.deepEqual((await send(page,root+'operation',{operationId:loser.operationId},proof)).body,{state:'absent'});
   });
   await t.test('compiled stateless browser clients preserve source/lead receipts, exact intake and complete history',async()=>{
    const clientProof=(await send(page,'auth/session')).body;
    await page.evaluate(code=>{const nonce=document.querySelector('script[nonce]')?.nonce;if(!nonce)throw new Error('SYNTHETIC_NONCE_REQUIRED');const script=document.createElement('script');script.nonce=nonce;script.textContent=code;document.head.append(script);},browserClient);
    const {schemaVersion,operationId,recoveryEpoch,leadSourceId,expectedVersion,...sourceBody}=sourceDraft(epoch,'Synthetic client source '+name),sourceCommand={schemaVersion,operationId,recoveryEpoch,leadSourceId,expectedVersion,draft:sourceBody};
    const raw={...leadDraft(epoch,'Synthetic client inquiry '+name),sourceId:leadSourceId,notes:'😀'.repeat(4000),estimatedCents:'9223372036854775807',followUpAt:'2026-10-25T10:00:00.123456Z'},leadBody={...raw};for(const key of ['schemaVersion','operationId','recoveryEpoch','leadId','expectedVersion'])delete leadBody[key];
    const leadCommand={schemaVersion:raw.schemaVersion,operationId:raw.operationId,recoveryEpoch:raw.recoveryEpoch,leadId:raw.leadId,expectedVersion:raw.expectedVersion,draft:leadBody};
    const result=await page.evaluate(async({business,source,lead,proof})=>{
      const sourceApi=globalThis.crestLeadSourceFixture.leadSources,leadApi=globalThis.crestLeadFixture.leads,signal=()=>new AbortController().signal;
      const sourceContext=await sourceApi.context(proof,signal()),context=await leadApi.context(proof,signal()),sourceSaved=await sourceApi.save(business,source,proof,signal()),saved=await leadApi.save(business,lead,proof,signal());
      const {draft:sourceDraft,...sourceReferenceWithSchema}=source,{schemaVersion:sourceVersion,...sourceReference}=sourceReferenceWithSchema,{draft:leadDraft,...leadReferenceWithSchema}=lead,{schemaVersion:leadVersion,...reference}=leadReferenceWithSchema;
      const lookup=await leadApi.lookup(business,reference,proof,signal()),sourceLookup=await sourceApi.lookup(business,sourceReference,proof,signal()),list=await leadApi.list(business,{search:leadDraft.label,afterId:null,includeLost:false,pageSize:50},proof,signal());
      const changed={...source,operationId:crypto.randomUUID(),expectedVersion:'1',draft:{...sourceDraft,active:false}};await sourceApi.save(business,changed,proof,signal());
      const sourceHistory=await sourceApi.history(business,{leadSourceId:source.leadSourceId,afterVersion:'0',pageSize:20},proof,signal()),history=await leadApi.history(business,{leadId:lead.leadId,afterVersion:'0',pageSize:20},proof,signal());
      return {context,sourceContext,sourceSaved,sourceLookup,saved,lookup,list,history,sourceHistory,sourceVersion,leadVersion};
    },{business,source:sourceCommand,lead:leadCommand,proof:clientProof});
    assert.equal(result.context.context.writeState,'ready');assert.notEqual(result.context.binding,result.sourceContext.binding);assert.deepEqual(result.saved,result.lookup);assert.deepEqual(result.sourceSaved,result.sourceLookup);assert.equal(result.saved.receipt.leadId,raw.leadId);assert.equal(result.list.leads.length,1);assert.equal(result.history.state,'found');assert.equal(result.history.lead.notes,raw.notes);assert.equal(result.history.lead.estimated_cents,raw.estimatedCents);assert.equal(result.history.lead.follow_up_at,raw.followUpAt);assert.equal(result.history.lead.source_snapshot.active,true);assert.deepEqual(result.sourceHistory.history.map(e=>e.action),['create','deactivate']);
   });

   await t.test('compiled status client retains Lost/reopen reasons, mixed history and original receipts',async()=>{
    const raw={...leadDraft(epoch,'Synthetic status client '+name),sourceId:otherSource.leadSourceId,estimatedCents:'9007199254740993',followUpAt:'2026-11-01T10:00:00.123456Z'};
    assert.equal((await send(page,root+'save',raw,proof)).status,200);
    const original={schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,leadId:raw.leadId,expectedVersion:'1',draft:{fromState:'new',toState:'lost',reason:' Original Lost é 😀\n retained '}};
    const result=await page.evaluate(async({business,raw,original,csrf})=>{
     const api=globalThis.crestLeadStateFixture.leadStates,intake=globalThis.crestLeadFixture.leads,p={csrfToken:csrf,expiresAt:Date.now()+60000},signal=()=>new AbortController().signal;
     const lost=await api.change(business,original,p,signal());
     const {schemaVersion,operationId,recoveryEpoch,leadId,expectedVersion,...draft}=raw;
     await intake.save(business,{schemaVersion,operationId:crypto.randomUUID(),recoveryEpoch,leadId,expectedVersion:'2',draft:{...draft,notes:'Intake between status events'}},p,signal());
     const reopen={...original,operationId:crypto.randomUUID(),expectedVersion:'3',draft:{fromState:'lost',toState:'follow_up',reason:' Original reopen é 😀\n retained '}};
     const reopened=await api.change(business,reopen,p,signal()),{draft:originalDraft,schemaVersion:originalSchema,...reference}=original;
     const lookup=await api.lookup(business,reference,p,signal()),replay=await api.change(business,original,p,signal()),different=await api.change(business,{...original,draft:{...originalDraft,reason:'Changed body'}},p,signal());
     const first=await api.events(business,{leadId,afterVersion:'0',pageSize:1},p,signal()),last=await api.events(business,{leadId,afterVersion:'2',pageSize:1},p,signal()),history=await intake.history(business,{leadId,afterVersion:'0',pageSize:5},p,signal());
     return {lost,reopened,lookup,replay,different,first,last,history,originalSchema,operationId,expectedVersion};
    },{business,raw,original,csrf:proof});
    assert.equal(result.lost.state,'committed');assert.equal(result.reopened.state,'committed');assert.deepEqual(result.lookup,result.lost);assert.deepEqual(result.replay,result.lost);assert.deepEqual(result.different,{state:'conflict',reason:'operation'});
    assert.equal(result.first.hasMore,true);assert.equal(result.last.hasMore,false);assert.deepEqual(result.first.events.map(e=>e.lead_version),['2']);assert.deepEqual(result.last.events.map(e=>e.lead_version),['4']);assert.equal(result.first.events[0].reason,original.draft.reason);assert.equal(result.last.events[0].reason,' Original reopen é 😀\n retained ');
    assert.deepEqual(result.history.history.map(e=>e.action),['create','state_change','edit','state_change']);assert.equal(result.history.lead.state,'follow_up');assert.equal(result.history.lead.estimated_cents,raw.estimatedCents);assert.equal(result.history.lead.follow_up_at,raw.followUpAt);assert.equal(result.history.lead.source_snapshot.id,otherSource.leadSourceId);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.lead_events WHERE lead_id=$1',[raw.leadId])).rows[0].n,2);
   });
   await t.test('two-device status race commits once and a dropped status response resolves only its original receipt',async()=>{
    const raw=leadDraft(epoch,'Synthetic status race '+name);assert.equal((await send(page,root+'save',raw,proof)).status,200);
    const change={schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,leadId:raw.leadId,expectedVersion:'1',fromState:'new',toState:'contacted',reason:null},rival={...change,operationId:randomUUID(),toState:'follow_up'};
    const race=await Promise.all([send(page,root+'state',change,proof),send(other,root+'state',rival,otherProof)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
    const winner=race[0].status===200?change:rival,loser=race[0].status===200?rival:change;assert.equal(race.find(r=>r.status===409).body.reason,'version');assert.equal((await send(page,root+'state-operation',{operationId:loser.operationId},proof)).body.state,'absent');
    const original={...change,operationId:randomUUID(),expectedVersion:'2',fromState:winner.toState,toState:'lost',reason:' Lost response original reason é 😀'};
    const pattern='**/api/business/leads/state';let calls=0,status;
    const drop=async intercepted=>{calls++;try{status=(await intercepted.fetch()).status();}finally{await intercepted.abort('failed');}};await page.route(pattern,drop);
    try{await assert.rejects(send(page,root+'state',original,proof));}finally{await page.unroute(pattern,drop);}
    assert.equal(calls,1);assert.equal(status,200);const found=await send(page,root+'state-operation',{operationId:original.operationId},proof);assert.equal(found.status,200);assert.equal(found.body.receipt.leadVersion,'3');assert.deepEqual((await send(page,root+'state',original,proof)).body,found.body);
    for(const patch of [{toState:'won'},{toState:'quote_sent'},{reason:null},{followUpAt:null}])assert.equal((await send(page,root+'state',{...original,...patch},proof)).status,400);
    const rows=(await client.query('SELECT lead_version::text AS version FROM crest.lead_events WHERE lead_id=$1 ORDER BY lead_version',[raw.leadId])).rows;assert.deepEqual(rows.map(r=>r.version),['2','3']);
   });
   await t.test('compiled vehicle client retains two original reports, genuine explicit link, archive history and original receipts',async()=>{
    const directory={schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,vehicleId:randomUUID(),expectedVersion:'0',label:'Synthetic directory vehicle '+name,year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'customer_vehicle',notes:null,archived:false,archiveReason:null};
    assert.equal((await send(page,'business/vehicles/save',directory,proof)).status,200);
    vehicleOriginal={...vehicleDraft(epoch,input.leadId,'Synthetic reported vehicle '+name),vehicleId:directory.vehicleId,reportedYear:-42,reportedVin:' Raw 001 ',reportedNotes:'😀'.repeat(2000),requestedServicesText:'\n'.repeat(4000),conditionNotes:'é'.repeat(4000)};
    const original=vehicleOriginal,secondReport=vehicleDraft(epoch,input.leadId,'Synthetic second unknown vehicle '+name);
    const result=await page.evaluate(async({business,original,secondReport,csrf})=>{
     const api=globalThis.crestLeadVehicleFixture.leadVehicles,p={csrfToken:csrf,expiresAt:Date.now()+60000},signal=()=>new AbortController().signal;
     const command=flat=>{const {schemaVersion,operationId,recoveryEpoch,leadId,leadVehicleId,expectedVersion,vehicleId,reportedLabel,reportedYear,reportedMake,reportedModel,reportedColor,reportedVin,reportedPlate,reportedNotes,requestedServicesText,conditionNotes,archived,archiveReason}=flat;return {schemaVersion,operationId,recoveryEpoch,leadId,leadVehicleId,expectedVersion,draft:{vehicleId,reportedVehicle:{schemaVersion:1,label:reportedLabel,year:reportedYear,make:reportedMake,model:reportedModel,color:reportedColor,vin:reportedVin,plate:reportedPlate,notes:reportedNotes},requestedServices:{schemaVersion:1,text:requestedServicesText},conditionNotes,archived,archiveReason}};};
     const first=command(original),saved=await api.save(business,first,p,signal());await api.save(business,command(secondReport),p,signal());
     const archived=await api.save(business,{...first,operationId:crypto.randomUUID(),expectedVersion:'1',draft:{...first.draft,archived:true,archiveReason:'Original archive é 😀'}},p,signal());
     const {schemaVersion,draft,...reference}=first,lookup=await api.lookup(business,reference,p,signal()),replay=await api.save(business,first,p,signal()),list=await api.list(business,{leadId:first.leadId,afterId:null,includeArchived:true,pageSize:10},p,signal()),active=await api.list(business,{leadId:first.leadId,afterId:null,includeArchived:false,pageSize:10},p,signal()),history=await api.history(business,{leadId:first.leadId,leadVehicleId:first.leadVehicleId,afterVersion:'0',pageSize:5},p,signal());return {saved,archived,lookup,replay,list,active,history,schemaVersion,draft};
    },{business,original,secondReport,csrf:proof});
    vehicleReceipt=result.saved;assert.equal(result.saved.receipt.leadVehicleVersion,'1');assert.equal(result.archived.receipt.leadVehicleVersion,'2');assert.deepEqual(result.lookup,result.saved);assert.deepEqual(result.replay,result.saved);assert.equal(result.list.leadVehicles.length,2);assert.equal(result.active.leadVehicles.length,1);assert.deepEqual(result.history.history.map(e=>e.action),['create','archive']);assert.equal(result.history.leadVehicle.vehicle_id,directory.vehicleId);assert.equal(result.history.history[0].after.reported_vehicle.notes,original.reportedNotes);assert.equal(result.history.leadVehicle.requested_services.text,original.requestedServicesText);assert.equal(result.history.leadVehicle.condition_notes,original.conditionNotes);
    const source=(await client.query('SELECT label,version::text FROM crest.vehicles WHERE id=$1',[directory.vehicleId])).rows[0];assert.deepEqual(source,{label:directory.label,version:'1'});assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.customer_vehicles WHERE vehicle_id=$1',[directory.vehicleId])).rows[0].n,0);
    const lead=(await client.query('SELECT state,version::text FROM crest.leads WHERE id=$1',[input.leadId])).rows[0];assert.deepEqual(lead,{state:'new',version:'4'});
   });
   await t.test('two-device vehicle race and dropped response preserve one winner and original operation only',async()=>{
    const original=vehicleDraft(epoch,input.leadId,'Synthetic vehicle race '+name);assert.equal((await send(page,root+'vehicle-save',original,proof)).status,200);
    const changes=[{...original,operationId:randomUUID(),expectedVersion:'1',conditionNotes:'Device one'},{...original,operationId:randomUUID(),expectedVersion:'1',conditionNotes:'Device two'}],race=await Promise.all([send(page,root+'vehicle-save',changes[0],proof),send(other,root+'vehicle-save',changes[1],otherProof)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);const loser=race[0].status===409?changes[0]:changes[1];assert.equal(race.find(r=>r.status===409).body.reason,'version');assert.deepEqual((await send(page,root+'vehicle-operation',{operationId:loser.operationId},proof)).body,{state:'absent'});
    const dropped={...original,operationId:randomUUID(),expectedVersion:'2',conditionNotes:'Original lost response é 😀'},pattern='**/api/business/leads/vehicle-save';let calls=0,status;
    const drop=async intercepted=>{calls++;try{status=(await intercepted.fetch()).status();}finally{await intercepted.abort('failed');}};await page.route(pattern,drop);try{await assert.rejects(send(page,root+'vehicle-save',dropped,proof));}finally{await page.unroute(pattern,drop);}assert.equal(calls,1);assert.equal(status,200);
    const found=await send(page,root+'vehicle-operation',{operationId:dropped.operationId},proof);assert.equal(found.body.receipt.leadVehicleVersion,'3');assert.deepEqual((await send(page,root+'vehicle-save',dropped,proof)).body,found.body);assert.equal((await send(page,root+'vehicle-save',{...dropped,conditionNotes:'Changed body'},proof)).body.reason,'operation');
   });
   await t.test('vehicle transport rejects fabricated authority and missing sources without retaining claims',async()=>{
    const original=vehicleDraft(epoch,input.leadId,'Synthetic rejected report '+name);
    assert.equal((await send(page,root+'vehicle-save',original)).status,400);
    for(const patch of [{businessId:randomUUID()},{customerId:randomUUID()},{reportedVehicle:{}},{quoteId:randomUUID()},{reportedYear:1.5},{reportedNotes:'😀'.repeat(2001)}])assert.equal((await send(page,root+'vehicle-save',{...original,...patch},proof)).status,400);
    const noLead={...original,operationId:randomUUID(),leadId:randomUUID()},noVehicle={...original,operationId:randomUUID(),vehicleId:randomUUID()};for(const command of [noLead,noVehicle]){const r=await send(page,root+'vehicle-save',command,proof);assert.equal(r.status,409);assert.equal(r.body.reason,'parent');assert.deepEqual((await send(page,root+'vehicle-operation',{operationId:command.operationId},proof)).body,{state:'absent'});}
    assert.deepEqual((await send(page,root+'vehicle-list',{leadId:randomUUID(),afterId:null,includeArchived:true,pageSize:10},proof)).body,{state:'absent'});assert.deepEqual((await send(page,root+'vehicle-history',{leadId:randomUUID(),leadVehicleId:vehicleOriginal.leadVehicleId,afterVersion:'0',pageSize:5},proof)).body,{state:'absent'});
    assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,original.operationId])).rows[0].n,0);
   });
   await t.test('paused vehicle writes and changed recovery epochs preserve original lookup and source history',async()=>{
    const wrong={...vehicleOriginal,operationId:randomUUID(),expectedVersion:'2',recoveryEpoch:randomUUID()};const denied=await send(page,root+'vehicle-save',wrong,proof);assert.equal(denied.status,409);assert.deepEqual(denied.body,{error:'RECOVERY_REVIEW_REQUIRED'});assert.deepEqual((await send(page,root+'vehicle-operation',{operationId:wrong.operationId},proof)).body,{state:'absent'});
    await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[business]);
    try{const r=await send(page,root+'vehicle-save',vehicleOriginal,proof);assert.equal(r.status,409);assert.deepEqual(r.body,{error:'RECOVERY_REVIEW_REQUIRED'});assert.deepEqual((await send(page,root+'vehicle-operation',{operationId:vehicleOriginal.operationId},proof)).body,vehicleReceipt);assert.equal((await send(page,root+'vehicle-history',{leadId:vehicleOriginal.leadId,leadVehicleId:vehicleOriginal.leadVehicleId,afterVersion:'0',pageSize:5},proof)).status,200);}finally{await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[business]);}
   });
   // Reuse the existing second genuine MFA session for the address workload.
   // Its independent ordinary budget avoids overloading the first session;
   // production admission limits and the four-login fixture remain unchanged.
   await t.test('compiled address client retains two lead-owned locations, exact decimals and archive/reopen original history',async()=>{
    addressOriginal={...addressDraft(epoch,input.leadId),line1:'',exactLocationText:'😀'.repeat(2000),instructions:'é'.repeat(2000),latitude:'89.999999999999999999999',longitude:'-0.00000000000000000000',geocodeSource:'Owner entered',geocodeAccuracy:'Reported only',verifiedAt:'2026-10-25T01:02:03.123456Z'};
    const original=addressOriginal,secondLocation=addressDraft(epoch,input.leadId);
    const result=await other.evaluate(async({business,original,secondLocation,csrf})=>{
     const api=globalThis.crestLeadAddressFixture.leadAddresses,p={csrfToken:csrf,expiresAt:Date.now()+60000},signal=()=>new AbortController().signal;
     const command=flat=>{const {schemaVersion,operationId,recoveryEpoch,leadId,leadAddressId,expectedVersion,...draft}=flat;return {schemaVersion,operationId,recoveryEpoch,leadId,leadAddressId,expectedVersion,draft};};
     const first=command(original),saved=await api.save(business,first,p,signal());await api.save(business,command(secondLocation),p,signal());
     const archived=await api.save(business,{...first,operationId:crypto.randomUUID(),expectedVersion:'1',draft:{...first.draft,archived:true,archiveReason:' Original location archive é 😀 '}},p,signal());
     const {schemaVersion,draft,...reference}=first,lookup=await api.lookup(business,reference,p,signal()),replay=await api.save(business,first,p,signal()),list=await api.list(business,{leadId:first.leadId,afterId:null,includeArchived:true,pageSize:10},p,signal()),active=await api.list(business,{leadId:first.leadId,afterId:null,includeArchived:false,pageSize:10},p,signal()),history=await api.history(business,{leadId:first.leadId,leadAddressId:first.leadAddressId,afterVersion:'0',pageSize:5},p,signal());
     const reopened=await api.save(business,{...first,operationId:crypto.randomUUID(),expectedVersion:'2'},p,signal()),last=await api.history(business,{leadId:first.leadId,leadAddressId:first.leadAddressId,afterVersion:'1',pageSize:5},p,signal());
     return {saved,archived,lookup,replay,list,active,history,reopened,last,schemaVersion,draft};
    },{business,original,secondLocation,csrf:otherProof});
    addressReceipt=result.saved;assert.equal(result.saved.receipt.leadAddressVersion,'1');assert.equal(result.archived.receipt.leadAddressVersion,'2');assert.equal(result.reopened.receipt.leadAddressVersion,'3');assert.deepEqual(result.lookup,result.saved);assert.deepEqual(result.replay,result.saved);assert.equal(result.list.leadAddresses.length,2);assert.equal(result.active.leadAddresses.length,1);assert.deepEqual(result.history.history.map(e=>e.action),['create','archive']);assert.deepEqual(result.last.history.map(e=>e.action),['archive','reopen']);
    const retained=result.history.history[0].after;assert.equal(retained.line1,'');assert.equal(retained.city,null);assert.equal(retained.exact_location_text,original.exactLocationText);assert.equal(retained.instructions,original.instructions);assert.equal(retained.latitude,original.latitude);assert.equal(retained.longitude,'0.00000000000000000000');assert.equal(retained.verified_at,original.verifiedAt);assert.equal(result.last.leadAddress.archived_at,null);
    assert.deepEqual((await client.query('SELECT state,customer_id,version::text FROM crest.leads WHERE id=$1',[input.leadId])).rows[0],{state:'new',customer_id:null,version:'4'});
    for(const table of ['customers','addresses'])assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.'+table+' WHERE business_id=$1',[business])).rows[0].n,0);
   });
   await t.test('two-device address race and dropped response retain one winner, original receipt and no losing claim',async()=>{
    const original=addressDraft(epoch,input.leadId);assert.equal((await send(other,root+'address-save',original,otherProof)).status,200);
    const one={...original,operationId:randomUUID(),expectedVersion:'1',instructions:'Device one'},two={...one,operationId:randomUUID(),instructions:'Device two'};
    const race=await Promise.all([send(other,root+'address-save',one,otherProof),send(page,root+'address-save',two,proof)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);const loser=race[0].status===409?one:two;assert.equal(race.find(r=>r.status===409).body.reason,'version');assert.deepEqual((await send(other,root+'address-operation',{operationId:loser.operationId},otherProof)).body,{state:'absent'});
    const dropped={...original,operationId:randomUUID(),expectedVersion:'2',instructions:'Original interrupted location'},pattern='**/api/business/leads/address-save';let calls=0,status;
    const drop=async intercepted=>{calls++;try{status=(await intercepted.fetch()).status();}finally{await intercepted.abort('failed');}};await other.route(pattern,drop);try{await assert.rejects(send(other,root+'address-save',dropped,otherProof));}finally{await other.unroute(pattern,drop);}
    assert.equal(calls,1);assert.equal(status,200);const found=await send(other,root+'address-operation',{operationId:dropped.operationId},otherProof);assert.equal(found.status,200);assert.equal(found.body.receipt.leadAddressVersion,'3');assert.deepEqual((await send(other,root+'address-save',dropped,otherProof)).body,found.body);assert.equal((await send(other,root+'address-save',{...dropped,instructions:'Changed body'},otherProof)).body.reason,'operation');
   });
   await t.test('address transport rejects invented authority, malformed coordinates and missing/wrong parents without claims',async()=>{
    const original=addressDraft(epoch,input.leadId);assert.equal((await send(other,root+'address-save',original)).status,400);
    for(const patch of [{businessId:randomUUID()},{customerId:randomUUID()},{draft:{}},{quoteId:randomUUID()},{latitude:'90.00001',longitude:'0'},{latitude:'0',longitude:null},{latitude:1,longitude:1},{verifiedAt:'2026-02-30T00:00:00.000000Z'},{exactLocationText:'😀'.repeat(2001)}])assert.equal((await send(other,root+'address-save',{...original,...patch},otherProof)).status,400);
    const genuineOther=leadDraft(epoch,'Synthetic other address parent '+name);assert.equal((await send(other,root+'save',genuineOther,otherProof)).status,200);
    const noLead={...original,operationId:randomUUID(),leadId:randomUUID()},wrongParent={...addressOriginal,operationId:randomUUID(),leadId:genuineOther.leadId,expectedVersion:'3'};
    for(const command of [noLead,wrongParent]){const r=await send(other,root+'address-save',command,otherProof);assert.equal(r.status,409);assert.equal(r.body.reason,'parent');assert.deepEqual((await send(other,root+'address-operation',{operationId:command.operationId},otherProof)).body,{state:'absent'});}
    assert.deepEqual((await send(other,root+'address-list',{leadId:randomUUID(),afterId:null,includeArchived:true,pageSize:10},otherProof)).body,{state:'absent'});assert.deepEqual((await send(other,root+'address-history',{leadId:randomUUID(),leadAddressId:addressOriginal.leadAddressId,afterVersion:'0',pageSize:5},otherProof)).body,{state:'absent'});
    assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,original.operationId])).rows[0].n,0);
   });
   await t.test('paused address writes and changed epochs preserve original lookup and private retained history',async()=>{
    const wrong={...addressOriginal,operationId:randomUUID(),expectedVersion:'3',recoveryEpoch:randomUUID()},denied=await send(other,root+'address-save',wrong,otherProof);assert.equal(denied.status,409);assert.deepEqual(denied.body,{error:'RECOVERY_REVIEW_REQUIRED'});assert.deepEqual((await send(other,root+'address-operation',{operationId:wrong.operationId},otherProof)).body,{state:'absent'});
    await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[business]);
    try{const r=await send(other,root+'address-save',addressOriginal,otherProof);assert.equal(r.status,409);assert.deepEqual(r.body,{error:'RECOVERY_REVIEW_REQUIRED'});assert.deepEqual((await send(other,root+'address-operation',{operationId:addressOriginal.operationId},otherProof)).body,addressReceipt);assert.equal((await send(other,root+'address-history',{leadId:addressOriginal.leadId,leadAddressId:addressOriginal.leadAddressId,afterVersion:'0',pageSize:5},otherProof)).status,200);}finally{await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[business]);}
   });
   await t.test('lost committed responses resolve the exact original receipt and paused writes retain historical lookup',async()=>{
    const original=leadDraft(epoch,'Synthetic lost response '+name),pattern='**/api/business/leads/save';let calls=0,status;
    const drop=async intercepted=>{calls++;try{status=(await intercepted.fetch()).status();}finally{await intercepted.abort('failed');}};await page.route(pattern,drop);
    try{await assert.rejects(send(page,root+'save',original,proof));}finally{await page.unroute(pattern,drop);}assert.equal(calls,1);assert.equal(status,200);
    const receipt=await send(page,root+'operation',{operationId:original.operationId},proof);assert.equal(receipt.status,200);assert.equal(receipt.body.receipt.leadId,original.leadId);assert.equal(receipt.body.receipt.leadVersion,'1');assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,original.operationId])).rows[0].n,1);
    const statusOriginal={schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,leadId:original.leadId,expectedVersion:'1',fromState:'new',toState:'lost',reason:'Retained while paused'};const statusReceipt=await send(page,root+'state',statusOriginal,proof);assert.equal(statusReceipt.status,200);
    await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[business]);
    try{const context=await send(page,root+'context',{},proof);assert.equal(context.body.writeState,'paused');assert.equal(context.body.recoveryEpoch,null);assert.equal((await send(page,root+'save',original,proof)).status,409);assert.deepEqual((await send(page,root+'operation',{operationId:original.operationId},proof)).body,receipt.body);assert.equal((await send(page,root+'state',statusOriginal,proof)).status,409);assert.deepEqual((await send(page,root+'state-operation',{operationId:statusOriginal.operationId},proof)).body,statusReceipt.body);assert.equal((await send(page,root+'state-events',{leadId:original.leadId,afterVersion:'0',pageSize:20},proof)).status,200);}finally{await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[business]);}
   });
   await t.test('fresh session revocation denies lead and source reads without returning private labels',async()=>{
    const cookie=(await second.cookies()).find(c=>c.name===sessionName);await client.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE token_hash=$1',[createHash('sha256').update(cookie.value,'ascii').digest()]);
    for(const [route,body] of [[root+'address-list',{leadId:input.leadId,afterId:null,includeArchived:true,pageSize:10}],[root+'address-history',{leadId:input.leadId,leadAddressId:addressOriginal.leadAddressId,afterVersion:'0',pageSize:5}],[root+'address-operation',{operationId:addressOriginal.operationId}],[root+'address-save',addressOriginal],[root+'vehicle-list',{leadId:input.leadId,afterId:null,includeArchived:true,pageSize:10}],[root+'vehicle-history',{leadId:input.leadId,leadVehicleId:vehicleOriginal.leadVehicleId,afterVersion:'0',pageSize:5}],[root+'vehicle-operation',{operationId:vehicleOriginal.operationId}],[root+'state-events',{leadId:input.leadId,afterVersion:'0',pageSize:20}],[root+'state-operation',{operationId:randomUUID()}],[root+'history',{leadId:input.leadId,afterVersion:'0',pageSize:20}],[sources+'history',{leadSourceId:source.leadSourceId,afterVersion:'0',pageSize:20}]]){const denied=await send(other,route,body,otherProof);assert.notEqual(denied.status,200);assert(!JSON.stringify(denied.body).includes(input.label));assert(!JSON.stringify(denied.body).includes(source.label));assert(!JSON.stringify(denied.body).includes(vehicleOriginal.reportedLabel));assert(!JSON.stringify(denied.body).includes(addressOriginal.exactLocationText));}
   });
  }finally{await first?.close();await second?.close();await browser.close();}
 });
}
