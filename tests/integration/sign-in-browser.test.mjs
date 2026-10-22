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

let sandbox,client,service,app,origin,fixture,actor,login,loginOwned=false;
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
    const business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic browser business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;
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
  app=await createCrestApplication({origin,environment:'test',tls:{key:await readFile(keyPath),cert:await readFile(certPath)},authentication:runtime.forServer()});
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',resolve);});
});
after(async()=>{try{await app?.close();}finally{try{await service?.close();}finally{if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();}}});

async function checkSession(page){await page.getByRole('button',{name:'Check session',exact:true}).click();await expect(page.getByRole('status')).not.toContainText('Checking this device');}
async function fill(page,{trusted=false,password=fixture.password}={}){
  await page.getByLabel('Email',{exact:true}).fill(fixture.email);await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByLabel('Authenticator code',{exact:true}).fill(fixture.totp.generate());await page.getByLabel('Trust this personal device').setChecked(trusted);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
}
async function localCookie(context){return (await context.cookies(origin)).find(cookie=>cookie.name===sessionName);}
async function row(cookie){assert(cookie,'session cookie required');const hash=createHash('sha256').update(cookie.value,'ascii').digest();return (await client.query('SELECT * FROM crest_private.app_sessions WHERE actor_id=$1 AND token_hash=$2',[actor,hash])).rows[0];}
async function assertPrivate(page,context){
  const cookie=await localCookie(context);assert(cookie,'HttpOnly cookie accepted');assert(cookie.secure&&cookie.httpOnly&&cookie.sameSite==='Lax'&&cookie.path==='/','cookie policy');
  assert.equal((await context.cookies(origin)).some(c=>c.name==='__Host-crest_login'),false,'pending login retired');
  const state=await page.evaluate(()=>({cookie:document.cookie,local:Object.keys(localStorage),session:Object.keys(sessionStorage),secure:isSecureContext,html:document.documentElement.outerHTML}));
  assert(state.secure,'real HTTPS secure context');assert(!state.cookie.includes('__Host-crest_'),'HttpOnly credentials invisible to scripts');assert.equal(state.local.length,0);assert.equal(state.session.length,0);
  for(const secret of [cookie.value,fixture.password,service.issuer,service.publicKey])assert(!state.html.includes(secret),'private runtime material absent from document');
  return cookie;
}
for(const [name,engine,viewport] of [['chromium',chromium,{width:1280,height:900}],['webkit',webkit,{width:360,height:780}]]){
  test(`${name}: genuine HTTPS sign-in, persistence, isolation and revocation`,{timeout:120000},async t=>{
    const browser=await engine.launch();let first,second,page,other,untrusted,trusted,initial;
    try{
      // Fixture-only self-signed certificate acceptance; never changes system or
      // Node TLS trust. Public CA/deployed TLS acceptance is a separate gate.
      first=await browser.newContext({ignoreHTTPSErrors:true,viewport});page=await first.newPage();
      second=await browser.newContext({ignoreHTTPSErrors:true,viewport});other=await second.newPage();
      await t.test('accessible form, generic failure and one explicit untrusted sign-in',async()=>{
        await page.goto(origin+'/sign-in');await expect(page.getByRole('status')).toHaveText('Sign in to continue.');
        await expect(page.getByLabel('Trust this personal device')).not.toBeChecked();
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
        for(const label of ['Email','Password','Authenticator code'])assert((await page.getByLabel(label,{exact:true}).boundingBox()).height>=44,'touch target');
        assert.equal((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.length,0,'accessible form');
        if(name==='chromium'){
          await fill(page,{password:'synthetic-wrong-password'});await expect(page.getByRole('status')).toContainText('Sign-in failed.');
          assert.equal(await page.getByLabel('Password',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('Authenticator code',{exact:true}).inputValue(),'');assert.equal(await localCookie(first),undefined,'failed login issues no session');
        }
        await fill(page);await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
        untrusted=await assertPrivate(page,first);assert.equal(untrusted.expires,-1,'untrusted cookie is nonpersistent');
        assert.equal((await row(untrusted)).trusted,false,'server persisted untrusted choice');
        assert.equal((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.length,0,'accessible signed-in state');
      });
      await t.test('separate trusted device, reload and proof checks preserve original deadlines',async()=>{
        await other.goto(origin+'/sign-in');await expect(other.getByRole('status')).toHaveText('Sign in to continue.');
        await fill(other,{trusted:true});await expect(other.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
        trusted=await assertPrivate(other,second);initial=await row(trusted);assert(initial.trusted&&trusted.expires>Date.now()/1000,'explicit persistent trust');
        assert(Math.abs(trusted.expires-initial.expires_at.getTime()/1000)<2,'cookie ends at original database deadline');assert(untrusted.value!==trusted.value,'independent device credentials');
        await other.reload();await expect(other.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();await checkSession(other);
        const checked=await row(trusted);for(const field of ['authenticated_at','last_active_at','expires_at'])assert.equal(checked[field].getTime(),initial[field].getTime(),'proof/reload cannot advance session time');
        assert.equal((await localCookie(second)).expires,trusted.expires,'proof does not rewrite persistent cookie');
        const denied=await other.evaluate(async()=>{const response=await fetch('/api/auth/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});return {status:response.status,body:await response.json()};});
        assert.equal(denied.status,400);assert.deepEqual(denied.body,{error:'AUTHENTICATION_REQUEST_FAILED'});assert.equal((await row(trusted)).revoked_at,null,'missing CSRF cannot revoke');
      });
      await t.test('confirmed local-first logout clears one device and leaves the other live',async()=>{
        await page.getByRole('button',{name:'Sign out on this device',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Signed out on this device.');
        assert.equal(await localCookie(first),undefined,'logout clears credential');const revoked=await row(untrusted);assert(revoked.revoked_at,'local revoked');assert.equal(revoked.provider_token_ciphertext,null);
        assert.equal((await client.query('SELECT count(*)::int AS n FROM auth.sessions WHERE id=$1',[revoked.provider_session_id])).rows[0].n,0,'selected provider session removed');
        await checkSession(other);await expect(other.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();assert.equal((await row(trusted)).revoked_at,null,'other device stays live');
      });
      await t.test('durable local revocation is observed after reload and cannot leave cached signed-in UI',async()=>{
        await client.query('BEGIN');try{await client.query('SET LOCAL ROLE crest_web');await client.query('SELECT crest_commands.revoke_app_session($1,$2)',[createHash('sha256').update(trusted.value,'ascii').digest(),randomUUID()]);await client.query('COMMIT');}catch{await client.query('ROLLBACK');throw new Error('SYNTHETIC_BROWSER_REVOCATION_FAILED');}
        await checkSession(other);await expect(other.getByRole('status')).toHaveText('Sign in to continue.');await expect(other.getByRole('button',{name:'Sign out on this device',exact:true})).toHaveCount(0);
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
          await expect(page.getByText('Setup in progress',{exact:true})).toBeVisible();assert.equal(loginCalls,1,'no replay after navigation/focus');
        }finally{release();}
      });
    }finally{await first?.close();await second?.close();await browser.close();}
  });
}
