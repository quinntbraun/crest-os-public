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
import AxeBuilder from '@axe-core/playwright';
import {URI,TOTP} from 'otpauth';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {startRealAuthService,authResult} from '../support/real-auth-service.mjs';

let sandbox,client,service,app,origin,fixture,actor,business,login,loginOwned=false;
const sessionName='__Host-crest_session';
before(async()=>{
  assert.equal(process.platform,'linux','the disposable container/HTTPS fixture requires Linux CI');
  process.env.NODE_ENV='production';
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
  app=await createCrestApplication({origin,environment:'test',tls:{key:await readFile(keyPath),cert:await readFile(certPath)},authentication:runtime.forServer(),business:{businessId:business},customers:true});
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',resolve);});
  await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[business]);
});
after(async()=>{try{await app?.close();}finally{try{await service?.close();}finally{if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();}}});

async function fill(page,{trusted=false,password=fixture.password}={}){
  await page.getByLabel('Email',{exact:true}).fill(fixture.email);await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByLabel('Authenticator code',{exact:true}).fill(fixture.totp.generate());if(trusted)await page.getByText('Personal device options',{exact:true}).click();await page.getByLabel('Trust this personal device').setChecked(trusted);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
}
async function exerciseAddressHttp(page,name){
  const send=(route,body={},proof=null)=>page.evaluate(async input=>{const response=await fetch('/api/'+input.route,{method:'POST',headers:{'content-type':'application/json',...(input.proof?{'x-crest-csrf':input.proof}:{})},body:JSON.stringify(input.body)}),text=await response.text();return {status:response.status,body:JSON.parse(text),bytes:new TextEncoder().encode(text).byteLength,cache:response.headers.get('cache-control'),binding:response.headers.get('x-crest-edit-binding')};},{route,body,proof});
  const proof=(await send('auth/session')).body.csrfToken,route='business/customers/addresses/',customerId=randomUUID(),customerContext=await send('business/customers/context',{},proof);
  const parent={schemaVersion:1,operationId:randomUUID(),customerId,recoveryEpoch:customerContext.body.recoveryEpoch,expectedVersion:'0',displayName:'Synthetic address parent '+name,phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null};
  assert.equal((await send('business/customers/save',parent,proof)).status,200);
  assert.equal((await send(route+'context',{customerId})).status,400);
  const context=await send(route+'context',{customerId},proof);assert.equal(context.status,200);assert.equal(context.body.customerId,customerId);assert.equal(context.body.writeState,'ready');assert.match(context.cache,/no-store/);assert.match(context.binding,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(context.binding,customerContext.binding);
  const input={schemaVersion:1,operationId:randomUUID(),customerId,addressId:randomUUID(),expectedVersion:'0',recoveryEpoch:context.body.recoveryEpoch,line1:'',line2:null,city:null,region:null,postalCode:'00123',country:null,exactLocationText:'Synthetic location %_ '+name,instructions:'Synthetic \\N =evidence é 😀',latitude:'39.1234567890123456789',longitude:'-86.000000000000000001',geocodeSource:null,geocodeAccuracy:null,verifiedAt:'2026-10-25T00:00:00.123456Z',archived:false,archiveReason:null};
  const created=await send(route+'save',input,proof);assert.equal(created.status,200);assert.equal(created.body.state,'committed');assert.equal(created.body.receipt.customerId,customerId);assert.equal(created.body.receipt.addressId,input.addressId);assert.equal(created.body.receipt.addressVersion,'1');assert.match(created.cache,/no-store/);
  for(let v=1;v<=3;v++){const result=await send(route+'save',{...input,operationId:randomUUID(),expectedVersion:String(v),instructions:('Retained address evidence '+v+' ').padEnd(2000,'x'),archived:v===2,archiveReason:v===2?'Synthetic archive':null},proof);assert.equal(result.status,200);assert.equal(result.body.receipt.addressVersion,String(v+1));}
  assert.deepEqual((await send(route+'save',input,proof)).body,created.body);assert.deepEqual((await send(route+'operation',{operationId:input.operationId},proof)).body,created.body);
  const history=await send(route+'history',{customerId,addressId:input.addressId,afterVersion:'0',pageSize:20},proof);assert.equal(history.status,200);assert(history.bytes>8192,'address history must use the private directory response cap');assert.equal(history.body.history.length,4);assert.equal(history.body.address.line1,'');assert.equal(history.body.address.line2,null);assert.equal(history.body.address.latitude,input.latitude);assert.equal(history.body.address.longitude,input.longitude);assert.equal(history.body.address.verified_at,input.verifiedAt);assert.equal(history.body.address.archived_at,null);assert.deepEqual(history.body.history.map(e=>e.action),['create','edit','archive','reopen']);
  const found=await send(route+'list',{customerId,search:'%_',afterId:null,includeArchived:false,pageSize:50},proof);assert.equal(found.status,200);assert.equal(found.body.addresses.length,1);assert.equal(found.body.addresses[0].id,input.addressId);
  const staleId=randomUUID(),stale=await send(route+'save',{...input,operationId:staleId,expectedVersion:'1'},proof);assert.equal(stale.status,409);assert.deepEqual(stale.body,{state:'conflict',reason:'version',currentVersion:'4'});assert.deepEqual((await send(route+'operation',{operationId:staleId},proof)).body,{state:'absent'});
  assert.equal((await send(route+'save',{...input,businessId:randomUUID()},proof)).status,400);
  assert.equal((await send(route+'save',{...input,operationId:randomUUID(),latitude:'90.0000000000000000001'},proof)).status,400);
  const otherParent=randomUUID(),wrongId=randomUUID(),wrong=await send(route+'save',{...input,operationId:wrongId,expectedVersion:'4',customerId:otherParent},proof);assert.equal(wrong.status,409);assert.deepEqual(wrong.body,{state:'conflict',reason:'version',currentVersion:'0'});assert.deepEqual((await send(route+'operation',{operationId:wrongId},proof)).body,{state:'absent'});
  const missingParentId=randomUUID(),missingParent=await send(route+'save',{...input,operationId:missingParentId,addressId:randomUUID(),expectedVersion:'0',customerId:otherParent},proof);assert.equal(missingParent.status,409);assert.deepEqual(missingParent.body,{state:'conflict',reason:'parent'});assert.deepEqual((await send(route+'operation',{operationId:missingParentId},proof)).body,{state:'absent'});
  assert.deepEqual((await send(route+'history',{customerId:otherParent,addressId:input.addressId,afterVersion:'0',pageSize:20},proof)).body,{state:'absent'});assert.deepEqual((await send(route+'list',{customerId:otherParent,search:'',afterId:null,includeArchived:true,pageSize:50},proof)).body.addresses,[]);
  await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[business]);
  try{const paused=await send(route+'context',{customerId},proof);assert.equal(paused.body.writeState,'paused');assert.equal(paused.body.recoveryEpoch,null);assert.equal((await send(route+'save',input,proof)).status,409);assert.deepEqual((await send(route+'operation',{operationId:input.operationId},proof)).body,created.body);assert.equal((await send(route+'history',{customerId,addressId:input.addressId,afterVersion:'0',pageSize:20},proof)).status,200);}
  finally{await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[business]);}
  assert.equal((await client.query("SELECT count(*)::int AS n FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='addresses' AND entity_id=$2",[business,input.addressId])).rows[0].n,4);
}
async function openAddresses(page,customerId){
 await page.bringToFront();await page.goto(origin+'/addresses?customer='+customerId);await expect(page.getByRole('button',{name:'Add address',exact:true})).toBeVisible();
}
async function findAddress(page,label,archived=false){
 await page.getByLabel('Address search',{exact:true}).fill(label);await page.getByLabel('Include archived addresses',{exact:true}).setChecked(archived);await page.getByRole('button',{name:'Search addresses',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Address search complete.');await page.getByRole('button',{name:label+(archived?' — archived':''),exact:true}).click();await expect(page.getByRole('form',{name:'Address editor',exact:true})).toBeVisible();
}
async function addressEditorFlow(page,other,name){
 const parentName='Synthetic address parent '+name,label='Synthetic address form '+name;
 await openCustomers(page);await findCustomer(page,parentName);await page.getByRole('link',{name:'Manage customer addresses',exact:true}).click();await expect(page.getByRole('button',{name:'Add address',exact:true})).toBeVisible();await expect(page.getByText(parentName,{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Add address',exact:true}).click();await page.getByLabel('Street / address line 1',{exact:true}).fill(label);await page.getByLabel('Postal code',{exact:true}).fill('00123');
 await page.getByText('Coordinates and verification',{exact:true}).click();await expect(page.getByRole('button',{name:'Save address',exact:true})).toBeEnabled();await page.getByLabel('Latitude',{exact:true}).fill('39.1234567890123456789');await expect(page.getByRole('button',{name:'Save address',exact:true})).toBeDisabled();await page.getByLabel('Longitude',{exact:true}).fill('-86.000000000000000001');await page.getByRole('button',{name:'Mark location verified now',exact:true}).click();await expect(page.getByLabel('Verified at UTC',{exact:true})).not.toHaveValue('');assert.match(await page.getByLabel('Verified at UTC',{exact:true}).inputValue(),/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/);await page.getByLabel('Verified at UTC',{exact:true}).fill('2026-10-25T00:00:00.123456Z');
 assert.equal((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.length,0,'accessible address editor');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'address editor fits mobile');assert((await page.getByLabel('Street / address line 1',{exact:true}).boundingBox()).height>=44);
 const firstRequest=page.waitForRequest(r=>r.url().endsWith('/api/business/customers/addresses/save'));await page.getByRole('button',{name:'Save address',exact:true}).click();const input=(await firstRequest).postDataJSON();await expect(page.getByRole('status')).toContainText('Address saved');await page.getByRole('button',{name:'Load current addresses',exact:true}).click();await findAddress(page,label);
 await expect(page.getByLabel('Address line 2',{exact:true})).toHaveValue('');await expect(page.getByLabel('City',{exact:true})).toHaveValue('');await expect(page.getByLabel('Postal code',{exact:true})).toHaveValue('00123');await page.getByText('Coordinates and verification',{exact:true}).click();await expect(page.getByLabel('Latitude',{exact:true})).toHaveValue(input.latitude);await expect(page.getByLabel('Longitude',{exact:true})).toHaveValue(input.longitude);await expect(page.getByLabel('Verified at UTC',{exact:true})).toHaveValue(input.verifiedAt);
 await page.getByLabel('Archive address',{exact:true}).check();await expect(page.getByRole('button',{name:'Save address',exact:true})).toBeDisabled();await page.getByLabel('Address archive reason',{exact:true}).fill('Synthetic retained location');await page.getByRole('button',{name:'Save address',exact:true}).click();await expect(page.getByRole('status')).toContainText('Address saved');await page.getByRole('button',{name:'Load current addresses',exact:true}).click();await findAddress(page,label,true);
 await expect(page.getByLabel('Address archive reason',{exact:true})).toHaveValue('Synthetic retained location');await page.getByLabel('Archive address',{exact:true}).uncheck();await page.getByRole('button',{name:'Save address',exact:true}).click();await expect(page.getByRole('status')).toContainText('Address saved');await page.getByRole('button',{name:'Load current addresses',exact:true}).click();await findAddress(page,label);await expect(page.getByLabel('Address history',{exact:true}).locator('details')).toHaveCount(3);
 await page.getByLabel('Street / address line 1',{exact:true}).fill(label+' stale draft');
 await other.evaluate(async input=>{const post=async(path,body,csrf)=>{const r=await fetch('/api/'+path,{method:'POST',headers:{'content-type':'application/json',...(csrf?{'x-crest-csrf':csrf}:{})},body:JSON.stringify(body)});if(r.status!==200)throw new Error('SYNTHETIC_ADDRESS_CONCURRENT_EDIT_FAILED');return r.json();};const p=await post('auth/session',{},null),c=await post('business/customers/addresses/context',{customerId:input.customerId},p.csrfToken);await post('business/customers/addresses/save',{...input,operationId:crypto.randomUUID(),expectedVersion:'3',recoveryEpoch:c.recoveryEpoch,instructions:'Concurrent synthetic address change'},p.csrfToken);},input);
 const staleRequest=page.waitForRequest(r=>r.url().endsWith('/api/business/customers/addresses/save'));await page.getByRole('button',{name:'Save address',exact:true}).click();const stale=(await staleRequest).postDataJSON();await expect(page.getByRole('status')).toContainText('record, address ID or customer link changed');await expect(page.getByRole('form',{name:'Address editor',exact:true})).toHaveCount(0);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,stale.operationId])).rows[0].n,0);
 await page.getByRole('button',{name:'Load current addresses',exact:true}).click();await findAddress(page,label);await expect(page.getByLabel('Location instructions',{exact:true})).toHaveValue('Concurrent synthetic address change');await expect(page.getByLabel('Street / address line 1',{exact:true})).toHaveValue(label);await expect(page.getByLabel('Address history',{exact:true}).locator('details')).toHaveCount(4);
 const result=await client.query("SELECT customer_id,line1,line2,city,postal_code,latitude::text,longitude::text,to_char(verified_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS verified,version::text FROM crest.addresses WHERE business_id=$1 AND id=$2",[business,input.addressId]);assert.equal(result.rows[0].customer_id,input.customerId);assert.equal(result.rows[0].line2,null);assert.equal(result.rows[0].city,null);assert.equal(result.rows[0].postal_code,'00123');assert.equal(result.rows[0].latitude,input.latitude);assert.equal(result.rows[0].longitude,input.longitude);assert.equal(result.rows[0].verified,input.verifiedAt);assert.equal(result.rows[0].version,'4');assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.address.pending-reference.v1')),null);
}
async function addressInterruptedFlow(page,name){
 const parent=(await client.query('SELECT id FROM crest.customers WHERE business_id=$1 AND display_name=$2',[business,'Synthetic address parent '+name])).rows[0].id,key='crest.address.pending-reference.v1',read=()=>page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)),key),save=()=>page.getByRole('button',{name:'Save address',exact:true}),load=()=>page.getByRole('button',{name:'Load current addresses',exact:true});
 async function draft(label){await page.getByRole('button',{name:'Add address',exact:true}).click();await page.getByLabel('Exact location',{exact:true}).fill(label);}
 await openAddresses(page,parent);await draft('Synthetic address lost response '+name);let sent,calls=0;
 const lost=async route=>{sent=route.request().postDataJSON();calls++;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');};
 await page.route('**/api/business/customers/addresses/save',lost);await save().click();await expect(page.getByRole('status')).toContainText('save could not be confirmed');await page.unroute('**/api/business/customers/addresses/save',lost);const original=await read();assert.equal(calls,1);assert.equal(original.reference.customerId,parent);assert.equal(original.reference.addressId,sent.addressId);assert.equal(original.reference.operationId,sent.operationId);assert(!JSON.stringify(original).includes(sent.exactLocationText));assert.deepEqual(Object.keys(original).sort(),['binding','businessId','reference','schemaVersion']);
 const contextRequest=page.waitForRequest(r=>r.url().endsWith('/api/business/customers/addresses/context'));await page.goto(origin+'/addresses?customer='+randomUUID());assert.equal((await contextRequest).postDataJSON().customerId,parent);await expect(page.getByRole('status')).toContainText('A pending address save was found');await expect(page.getByRole('button',{name:'Add address',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Check address save status',exact:true}).click();await expect(page.getByRole('status')).toContainText('original save is confirmed');assert.equal(await read(),null);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,original.reference.operationId])).rows[0].n,1);
 await openAddresses(page,parent);await draft('Synthetic address explicit retry '+name);const notSent=route=>route.abort('failed');await page.route('**/api/business/customers/addresses/save',notSent);await save().click();await expect(page.getByRole('status')).toContainText('save could not be confirmed');await page.unroute('**/api/business/customers/addresses/save',notSent);const retry=await read();await page.getByRole('button',{name:'Check address save status',exact:true}).click();await expect(page.getByRole('status')).toContainText('does not prove an earlier request failed');
 const retriedRequest=page.waitForRequest(r=>r.url().endsWith('/api/business/customers/addresses/save'));await page.getByRole('button',{name:'Retry original address change',exact:true}).click();const retried=(await retriedRequest).postDataJSON();for(const field of ['operationId','customerId','addressId','expectedVersion','recoveryEpoch'])assert.equal(retried[field],retry.reference[field]);await expect(page.getByRole('status')).toContainText('Address saved');assert.equal(await read(),null);
 await load().click();await draft('Synthetic address lost draft '+name);await page.route('**/api/business/customers/addresses/save',notSent);await save().click();await expect(page.getByRole('status')).toContainText('save could not be confirmed');await page.unroute('**/api/business/customers/addresses/save',notSent);const lostDraft=await read();await page.reload();await expect(page.getByRole('status')).toContainText('A pending address save was found');await page.getByRole('button',{name:'Check address save status',exact:true}).click();await expect(page.getByRole('status')).toContainText('original draft is no longer in memory');await expect(page.getByRole('button',{name:'Retry original address change',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Add address',exact:true})).toHaveCount(0);assert.deepEqual(await read(),lostDraft);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,lostDraft.reference.operationId])).rows[0].n,0);
}
async function openCustomers(page){await page.bringToFront();await page.goto(origin+'/customers');await expect(page.getByRole('button',{name:'Add customer',exact:true})).toBeVisible();}
async function findCustomer(page,name,archived=false){await page.getByLabel('Customer search',{exact:true}).fill(name);await page.getByLabel('Include archived customers',{exact:true}).setChecked(archived);await page.getByRole('button',{name:'Search customers',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Customer search complete.');await page.getByRole('button',{name:name+(archived?' — archived':''),exact:true}).click();await expect(page.getByRole('form',{name:'Customer editor',exact:true})).toBeVisible();}

// A separate disposable cluster/runtime isolates the address acceptance request
// budget from unrelated customer/settings scenarios. No admission row/limit,
// provider authority or runtime protection is reset or bypassed.
for(const [name,engine,viewport] of [['chromium',chromium,{width:1280,height:900}],['webkit',webkit,{width:360,height:800}]]){
 test('genuine private address workflow '+name,async t=>{
  const browser=await engine.launch();let first,second;
  try{
   first=await browser.newContext({ignoreHTTPSErrors:true,viewport});second=await browser.newContext({ignoreHTTPSErrors:true,viewport});const page=await first.newPage(),other=await second.newPage();
   await t.test('two independent devices use genuine owner MFA and private durable sessions',async()=>{
    await page.goto(origin+'/sign-in');await expect(page.getByRole('status')).toHaveText('Sign in to continue.');await fill(page);await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
    await other.goto(origin+'/sign-in');await expect(other.getByRole('status')).toHaveText('Sign in to continue.');await fill(other,{trusted:true});await expect(other.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
    const a=(await first.cookies()).find(c=>c.name===sessionName),b=(await second.cookies()).find(c=>c.name===sessionName);assert(a?.httpOnly&&a.secure&&b?.httpOnly&&b.secure&&a.value!==b.value);
    for(const [cookie,trusted] of [[a,false],[b,true]]){const r=(await client.query('SELECT s.trusted,s.revoked_at,s.expires_at,p.id AS provider_id FROM crest_private.app_sessions s JOIN auth.sessions p ON p.id=s.provider_session_id WHERE s.token_hash=$1',[createHash('sha256').update(cookie.value,'ascii').digest()])).rows[0];assert(r&&r.trusted===trusted&&r.revoked_at===null&&r.expires_at.getTime()>Date.now()&&r.provider_id);}
   });
   await t.test('private HTTP preserves exact location, parent, receipt, audit and recovery fencing',async()=>{await exerciseAddressHttp(page,name);});
   await t.test('mobile editor preserves exact location and archive history through concurrent edits',async()=>{await addressEditorFlow(other,page,name);});
   await t.test('interrupted saves retain original parent and receipt, permit unchanged retry and refuse lost drafts',async()=>{await addressInterruptedFlow(other,name);});
  }finally{await first?.close();await second?.close();await browser.close();}
 });
}
