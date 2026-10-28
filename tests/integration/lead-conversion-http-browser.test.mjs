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
import {leadConversionToWire} from '../../src/customer/lead-conversion-command-contract.ts';
import {URI,TOTP} from 'otpauth';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {startRealAuthService,authResult} from '../support/real-auth-service.mjs';

let sandbox,client,service,app,origin,fixture,actor,business,login,loginOwned=false,browserClient='';
const sessionName='__Host-crest_session';
before(async()=>{
  assert.equal(process.platform,'linux','the disposable container/HTTPS fixture requires Linux CI');
  process.env.NODE_ENV='production';
  for(const [input,name] of [['src/client/leads.ts','crestLeadFixture'],['src/client/lead-conversions.ts','crestConversionFixture']]){
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
  app=await createCrestApplication({origin,environment:'test',tls:{key:await readFile(keyPath),cert:await readFile(certPath)},authentication:runtime.forServer(),business:{businessId:business},leads:true,leadConversions:true,customers:true,vehicles:true,operationResolution:true});
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',resolve);});
  await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[business]);
});
after(async()=>{try{await app?.close();}finally{try{await service?.close();}finally{if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();}}});

async function fill(page,{trusted=false,password=fixture.password}={}){
  await page.getByLabel('Email',{exact:true}).fill(fixture.email);await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByLabel('Authenticator code',{exact:true}).fill(fixture.totp.generate());if(trusted)await page.getByText('Personal device options',{exact:true}).click();await page.getByLabel('Trust this personal device').setChecked(trusted);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
}
async function send(page,route,body={},proof=null){
  return page.evaluate(async input=>{
    const response=await fetch('/api/'+input.route,{method:'POST',headers:{'content-type':'application/json',...(input.proof?{'x-crest-csrf':input.proof}:{})},body:JSON.stringify(input.body)}),text=await response.text();
    return {status:response.status,body:JSON.parse(text),bytes:new TextEncoder().encode(text).byteLength,cache:response.headers.get('cache-control'),binding:response.headers.get('x-crest-edit-binding')};
  },{route,body,proof});
}
const root='business/leads/';
const customerDraft=()=>({displayName:'Explicit synthetic converted customer é 😀',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:'Explicit customer notes',customerSince:null,archived:false,archiveReason:null});
const directoryVehicle=()=>({label:'Explicit synthetic directory vehicle',year:-42,make:null,model:null,color:null,vin:' Raw invalid VIN / é ',plate:null,kind:'customer_vehicle',notes:null,archived:false,archiveReason:null});
const locationDraft=()=>({line1:null,line2:null,city:null,region:null,postalCode:null,country:null,exactLocationText:'  Behind barn é 😀\nOriginal  ',instructions:'Original gate',latitude:'89.999999999999999999999',longitude:'-179.000000000000000000001',geocodeSource:'Owner entered',geocodeAccuracy:null,verifiedAt:'2026-10-25T01:02:03.123456Z',archived:false,archiveReason:null});
const newTarget=draft=>({kind:'new',id:randomUUID(),draft});
const command=(epoch,leadId,customer=newTarget(customerDraft()),expectedLeadVersion='1')=>({schemaVersion:1,businessId:business,operationId:randomUUID(),recoveryEpoch:epoch,conversionId:randomUUID(),leadId,expectedLeadVersion,customer,vehicles:[],addresses:[]});
const reference=c=>({operationId:c.operationId,recoveryEpoch:c.recoveryEpoch,conversionId:c.conversionId,leadId:c.leadId,expectedLeadVersion:c.expectedLeadVersion,customerId:c.customer.id});
async function convertClient(page,c,proof){const {businessId,...input}=c;return page.evaluate(async({businessId,input,proof})=>globalThis.crestConversionFixture.leadConversions.convert(businessId,input,proof,new AbortController().signal),{businessId,input,proof});}
async function lookupClient(page,c,proof){return page.evaluate(async({business,ref,proof})=>globalThis.crestConversionFixture.leadConversions.lookup(business,ref,proof,new AbortController().signal),{business,ref:reference(c),proof});}
async function newLead(page,epoch,label,proof){
 const input={schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,leadId:randomUUID(),expectedVersion:'0',label,customerId:null,sourceId:null,referralText:'Original referral é 😀',phone:null,email:null,requestedScope:'Reported only; never accepted',availability:null,estimatedCents:'9007199254740993',followUpAt:'2026-10-25T01:02:03.123456Z',notes:'é'.repeat(4000)};
 assert.equal((await send(page,root+'save',input,proof.csrfToken)).status,200);return input;
}
for(const [name,engine,viewport] of [['chromium',chromium,{width:1280,height:900}],['webkit',webkit,{width:360,height:800}]]){
 test('genuine private atomic lead conversion HTTP '+name,{timeout:180000},async t=>{
  const browser=await engine.launch();let first,second,proof,otherProof,epoch,original,receipt,intake;
  try{
   first=await browser.newContext({ignoreHTTPSErrors:true,viewport});second=await browser.newContext({ignoreHTTPSErrors:true,viewport});const page=await first.newPage(),other=await second.newPage();
   await t.test('independent genuine MFA sessions install the actual nonce-bound conversion and lead clients',async()=>{
    for(const p of [page,other]){await p.goto(origin+'/sign-in');await fill(p);await expect(p.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();await p.evaluate(code=>{const nonce=document.querySelector('script[nonce]')?.nonce;if(!nonce)throw new Error('SYNTHETIC_NONCE_REQUIRED');const script=document.createElement('script');script.nonce=nonce;script.textContent=code;document.head.append(script);},browserClient);assert.deepEqual(await p.evaluate(()=>[typeof globalThis.crestConversionFixture?.leadConversions?.convert,typeof globalThis.crestLeadFixture?.leads?.save]),['function','function']);}
    const a=(await first.cookies()).find(c=>c.name===sessionName),b=(await second.cookies()).find(c=>c.name===sessionName);assert(a?.httpOnly&&a.secure&&b?.httpOnly&&b.secure&&a.value!==b.value);
    for(const cookie of [a,b])assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.app_sessions s JOIN auth.sessions p ON p.id=s.provider_session_id WHERE s.token_hash=$1 AND s.actor_id=$2 AND s.revoked_at IS NULL',[createHash('sha256').update(cookie.value,'ascii').digest(),actor])).rows[0].n,1);
    proof=(await send(page,'auth/session')).body;otherProof=(await send(other,'auth/session')).body;const context=await send(page,root+'context',{},proof.csrfToken);assert.equal(context.status,200);epoch=context.body.recoveryEpoch;
   });
   await t.test('one compiled conversion creates two vehicles and two locations while retaining Lost intake and exact original evidence',async()=>{
    intake=await newLead(page,epoch,'Synthetic complete conversion '+name,proof);
    assert.equal((await send(page,root+'state',{schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,leadId:intake.leadId,expectedVersion:'1',fromState:'new',toState:'lost',reason:'Original retained Lost reason'},proof.csrfToken)).status,200);
    original=command(epoch,intake.leadId,newTarget(customerDraft()),'2');
    for(let i=0;i<2;i++){
     const id=randomUUID(),vehicle={schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,leadId:intake.leadId,leadVehicleId:id,expectedVersion:'0',vehicleId:null,reportedLabel:'Original reported '+name+' '+i,reportedYear:-42,reportedMake:null,reportedModel:null,reportedColor:null,reportedVin:' Raw invalid VIN / é ',reportedPlate:null,reportedNotes:'Original report',requestedServicesText:'Reported only',conditionNotes:'Original condition',archived:false,archiveReason:null};
     assert.equal((await send(page,root+'vehicle-save',vehicle,proof.csrfToken)).status,200);original.vehicles.push({linkId:randomUUID(),leadVehicleId:id,expectedLeadVehicleVersion:'1',target:newTarget(directoryVehicle())});
     const location=randomUUID();assert.equal((await send(page,root+'address-save',{schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,leadId:intake.leadId,leadAddressId:location,expectedVersion:'0',...locationDraft()},proof.csrfToken)).status,200);original.addresses.push({linkId:randomUUID(),leadAddressId:location,expectedLeadAddressVersion:'1',target:newTarget(locationDraft())});
    }
    receipt=await convertClient(page,original,proof);assert.equal(receipt.state,'committed');assert.equal(receipt.receipt.leadVersion,'3');assert.deepEqual(await convertClient(other,original,otherProof),receipt);
    const result=await page.evaluate(async({business,leadId,conversionId,proof})=>{const api=globalThis.crestConversionFixture.leadConversions,signal=()=>new AbortController().signal,parent=await api.read(business,leadId,proof,signal()),links=[];let afterId=null,more=true;while(more){const p=await api.links(business,{leadId,conversionId,afterId,pageSize:1},proof,signal());links.push(...p.links);more=p.hasMore;afterId=p.links.at(-1)?.id??afterId;if(links.length>4)throw new Error('SYNTHETIC_MAPPING_PAGE_LIMIT');}return {parent,links};},{business,leadId:original.leadId,conversionId:original.conversionId,proof});
    assert.equal(result.links.length,4);assert.deepEqual(result.parent.conversion.request,original);assert.equal(result.parent.conversion.lead_version,'3');
    const lead=(await client.query('SELECT state,lost_reason,notes,estimated_cents::text,to_char(follow_up_at AT TIME ZONE $2,\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS follow_up FROM crest.leads WHERE id=$1',[intake.leadId,'UTC'])).rows[0];assert.equal(lead.state,'lost');assert.equal(lead.lost_reason,'Original retained Lost reason');assert.equal(lead.notes,intake.notes);assert.equal(lead.estimated_cents,intake.estimatedCents);assert.equal(lead.follow_up,intake.followUpAt);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.customer_vehicles WHERE business_id=$1',[business])).rows[0].n,0);assert.equal((await client.query('SELECT latitude::text AS lat,longitude::text AS lon FROM crest.addresses WHERE id=$1',[original.addresses[0].target.id])).rows[0].lat,locationDraft().latitude);
   });
   await t.test('stale destination and competing devices leave only one complete conversion and no losing claims',async()=>{
    const lead=await newLead(page,epoch,'Synthetic conversion race '+name,proof),existing={kind:'existing',id:original.customer.id,expectedVersion:'1'},stale=command(epoch,lead.leadId,{...existing,expectedVersion:'2'});
    assert.deepEqual(await convertClient(page,stale,proof),{state:'conflict',reason:'destination'});
    const a=command(epoch,lead.leadId,existing),b=command(epoch,lead.leadId,existing),results=await Promise.all([convertClient(page,a,proof),convertClient(other,b,otherProof)]);assert.equal(results.filter(r=>r.state==='committed').length,1);assert.equal(results.filter(r=>r.state==='conflict').length,1);
    const loser=results[0].state==='committed'?b:a;for(const c of [stale,loser])assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,c.operationId])).rows[0].n,0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.lead_conversions WHERE business_id=$1 AND lead_id=$2',[business,lead.leadId])).rows[0].n,1);
   });
   await t.test('a dropped committed response resolves only its original receipt and exact manual retry',async()=>{
    const lead=await newLead(page,epoch,'Synthetic dropped conversion '+name,proof),c=command(epoch,lead.leadId),pattern='**/api/business/leads/convert';let calls=0;
    const drop=async route=>{calls++;assert.equal((await route.fetch()).status(),200);await route.abort('failed');};await page.route(pattern,drop);
    try{const {businessId,...input}=c;const outcome=await page.evaluate(async({businessId,input,proof})=>{try{await globalThis.crestConversionFixture.leadConversions.convert(businessId,input,proof,new AbortController().signal);return 'incorrect-success';}catch(e){return e.kind;}},{businessId,input,proof});assert.equal(outcome,'unknown');}finally{await page.unroute(pattern,drop);}
    assert.equal(calls,1);const committed=await lookupClient(page,c,proof);assert.equal(committed.state,'committed');assert.deepEqual(await convertClient(page,c,proof),committed);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,c.operationId])).rows[0].n,1);
    assert.deepEqual(await convertClient(page,{...c,customer:newTarget(customerDraft())},proof),{state:'conflict',reason:'operation'});
   });
   await t.test('converted customer relink is a definite rollback conflict while other intake remains editable',async()=>{
    const operationId=randomUUID(),body={...intake,operationId,expectedVersion:'3',customerId:null},r=await send(page,root+'save',body,proof.csrfToken);assert.equal(r.status,409);assert.deepEqual(r.body,{state:'conflict',reason:'converted'});
    const {schemaVersion,recoveryEpoch,leadId,expectedVersion,label,customerId,sourceId,referralText,phone,email,requestedScope,availability,estimatedCents,followUpAt,notes}=body;
    const clientResult=await page.evaluate(async({business,proof,input})=>globalThis.crestLeadFixture.leads.save(business,input,proof,new AbortController().signal),{business,proof,input:{schemaVersion,operationId:randomUUID(),recoveryEpoch,leadId,expectedVersion,draft:{label,customerId,sourceId,referralText,phone,email,requestedScope,availability,estimatedCents,followUpAt,notes}}});assert.deepEqual(clientResult,{state:'conflict',reason:'converted'});
    assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,operationId])).rows[0].n,0);
    assert.equal((await send(page,root+'save',{...body,operationId:randomUUID(),customerId:original.customer.id,notes:'Explicit edited intake after conversion'},proof.csrfToken)).status,200);assert.deepEqual(await lookupClient(page,original,proof),receipt);assert.deepEqual(await convertClient(page,original,proof),receipt);
   });
   await t.test('paused and rotated recovery authority retain original lookup and immutable reads while stale commands stay blocked',async()=>{
    await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,active_epoch=$2,version=version+1 WHERE business_id=$1',[business,randomUUID()]);
    try{
     assert.deepEqual(await lookupClient(page,original,proof),receipt);
     const outcome=await page.evaluate(async({business,c,proof})=>{const {businessId:ignored,...input}=c;void ignored;const api=globalThis.crestConversionFixture.leadConversions,parent=await api.read(business,c.leadId,proof,new AbortController().signal);try{await api.convert(business,input,proof,new AbortController().signal);return {parent,kind:'incorrect-success'};}catch(e){return {parent,kind:e.kind};}},{business,c:original,proof});assert.equal(outcome.kind,'recovery');assert.equal(outcome.parent.conversion.id,original.conversionId);
    }finally{await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[business]);}
   });
   await t.test('owner review resolves a dropped retirement response, paused historical lookup and exact local acknowledgment',async()=>{
    proof=(await send(page,'auth/session')).body;const context=await send(page,'business/customers/context',{},proof.csrfToken);assert.equal(context.status,200);
    const ref={operationId:randomUUID(),recoveryEpoch:context.body.recoveryEpoch,customerId:randomUUID(),expectedVersion:'0'},key='crest.customer.pending-reference.v1';
    const pending={schemaVersion:1,businessId:business,binding:context.binding,reference:ref};await page.evaluate(({key,pending})=>sessionStorage.setItem(key,JSON.stringify(pending)),{key,pending});
    await page.goto(origin+'/save-review');await expect(page.getByLabel('Reason for retiring this original save',{exact:true})).toBeVisible();await page.getByLabel('Reason for retiring this original save',{exact:true}).fill('Owner reviewed lost synthetic draft é 😀\nKeep exact original reference.');
    await page.getByRole('button',{name:'Review retirement',exact:true}).click();await expect(page.getByRole('heading',{name:'Confirm retirement',exact:true})).toBeVisible();
    let calls=0;const pattern='**/api/business/original-operations/retire',drop=async route=>{calls++;assert.equal((await route.fetch()).status(),200);await route.abort('failed');};await page.route(pattern,drop);
    try{await page.getByRole('button',{name:'Confirm retirement of this original save',exact:true}).click();await expect(page.getByRole('status')).toContainText('The outcome could not be verified');}finally{await page.unroute(pattern,drop);}
    assert.equal(calls,1);assert.deepEqual(JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),key)),pending);assert.equal((await client.query('SELECT command_type FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,ref.operationId])).rows[0].command_type,'operation.retire');assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.customers WHERE id=$1',[ref.customerId])).rows[0].n,0);
    await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,active_epoch=$2,version=version+1 WHERE business_id=$1',[business,randomUUID()]);
    try{
     await page.getByRole('button',{name:'Check original resolution',exact:true}).click();await expect(page.getByRole('status')).toContainText('The original save is retired');assert.deepEqual(JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),key)),pending);
     await page.getByRole('button',{name:'Acknowledge retirement and release local reference',exact:true}).click();await expect(page.getByRole('status')).toContainText('The retired save reference is released');assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);
    }finally{await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[business]);}
    proof=(await send(page,'auth/session')).body;
   });
   await t.test('owner review of a recorded conversion verifies the actual typed original receipt before release',async()=>{
    proof=(await send(page,'auth/session')).body;const context=await send(page,'business/customers/context',{},proof.csrfToken);assert.equal(context.status,200);
    const key='crest.lead-conversion.pending-reference.v1',pending={schemaVersion:1,businessId:business,binding:context.binding,reference:reference(original)};await page.evaluate(({key,pending})=>sessionStorage.setItem(key,JSON.stringify(pending)),{key,pending});
    await page.goto(origin+'/save-review');await page.getByLabel('Interrupted save type',{exact:true}).selectOption('crm.lead.convert');await expect(page.getByLabel('Reason for retiring this original save',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Check original resolution',exact:true}).click();await expect(page.getByRole('status')).toContainText('The original request was recorded');assert.deepEqual(JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),key)),pending);
    const verified=page.waitForResponse(response=>response.url()===origin+'/api/business/leads/conversion-operation'&&response.request().method()==='POST');
    await page.getByRole('button',{name:'Verify original save receipt',exact:true}).click();assert.equal((await verified).status(),200);await expect(page.getByRole('status')).toContainText('The original save receipt is verified');assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);
    assert.equal((await client.query('SELECT command_type FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,original.operationId])).rows[0].command_type,'crm.lead.convert');proof=(await send(page,'auth/session')).body;
   });
   await t.test('changed recovery authority blocks a reviewed retirement until fresh owner review without rebasing the original',async()=>{
    proof=(await send(page,'auth/session')).body;const context=await send(page,'business/customers/context',{},proof.csrfToken);assert.equal(context.status,200);
    const key='crest.customer.pending-reference.v1',ref={operationId:randomUUID(),recoveryEpoch:context.body.recoveryEpoch,customerId:randomUUID(),expectedVersion:'0'},pending={schemaVersion:1,businessId:business,binding:context.binding,reference:ref};
    await page.evaluate(({key,pending})=>sessionStorage.setItem(key,JSON.stringify(pending)),{key,pending});await page.goto(origin+'/save-review');
    await page.getByLabel('Reason for retiring this original save',{exact:true}).fill('Private discarded review reason');await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
    await expect(page.getByRole('status')).toContainText('Private review details were cleared');await expect(page.getByLabel('Reason for retiring this original save',{exact:true})).toHaveCount(0);assert.deepEqual(JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),key)),pending);
    await page.getByRole('button',{name:'Load original save review',exact:true}).click();await expect(page.getByLabel('Reason for retiring this original save',{exact:true})).toHaveValue('');await page.getByLabel('Reason for retiring this original save',{exact:true}).fill('Reason before recovery change');await page.getByRole('button',{name:'Review retirement',exact:true}).click();await expect(page.getByRole('heading',{name:'Confirm retirement',exact:true})).toBeVisible();
    await client.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$2,version=version+1 WHERE business_id=$1',[business,randomUUID()]);
    let requests=0;const count=request=>{if(request.url()===origin+'/api/business/original-operations/retire')requests++;};page.on('request',count);
    try{await page.getByRole('button',{name:'Confirm retirement of this original save',exact:true}).click();await expect(page.getByRole('status')).toContainText('Access or recovery changed after review');assert.equal(requests,0);}finally{page.off('request',count);}
    assert.deepEqual(JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),key)),pending);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,ref.operationId])).rows[0].n,0);
    await page.getByRole('button',{name:'Load original save review',exact:true}).click();await expect(page.getByLabel('Reason for retiring this original save',{exact:true})).toHaveValue('');
    await page.getByLabel('Reason for retiring this original save',{exact:true}).fill('Fresh owner review of the same original');await page.getByRole('button',{name:'Review retirement',exact:true}).click();await page.getByRole('button',{name:'Confirm retirement of this original save',exact:true}).click();await expect(page.getByRole('status')).toContainText('The original save is retired');
    assert.deepEqual(JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),key)).reference,ref);await page.getByRole('button',{name:'Acknowledge retirement and release local reference',exact:true}).click();await expect(page.getByRole('status')).toContainText('The retired save reference is released');
    await page.getByRole('link',{name:'Load current customers',exact:true}).click();await expect(page.getByRole('button',{name:'Add customer',exact:true})).toBeVisible();proof=(await send(page,'auth/session')).body;
   });
   await t.test('fabricated authority and revoked sessions return no conversion or financial/customer evidence',async()=>{
    const invalid={...leadConversionToWire(original),businessId:randomUUID()};assert.equal((await send(page,root+'convert',invalid,proof.csrfToken)).status,400);
    const cookie=(await second.cookies()).find(c=>c.name===sessionName);await client.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE token_hash=$1',[createHash('sha256').update(cookie.value,'ascii').digest()]);
    for(const [route,body]of [['conversion',{leadId:original.leadId}],['conversion-operation',{operationId:original.operationId}],['conversion-links',{leadId:original.leadId,conversionId:original.conversionId,afterId:null,pageSize:50}],['convert',leadConversionToWire(original)]]){
     const denied=await send(other,root+route,body,otherProof.csrfToken);assert.notEqual(denied.status,200);assert.match(denied.cache,/no-store/);assert(!JSON.stringify(denied.body).includes(original.customer.draft.displayName));assert(!JSON.stringify(denied.body).includes(original.conversionId));
    }
   });
  }finally{await first?.close();await second?.close();await browser.close();}
 });
}
