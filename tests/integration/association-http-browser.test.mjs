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

let sandbox,client,service,app,origin,fixture,actor,business,login,loginOwned=false,browserClient;
const sessionName='__Host-crest_session';
before(async()=>{
  assert.equal(process.platform,'linux','the disposable container/HTTPS fixture requires Linux CI');
  process.env.NODE_ENV='production';
  const bundle=await rolldown({input:'src/client/associations.ts',platform:'browser',onwarn(warning){throw new Error('ASSOCIATION_CLIENT_FIXTURE_BUILD_FAILED:'+warning.code);}});
  try{const result=await bundle.generate({format:'iife',name:'crestAssociationFixture',sourcemap:false});assert.equal(result.output.length,1);assert.equal(result.output[0].type,'chunk');browserClient=result.output[0].code;}finally{await bundle.close();}

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
  await page.getByLabel('Authenticator code',{exact:true}).fill(fixture.totp.generate());if(trusted)await page.getByText('Personal device options',{exact:true}).click();await page.getByLabel('Trust this personal device').setChecked(trusted);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
}
async function send(page,route,body={},proof=null){
  return page.evaluate(async input=>{
    const response=await fetch('/api/'+input.route,{method:'POST',headers:{'content-type':'application/json',...(input.proof?{'x-crest-csrf':input.proof}:{})},body:JSON.stringify(input.body)}),text=await response.text();
    return {status:response.status,body:JSON.parse(text),bytes:new TextEncoder().encode(text).byteLength,cache:response.headers.get('cache-control'),binding:response.headers.get('x-crest-edit-binding')};
  },{route,body,proof});
}

const root='business/vehicle-associations/';
const customer=()=>({schemaVersion:1,operationId:randomUUID(),customerId:randomUUID(),expectedVersion:'0',displayName:'Synthetic association HTTP customer',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null});
const vehicle=()=>({schemaVersion:1,operationId:randomUUID(),vehicleId:randomUUID(),expectedVersion:'0',label:'Synthetic association HTTP vehicle',year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'customer_vehicle',notes:null,archived:false,archiveReason:null});
for(const [name,engine,viewport] of [['chromium',chromium,{width:1280,height:900}],['webkit',webkit,{width:360,height:800}]]){
 test('genuine private vehicle association HTTP '+name,async t=>{
  const browser=await engine.launch();let first,second,proof,otherProof,epoch,one,two,car,opened,current,transferred,dropped,droppedReceipt;
  try{
   first=await browser.newContext({ignoreHTTPSErrors:true,viewport});second=await browser.newContext({ignoreHTTPSErrors:true,viewport});const page=await first.newPage(),other=await second.newPage();
   await t.test('two devices establish genuine MFA and private provider-backed sessions',async()=>{
    for(const p of [page,other]){await p.goto(origin+'/sign-in');await expect(p.getByRole('status')).toHaveText('Sign in to continue.');await fill(p);await expect(p.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();}
    const a=(await first.cookies()).find(c=>c.name===sessionName),b=(await second.cookies()).find(c=>c.name===sessionName);assert(a?.httpOnly&&a.secure&&b?.httpOnly&&b.secure&&a.value!==b.value);
    proof=(await send(page,'auth/session')).body.csrfToken;otherProof=(await send(other,'auth/session')).body.csrfToken;
   });
   await t.test('real HTTP customer/vehicle parents and scoped advisory context precede association writes',async()=>{
    epoch=(await send(page,'business/vehicles/context',{},proof)).body.recoveryEpoch;one={...customer(),recoveryEpoch:epoch};two={...customer(),recoveryEpoch:epoch};car={...vehicle(),recoveryEpoch:epoch};
    for(const [route,value]of [['business/customers/save',one],['business/customers/save',two],['business/vehicles/save',car]]){const r=await send(page,route,value,proof);assert.equal(r.status,200);assert.equal(r.body.state,'committed');}
    assert.equal((await send(page,root+'context',{vehicleId:car.vehicleId})).status,400);
    const context=await send(page,root+'context',{vehicleId:car.vehicleId},proof),different=await send(other,root+'context',{vehicleId:car.vehicleId},otherProof);
    assert.equal(context.status,200);assert.deepEqual(context.body,{schemaVersion:1,businessId:business,vehicleId:car.vehicleId,writeState:'ready',recoveryEpoch:epoch});assert.match(context.cache,/no-store/);assert.match(context.binding,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(context.binding,different.binding);
   });
   await t.test('explicit owner/billing, Unicode evidence, original receipt and complete history survive HTTPS',async()=>{
    opened={schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,expectedVersion:'0',action:'open',associationId:randomUUID(),customerId:one.customerId,vehicleId:car.vehicleId,effectiveAt:'2026-10-01T00:00:00.000000Z',relationship:'owner',isBilling:true,evidence:'Synthetic retained \\N =evidence é 😀',reason:null,nextAssociationId:null};
    const created=await send(page,root+'save',opened,proof);assert.equal(created.status,200);assert.equal(created.body.receipt.openedAssociationId,opened.associationId);assert.equal(created.body.receipt.associationVersion,'1');
    assert.deepEqual((await send(page,root+'save',opened,proof)).body,created.body);assert.deepEqual((await send(page,root+'operation',{operationId:opened.operationId},proof)).body,created.body);
    const history=await send(page,root+'history',{associationId:opened.associationId,afterVersion:'0',pageSize:20},proof);assert.equal(history.status,200);assert.equal(history.body.association.customer_id,one.customerId);assert.equal(history.body.association.evidence,opened.evidence);assert.equal(history.body.association.is_billing,true);assert.deepEqual(history.body.history[0].after,history.body.association);
    for(const patch of [{businessId:randomUUID()},{actorId:randomUUID()},{isBilling:null},{relationship:'billing'},{effectiveAt:'2026-02-30T00:00:00.000000Z'}])assert.equal((await send(page,root+'save',{...opened,...patch},proof)).status,400);
   });
   await t.test('atomic transfer retains both genuine customers and rejects overlapping owner periods without a claim',async()=>{
    transferred={...opened,operationId:randomUUID(),action:'transfer',expectedVersion:'1',customerId:two.customerId,effectiveAt:'2026-10-25T00:00:00.000001Z',reason:'Synthetic selected next customer',nextAssociationId:randomUUID()};const changed=await send(page,root+'save',transferred,proof);assert.equal(changed.status,200);assert.equal(changed.body.receipt.associationVersion,'2');
    const old=(await send(page,root+'history',{associationId:opened.associationId,afterVersion:'0',pageSize:1},proof)).body;assert.equal(old.hasMore,true);assert.equal(old.history.length,1);assert.equal(old.association.customer_id,one.customerId);assert.equal(old.association.valid_to,transferred.effectiveAt);
    const next=(await send(page,root+'history',{associationId:transferred.nextAssociationId,afterVersion:'0',pageSize:20},proof)).body.association;assert.equal(next.customer_id,two.customerId);assert.equal(next.valid_from,old.association.valid_to);assert.equal(next.is_billing,true);assert.equal(next.version,'1');
    const before=await send(page,root+'operation',{operationId:opened.operationId},proof);assert.equal(before.body.receipt.associationVersion,'1');
    const overlap={...opened,operationId:randomUUID(),associationId:randomUUID(),effectiveAt:transferred.effectiveAt,isBilling:false};const rejected=await send(page,root+'save',overlap,proof);assert.equal(rejected.status,409);assert.equal(rejected.body.reason,'owner_period');assert.deepEqual((await send(page,root+'operation',{operationId:overlap.operationId},proof)).body,{state:'absent'});
    const listed=await send(page,root+'list',{vehicleId:car.vehicleId,afterId:null,pageSize:50},proof);assert.equal(listed.status,200);assert.equal(listed.body.associations.length,2);current=transferred.nextAssociationId;
   });
   await t.test('two authorized devices cannot both transfer the same retained period',async()=>{
    const requests=[one,two].map(c=>({...transferred,operationId:randomUUID(),associationId:current,customerId:c.customerId,effectiveAt:'2026-10-26T00:00:00.000001Z',nextAssociationId:randomUUID()})),results=await Promise.all([send(page,root+'save',requests[0],proof),send(other,root+'save',requests[1],otherProof)]);
    assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409&&r.body.reason==='version'&&r.body.currentVersion==='2').length,1);const winner=results[0].status===200?0:1,loser=1-winner;current=requests[winner].nextAssociationId;
    assert.deepEqual((await send(page,root+'operation',{operationId:requests[loser].operationId},proof)).body,{state:'absent'});assert.equal((await send(page,root+'list',{vehicleId:car.vehicleId,afterId:null,pageSize:50},proof)).body.associations.length,3);
   });
   await t.test('a dropped committed transfer resolves only the original receipt without a replacement',async()=>{
    dropped={...transferred,operationId:randomUUID(),associationId:current,customerId:one.customerId,effectiveAt:'2026-10-27T00:00:00.000001Z',nextAssociationId:randomUUID()};let calls=0,status;const pattern='**/api/business/vehicle-associations/save';
    const drop=async route=>{calls++;try{status=(await route.fetch()).status();}finally{await route.abort('failed');}};await page.route(pattern,drop);try{await assert.rejects(send(page,root+'save',dropped,proof));}finally{await page.unroute(pattern,drop);}assert.equal(calls,1);assert.equal(status,200);
    droppedReceipt=(await send(page,root+'operation',{operationId:dropped.operationId},proof)).body;assert.equal(droppedReceipt.receipt.openedAssociationId,dropped.nextAssociationId);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[business,dropped.operationId])).rows[0].n,1);
   });

   await t.test('the compiled stateless browser client verifies original open/close receipts and source history',async()=>{
    const clientProof=(await send(page,'auth/session')).body;
    await page.evaluate(code=>{const nonce=document.querySelector('script[nonce]')?.nonce;if(!nonce)throw new Error('SYNTHETIC_NONCE_REQUIRED');const script=document.createElement('script');script.nonce=nonce;script.textContent=code;document.head.append(script);},browserClient);
    assert.equal(await page.evaluate(()=>typeof globalThis.crestAssociationFixture?.associations),'object');
    const created={schemaVersion:1,operationId:randomUUID(),recoveryEpoch:epoch,expectedVersion:'0',body:{...opened,action:'open',associationId:randomUUID(),relationship:'keeper',isBilling:false,reason:null,nextAssociationId:null}};
    for(const key of ['schemaVersion','operationId','recoveryEpoch','expectedVersion'])delete created.body[key];
    const result=await page.evaluate(async({business,vehicleId,created,proof})=>{
      const api=globalThis.crestAssociationFixture.associations,signal=()=>new AbortController().signal;
      const context=await api.context(business,vehicleId,proof,signal()),saved=await api.save(business,created,proof,signal());
      const reference={operationId:created.operationId,recoveryEpoch:created.recoveryEpoch,expectedVersion:created.expectedVersion,action:created.body.action,associationId:created.body.associationId,vehicleId:created.body.vehicleId,nextAssociationId:created.body.nextAssociationId};
      const lookup=await api.lookup(business,reference,proof,signal()),list=await api.list(business,{vehicleId,afterId:null,pageSize:50},proof,signal()),history=await api.history(business,{associationId:created.body.associationId,afterVersion:'0',pageSize:20},proof,signal());
      return {context,saved,lookup,list,history};
    },{business,vehicleId:car.vehicleId,created,proof:clientProof});
    assert.equal(result.context.context.writeState,'ready');assert.deepEqual(result.saved,result.lookup);assert.equal(result.saved.receipt.openedAssociationId,created.body.associationId);assert(result.list.associations.some(r=>r.id===created.body.associationId));assert.equal(result.history.state,'found');assert.equal(result.history.association.is_billing,false);
    const close={...created,operationId:randomUUID(),expectedVersion:'1',body:{...created.body,action:'close',effectiveAt:'2026-10-28T00:00:00.000001Z',relationship:null,isBilling:null,evidence:null,reason:'Synthetic browser client retained close'}};
    const closed=await page.evaluate(async({business,created,close,proof})=>{
      const api=globalThis.crestAssociationFixture.associations,signal=()=>new AbortController().signal,closed=await api.save(business,close,proof,signal());
      const history=await api.history(business,{associationId:close.body.associationId,afterVersion:'0',pageSize:20},proof,signal()),original=await api.save(business,created,proof,signal());return {closed,history,original};
    },{business,created,close,proof:clientProof});
    assert.equal(closed.closed.receipt.associationVersion,'2');assert.deepEqual(closed.history.history.map(e=>e.action),['open','close']);assert.equal(closed.history.association.close_reason,close.body.reason);assert.deepEqual(closed.original,result.saved);
   });
   await t.test('paused writes preserve original receipts and fresh revocation denies association reads',async()=>{
    await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[business]);
    try{const context=(await send(page,root+'context',{vehicleId:car.vehicleId},proof)).body;assert.equal(context.writeState,'paused');assert.equal(context.recoveryEpoch,null);const replay=await send(page,root+'save',dropped,proof);assert.equal(replay.status,409);assert.equal(replay.body.error,'RECOVERY_REVIEW_REQUIRED');assert.deepEqual((await send(page,root+'operation',{operationId:dropped.operationId},proof)).body,droppedReceipt);}
    finally{await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[business]);}
    const cookie=(await second.cookies()).find(c=>c.name===sessionName);await client.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE token_hash=$1',[createHash('sha256').update(cookie.value,'ascii').digest()]);
    const denied=await send(other,root+'history',{associationId:opened.associationId,afterVersion:'0',pageSize:20},otherProof);assert.notEqual(denied.status,200);assert(!JSON.stringify(denied.body).includes(opened.evidence));
   });
  }finally{await first?.close();await second?.close();await browser.close();}
 });
}
