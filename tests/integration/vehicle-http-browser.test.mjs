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
  app=await createCrestApplication({origin,environment:'test',tls:{key:await readFile(keyPath),cert:await readFile(certPath)},authentication:runtime.forServer(),business:{businessId:business},vehicles:true});
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
const root='business/vehicles/';
const draft=(epoch,name)=>({schemaVersion:1,operationId:randomUUID(),vehicleId:randomUUID(),expectedVersion:'0',recoveryEpoch:epoch,label:'Synthetic vehicle %_ '+name,year:-500,make:null,model:null,color:null,vin:' Raw-vin / é 001 ',plate:'00123',kind:'customer_vehicle',notes:'Synthetic \\N =evidence é 😀',archived:false,archiveReason:null});
async function openVehicles(page){await page.bringToFront();await page.goto(origin+'/vehicles');await expect(page.getByRole('button',{name:'Add vehicle',exact:true})).toBeVisible();}
async function findVehicle(page,label,archived=false){await page.getByLabel('Vehicle search',{exact:true}).fill(label);await page.getByLabel('Include archived vehicles',{exact:true}).setChecked(archived);await page.getByRole('button',{name:'Search vehicles',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Vehicle search complete.');await page.getByRole('button',{name:label+(archived?' — archived':''),exact:true}).click();await expect(page.getByRole('form',{name:'Vehicle editor',exact:true})).toBeVisible();}
async function vehicleEditorFlow(page,other,proof,name){
 const label='Synthetic editor vehicle '+name,save=()=>page.getByRole('button',{name:'Save vehicle',exact:true}),load=()=>page.getByRole('button',{name:'Load current vehicles',exact:true});
 await openVehicles(page);await page.getByRole('button',{name:'Add vehicle',exact:true}).click();await page.getByLabel('Vehicle label',{exact:true}).fill(label);await expect(save()).toBeEnabled();
 await page.getByLabel('Record year',{exact:true}).check();await expect(save()).toBeDisabled();await page.getByLabel('Year value',{exact:true}).fill('1.5');await expect(save()).toBeDisabled();await page.getByLabel('Year value',{exact:true}).fill('-500');
 await page.getByLabel('Record vin',{exact:true}).check();await page.getByLabel('VIN value',{exact:true}).fill(' Raw-VIN / é 001 ');await page.getByLabel('Record plate',{exact:true}).check();await page.getByLabel('Plate value',{exact:true}).fill('00123');await page.getByLabel('Vehicle kind',{exact:true}).selectOption('other');await page.getByLabel('Record notes',{exact:true}).check();await page.getByLabel('Notes value',{exact:true}).fill('');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);assert(await save().evaluate(el=>el.getBoundingClientRect().height>=44));
 await save().click();await expect(page.getByRole('status')).toContainText('Vehicle saved');
 const row=(await client.query('SELECT id,year,make,vin_raw,vin_normalized,plate,kind,notes,version::text FROM crest.vehicles WHERE business_id=$1 AND label=$2',[business,label])).rows[0];assert(row);assert.equal(row.year,-500);assert.equal(row.make,null);assert.equal(row.vin_raw,' Raw-VIN / é 001 ');assert.equal(row.vin_normalized,'RAWVIN001');assert.equal(row.plate,'00123');assert.equal(row.kind,'other');assert.equal(row.notes,'');assert.equal(row.version,'1');
 await load().click();await findVehicle(page,label);await page.getByLabel('Notes value',{exact:true}).fill('Stale original edit');
 const context=await send(other,root+'context',{},proof),changed={...draft(context.body.recoveryEpoch,name),vehicleId:row.id,expectedVersion:'1',label,notes:'Other device retained edit'};assert.equal((await send(other,root+'save',changed,proof)).status,200);
 await save().click();await expect(page.getByRole('status')).toContainText('record changed');assert.equal((await client.query('SELECT notes FROM crest.vehicles WHERE id=$1',[row.id])).rows[0].notes,changed.notes);
 await load().click();await findVehicle(page,label);await page.getByLabel('Archive vehicle',{exact:true}).check();await expect(save()).toBeDisabled();await page.getByLabel('Archive reason',{exact:true}).fill('Synthetic retained vehicle');await save().click();await expect(page.getByRole('status')).toContainText('Vehicle saved');
 await load().click();await findVehicle(page,label,true);await page.getByLabel('Archive vehicle',{exact:true}).uncheck();await save().click();await expect(page.getByRole('status')).toContainText('Vehicle saved');
 await load().click();await findVehicle(page,label);await expect(page.getByRole('region',{name:'Vehicle history',exact:true})).toContainText('Current version: 4');const actions=(await client.query("SELECT action FROM crest_private.audit_events WHERE business_id=$1 AND entity_id=$2 AND entity_kind='vehicles' ORDER BY entity_version",[business,row.id])).rows;assert.deepEqual(actions.map(r=>r.action),['create','edit','archive','reopen']);
}
async function interruptedVehicleFlow(page,name){
 const key='crest.vehicle.pending-reference.v1',read=()=>page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)),key),save=()=>page.getByRole('button',{name:'Save vehicle',exact:true}),load=()=>page.getByRole('button',{name:'Load current vehicles',exact:true});
 async function add(label){await page.getByRole('button',{name:'Add vehicle',exact:true}).click();await page.getByLabel('Vehicle label',{exact:true}).fill(label);}
 await openVehicles(page);await add('Synthetic lost vehicle response '+name);let sent,calls=0;const pattern='**/api/business/vehicles/save',lost=async route=>{sent=route.request().postDataJSON();calls++;assert.equal((await route.fetch()).status(),200);await route.abort('failed');};
 await page.route(pattern,lost);await save().click();await expect(page.getByRole('status')).toContainText('save could not be confirmed');await page.unroute(pattern,lost);const original=await read();assert.equal(calls,1);assert.equal(original.reference.vehicleId,sent.vehicleId);assert.equal(original.reference.operationId,sent.operationId);assert(!JSON.stringify(original).includes(sent.label));assert.deepEqual(Object.keys(original).sort(),['binding','businessId','reference','schemaVersion']);
 await page.reload();await expect(page.getByRole('status')).toContainText('A pending vehicle save was found');await page.getByRole('button',{name:'Check vehicle save status',exact:true}).click();await expect(page.getByRole('status')).toContainText('original save is confirmed');assert.equal(await read(),null);
 await load().click();await add('Synthetic unchanged vehicle retry '+name);const notSent=route=>route.abort('failed');await page.route(pattern,notSent);await save().click();await expect(page.getByRole('status')).toContainText('save could not be confirmed');await page.unroute(pattern,notSent);const retry=await read();await page.getByRole('button',{name:'Check vehicle save status',exact:true}).click();await expect(page.getByRole('status')).toContainText('does not prove an earlier request failed');
 const pending=page.waitForRequest(r=>r.url().endsWith('/api/business/vehicles/save'));await page.getByRole('button',{name:'Retry original vehicle change',exact:true}).click();const retried=(await pending).postDataJSON();for(const field of ['operationId','vehicleId','expectedVersion','recoveryEpoch'])assert.equal(retried[field],retry.reference[field]);await expect(page.getByRole('status')).toContainText('Vehicle saved');assert.equal(await read(),null);
 await load().click();await add('Synthetic missing vehicle draft '+name);await page.route(pattern,notSent);await save().click();await expect(page.getByRole('status')).toContainText('save could not be confirmed');await page.unroute(pattern,notSent);const unresolved=await read();await page.reload();await expect(page.getByRole('status')).toContainText('A pending vehicle save was found');await page.getByRole('button',{name:'Check vehicle save status',exact:true}).click();await expect(page.getByRole('status')).toContainText('original draft is no longer in memory');await expect(page.getByRole('button',{name:'Retry original vehicle change',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Add vehicle',exact:true})).toHaveCount(0);assert.deepEqual(await read(),unresolved);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,unresolved.reference.operationId])).rows[0].n,0);
}
// This fixture has its own disposable runtime/admission budget; no ordinary
// allowance, recovery fence or genuine provider authority is bypassed/reset.
for(const [name,engine,viewport] of [['chromium',chromium,{width:1280,height:900}],['webkit',webkit,{width:360,height:800}]]){
 test('genuine private vehicle HTTP '+name,async t=>{
  const browser=await engine.launch();let first,second,proof,otherProof,input,created;
  try{
   first=await browser.newContext({ignoreHTTPSErrors:true,viewport});second=await browser.newContext({ignoreHTTPSErrors:true,viewport});const page=await first.newPage(),other=await second.newPage();
   await t.test('independent devices establish genuine MFA and separate durable sessions',async()=>{
    for(const [p,trusted] of [[page,false],[other,true]]){await p.goto(origin+'/sign-in');await expect(p.getByRole('status')).toHaveText('Sign in to continue.');await fill(p,{trusted});await expect(p.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();}
    const a=(await first.cookies()).find(c=>c.name===sessionName),b=(await second.cookies()).find(c=>c.name===sessionName);assert(a?.httpOnly&&a.secure&&b?.httpOnly&&b.secure&&a.value!==b.value);
    for(const [cookie,trusted] of [[a,false],[b,true]]){const r=(await client.query('SELECT s.trusted,s.revoked_at,p.id AS provider_id FROM crest_private.app_sessions s JOIN auth.sessions p ON p.id=s.provider_session_id WHERE s.token_hash=$1',[createHash('sha256').update(cookie.value,'ascii').digest()])).rows[0];assert(r&&r.trusted===trusted&&r.revoked_at===null&&r.provider_id);}
    proof=(await send(page,'auth/session')).body.csrfToken;otherProof=(await send(other,'auth/session')).body.csrfToken;
   });
   await t.test('source, generated VIN, original receipts and large archive history survive the actual HTTP boundary',async()=>{
    assert.equal((await send(page,root+'context')).status,400);
    assert.equal((await send(page,'business/customers/context',{},proof)).status,503,'vehicle opt-in does not enable customers');
    const context=await send(page,root+'context',{},proof),different=await send(other,root+'context',{},otherProof);assert.equal(context.status,200);assert.equal(context.body.writeState,'ready');assert.match(context.cache,/no-store/);assert.match(context.binding,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(context.binding,different.binding);
    input=draft(context.body.recoveryEpoch,name);created=await send(page,root+'save',input,proof);assert.equal(created.status,200);assert.equal(created.body.state,'committed');assert.equal(created.body.receipt.vehicleId,input.vehicleId);assert.equal(created.body.receipt.vehicleVersion,'1');
    for(let v=1;v<=3;v++){const result=await send(page,root+'save',{...input,operationId:randomUUID(),expectedVersion:String(v),vin:' Changed-vin /002 ',notes:('Synthetic retained evidence '+v+' ').padEnd(2000,'x'),archived:v===2,archiveReason:v===2?'Synthetic archive':null},proof);assert.equal(result.status,200);assert.equal(result.body.receipt.vehicleVersion,String(v+1));}
    assert.deepEqual((await send(page,root+'save',input,proof)).body,created.body);assert.deepEqual((await send(page,root+'operation',{operationId:input.operationId},proof)).body,created.body);
    const history=await send(page,root+'history',{vehicleId:input.vehicleId,afterVersion:'0',pageSize:20},proof);assert.equal(history.status,200);assert(history.bytes>8192);assert.equal(history.body.vehicle.vin_raw,' Changed-vin /002 ');assert.equal(history.body.vehicle.vin_normalized,'CHANGEDVIN002');assert.equal(history.body.vehicle.year,-500);assert.equal(history.body.vehicle.plate,'00123');assert.equal(history.body.vehicle.make,null);assert.equal(history.body.history[0].after.vin_raw,input.vin);assert.equal(history.body.history[0].after.vin_normalized,'RAWVIN001');assert.deepEqual(history.body.history.map(e=>e.action),['create','edit','archive','reopen']);
    const found=await send(page,root+'list',{search:input.label,afterId:null,includeArchived:false,pageSize:50},proof);assert.equal(found.status,200);assert.equal(found.body.vehicles.length,1);assert.equal(found.body.vehicles[0].id,input.vehicleId);
    for(const patch of [{businessId:randomUUID()},{customerId:randomUUID()},{categoryId:randomUUID()},{year:'2026'},{year:1.5}])assert.equal((await send(page,root+'save',{...input,...patch},proof)).status,400);
   });
   await t.test('two authorized devices cannot overwrite one expected version or retain the losing claim',async()=>{
    const changes=[{...input,operationId:randomUUID(),expectedVersion:'4',notes:'Device one'},{...input,operationId:randomUUID(),expectedVersion:'4',notes:'Device two'}],results=await Promise.all([send(page,root+'save',changes[0],proof),send(other,root+'save',changes[1],otherProof)]);
    assert.equal(results.filter(r=>r.status===200&&r.body.state==='committed').length,1);assert.equal(results.filter(r=>r.status===409&&r.body.reason==='version'&&r.body.currentVersion==='5').length,1);
    const loser=results[0].status===409?changes[0]:changes[1];assert.deepEqual((await send(page,root+'operation',{operationId:loser.operationId},proof)).body,{state:'absent'});
   });
   await t.test('mobile vehicle editor retains nullable evidence, unusual years, conflicts and archive history',async()=>{await vehicleEditorFlow(page,other,otherProof,name);});
   await t.test('interrupted editor saves resolve original receipts and retain unchanged retries or blocked lost drafts',async()=>{await interruptedVehicleFlow(page,name);});
   await t.test('a dropped committed response resolves only the original receipt and fresh revocation blocks later reads',async()=>{
    const original={...input,operationId:randomUUID(),vehicleId:randomUUID(),expectedVersion:'0'},route='**/api/business/vehicles/save';let calls=0,droppedStatus;
    // The intervening screen loads/first saves issue fresh proofs and evict
    // the initial one from the bounded eight-proof history. Retain that gate.
    assert.equal((await send(page,root+'save',original,proof)).status,400);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,original.operationId])).rows[0].n,0);
    proof=(await send(page,'auth/session')).body.csrfToken;
    const drop=async intercepted=>{calls++;try{droppedStatus=(await intercepted.fetch()).status();}finally{await intercepted.abort('failed');}};await page.route(route,drop);
    try{await assert.rejects(send(page,root+'save',original,proof));}finally{await page.unroute(route,drop);}assert.equal(calls,1);assert.equal(droppedStatus,200);
    const receipt=await send(page,root+'operation',{operationId:original.operationId},proof);assert.equal(receipt.status,200);assert.equal(receipt.body.receipt.vehicleId,original.vehicleId);assert.equal(receipt.body.receipt.vehicleVersion,'1');assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,original.operationId])).rows[0].n,1);
    await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[business]);
    try{const context=await send(page,root+'context',{},proof);assert.equal(context.body.writeState,'paused');assert.equal(context.body.recoveryEpoch,null);assert.equal((await send(page,root+'save',original,proof)).status,409);assert.deepEqual((await send(page,root+'operation',{operationId:original.operationId},proof)).body,receipt.body);}finally{await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[business]);}
    const cookie=(await second.cookies()).find(c=>c.name===sessionName);await client.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE token_hash=$1',[createHash('sha256').update(cookie.value,'ascii').digest()]);
    const denied=await send(other,root+'history',{vehicleId:input.vehicleId,afterVersion:'0',pageSize:20},otherProof);assert.notEqual(denied.status,200);assert(!JSON.stringify(denied.body).includes(input.label));
   });
  }finally{await first?.close();await second?.close();await browser.close();}
 });
}
