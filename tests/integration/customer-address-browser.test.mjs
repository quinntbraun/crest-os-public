import {reviewRecordRecovery} from '../support/record-recovery-layout.mjs';
// Genuine HTTPS + compiled Next/Node + real disposable Auth/PG. No traces,
// HAR, video, storageState exports or credential-bearing failure artifacts.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {before,after,test} from 'node:test';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'node:net';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {URI,TOTP} from 'otpauth';
import {browserTestTls} from '../support/browser-test-tls.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {startRealAuthService,authResult} from '../support/real-auth-service.mjs';
import {gateEditorFocusFrames,releaseEditorFocusFrames} from '../support/editor-focus-frame.mjs';

let sandbox,client,service,app,origin,fixture,actor,business,login,loginOwned=false;
const sessionName='__Host-crest_session';
before(async()=>{
  assert(['linux','win32'].includes(process.platform),'supported disposable HTTPS/Auth fixture required');
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
  const nextCodeAt=(Math.floor(Date.now()/(totp.period*1000))+1)*totp.period*1000;
  authResult(await sdk.mfa.challengeAndVerify({factorId:factor.id,code:totp.generate()}),'browser_enrollment_verify');fixture={email,password:secret,totp,nextCodeAt};
  const bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  await client.query('BEGIN');try{
    actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic browser owner',$1,$2,$3,$3,'manual') RETURNING id",[service.issuer,user.id,bootstrap])).rows[0].id;
    business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic browser business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;
    await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
    await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,actor]);await client.query('COMMIT');
  }catch{await client.query('ROLLBACK');throw new Error('SYNTHETIC_BROWSER_OWNER_FAILED');}
  const tls=await browserTestTls();
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));origin=`https://127.0.0.1:${port}`;
  // Normal Node resolution: react-server is only a build-time marker condition.
  const {createCrestApplication,createAuthenticationRuntime}=await import('../../.local/server/application.mjs');
  const runtime=await createAuthenticationRuntime({database:{connectionString:database.toString(),environment:'test'},provider:{issuer:service.issuer,publicKey:service.publicKey,environment:'test'},
    owner:{subject:user.id,factorId:factor.id},loginKey:randomBytes(32),ingress:{kind:'direct'},activeKeyId:'synthetic',keys:[{id:'synthetic',key:randomBytes(32)}]});
  assert.throws(()=>JSON.stringify(runtime),/AUTHENTICATION_RUNTIME_PRIVATE/);
  app=await createCrestApplication({origin,environment:'test',tls,authentication:runtime.forServer(),business:{businessId:business},customers:true});
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',resolve);});
  await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[business]);
});
after(async()=>{try{await app?.close();}finally{try{await service?.close();}finally{if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();}}});

async function fill(page,{trusted=false,password=fixture.password}={}){
  await page.getByLabel('Email',{exact:true}).fill(fixture.email);await page.getByLabel('Password',{exact:true}).fill(password);
  const period=fixture.totp.period*1000,now=Date.now(),remaining=period-now%period;
  const readyAt=Math.max(fixture.nextCodeAt,remaining<6000?now+remaining:0);
  if(readyAt>now)await delay(readyAt-now+250);
  fixture.nextCodeAt=(Math.floor(Date.now()/period)+1)*period;
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
 await page.getByLabel('Address search',{exact:true}).fill(label);await page.getByLabel('Include archived addresses',{exact:true}).setChecked(archived);await page.getByRole('button',{name:'Search addresses',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Address search complete.');await page.getByRole('button',{name:label+(archived?' — archived':''),exact:true}).click();
 await expect(page.getByRole('heading',{name:label,exact:true})).toBeFocused();
 await expect(page.getByRole('form',{name:'Address editor',exact:true})).toHaveCount(0);
}
const addressStatus=page=>page.getByRole('status',{name:'Address editor status',exact:true});
const reviewAddress=page=>page.getByRole('button',{name:'Review address',exact:true});
const editAddress=page=>page.getByRole('button',{name:'Edit address',exact:true});
const saveAddress=page=>page.getByRole('button',{name:'Save address',exact:true});
async function confirmAddress(page){await reviewAddress(page).click();await saveAddress(page).click();}
async function addressEditorFlow(page,other,name){
 const parentName='Synthetic address parent '+name,label='Synthetic address form '+name,viewport=page.viewportSize();
 await page.bringToFront();
 await page.goto(origin+'/addresses');
 await expect(addressStatus(page)).toHaveText('Choose a customer to view or manage their saved addresses.');
 const customers=page.locator('main').getByRole('link',{name:'Open Customers',exact:true});
 await expect(customers).toHaveAttribute('href','/customers');
 await expect(page.getByRole('button',{name:'Load current addresses',exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 await expect(customers).toBeVisible();
 const bounds=await customers.boundingBox();
 assert(bounds&&bounds.height>=44);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
 await mkdir('.local/review',{recursive:true});
 await page.screenshot({path:'.local/review/addresses-pick-customer-'+name+'.png'});
 await customers.press('Enter');
 await expect(page).toHaveURL(origin+'/customers');
 await findCustomer(page,parentName);await page.getByRole('navigation',{name:'Customer record sections',exact:true}).getByRole('button',{name:'Vehicles',exact:true}).click();await page.getByRole('link',{name:'Manage customer addresses',exact:true}).click();await expect(page.getByRole('button',{name:'Add address',exact:true})).toBeVisible();await expect(page.getByText(parentName,{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Add address',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'New address',exact:true})).toBeFocused();await page.getByLabel('Street / address line 1',{exact:true}).fill(label);await page.getByLabel('Postal code',{exact:true}).fill('00123');
 await page.getByText('Coordinates and verification',{exact:true}).click();await expect(reviewAddress(page)).toBeEnabled();await page.getByLabel('Latitude',{exact:true}).fill('39.1234567890123456789');await expect(reviewAddress(page)).toBeDisabled();await page.getByLabel('Longitude',{exact:true}).fill('-86.000000000000000001');await page.getByRole('button',{name:'Mark location verified now',exact:true}).click();await expect(page.getByLabel('Verified at UTC',{exact:true})).not.toHaveValue('');assert.match(await page.getByLabel('Verified at UTC',{exact:true}).inputValue(),/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/);await page.getByLabel('Verified at UTC',{exact:true}).fill('2026-10-25T00:00:00.123456Z');
 assert.equal((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.length,0,'accessible address editor');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'address editor fits mobile');assert((await page.getByLabel('Street / address line 1',{exact:true}).boundingBox()).height>=44);
 const firstRequest=page.waitForRequest(r=>r.url().endsWith('/api/business/customers/addresses/save'));await reviewAddress(page).press('Enter');
 const review=page.getByRole('region',{name:'Address change review',exact:true});
 await expect(review.getByRole('heading')).toBeFocused();
 await expect(review).toContainText('39.1234567890123456789');
 await expect(review).toContainText('00123');
 assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.addresses WHERE business_id=$1 AND line1=$2',[business,label])).rows[0].n,0);
 await review.getByRole('button',{name:'Back to address details',exact:true}).press('Enter');
 await expect(reviewAddress(page)).toBeFocused();
 await expect(page.getByLabel('Latitude',{exact:true})).toHaveValue('39.1234567890123456789');
 await confirmAddress(page);const input=(await firstRequest).postDataJSON();await expect(page.getByRole('status')).toContainText('Address saved');await page.getByRole('button',{name:'Load current addresses',exact:true}).click();await findAddress(page,label);
 await expect(page.getByRole('region',{name:'Saved address',exact:true})).toContainText('Location verified');
 const destination=page.getByRole('button',{name:'Copy destination',exact:true});
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.testCopiedDestination=text;}}}));
 await destination.press('Enter');
 await expect(page.getByRole('status',{name:'Copy destination status',exact:true})).toContainText('Destination copied');
 assert.equal(await page.evaluate(()=>window.testCopiedDestination),input.latitude+', '+input.longitude);
 await page.evaluate(()=>{delete navigator.clipboard;delete window.testCopiedDestination;});
 await editAddress(page).click();
 await expect(page.getByLabel('Address line 2',{exact:true})).toHaveValue('');await expect(page.getByLabel('City',{exact:true})).toHaveValue('');await expect(page.getByLabel('Postal code',{exact:true})).toHaveValue('00123');await page.getByText('Coordinates and verification',{exact:true}).click();await expect(page.getByLabel('Latitude',{exact:true})).toHaveValue(input.latitude);await expect(page.getByLabel('Longitude',{exact:true})).toHaveValue(input.longitude);await expect(page.getByLabel('Verified at UTC',{exact:true})).toHaveValue(input.verifiedAt);
 await page.getByLabel('Archive address',{exact:true}).check();await expect(reviewAddress(page)).toBeDisabled();await page.getByLabel('Address archive reason',{exact:true}).fill('Synthetic retained location');await confirmAddress(page);await expect(addressStatus(page)).toContainText('Address saved');await page.getByRole('button',{name:'Load current addresses',exact:true}).click();await findAddress(page,label,true);
 await expect(page.getByRole('button',{name:'Copy destination',exact:true})).toHaveCount(0);
 await editAddress(page).click();
 await expect(page.getByLabel('Address archive reason',{exact:true})).toHaveValue('Synthetic retained location');await page.getByLabel('Archive address',{exact:true}).uncheck();await confirmAddress(page);await expect(addressStatus(page)).toContainText('Address saved');await page.getByRole('button',{name:'Load current addresses',exact:true}).click();await findAddress(page,label);await expect(page.locator('.address-history details')).toHaveCount(3);
 await page.setViewportSize({width:1280,height:900});
 await editAddress(page).click();
 const latitude=page.getByLabel('Latitude',{exact:true});
 await page.getByText('Coordinates and verification',{exact:true}).click();
 await latitude.fill('91');
 await expect(reviewAddress(page)).toBeDisabled();
 for(const action of [page.getByRole('button',{name:'Search addresses',exact:true}),page.getByRole('button',{name:'Add address',exact:true}),page.getByRole('button',{name:label,exact:true})]){
  let warned=false;
  page.once('dialog',async dialog=>{warned=dialog.type()==='confirm'&&dialog.message().includes('unsaved address changes');await dialog.dismiss();});
  await action.click();
  assert(warned,'Navigation asks before losing an invalid draft');
  await expect(latitude).toHaveValue('91');
 }
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:label,exact:true}).click();
 await expect(page.getByRole('heading',{name:label,exact:true})).toBeFocused();
 await editAddress(page).click();
 await expect(page.getByRole('heading',{name:'Edit address',exact:true})).toBeFocused();
 await page.getByText('Coordinates and verification',{exact:true}).click();
 await expect(latitude).toHaveValue(input.latitude);
 await page.getByLabel('Street / address line 1',{exact:true}).fill(label+' stale draft');
 await other.evaluate(async input=>{const post=async(path,body,csrf)=>{const r=await fetch('/api/'+path,{method:'POST',headers:{'content-type':'application/json',...(csrf?{'x-crest-csrf':csrf}:{})},body:JSON.stringify(body)});if(r.status!==200)throw new Error('SYNTHETIC_ADDRESS_CONCURRENT_EDIT_FAILED');return r.json();};const p=await post('auth/session',{},null),c=await post('business/customers/addresses/context',{customerId:input.customerId},p.csrfToken);await post('business/customers/addresses/save',{...input,operationId:crypto.randomUUID(),expectedVersion:'3',recoveryEpoch:c.recoveryEpoch,instructions:'Concurrent synthetic address change'},p.csrfToken);},input);
 await reviewAddress(page).click();
 await expect(review).toContainText(label+' stale draft');
 await expect(review.getByText(label,{exact:true})).toBeVisible();
 await mkdir('.local/review',{recursive:true});
 for(const width of [360,390,768,1440]){
  await page.setViewportSize({width,height:900});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
  await review.screenshot({path:'.local/review/address-change-review-'+name+'-'+width+'.png',animations:'disabled'});
 }
 await page.setViewportSize(viewport);
 const staleRequest=page.waitForRequest(r=>r.url().endsWith('/api/business/customers/addresses/save'));await saveAddress(page).click();const stale=(await staleRequest).postDataJSON();await expect(page.getByRole('status')).toContainText('record, address ID or customer link changed');await expect(page.getByRole('form',{name:'Address editor',exact:true})).toHaveCount(0);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,stale.operationId])).rows[0].n,0);
 await page.getByRole('button',{name:'Load current addresses',exact:true}).click();await findAddress(page,label);
 await expect(page.getByRole('region',{name:'Saved address',exact:true})).toContainText('Concurrent synthetic address change');
 await expect(page.locator('.address-history details')).toHaveCount(4);
 for(const width of [390,1440]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'.local/review/address-profile-'+name+'-'+width+'.png',animations:'disabled'});
 }
 await page.setViewportSize({width:390,height:844});
 await gateEditorFocusFrames(page,'Edit address');
 try{await editAddress(page).click();await expect(page.getByRole('heading',{name:'Edit address',exact:true})).toBeFocused();await page.getByLabel('Location instructions',{exact:true}).focus();await releaseEditorFocusFrames(page);await expect(page.getByLabel('Location instructions',{exact:true})).toBeFocused();}finally{await releaseEditorFocusFrames(page);}
 await page.getByLabel('Location instructions',{exact:true}).fill('Temporary draft after returning to the list');
 await page.getByRole('button',{name:'Back to addresses',exact:true}).click();
 await expect(page.getByRole('button',{name:label,exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Return to open address',exact:true}).press('Enter');
 await expect(page.getByRole('heading',{name:'Edit address',exact:true})).toBeFocused();
 await expect(page.getByLabel('Location instructions',{exact:true})).toHaveValue('Temporary draft after returning to the list');
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'Close editor',exact:true}).click();
 const result=await client.query("SELECT customer_id,line1,line2,city,postal_code,latitude::text,longitude::text,to_char(verified_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS verified,version::text FROM crest.addresses WHERE business_id=$1 AND id=$2",[business,input.addressId]);assert.equal(result.rows[0].customer_id,input.customerId);assert.equal(result.rows[0].line2,null);assert.equal(result.rows[0].city,null);assert.equal(result.rows[0].postal_code,'00123');assert.equal(result.rows[0].latitude,input.latitude);assert.equal(result.rows[0].longitude,input.longitude);assert.equal(result.rows[0].verified,input.verifiedAt);assert.equal(result.rows[0].version,'4');assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.address.pending-reference.v1')),null);
 const back=page.getByRole('link',{name:'Back to customer record',exact:true});
 await expect(back).toHaveAttribute('href','/customers?customer='+input.customerId+'&view=vehicles');
 assert((await back.boundingBox()).height>=44);
 await back.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('heading',{name:'Vehicles and addresses',exact:true})).toBeFocused();
 await expect(page.getByRole('heading',{name:parentName,exact:true})).toBeVisible();
}
async function addressInterruptedFlow(page,name){
 const parent=(await client.query('SELECT id FROM crest.customers WHERE business_id=$1 AND display_name=$2',[business,'Synthetic address parent '+name])).rows[0].id,key='crest.address.pending-reference.v1',read=()=>page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)),key),save=()=>confirmAddress(page),load=()=>page.getByRole('button',{name:'Load current addresses',exact:true});
 async function draft(label){await page.getByRole('button',{name:'Add address',exact:true}).click();await page.getByLabel('Exact location',{exact:true}).fill(label);}
 await openAddresses(page,parent);await draft('Synthetic address lost response '+name);let sent,calls=0;
 const lost=async route=>{sent=route.request().postDataJSON();calls++;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');};
 await page.route('**/api/business/customers/addresses/save',lost);await save();await expect(page.getByRole('status')).toContainText('save could not be confirmed');await page.unroute('**/api/business/customers/addresses/save',lost);const original=await read();await reviewRecordRecovery(page,{client,business},name,'address',original.reference.operationId);assert.equal(calls,1);assert.equal(original.reference.customerId,parent);assert.equal(original.reference.addressId,sent.addressId);assert.equal(original.reference.operationId,sent.operationId);assert(!JSON.stringify(original).includes(sent.exactLocationText));assert.deepEqual(Object.keys(original).sort(),['binding','businessId','reference','schemaVersion']);
 const contextRequest=page.waitForRequest(r=>r.url().endsWith('/api/business/customers/addresses/context'));await page.goto(origin+'/addresses?customer='+randomUUID());assert.equal((await contextRequest).postDataJSON().customerId,parent);await expect(page.getByRole('status')).toContainText('A pending address save was found');await expect(page.getByRole('button',{name:'Add address',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Check address save status',exact:true}).click();await expect(page.getByRole('status')).toContainText('original save is confirmed');assert.equal(await read(),null);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,original.reference.operationId])).rows[0].n,1);
 await openAddresses(page,parent);await draft('Synthetic address explicit retry '+name);const notSent=route=>route.abort('failed');await page.route('**/api/business/customers/addresses/save',notSent);await save();await expect(page.getByRole('status')).toContainText('save could not be confirmed');await page.unroute('**/api/business/customers/addresses/save',notSent);const retry=await read();await page.getByRole('button',{name:'Check address save status',exact:true}).click();await expect(page.getByRole('status')).toContainText('does not prove an earlier request failed');
 const retriedRequest=page.waitForRequest(r=>r.url().endsWith('/api/business/customers/addresses/save'));await page.getByRole('button',{name:'Retry original address change',exact:true}).click();const retried=(await retriedRequest).postDataJSON();for(const field of ['operationId','customerId','addressId','expectedVersion','recoveryEpoch'])assert.equal(retried[field],retry.reference[field]);await expect(page.getByRole('status')).toContainText('Address saved');assert.equal(await read(),null);
 await load().click();await draft('Synthetic address lost draft '+name);await page.route('**/api/business/customers/addresses/save',notSent);await save();await expect(page.getByRole('status')).toContainText('save could not be confirmed');await page.unroute('**/api/business/customers/addresses/save',notSent);const lostDraft=await read();await page.reload();await expect(page.getByRole('status')).toContainText('A pending address save was found');await page.getByRole('button',{name:'Check address save status',exact:true}).click();await expect(page.getByRole('status')).toContainText('original draft is no longer in memory');await expect(page.getByRole('button',{name:'Retry original address change',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Add address',exact:true})).toHaveCount(0);assert.deepEqual(await read(),lostDraft);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,lostDraft.reference.operationId])).rows[0].n,0);
}
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
