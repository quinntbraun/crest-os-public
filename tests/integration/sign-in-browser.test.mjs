import {reviewRecordRecovery} from '../support/record-recovery-layout.mjs';
// Genuine HTTPS + compiled Next/Node + real disposable Auth/PG. No traces,
// HAR, video, storageState exports or credential-bearing failure artifacts.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {reviewTextResize} from '../support/text-resize-layout.mjs';
import {URI,TOTP} from 'otpauth';
import {browserTestTls} from '../support/browser-test-tls.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {startRealAuthService,authResult} from '../support/real-auth-service.mjs';

let sandbox,client,service,app,origin,fixture,actor,business,login,loginOwned=false;
const sessionName='__Host-crest_session';
async function setupSignInFixture(){
  app=undefined;service=undefined;client=undefined;sandbox=undefined;loginOwned=false;
  assert(['linux','win32'].includes(process.platform),'supported disposable TLS/Auth browser fixture required');
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
  const tls=await browserTestTls();
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));origin=`https://127.0.0.1:${port}`;
  // Normal Node resolution: react-server is only a build-time marker condition.
  const {createCrestApplication,createAuthenticationRuntime}=await import('../../.local/server/application.mjs');
  const runtime=await createAuthenticationRuntime({database:{connectionString:database.toString(),environment:'test'},provider:{issuer:service.issuer,publicKey:service.publicKey,environment:'test'},
    owner:{subject:user.id,factorId:factor.id},loginKey:randomBytes(32),ingress:{kind:'direct'},activeKeyId:'synthetic',keys:[{id:'synthetic',key:randomBytes(32)}]});
  assert.throws(()=>JSON.stringify(runtime),/AUTHENTICATION_RUNTIME_PRIVATE/);
  app=await createCrestApplication({origin,environment:'test',tls,authentication:runtime.forServer(),business:{businessId:business},customers:true});
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',resolve);});
}
async function closeSignInFixture(){try{await app?.close();}finally{try{await service?.close();}finally{if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();}}}

async function checkSession(page){await page.getByRole('button',{name:'Check session',exact:true}).click();await expect(page.getByRole('status')).not.toContainText('Checking this device');}
async function exerciseBusinessHttp(page,name){
  const send=(path,body={},proof=null)=>page.evaluate(async input=>{const response=await fetch(input.path,{method:'POST',headers:{'Content-Type':'application/json',...(input.proof?{'x-crest-csrf':input.proof}:{})},body:JSON.stringify(input.body)});return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};},{path,body,proof});
  const session=await send('/api/auth/session');assert.equal(session.status,200);const csrf=session.body.csrfToken;
  assert.equal((await send('/api/business/settings')).status,400);
  await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[business]);
  const settings=await send('/api/business/settings',{},csrf);assert.equal(settings.status,200);assert.match(settings.cache,/no-store/);assert.equal(settings.body.businessId,business);assert.equal(settings.body.writeState,'ready');
  const input={schemaVersion:1,operationId:randomUUID(),expectedVersion:settings.body.businessVersion,recoveryEpoch:settings.body.recoveryEpoch,legalName:`Synthetic HTTPS ${name}`};
  const result=await send('/api/business/rename',input,csrf);assert.equal(result.status,200);assert.equal(result.body.state,'committed');assert.equal(result.body.receipt.businessVersion,(BigInt(input.expectedVersion)+1n).toString());
  assert.deepEqual((await send('/api/business/rename',input,csrf)).body,result.body);
  assert.deepEqual((await send('/api/business/operation',{operationId:input.operationId},csrf)).body,result.body);
  assert.equal((await send('/api/business/rename',{...input,businessId:randomUUID()},csrf)).status,400);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.audit_events WHERE business_id=$1 AND operation_id=$2',[business,input.operationId])).rows[0].n,1);
}
async function captureSignInState(page,name,state){
  const viewport=page.viewportSize();await mkdir('.local/review',{recursive:true});
  if(state==='form')await reviewTextResize(page,name,'sign-in-form');
  try{for(const width of [320,360,390,768,1440,1920]){
    await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
    await expect(page.getByRole('heading',{name:'Welcome back',exact:true})).toBeVisible();
    await expect(page.locator('.sign-in-workspace img:visible')).toHaveCount(1);
    assert(await page.locator('.sign-in-panel img').evaluate(image=>image.complete&&image.naturalWidth>0));
    const crest=await page.locator('.sign-in-panel img').boundingBox();assert(crest);
    assert(crest.width>=144&&crest.width<=192&&Math.abs(crest.width-crest.height)<1,'the supplied full crest stays prominent and square at ordinary text size');
    const card=await page.locator('.sign-in-panel').boundingBox();assert(card);
    if(width>=768){assert(card.width>=400&&card.width<=440,'sign-in stays within its focused desktop width');assert(Math.abs(card.x+card.width/2-width/2)<1,'sign-in stays centered');}
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
    if(state==='form'&&width===1440){
      const typography=await page.evaluate(()=>({root:getComputedStyle(document.documentElement).fontFamily,
        heading:getComputedStyle(document.querySelector('.sign-in-brand h1')).fontFamily,
        label:getComputedStyle(document.querySelector('label[for="email"]')).fontFamily,
        faces:Array.from(document.fonts).map(face=>({family:face.family,weight:face.weight,status:face.status}))}));
      if(name==='chromium'){
        const cdp=await page.context().newCDPSession(page);try{
          await cdp.send('DOM.enable');await cdp.send('CSS.enable');const {root}=await cdp.send('DOM.getDocument');typography.glyphs=[];
          for(const selector of ['.sign-in-brand h1','label[for="email"]','.sign-in-feedback']){
            const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});const fonts=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});typography.glyphs.push({selector,fonts:fonts.fonts});
          }
        }finally{await cdp.detach();}
      }
      await writeFile('.local/review/device-sign-in-served-fonts-'+name+'.json',JSON.stringify(typography,null,2)+'\n');
    }
    await page.screenshot({path:'.local/review/device-sign-in-'+state+'-'+name+'-'+width+'.png',fullPage:true,
      mask:[page.locator('#email,#password,#code')],maskColor:'#e8ecf5'});
  }}finally{if(viewport)await page.setViewportSize(viewport);}
}
async function fill(page,{trusted=false,password=fixture.password,code}={}){
  await page.getByLabel('Email',{exact:true}).fill(fixture.email);await page.getByLabel('Password',{exact:true}).fill(password);
  const input=page.getByLabel('Authenticator code',{exact:true});await input.fill(code??fixture.totp.generate());
  assert.deepEqual(await input.evaluate(element=>({sixDigits:/^[0-9]{6}$/.test(element.value),valid:element.validity.valid})),{sixDigits:true,valid:true});
  await expect(input).toBeFocused();
  if(trusted)await page.getByText('Personal device options',{exact:true}).click();await page.getByLabel('Trust this personal device').setChecked(trusted);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
}
async function exerciseCustomerHttp(page,name){
  const send=(route,body={},proof=null)=>page.evaluate(async input=>{const response=await fetch(input.path,{method:'POST',headers:{'content-type':'application/json',...(input.proof?{'x-crest-csrf':input.proof}:{})},body:JSON.stringify(input.body)}),text=await response.text();return {status:response.status,body:JSON.parse(text),bytes:new TextEncoder().encode(text).byteLength,cache:response.headers.get('cache-control'),binding:response.headers.get('x-crest-edit-binding')};},{path:'/api/'+route,body,proof});
  const proof=(await send('auth/session')).body.csrfToken,route='business/customers/';assert(proof);
  assert.equal((await send(route+'context')).status,400);
  const context=await send(route+'context',{},proof);assert.equal(context.status,200);assert.equal(context.body.businessId,business);assert.equal(context.body.writeState,'ready');assert.match(context.binding,/^[A-Za-z0-9_-]{43}$/);assert.match(context.cache,/no-store/);
  const input={schemaVersion:1,operationId:randomUUID(),customerId:randomUUID(),recoveryEpoch:context.body.recoveryEpoch,expectedVersion:'0',displayName:`Synthetic HTTPS customer ${name}`,phone:'(317) 555-0100',email:null,contactPreference:null,outreachOptOut:true,notes:'Synthetic \\N =evidence é 😀',customerSince:null,archived:false,archiveReason:null};
  const created=await send(route+'save',input,proof);assert.equal(created.status,200);assert.equal(created.body.state,'committed');assert.equal(created.body.receipt.customerVersion,'1');assert.equal(created.body.receipt.customerId,input.customerId);assert.match(created.cache,/no-store/);
  for(let v=1;v<=3;v++){const edit=await send(route+'save',{...input,operationId:randomUUID(),expectedVersion:String(v),notes:('Retained evidence é '+v+' ').padEnd(2000,'x')},proof);assert.equal(edit.status,200);assert.equal(edit.body.receipt.customerVersion,String(v+1));}
  assert.deepEqual((await send(route+'save',input,proof)).body,created.body);assert.deepEqual((await send(route+'operation',{operationId:input.operationId},proof)).body,created.body);
  assert.equal((await send(route+'save',{...input,businessId:randomUUID()},proof)).status,400);
  const staleOperation=randomUUID(),stale=await send(route+'save',{...input,operationId:staleOperation,expectedVersion:'1'},proof);assert.equal(stale.status,409);assert.deepEqual(stale.body,{state:'conflict',reason:'version',currentVersion:'4'});assert.deepEqual((await send(route+'operation',{operationId:staleOperation},proof)).body,{state:'absent'});
  const history=await send(route+'history',{customerId:input.customerId,afterVersion:'0',pageSize:20},proof);assert.equal(history.status,200);assert(history.bytes>8192,'real retained history must exceed the authentication response cap');assert.equal(history.body.history.length,4);assert.equal(history.body.customer.version,'4');assert.equal(history.body.customer.phone_raw,input.phone);assert.equal(history.body.customer.email_raw,null);assert.equal(history.body.customer.outreach_opt_out,true);
  const found=await send(route+'list',{search:input.displayName,afterId:null,includeArchived:false,pageSize:50},proof);assert.equal(found.status,200);assert.equal(found.body.customers.length,1);assert.equal(found.body.customers[0].id,input.customerId);
  await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[business]);
  try{const paused=await send(route+'context',{},proof);assert.equal(paused.body.writeState,'paused');assert.equal(paused.body.recoveryEpoch,null);assert.equal((await send(route+'save',input,proof)).status,409);assert.deepEqual((await send(route+'operation',{operationId:input.operationId},proof)).body,created.body);assert.equal((await send(route+'history',{customerId:input.customerId,afterVersion:'0',pageSize:20},proof)).status,200);}
  finally{await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[business]);}
  assert.equal((await client.query("SELECT count(*)::int AS n FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='customers' AND entity_id=$2",[business,input.customerId])).rows[0].n,4);
}
async function openCustomers(page){await page.bringToFront();await page.goto(origin+'/customers');await expect(page.getByRole('button',{name:'Add customer',exact:true})).toBeVisible();}
async function findCustomer(page,name,archived=false){await page.getByLabel('Customer search',{exact:true}).fill(name);await page.getByLabel('Include archived customers',{exact:true}).setChecked(archived);await page.getByRole('button',{name:'Search customers',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Customer search complete.');await page.getByRole('button',{name:name+(archived?' — archived':''),exact:true}).click();await expect(page.getByRole('form',{name:'Customer editor',exact:true})).toBeVisible();await page.getByText('Notes and more customer details',{exact:true}).click();}
async function customerEditorFlow(page,other,name){
  await openCustomers(page);await page.getByRole('button',{name:'Add customer',exact:true}).click();const label=`Synthetic editor ${name}`;
  await page.getByLabel('Customer name',{exact:true}).fill(label);await page.getByLabel('Phone value',{exact:true}).fill('(001) raw shared');await page.getByText('Notes and more customer details',{exact:true}).click();await page.getByLabel('Customer has opted out of outreach',{exact:true}).check();
  assert.equal((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.length,0,'accessible customer editor');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'customer editor fits mobile');assert((await page.getByLabel('Customer name',{exact:true}).boundingBox()).height>=44);
  await page.getByRole('button',{name:'Save customer',exact:true}).click();await expect(page.getByRole('status')).toContainText('Customer saved');await page.getByRole('button',{name:'Load current customers',exact:true}).click();await findCustomer(page,label);
  await expect(page.getByLabel('Phone value',{exact:true})).toHaveValue('(001) raw shared');await expect(page.getByLabel('Email value',{exact:true})).toHaveValue('');await expect(page.getByLabel('Contact preference',{exact:true})).toHaveValue('');await expect(page.getByLabel('Customer has opted out of outreach',{exact:true})).toBeChecked();await expect(page.getByLabel('Customer-since date',{exact:true})).toHaveValue('');
  await page.getByLabel('Archive customer',{exact:true}).check();await expect(page.getByRole('button',{name:'Save customer',exact:true})).toBeDisabled();await page.getByLabel('Archive reason',{exact:true}).fill('Synthetic retained archive reason');await page.getByRole('button',{name:'Save customer',exact:true}).click();await expect(page.getByRole('status')).toContainText('Customer saved');
  await page.getByRole('button',{name:'Load current customers',exact:true}).click();await findCustomer(page,label,true);await expect(page.getByLabel('Archive reason',{exact:true})).toHaveValue('Synthetic retained archive reason');await page.getByLabel('Archive customer',{exact:true}).uncheck();await page.getByRole('button',{name:'Save customer',exact:true}).click();await expect(page.getByRole('status')).toContainText('Customer saved');
  await page.getByRole('button',{name:'Load current customers',exact:true}).click();await findCustomer(page,label);await page.getByRole('navigation',{name:'Customer record sections',exact:true}).getByRole('button',{name:'History',exact:true}).click();await expect(page.getByLabel('Customer history',{exact:true}).locator('details')).toHaveCount(3);await page.getByRole('navigation',{name:'Customer record sections',exact:true}).getByRole('button',{name:'Overview',exact:true}).click();await expect(page.getByLabel('Archive customer',{exact:true})).not.toBeChecked();
  const row=(await client.query('SELECT * FROM crest.customers WHERE business_id=$1 AND display_name=$2',[business,label])).rows[0];assert.equal(row.version,'3');assert.equal(row.email_raw,null);assert.equal(row.contact_preference,null);assert.equal(row.notes,null);assert.equal(row.customer_since,null);assert.equal(row.archived_at,null);assert.equal(row.archived_reason,null);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='customers' AND entity_id=$2",[business,row.id])).rows[0].n,3);assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.customer.pending-reference.v1')),null);
  await page.getByLabel('Customer name',{exact:true}).fill(label+' stale draft');
  await other.evaluate(async input=>{const post=async(path,body,csrf)=>{const r=await fetch('/api/'+path,{method:'POST',headers:{'content-type':'application/json',...(csrf?{'x-crest-csrf':csrf}:{})},body:JSON.stringify(body)});if(r.status!==200)throw new Error('SYNTHETIC_CUSTOMER_CONCURRENT_EDIT_FAILED');return r.json();};const proof=await post('auth/session',{},null),context=await post('business/customers/context',{},proof.csrfToken);await post('business/customers/save',{schemaVersion:1,operationId:crypto.randomUUID(),customerId:input.customerId,expectedVersion:'3',recoveryEpoch:context.recoveryEpoch,displayName:input.label,phone:'(001) raw shared',email:null,contactPreference:'',outreachOptOut:true,notes:'Concurrent synthetic customer edit',customerSince:null,archived:false,archiveReason:null},proof.csrfToken);},{customerId:row.id,label});
  const request=page.waitForRequest(r=>r.url().endsWith('/api/business/customers/save'));await page.getByRole('button',{name:'Save customer',exact:true}).click();const stale=(await request).postDataJSON();await expect(page.getByRole('status')).toContainText('record changed');assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.customer.pending-reference.v1')),null);await expect(page.getByLabel('Customer name',{exact:true})).toHaveCount(0);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,stale.operationId])).rows[0].n,0,'stale command claim rolls back');await page.getByRole('button',{name:'Load current customers',exact:true}).click();await findCustomer(page,label);await expect(page.getByLabel('Notes',{exact:true})).toHaveValue('Concurrent synthetic customer edit');await expect(page.getByLabel('Customer name',{exact:true})).toHaveValue(label);
  assert.equal((await client.query('SELECT contact_preference FROM crest.customers WHERE business_id=$1 AND id=$2',[business,row.id])).rows[0].contact_preference,'','an explicit API empty string remains distinct from an omitted form field');
}
async function customerInterruptedFlow(page,name){
  const leave=dialog=>{assert.equal(dialog.type(),'beforeunload');void dialog.accept();};
  const watched=new Set(['/api/auth/session','/api/business/customers/context','/api/business/customers/save','/api/business/customers/operation']);
  const requests=[];
  const record=(url,outcome)=>{
    const path=new URL(url).pathname;
    if(!watched.has(path))return;
    requests.push([path,outcome]);
    if(requests.length>16)requests.shift();
  };
  const response=event=>record(event.url(),event.status());
  const failed=event=>record(event.url(),'request_failed');
  page.on('dialog',leave);page.on('response',response);page.on('requestfailed',failed);
  try{
  const key='crest.customer.pending-reference.v1',read=()=>page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)),key),saveButton=()=>page.getByRole('button',{name:'Save customer',exact:true}),loadButton=()=>page.getByRole('button',{name:'Load current customers',exact:true});
  await openCustomers(page);await page.getByRole('button',{name:'Add customer',exact:true}).click();await page.getByLabel('Customer name',{exact:true}).fill(`Synthetic customer lost response ${name}`);let submitted,calls=0;
  const lost=async route=>{calls++;submitted=route.request().postDataJSON();const response=await route.fetch();assert.equal(response.status(),200);await response.body();await route.abort('failed');};
  await page.route('**/api/business/customers/save',lost);await saveButton().click();await expect(page.getByRole('status')).toContainText('save could not be confirmed');await page.unroute('**/api/business/customers/save',lost);const original=await read();await reviewRecordRecovery(page,{client,business},name,'customer',original.reference.operationId);assert.equal(calls,1);assert.equal(original.reference.operationId,submitted.operationId);assert.equal(original.reference.customerId,submitted.customerId);assert.deepEqual(Object.keys(original).sort(),['binding','businessId','reference','schemaVersion']);assert(!JSON.stringify(original).includes(submitted.displayName));assert(!JSON.stringify(original).includes('csrfToken'));
  await page.reload();await expect(page.getByRole('status')).toContainText('A pending customer save was found');await page.getByRole('button',{name:'Check customer save status',exact:true}).click();await expect(page.getByRole('status')).toContainText('original save is confirmed');assert.equal(await read(),null);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,original.reference.operationId])).rows[0].n,1);
  await loadButton().click();await page.getByRole('button',{name:'Add customer',exact:true}).click();await page.getByLabel('Customer name',{exact:true}).fill(`Synthetic customer explicit retry ${name}`);const notSent=route=>route.abort('failed');await page.route('**/api/business/customers/save',notSent);await saveButton().click();await expect(page.getByRole('status')).toContainText('save could not be confirmed');await page.unroute('**/api/business/customers/save',notSent);const retry=await read();await page.getByRole('button',{name:'Check customer save status',exact:true}).click();await expect(page.getByRole('status')).toContainText('does not prove an earlier request failed');
  const request=page.waitForRequest(r=>r.url().endsWith('/api/business/customers/save'));await page.getByRole('button',{name:'Retry original customer change',exact:true}).click();const retried=(await request).postDataJSON();for(const field of ['operationId','customerId','expectedVersion','recoveryEpoch'])assert.equal(retried[field],retry.reference[field]);await expect(page.getByRole('status')).toContainText('Customer saved');assert.equal(await read(),null);
  await loadButton().click();await page.getByRole('button',{name:'Add customer',exact:true}).click();await page.getByLabel('Customer name',{exact:true}).fill(`Synthetic lost draft ${name}`);await page.route('**/api/business/customers/save',notSent);await saveButton().click();await expect(page.getByRole('status')).toContainText('save could not be confirmed');await page.unroute('**/api/business/customers/save',notSent);const lostDraft=await read();await page.reload();await expect(page.getByRole('status')).toContainText('A pending customer save was found');await page.getByRole('button',{name:'Check customer save status',exact:true}).click();await expect(page.getByRole('status')).toContainText('original draft is no longer in memory');await expect(page.getByRole('button',{name:'Retry original customer change',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Add customer',exact:true})).toHaveCount(0);assert.deepEqual(await read(),lostDraft);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,lostDraft.reference.operationId])).rows[0].n,0);
  await page.goto(origin+'/sign-in');await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  }catch(error){
    assert(error instanceof Error);
    error.message+='\nRecent customer request outcomes '+JSON.stringify(requests);
    throw error;
  }finally{
    page.off('dialog',leave);page.off('response',response);page.off('requestfailed',failed);
  }
}
async function openSettings(page){await page.bringToFront();await page.goto(origin+'/settings');await expect(page.getByLabel('Business legal name',{exact:true})).toBeVisible();}
async function backgroundNameChange(page,legalName){
  return page.evaluate(async name=>{const post=async(path,body,csrf)=>{const r=await fetch('/api/'+path,{method:'POST',headers:{'content-type':'application/json',...(csrf?{'x-crest-csrf':csrf}:{})},body:JSON.stringify(body)});if(r.status!==200)throw new Error('SYNTHETIC_CONCURRENT_SAVE_FAILED');return r.json();};
    const proof=await post('auth/session',{},null),context=await post('business/settings',{},proof.csrfToken);
    return post('business/rename',{schemaVersion:1,operationId:crypto.randomUUID(),expectedVersion:context.businessVersion,recoveryEpoch:context.recoveryEpoch,legalName:name},proof.csrfToken);
  },legalName);
}
async function pendingNameEdit(page){return page.evaluate(()=>JSON.parse(sessionStorage.getItem('crest.business-name.pending.v1')));}
async function settingsReviewFlow(page,other,name){
  await openSettings(page);const proposed=`Synthetic reviewed UI ${name}`;await page.getByLabel('Business legal name',{exact:true}).fill(proposed);
  await backgroundNameChange(other,`Concurrent synthetic ${name}`);let attempts=0;const observe=request=>{if(request.url().endsWith('/api/business/rename'))attempts++;};page.on('request',observe);
  try{
    await page.getByRole('button',{name:'Save business name',exact:true}).click();await expect(page.getByRole('status')).toContainText('Another change was saved first');assert.equal(attempts,1);
    assert.equal(await pendingNameEdit(page),null);await expect(page.getByLabel('Business legal name',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Load current settings',exact:true}).click();await expect(page.getByLabel('Business legal name',{exact:true})).toHaveValue(proposed);await expect(page.locator('.current-name')).toContainText(`Concurrent synthetic ${name}`);assert.equal(attempts,1);
    await page.getByRole('button',{name:'Save business name',exact:true}).click();await expect(page.getByRole('status')).toContainText('Business name saved');assert.equal(attempts,2);assert.equal(await pendingNameEdit(page),null);
    await page.getByRole('button',{name:'Load current settings',exact:true}).click();await expect(page.getByLabel('Business legal name',{exact:true})).toHaveValue(proposed);
    assert.equal((await page.getByLabel('Business legal name',{exact:true}).boundingBox()).height>=44,true);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.equal((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.length,0);
    await mkdir('.local/review',{recursive:true});await page.screenshot({path:`.local/review/settings-${name}.png`,fullPage:true});
  }finally{page.off('request',observe);}
}
async function settingsInterruptedFlow(page,name){
  await openSettings(page);await page.getByLabel('Business legal name',{exact:true}).fill(`Synthetic acknowledged loss ${name}`);let committedRequest,requests=0;
  const lost=async route=>{requests++;committedRequest=route.request().postDataJSON();const response=await route.fetch();assert.equal(response.status(),200);await response.body();await route.abort('failed');};
  await page.route('**/api/business/rename',lost);await page.getByRole('button',{name:'Save business name',exact:true}).click();await expect(page.getByRole('status')).toContainText('save could not be confirmed');await page.unroute('**/api/business/rename',lost);
  const original=await pendingNameEdit(page);assert.deepEqual(original.command,committedRequest);assert.equal(requests,1);
  const stored=JSON.stringify(original);const cookie=await localCookie(page.context());assert(!stored.includes(cookie.value));assert(!stored.includes('csrfToken'));assert(!stored.includes('provider'));assert.equal(await page.evaluate(()=>localStorage.length),0);
  await page.reload();await expect(page.getByRole('status')).toContainText('A pending save was found');assert.deepEqual(await pendingNameEdit(page),original);assert.equal(requests,1);
  await page.getByRole('button',{name:'Check save status',exact:true}).click();await expect(page.getByRole('status')).toContainText('Save reference confirmed');assert.equal(await pendingNameEdit(page),null);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.audit_events WHERE business_id=$1 AND operation_id=$2',[business,original.command.operationId])).rows[0].n,1);
  await page.getByRole('button',{name:'Load current settings',exact:true}).click();await expect(page.getByLabel('Business legal name',{exact:true})).toHaveValue(original.command.legalName);
  await page.getByLabel('Business legal name',{exact:true}).fill(`Synthetic explicit retry ${name}`);const notSent=route=>route.abort('failed');await page.route('**/api/business/rename',notSent);
  await page.getByRole('button',{name:'Save business name',exact:true}).click();await expect(page.getByRole('status')).toContainText('save could not be confirmed');await page.unroute('**/api/business/rename',notSent);const retry=await pendingNameEdit(page);
  await page.getByRole('button',{name:'Check save status',exact:true}).click();await expect(page.getByRole('status')).toContainText('does not prove an earlier request failed');assert.deepEqual(await pendingNameEdit(page),retry);
  const sent=page.waitForRequest(request=>request.url().endsWith('/api/business/rename'));await page.getByRole('button',{name:'Retry original change',exact:true}).click();assert.deepEqual((await sent).postDataJSON(),retry.command);
  await expect(page.getByRole('status')).toContainText('Business name saved');assert.equal(await pendingNameEdit(page),null);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,retry.command.operationId])).rows[0].n,1);
  await page.goto(origin+'/sign-in');await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
}
async function localCookie(context){return (await context.cookies(origin)).find(cookie=>cookie.name===sessionName);}
async function row(cookie){assert(cookie,'session cookie required');const hash=createHash('sha256').update(cookie.value,'ascii').digest();return (await client.query('SELECT * FROM crest_private.app_sessions WHERE actor_id=$1 AND token_hash=$2',[actor,hash])).rows[0];}
async function assertPrivate(page,context,loginReply){
  const cookie=await localCookie(context);assert(cookie,'HttpOnly cookie accepted');
  assert(cookie.secure&&cookie.httpOnly&&cookie.path==='/','browser accepted a secure root-scoped HttpOnly cookie');
  const fromServer=(await loginReply.headerValues('set-cookie')).find(value=>value.startsWith(sessionName+'='));
  assert(fromServer,'server issued the session cookie');
  const attributes=new Set(fromServer.split(';').slice(1).map(value=>value.trim().toLowerCase()));
  assert(['secure','httponly','samesite=lax','path=/'].every(value=>attributes.has(value)),'session cookie attributes sent');
  assert.equal((await context.cookies(origin)).some(c=>c.name==='__Host-crest_login'),false,'pending login retired');
  const state=await page.evaluate(()=>({cookie:document.cookie,local:Object.keys(localStorage),session:Object.keys(sessionStorage),secure:isSecureContext,html:document.documentElement.outerHTML}));
  assert(state.secure,'real HTTPS secure context');assert(!state.cookie.includes('__Host-crest_'),'HttpOnly credentials invisible to scripts');assert.equal(state.local.length,0);assert.equal(state.session.length,0);
  for(const secret of [cookie.value,fixture.password,service.issuer,service.publicKey])assert(!state.html.includes(secret),'private runtime material absent from document');
  return cookie;
}
for(const [name,engine,viewport] of [['chromium',chromium,{width:1280,height:900}],['webkit',webkit,{width:360,height:780}]]){
  test(`${name}: genuine HTTPS sign-in, persistence, isolation and revocation`,{timeout:120000},async t=>{
    let browser,first,second,page,other,untrusted,trusted,initial;
    try{
      await setupSignInFixture();browser=await engine.launch();
      // Fixture-only self-signed certificate acceptance; never changes system or
      // Node TLS trust. Public CA/deployed TLS acceptance is a separate gate.
      first=await browser.newContext({ignoreHTTPSErrors:true,viewport});page=await first.newPage();
      second=await browser.newContext({ignoreHTTPSErrors:true,viewport});other=await second.newPage();
      await t.test('accessible form, generic failure and one explicit untrusted sign-in',async()=>{
        const missing=await page.goto(origin+'/fictional-missing-crest-page');
        assert.equal(missing.status(),404);
        const recovery=page.getByRole('region',{name:'Page not found',exact:true});
        await expect(recovery.getByRole('link',{name:'Back to Today',exact:true})).toHaveAttribute('href','/');
        const tool=recovery.getByRole('button',{name:'Find a tool',exact:true});
        await mkdir('.local/review',{recursive:true});
        for(const width of [360,390,768,1440]){
          await page.setViewportSize({width,height:820});
          await expect(tool).toBeInViewport();
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(issue=>issue.id),[]);
          if(width===390||width===1440)await page.screenshot({path:'.local/review/missing-page-recovery-'+name+'-'+width+'.png'});
        }
        await page.setViewportSize(viewport);
        await tool.press('Enter');
        const dialog=page.getByRole('dialog',{name:'Find a tool',exact:true});
        const query=dialog.getByRole('searchbox',{name:'Search workspace tools',exact:true});
        await expect(query).toBeFocused();
        await query.press('Escape');await expect(tool).toBeFocused();
        await tool.press('Enter');await query.fill('sign in');await query.press('Enter');
        await expect(page).toHaveURL(origin+'/sign-in');
        const job=randomUUID();
        await page.goto(origin+'/sign-in?returnTo=schedule&job='+job);
        await expect(page.getByRole('status')).toHaveText('Sign in to continue.');
        await expect(page.getByLabel('Trust this personal device')).not.toBeChecked();
        await captureSignInState(page,name,'form');
        const password=page.getByLabel('Password',{exact:true});let visibilityPosts=0;const visibilityRequest=request=>{if(request.method()==='POST'&&request.url().includes('/api/auth/'))visibilityPosts++;};page.on('request',visibilityRequest);
        await password.fill('synthetic-visibility-check');await page.getByRole('button',{name:'Show password',exact:true}).click();await expect(password).toHaveAttribute('type','text');await expect(password).toHaveValue('synthetic-visibility-check');await page.getByRole('button',{name:'Hide password',exact:true}).click();await expect(password).toHaveAttribute('type','password');assert.equal(visibilityPosts,0,'visibility control cannot submit credentials');page.off('request',visibilityRequest);await password.fill('');
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
        for(const label of ['Email','Password','Authenticator code'])assert((await page.getByLabel(label,{exact:true}).boundingBox()).height>=44,'touch target');
        assert.equal((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.length,0,'accessible form');
        const code=page.getByLabel('Authenticator code',{exact:true});
        await expect(code).toHaveAttribute('inputmode','numeric');
        await expect(code).toHaveAttribute('autocomplete','one-time-code');
        for(const width of [360,390,768,1440]){
          await page.setViewportSize({width,height:820});
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          if(width===390||width===1440){
            await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
            await page.screenshot({path:'.local/review/device-sign-in-'+name+'-'+width+'.png'});
          }
        }
        await page.setViewportSize({width:360,height:480});
        await page.getByLabel('Email',{exact:true}).fill(fixture.email);
        await password.fill('synthetic-format-validation');
        await code.fill('123');
        await page.getByRole('button',{name:'Sign in',exact:true}).click();
        await expect(page.locator('#code-invalid')).toHaveText('Enter all six digits from your authenticator app.');
        await expect(code).toBeFocused();
        await expect(code).toHaveAttribute('aria-invalid','true');
        await expect(password).toHaveValue('synthetic-format-validation');
        await code.fill('123456');
        await expect(page.locator('#code-invalid')).toHaveCount(0);
        await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeInViewport();
        await page.setViewportSize(viewport);
        if(name==='chromium'){
          await fill(page,{password:'synthetic-wrong-password'});await expect(page.getByRole('status')).toContainText('Sign-in failed.');
          await expect(page.getByRole('status')).toContainText('phone’s date and time are set automatically');
          await expect(page.getByRole('status')).toBeFocused();
          await expect(page.getByRole('status')).toHaveAttribute('data-tone','error');
          await expect(page.getByLabel('Email',{exact:true})).toHaveValue(fixture.email);
          assert.equal(await page.getByLabel('Password',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('Authenticator code',{exact:true}).inputValue(),'');assert.equal(await localCookie(first),undefined,'failed login issues no session');
        }
        let wrongCode='000000';
        while(fixture.totp.validate({token:wrongCode,window:2})!==null)wrongCode=String(Number(wrongCode)+1).padStart(6,'0');
        await fill(page,{code:wrongCode});await expect(page.getByRole('status')).toContainText('Sign-in failed.');
        await expect(page.getByLabel('Email',{exact:true})).toHaveValue(fixture.email);
        assert.equal(await password.inputValue(),'');assert.equal(await code.inputValue(),'');
        assert.equal(await localCookie(first),undefined,'wrong MFA code issues no session');
        await captureSignInState(page,name,'wrong-code');
        const loginReply=page.waitForResponse(response=>response.url()===origin+'/api/auth/login'&&response.status()===200);
        await fill(page);await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
        await expect(page.getByRole('status')).toBeFocused();
        await expect(page.getByRole('link',{name:'Return to saved job',exact:true})).toHaveAttribute('href','/schedule?job='+job);
        untrusted=await assertPrivate(page,first,await loginReply);assert.equal(untrusted.expires,-1,'untrusted cookie is nonpersistent');
        assert.equal((await row(untrusted)).trusted,false,'server persisted untrusted choice');
        assert.equal((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.length,0,'accessible signed-in state');
        await captureSignInState(page,name,'verified');
        await page.goto(origin+'/sign-in?returnTo=https%3A%2F%2Fexample.test');
        await expect(page.getByRole('link',{name:'Open workspace',exact:true})).toHaveAttribute('href','/');
      });
      await t.test('separate trusted device, reload and proof checks preserve original deadlines',async()=>{
        await other.goto(origin+'/sign-in');await expect(other.getByRole('status')).toHaveText('Sign in to continue.');
        const loginReply=other.waitForResponse(response=>response.url()===origin+'/api/auth/login'&&response.status()===200);
        await fill(other,{trusted:true});await expect(other.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
        trusted=await assertPrivate(other,second,await loginReply);initial=await row(trusted);assert(initial.trusted&&trusted.expires>Date.now()/1000,'explicit persistent trust');
        assert(Math.abs(trusted.expires-initial.expires_at.getTime()/1000)<2,'cookie ends at original database deadline');assert(untrusted.value!==trusted.value,'independent device credentials');
        await other.reload();await expect(other.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();await checkSession(other);
        const checked=await row(trusted);for(const field of ['authenticated_at','last_active_at','expires_at'])assert.equal(checked[field].getTime(),initial[field].getTime(),'proof/reload cannot advance session time');
        assert.equal((await localCookie(second)).expires,trusted.expires,'proof does not rewrite persistent cookie');
        const denied=await other.evaluate(async()=>{const response=await fetch('/api/auth/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});return {status:response.status,body:await response.json()};});
        assert.equal(denied.status,400);assert.deepEqual(denied.body,{error:'AUTHENTICATION_REQUEST_FAILED'});assert.equal((await row(trusted)).revoked_at,null,'missing CSRF cannot revoke');
      });
      await t.test('compiled HTTPS guarded business API uses the authenticated device',async()=>{await exerciseBusinessHttp(page,name);});
      await t.test('compiled HTTPS customer save, history, conflict and paused replay use real Auth and PostgreSQL',async()=>{await exerciseCustomerHttp(page,name);});
      await t.test('customer editor preserves optional values, archive/reopen and rejects a concurrent stale edit',async()=>{await customerEditorFlow(other,page,name);});
      await t.test('customer interrupted-save UI reconciles receipts, permits only original retry and blocks lost drafts',async()=>{await customerInterruptedFlow(other,name);});
      await t.test('settings UI requires version-conflict review and remains accessible on this device',async()=>{await settingsReviewFlow(page,other,name);});
      await t.test('interrupted saves survive reload and reconcile before an explicit original retry',async()=>{await settingsInterruptedFlow(page,name);});
      await t.test('confirmed local-first logout clears one device and leaves the other live',async()=>{
        await page.getByRole('button',{name:'Sign out on this device',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Signed out on this device.');
        assert.equal(await localCookie(first),undefined,'logout clears credential');const revoked=await row(untrusted);assert(revoked.revoked_at,'local revoked');assert.equal(revoked.provider_token_ciphertext,null);
        assert.equal((await client.query('SELECT count(*)::int AS n FROM auth.sessions WHERE id=$1',[revoked.provider_session_id])).rows[0].n,0,'selected provider session removed');
        await other.goto(origin+'/sign-in');
        await checkSession(other);await expect(other.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();assert.equal((await row(trusted)).revoked_at,null,'other device stays live');
      });
      await t.test('durable local revocation is observed after reload and cannot leave cached signed-in UI',async()=>{
        await client.query('BEGIN');try{await client.query('SET LOCAL ROLE crest_web');await client.query('SELECT crest_commands.revoke_app_session($1,$2)',[createHash('sha256').update(trusted.value,'ascii').digest(),randomUUID()]);await client.query('COMMIT');}catch{await client.query('ROLLBACK');throw new Error('SYNTHETIC_BROWSER_REVOCATION_FAILED');}
        await checkSession(other);await expect(other.getByRole('status')).toHaveText('Your session has ended. Sign in again.');await expect(other.getByRole('button',{name:'Sign out on this device',exact:true})).toHaveCount(0);
        await captureSignInState(other,name,'ended-session');
        await other.reload();await expect(other.getByRole('status')).toHaveText('Sign in to continue.');
      });
      await t.test('client-only fault injection: uncertain logout is never reported or replayed as success',async()=>{
        // These route faults test only UI behavior; real auth acceptance is above.
        let logoutCalls=0;
        await other.route('**/api/auth/session',route=>route.fulfill({json:{csrfToken:'A'.repeat(43),expiresAt:Date.now()+600000}}));
        await other.route('**/api/auth/logout',route=>{logoutCalls++;return route.abort('failed');});
        await other.reload();await expect(other.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
        await other.getByRole('button',{name:'Sign out on this device',exact:true}).click();await expect(other.getByRole('status')).toContainText('Sign-out could not be confirmed.');
        assert.equal(logoutCalls,1,'no automatic logout replay');await expect(other.getByRole('button',{name:'Sign out on this device',exact:true})).toHaveCount(0);
        await checkSession(other);await expect(other.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();assert.equal(logoutCalls,1,'explicit proof check is not logout replay');
      });
      await t.test('client-only fault injection: pending submission is single-flight and stale completion cannot update another page',async()=>{
        let loginCalls=0,release;const blocked=new Promise(resolve=>{release=resolve;});
        await page.route('**/api/auth/session',route=>route.fulfill({status:400,json:{error:'AUTHENTICATION_REQUEST_FAILED'}}));
        await page.route('**/api/auth/bootstrap',route=>route.fulfill({json:{csrfToken:'A'.repeat(43),expiresAt:Date.now()+600000}}));
        await page.route('**/api/auth/login',async route=>{loginCalls++;await blocked;await route.abort('failed').catch(()=>undefined);});
        try{
          await page.reload();await expect(page.getByRole('status')).toHaveText('Sign in to continue.');
          await page.getByLabel('Email',{exact:true}).fill(fixture.email);
          await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));});
          assert.equal(await page.getByLabel('Email',{exact:true}).inputValue(),fixture.email,'password-manager focus must preserve the form');
          await fill(page);await expect(page.getByRole('status')).toHaveText('Signing in…');
          await expect(page.getByLabel('Password',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Sign in',exact:true})).toHaveCount(0);
          await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));});
          await expect.poll(()=>loginCalls).toBe(1);await page.goto(origin+'/');release();
          await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();assert.equal(loginCalls,1,'no replay after navigation/focus');
        }finally{release();}
      });
    }finally{try{await first?.close();await second?.close();await browser?.close();}finally{await closeSignInFixture();}}
  });
}
