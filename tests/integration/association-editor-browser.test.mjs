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
import {setTimeout as delay} from 'node:timers/promises';
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
  app=await createCrestApplication({origin,environment:'test',tls:{key:await readFile(keyPath),cert:await readFile(certPath)},authentication:runtime.forServer(),business:{businessId:business},customers:true,vehicles:true,associations:true});
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


const root='business/vehicle-associations/';
const customer=(name,epoch)=>({schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,customerId:randomUUID(),expectedVersion:'0',displayName:name,phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null});
const vehicle=(name,epoch)=>({schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,vehicleId:randomUUID(),expectedVersion:'0',label:name,year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'customer_vehicle',notes:null,archived:false,archiveReason:null});
const panel=page=>page.getByRole('region',{name:'Customers for this vehicle',exact:true});
async function openPanel(page,car){
 await page.bringToFront();await page.goto(origin+'/vehicles');await expect(page.getByRole('button',{name:'Add vehicle',exact:true})).toBeVisible();
 await page.getByLabel('Vehicle search',{exact:true}).fill(car.label);await page.getByRole('button',{name:'Search vehicles',exact:true}).click();await expect(page.getByRole('status',{name:'Vehicle editor status',exact:true})).toHaveText('Vehicle search complete.');
 await page.getByRole('button',{name:car.label,exact:true}).click();await expect(panel(page)).toBeVisible();
 await panel(page).getByRole('button',{name:'Load current customer links',exact:true}).click();
}
async function reloadLinks(page){await panel(page).getByRole('button',{name:'Load current customer links',exact:true}).click();await expect(panel(page).getByRole('status')).toContainText('Review the retained customer links');}
async function choose(page,name){const box=panel(page);await box.getByLabel('Customer name, phone or email',{exact:true}).fill(name);await box.getByRole('button',{name:'Find customers',exact:true}).click();await expect(box.getByRole('status')).toContainText('Customer search complete');await box.getByRole('button',{name:'Use '+name,exact:true}).click();}
async function openDraft(page,name,at){
 const box=panel(page);await box.getByRole('button',{name:'Add customer link',exact:true}).click();await choose(page,name);
 await box.getByLabel('Relationship',{exact:true}).selectOption('keeper');await box.getByLabel('Billing selection',{exact:true}).selectOption('no');await box.getByLabel('Effective time (UTC)',{exact:true}).fill(at);
}
for(const [name,engine,viewport] of [['chromium',chromium,{width:1280,height:900}],['webkit',webkit,{width:360,height:800}]]){
 test('genuine vehicle customer-link editor '+name,async t=>{
  const browser=await engine.launch();let first,second,one,two,car,epoch,proof,otherProof;
  try{
   first=await browser.newContext({ignoreHTTPSErrors:true,viewport});second=await browser.newContext({ignoreHTTPSErrors:true,viewport});const page=await first.newPage(),other=await second.newPage();
   await t.test('two genuine MFA devices retain separate private sessions',async()=>{
    for(const p of [page,other]){await p.goto(origin+'/sign-in');await expect(p.getByRole('status')).toHaveText('Sign in to continue.');await fill(p);await expect(p.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();}
    const a=(await first.cookies()).find(c=>c.name===sessionName),b=(await second.cookies()).find(c=>c.name===sessionName);assert(a?.httpOnly&&a.secure&&b?.httpOnly&&b.secure&&a.value!==b.value);
    for(const cookie of [a,b]){const session=(await client.query('SELECT s.id,p.id AS provider_id FROM crest_private.app_sessions s JOIN auth.sessions p ON p.id=s.provider_session_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL',[createHash('sha256').update(cookie.value,'ascii').digest()])).rows[0];assert(session?.id&&session.provider_id);}

    proof=(await send(page,'auth/session')).body.csrfToken;otherProof=(await send(other,'auth/session')).body.csrfToken;
   });
   await t.test('the editor uses real customer and vehicle commands rather than fabricated parents',async()=>{
    epoch=(await send(page,'business/vehicles/context',{},proof)).body.recoveryEpoch;one=customer('Synthetic screen owner '+name,epoch);two=customer('Synthetic screen next '+name,epoch);car=vehicle('Synthetic customer-link screen '+name,epoch);
    for(const [route,value]of [['business/customers/save',one],['business/customers/save',two],['business/vehicles/save',car]])assert.equal((await send(page,route,value,proof)).status,200);
   });
   await t.test('mobile forms preserve explicit billing, exact periods, conflict review and complete ownership history',async()=>{
    await openPanel(page,car);const box=panel(page);await expect(box.getByRole('status')).toContainText('Review the retained customer links');
    await box.getByRole('button',{name:'Add customer link',exact:true}).click();await expect(box.getByRole('button',{name:'Save customer link',exact:true})).toBeDisabled();await choose(page,one.displayName);
    await box.getByLabel('Relationship',{exact:true}).selectOption('keeper');await expect(box.getByRole('button',{name:'Save customer link',exact:true})).toBeDisabled();await box.getByLabel('Billing selection',{exact:true}).selectOption('no');await box.getByRole('button',{name:'Use current time',exact:true}).click();assert.match(await box.getByLabel('Effective time (UTC)',{exact:true}).inputValue(),/\.[0-9]{6}Z$/);
    await box.getByLabel('Effective time (UTC)',{exact:true}).fill('2026-10-01T00:00:00.123456Z');await box.getByLabel('Link evidence',{exact:true}).fill('Synthetic screen retained é 😀');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);assert(await box.getByRole('button',{name:'Save customer link',exact:true}).evaluate(el=>el.getBoundingClientRect().height>=44));
    await box.getByRole('button',{name:'Save customer link',exact:true}).click();await expect(box.getByRole('status')).toContainText('Customer link saved');
    const original=(await client.query('SELECT crest_private.association_projection(c) AS value FROM crest.customer_vehicles c WHERE business_id=$1 AND vehicle_id=$2',[business,car.vehicleId])).rows[0].value;assert.equal(original.valid_from,'2026-10-01T00:00:00.123456Z');assert.equal(original.customer_id,one.customerId);assert.equal(original.is_billing,false);assert.equal(original.evidence,'Synthetic screen retained é 😀');
    await reloadLinks(page);await box.getByRole('button',{name:'End link for '+one.displayName,exact:true}).click();await box.getByLabel('Effective time (UTC)',{exact:true}).fill('2026-10-25T00:00:00.000001Z');await box.getByLabel('Reason for ending the earlier link',{exact:true}).fill('Stale device review');
    otherProof=(await send(other,'auth/session')).body.csrfToken;
    const current={schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,expectedVersion:'1',action:'transfer',associationId:original.id,customerId:two.customerId,vehicleId:car.vehicleId,effectiveAt:'2026-10-25T00:00:00.000001Z',relationship:'keeper',isBilling:false,evidence:null,reason:'Synthetic other device transfer',nextAssociationId:randomUUID()};assert.equal((await send(other,root+'save',current,otherProof)).status,200);
    const stale=page.waitForRequest(r=>r.url().endsWith('/api/business/vehicle-associations/save'));await box.getByRole('button',{name:'Confirm end of link',exact:true}).click();const loser=(await stale).postDataJSON();await expect(box.getByRole('status')).toContainText('changed or conflicts');assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,loser.operationId])).rows[0].n,0);
    await reloadLinks(page);await box.getByRole('button',{name:'Transfer link for '+two.displayName,exact:true}).click();await choose(page,one.displayName);await box.getByLabel('Relationship',{exact:true}).selectOption('keeper');await box.getByLabel('Billing selection',{exact:true}).selectOption('no');await box.getByLabel('Effective time (UTC)',{exact:true}).fill('2026-10-26T00:00:00.000001Z');await box.getByLabel('Reason for ending the earlier link',{exact:true}).fill('Synthetic selected next customer');await box.getByRole('button',{name:'Confirm customer-link transfer',exact:true}).click();await expect(box.getByRole('status')).toContainText('Customer link saved');
    await reloadLinks(page);await box.getByRole('button',{name:'End link for '+one.displayName,exact:true}).click();await box.getByLabel('Effective time (UTC)',{exact:true}).fill('2026-10-27T00:00:00.000001Z');await box.getByLabel('Reason for ending the earlier link',{exact:true}).fill('Synthetic retained end');await box.getByRole('button',{name:'Confirm end of link',exact:true}).click();await expect(box.getByRole('status')).toContainText('Customer link saved');
    const rows=(await client.query('SELECT customer_id,valid_to,version::text,is_billing FROM crest.customer_vehicles WHERE business_id=$1 AND vehicle_id=$2 ORDER BY valid_from',[business,car.vehicleId])).rows;assert.equal(rows.length,3);assert.deepEqual(rows.map(r=>r.customer_id),[one.customerId,two.customerId,one.customerId]);assert(rows.every(r=>r.valid_to!==null&&r.version==='2'&&r.is_billing===false));
    await reloadLinks(page);await box.getByRole('button',{name:'View link history for '+one.displayName,exact:true}).last().click();await expect(box.getByRole('region',{name:'Customer link history',exact:true})).toContainText('Current version: 2');
   });
   await t.test('lost responses resolve original receipts; unchanged retries and lost drafts stay explicit',async()=>{
    // This independent MFA device uses its genuine ordinary budget. No table,
    // capability, proof limit or allowance is rewritten by the fixture.
    await openPanel(other,car);const box=panel(other),key='crest.vehicle-association.pending-reference.v1',read=()=>other.evaluate(k=>JSON.parse(sessionStorage.getItem(k)),key),save=()=>box.getByRole('button',{name:'Save customer link',exact:true});
    await expect(box.getByRole('status')).toContainText('Review the retained customer links');await openDraft(other,two.displayName,'2026-10-28T00:00:00.000001Z');
    const pattern='**/api/business/vehicle-associations/save';let sent,calls=0;const lost=async route=>{sent=route.request().postDataJSON();calls++;try{assert.equal((await route.fetch()).status(),200);}finally{await route.abort('failed');}};
    await other.route(pattern,lost);await save().click();await expect(box.getByRole('status')).toContainText('save could not be confirmed');await other.unroute(pattern,lost);const original=await read();assert.equal(calls,1);assert.equal(original.reference.associationId,sent.associationId);assert.equal(original.reference.operationId,sent.operationId);assert(!JSON.stringify(original).includes(two.displayName));assert(!JSON.stringify(original).includes('Synthetic evidence'));
    await openPanel(other,car);await expect(box.getByRole('status')).toContainText('pending customer-link save');await box.getByRole('button',{name:'Check customer-link save status',exact:true}).click();await expect(box.getByRole('status')).toContainText('original customer-link save is confirmed');assert.equal(await read(),null);
    await reloadLinks(other);await openDraft(other,one.displayName,'2026-10-29T00:00:00.000001Z');const blocked=route=>route.abort('failed');await other.route(pattern,blocked);await save().click();await expect(box.getByRole('status')).toContainText('save could not be confirmed');await other.unroute(pattern,blocked);const retry=await read();await box.getByRole('button',{name:'Check customer-link save status',exact:true}).click();await expect(box.getByRole('status')).toContainText('does not prove an earlier request failed');
    const request=other.waitForRequest(r=>r.url().endsWith('/api/business/vehicle-associations/save'));await box.getByRole('button',{name:'Retry original customer-link change',exact:true}).click();const retried=(await request).postDataJSON();for(const field of ['operationId','associationId','vehicleId','expectedVersion','recoveryEpoch','nextAssociationId','action'])assert.equal(retried[field],retry.reference[field]);await expect(box.getByRole('status')).toContainText('Customer link saved');assert.equal(await read(),null);
    // Allow the real minute window to replenish before the final reload path;
    // do not reset or bypass admission to make a dense automated flow pass.
    await delay(60000);await delay(250);
    await reloadLinks(other);await openDraft(other,one.displayName,'2026-10-30T00:00:00.000001Z');await other.route(pattern,blocked);await save().click();await expect(box.getByRole('status')).toContainText('save could not be confirmed');await other.unroute(pattern,blocked);const unresolved=await read();
    await openPanel(other,car);await expect(box.getByRole('status')).toContainText('pending customer-link save');await box.getByRole('button',{name:'Check customer-link save status',exact:true}).click();await expect(box.getByRole('status')).toContainText('original draft is no longer in memory');await expect(box.getByRole('button',{name:'Retry original customer-link change',exact:true})).toHaveCount(0);await expect(box.getByRole('button',{name:'Add customer link',exact:true})).toHaveCount(0);assert.deepEqual(await read(),unresolved);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,unresolved.reference.operationId])).rows[0].n,0);
   });
  }finally{await first?.close();await second?.close();await browser.close();}
 });
}
