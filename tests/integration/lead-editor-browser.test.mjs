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
  app=await createCrestApplication({origin,environment:'test',tls:{key:await readFile(keyPath),cert:await readFile(certPath)},authentication:runtime.forServer(),business:{businessId:business},leads:true,customers:true});
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
const leadRoot='business/leads/',sourceRoot='business/lead-sources/';
const editorStatus=(page,source=false)=>page.getByRole('status',{name:source?'Lead source editor status':'Lead editor status',exact:true});
const saveButton=(page,source=false)=>page.getByRole('button',{name:source?'Save lead source':'Save lead',exact:true});
const loadButton=(page,source=false)=>page.getByRole('button',{name:source?'Load current lead sources':'Load current leads',exact:true});
async function openScreen(page,source=false){await page.bringToFront();await page.goto(origin+(source?'/lead-sources':'/leads'));await expect(page.getByRole('button',{name:source?'Add lead source':'Add lead',exact:true})).toBeVisible();}
async function find(page,label,source=false,inactive=false){await page.getByLabel(source?'Lead source search':'Lead search',{exact:true}).fill(label);if(source)await page.getByLabel('Include inactive sources',{exact:true}).setChecked(inactive);await page.getByRole('button',{name:source?'Search lead sources':'Search leads',exact:true}).click();await expect(editorStatus(page,source)).toHaveText(source?'Lead source search complete.':'Lead search complete.');await page.getByRole('button',{name:label+(source&&inactive?' — inactive':''),exact:true}).click();await expect(page.getByRole('form',{name:source?'Lead source editor':'Lead editor',exact:true})).toBeVisible();}
async function choose(page,kind,search,label){const picker=page.getByRole('region',{name:'Choose '+kind,exact:true});await picker.getByLabel(kind==='customer'?'Customer search':'Source search',{exact:true}).fill(search);await picker.getByRole('button',{name:kind==='customer'?'Find customers':'Find sources',exact:true}).click();await expect(picker.getByRole('button',{name:'Use '+label,exact:true})).toBeVisible();await picker.getByRole('button',{name:'Use '+label,exact:true}).click();await expect(picker).toContainText('Selected '+kind+': '+label);}
const customer=(epoch,label)=>({schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,customerId:randomUUID(),expectedVersion:'0',displayName:label,phone:'5550100',email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null});
for(const [name,engine,viewport] of [['chromium',chromium,{width:1280,height:900}],['webkit',webkit,{width:360,height:800}]]){
 test('genuine private lead/source editors '+name,async t=>{
  const browser=await engine.launch();let first,second,epoch,one,two,source,lead,sourceLabel='Synthetic source editor '+name,leadLabel='Synthetic lead editor '+name;
  try{
   first=await browser.newContext({ignoreHTTPSErrors:true,viewport});second=await browser.newContext({ignoreHTTPSErrors:true,viewport});const page=await first.newPage(),other=await second.newPage();
   async function fresh(){return (await send(other,'auth/session')).body.csrfToken;}
   await t.test('two genuine MFA devices and explicit same-contact customers remain separate',async()=>{
    for(const p of [page,other]){await p.goto(origin+'/sign-in');await expect(p.getByRole('status')).toHaveText('Sign in to continue.');await fill(p);await expect(p.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();}
    const a=(await first.cookies()).find(c=>c.name===sessionName),b=(await second.cookies()).find(c=>c.name===sessionName);assert(a?.httpOnly&&a.secure&&b?.httpOnly&&b.secure&&a.value!==b.value);
    for(const cookie of [a,b]){const row=(await client.query('SELECT s.actor_id,s.revoked_at,p.id AS provider_id FROM crest_private.app_sessions s JOIN auth.sessions p ON p.id=s.provider_session_id WHERE s.token_hash=$1',[createHash('sha256').update(cookie.value,'ascii').digest()])).rows[0];assert(row&&row.actor_id===actor&&row.revoked_at===null&&row.provider_id);}
    const proof=await fresh();epoch=(await send(other,'business/customers/context',{},proof)).body.recoveryEpoch;one=customer(epoch,'Synthetic selected customer '+name);two=customer(epoch,'Synthetic shared-contact customer '+name);for(const input of [one,two])assert.equal((await send(other,'business/customers/save',input,proof)).status,200);assert.notEqual(one.customerId,two.customerId);
   });
   await t.test('source forms explicitly select a referring customer and retain deactivation/reactivation history',async()=>{
    await openScreen(page,true);await page.getByRole('button',{name:'Add lead source',exact:true}).click();await page.getByLabel('Source label',{exact:true}).fill(sourceLabel);await expect(saveButton(page,true)).toBeDisabled();await page.getByLabel('Source kind',{exact:true}).fill('Synthetic owner classification');await choose(page,'customer','5550100',one.displayName);
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert(await saveButton(page,true).evaluate(el=>el.getBoundingClientRect().height>=44));
    await saveButton(page,true).click();await expect(editorStatus(page,true)).toContainText('Lead source saved');source=(await client.query('SELECT id,referral_customer_id,version::text FROM crest.lead_sources WHERE business_id=$1 AND label=$2',[business,sourceLabel])).rows[0];assert.equal(source.referral_customer_id,one.customerId);assert.equal(source.version,'1');
    await loadButton(page,true).click();await find(page,sourceLabel,true);await page.getByLabel('Source active',{exact:true}).uncheck();await saveButton(page,true).click();await expect(editorStatus(page,true)).toContainText('Lead source saved');
    await loadButton(page,true).click();await find(page,sourceLabel,true,true);await page.getByLabel('Source active',{exact:true}).check();await saveButton(page,true).click();await expect(editorStatus(page,true)).toContainText('Lead source saved');
    await loadButton(page,true).click();await find(page,sourceLabel,true);await expect(page.getByRole('region',{name:'Lead source history',exact:true})).toContainText('Current version: 3');assert.deepEqual((await client.query("SELECT action FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='lead_sources' AND entity_id=$2 ORDER BY entity_version",[business,source.id])).rows.map(r=>r.action),['create','deactivate','activate']);
   });
   await t.test('lead forms preserve nullable/empty evidence, exact dollars/UTC and genuine customer/source choices on mobile',async()=>{
    await openScreen(page);await page.getByRole('button',{name:'Add lead',exact:true}).click();await page.getByLabel('Lead label',{exact:true}).fill(leadLabel);await choose(page,'customer','5550100',two.displayName);await choose(page,'source',sourceLabel,sourceLabel);
    await page.getByLabel('Record phone',{exact:true}).check();await expect(saveButton(page)).toBeDisabled();await page.getByLabel('Phone value',{exact:true}).fill(' Raw phone é /001 ');await page.getByLabel('Record notes',{exact:true}).check();await page.getByLabel('Notes value',{exact:true}).fill('');await page.getByLabel('Record requested scope',{exact:true}).check();await page.getByLabel('Requested scope value',{exact:true}).fill('😀'.repeat(4000));
    await page.getByLabel('Record estimated value',{exact:true}).check();await page.getByLabel('Estimated value (USD)',{exact:true}).fill('1.001');await expect(saveButton(page)).toBeDisabled();await page.getByLabel('Estimated value (USD)',{exact:true}).fill('90071992547409.93');
    await page.getByLabel('Record follow-up time',{exact:true}).check();await page.getByLabel('Follow-up date and time (UTC)',{exact:true}).fill('2026-02-30 14:30');await expect(saveButton(page)).toBeDisabled();await page.getByLabel('Follow-up date and time (UTC)',{exact:true}).fill('2026-10-25 14:30:01.123456');
    assert.equal(await page.locator('form form').count(),0);assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert(await saveButton(page).evaluate(el=>el.getBoundingClientRect().height>=44));
    await saveButton(page).click();await expect(editorStatus(page)).toContainText('Lead saved');lead=(await client.query('SELECT id,customer_id,source_id,source_snapshot,phone_raw,email_raw,notes,estimated_cents::text,to_char(follow_up_at AT TIME ZONE $3,\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS follow_up,requested_scope,state FROM crest.leads WHERE business_id=$1 AND label=$2',[business,leadLabel,'UTC'])).rows[0];assert.equal(lead.customer_id,two.customerId);assert.equal(lead.source_id,source.id);assert.equal(lead.source_snapshot.label,sourceLabel);assert.equal(lead.phone_raw,' Raw phone é /001 ');assert.equal(lead.email_raw,null);assert.equal(lead.notes,'');assert.equal(lead.estimated_cents,'9007199254740993');assert.equal(lead.follow_up,'2026-10-25T14:30:01.123456Z');assert.equal(lead.requested_scope,'😀'.repeat(4000));assert.equal(lead.state,'new');
   });
   await t.test('stale edits cannot overwrite another device; large complete history pages preserve the pinned source',async()=>{
    await loadButton(page).click();await find(page,leadLabel);await page.getByLabel('Notes value',{exact:true}).fill('Stale unsaved intake');const proof=await fresh(),base={schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,leadId:lead.id,expectedVersion:'1',label:leadLabel,customerId:two.customerId,sourceId:source.id,referralText:null,phone:lead.phone_raw,email:null,requestedScope:lead.requested_scope,availability:null,estimatedCents:lead.estimated_cents,followUpAt:lead.follow_up,notes:'Other device retained edit'};
    assert.equal((await send(other,leadRoot+'save',base,proof)).status,200);await saveButton(page).click();await expect(editorStatus(page)).toContainText('record changed');assert.equal((await client.query('SELECT notes FROM crest.leads WHERE id=$1',[lead.id])).rows[0].notes,base.notes);
    for(let version=2;version<10;version++){const body={...base,operationId:randomUUID(),expectedVersion:String(version),phone:'😀'.repeat(512),email:'😀'.repeat(512),referralText:'😀'.repeat(2000),requestedScope:'😀'.repeat(4000),availability:'😀'.repeat(4000),notes:'😀'.repeat(4000)};assert.equal((await send(other,leadRoot+'save',body,proof)).status,200);}
    assert.equal((await send(other,sourceRoot+'save',{schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,leadSourceId:source.id,expectedVersion:'3',label:sourceLabel+' renamed',kind:'Changed classification',active:false,referralCustomerId:one.customerId},proof)).status,200);
    assert.equal((await send(other,leadRoot+'history',{leadId:lead.id,afterVersion:'0',pageSize:20},proof)).status,503,'oversized history stays closed');
    await loadButton(page).click();await find(page,leadLabel);const history=page.getByRole('region',{name:'Lead history',exact:true});await expect(history).toContainText('Current version: 10');await expect(page.getByText('Retained source attribution: '+sourceLabel+' · Synthetic owner classification. Later source edits do not replace this snapshot.',{exact:true})).toBeVisible();assert.equal(await history.locator('details').count(),5);await page.getByRole('button',{name:'Next lead history page',exact:true}).click();await expect(editorStatus(page)).toContainText('Showing the next retained history page');assert.equal(await history.locator('details').count(),5);await expect(history).toContainText('Version 10');
   });
   await t.test('lost lead responses resolve original receipts; unchanged manual retry and missing-draft blocking survive reload',async()=>{
    await openScreen(page);const key='crest.lead.pending-reference.v1',pattern='**/api/business/leads/save',read=()=>page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)),key);async function add(label){await page.getByRole('button',{name:'Add lead',exact:true}).click();await page.getByLabel('Lead label',{exact:true}).fill(label);}
    let sent,calls=0;await add('Synthetic lost lead response '+name);const drop=async route=>{sent=route.request().postDataJSON();calls++;assert.equal((await route.fetch()).status(),200);await route.abort('failed');};await page.route(pattern,drop);await saveButton(page).click();await expect(editorStatus(page)).toContainText('save could not be confirmed');await page.unroute(pattern,drop);const original=await read();assert.equal(calls,1);assert.equal(original.reference.operationId,sent.operationId);assert.equal(original.reference.leadId,sent.leadId);assert(!JSON.stringify(original).includes(sent.label));
    await page.reload();await expect(editorStatus(page)).toContainText('A pending lead save was found');await page.getByRole('button',{name:'Check lead save status',exact:true}).click();await expect(editorStatus(page)).toContainText('original save is confirmed');assert.equal(await read(),null);
    await loadButton(page).click();await add('Synthetic unchanged lead retry '+name);const notSent=route=>route.abort('failed');await page.route(pattern,notSent);await saveButton(page).click();await expect(editorStatus(page)).toContainText('save could not be confirmed');await page.unroute(pattern,notSent);const retry=await read();await page.getByRole('button',{name:'Check lead save status',exact:true}).click();await expect(editorStatus(page)).toContainText('does not prove an earlier request failed');const waiting=page.waitForRequest(r=>r.url().endsWith('/api/business/leads/save'));await page.getByRole('button',{name:'Retry original lead change',exact:true}).click();const retried=(await waiting).postDataJSON();for(const key of ['operationId','leadId','expectedVersion','recoveryEpoch'])assert.equal(retried[key],retry.reference[key]);await expect(editorStatus(page)).toContainText('Lead saved');assert.equal(await read(),null);
    await loadButton(page).click();await add('Synthetic missing lead draft '+name);await page.route(pattern,notSent);await saveButton(page).click();await expect(editorStatus(page)).toContainText('save could not be confirmed');await page.unroute(pattern,notSent);const unresolved=await read();await page.reload();await page.getByRole('button',{name:'Check lead save status',exact:true}).click();await expect(editorStatus(page)).toContainText('original draft is no longer in memory');assert.equal(await page.getByRole('button',{name:'Retry original lead change',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Add lead',exact:true}).count(),0);assert.deepEqual(await read(),unresolved);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,unresolved.reference.operationId])).rows[0].n,0);
   });
   await t.test('source lost responses keep their own reference; hidden drafts clear and paused writes remain read-only',async()=>{
    await openScreen(page,true);await page.getByRole('button',{name:'Add lead source',exact:true}).click();const label='Synthetic lost source response '+name;await page.getByLabel('Source label',{exact:true}).fill(label);await page.getByLabel('Source kind',{exact:true}).fill('Private source');const pattern='**/api/business/lead-sources/save';let sent;const drop=async route=>{sent=route.request().postDataJSON();assert.equal((await route.fetch()).status(),200);await route.abort('failed');};await page.route(pattern,drop);await saveButton(page,true).click();await expect(editorStatus(page,true)).toContainText('save could not be confirmed');await page.unroute(pattern,drop);
    const references=await page.evaluate(()=>({lead:JSON.parse(sessionStorage.getItem('crest.lead.pending-reference.v1')),source:JSON.parse(sessionStorage.getItem('crest.lead.source.pending-reference.v1'))}));assert(references.lead);assert.equal(references.source.reference.leadSourceId,sent.leadSourceId);assert(!JSON.stringify(references.source).includes(label));await page.reload();await page.getByRole('button',{name:'Check lead source save status',exact:true}).click();await expect(editorStatus(page,true)).toContainText('original save is confirmed');assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.lead.source.pending-reference.v1')),null);assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('crest.lead.pending-reference.v1'))),references.lead);
    await loadButton(page,true).click();await page.getByRole('button',{name:'Add lead source',exact:true}).click();await page.getByLabel('Source label',{exact:true}).fill('Synthetic hidden source draft');await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await expect(editorStatus(page,true)).toContainText('Private lead source details were cleared');await expect(page.getByRole('form',{name:'Lead source editor',exact:true})).toHaveCount(0);await page.evaluate(()=>{delete document.visibilityState;});
    await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[business]);try{await loadButton(page,true).click();await expect(page.getByRole('button',{name:'Add lead source',exact:true})).toBeDisabled();await find(page,label,true);await expect(saveButton(page,true)).toBeDisabled();}finally{await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[business]);}
   });
  }finally{await first?.close();await second?.close();await browser.close();}
 });
}
