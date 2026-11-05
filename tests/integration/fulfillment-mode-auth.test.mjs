// Genuine password/TOTP and restricted server adapter on disposable PostgreSQL.
// Actual registered50; no browser-screen or production-activation claim.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {URI} from 'otpauth';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {startRealAuthService,authResult} from '../support/real-auth-service.mjs';
import {createProviderBoundary} from '../../src/security/provider-auth.ts';
import {createLiveProviderSessionLookup} from '../../src/security/provider-session-db.ts';
import {createProviderTokenStore} from '../../src/security/provider-token-store.ts';
import {createSessionLifecycle} from '../../src/security/session-lifecycle.ts';
import {createFulfillmentModeDirectory} from '../../src/operations/fulfillment-mode-directory.ts';
import {initialFulfillmentModes} from '../../src/operations/fulfillment-mode-contract.ts';
let sandbox,target,client,service,login,config,boundary,tokens,lifecycle,bootstrap,owner,other,initialRequest,changeRequest,initialResult,changeResult;
const signal=()=>new AbortController().signal;
async function transaction(work){await client.query('BEGIN');try{const result=await work();await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}}
async function fixture(){
 const email='synthetic-modes-'+randomUUID()+'@example.com',password=randomBytes(32).toString('base64url');
 const user=authResult(await service.admin.admin.createUser({email,password,email_confirm:true}),'mode_user').user;assert(user?.id);
 const sdk=service.sdk();await sdk.initialize();authResult(await sdk.signInWithPassword({email,password}),'mode_enroll_password');
 const factor=authResult(await sdk.mfa.enroll({factorType:'totp',friendlyName:'Synthetic mode MFA'}),'mode_enroll'),totp=URI.parse(factor.totp.uri);authResult(await sdk.mfa.challengeAndVerify({factorId:factor.id,code:totp.generate()}),'mode_enroll_verify');
 const f=await transaction(async()=>{
  const actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic mode Auth owner',$1,$2,$3,$3,'manual') RETURNING id",[service.issuer,user.id,bootstrap])).rows[0].id;
  const business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic mode business','America/Indiana/Indianapolis',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;
  await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
  const epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;return{actor,business,epoch};
 });
 const issued=await lifecycle.login({email,password,factorId:factor.id,code:totp.generate()},{subject:user.id},false,signal());
 return {...f,credential:issued.cookieValueForResponse(),api:createFulfillmentModeDirectory(config,boundary,tokens)};
}
const request=(f,sequence='0',payload={...initialFulfillmentModes})=>({schemaVersion:1,businessId:f.business,operationId:randomUUID(),recoveryEpoch:f.epoch,expectedSequence:sequence,payload});
const save=(f,r)=>f.api.save(f.credential,r,signal());
const lookup=(f,r)=>f.api.lookup(f.credential,{businessId:f.business,operationId:r.operationId},signal());
const history=f=>f.api.history(f.credential,{businessId:f.business,afterSequence:'0',pageSize:20},signal());
async function facts(){const rows=[];for(const table of ['crest.fulfillment_mode_versions','crest_private.operations','crest_private.audit_events'])rows.push((await client.query('SELECT row_to_json(v)::text AS value FROM '+table+' v ORDER BY row_to_json(v)::text COLLATE "C"')).rows);return rows;}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);await sandbox.apply(target,await sandbox.prefix(50));
 await sandbox.apply(target,await sandbox.prefix(50));
 login='crest_mode_auth_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);
 const url=new URL(target);url.username=login;url.password=password;config={connectionString:url.toString(),environment:'test'};
 service=await startRealAuthService(target);boundary=createProviderBoundary({issuer:service.issuer,publicKey:service.publicKey,environment:'test'},createLiveProviderSessionLookup(config));tokens=await createProviderTokenStore('synthetic-modes',[{id:'synthetic-modes',key:randomBytes(32)}]);lifecycle=createSessionLifecycle(config,boundary,tokens);bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
 owner=await fixture();other=await fixture();
},{timeout:240000});
after(async()=>{await service?.close();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});

test('genuine MFA saves canonical defaults, explicitly enables pickup, and reloads retained history through a fresh adapter',async()=>{
 assert.deepEqual((await history(owner)).forServer(),{state:'absent'});initialRequest=request(owner);const first=await save(owner,initialRequest);initialResult=first.forServer();assert.equal(initialResult.state,'committed');assert.throws(()=>JSON.stringify(first),/FULFILLMENT_MODE_VALUE_PRIVATE/);
 changeRequest=request(owner,'1',{...initialFulfillmentModes,pickupReturnEnabled:true,reason:'Owner enabled synthetic pickup service'});changeResult=(await save(owner,changeRequest)).forServer();assert.equal(changeResult.receipt.sequence,'2');
 const fresh={...owner,api:createFulfillmentModeDirectory(config,boundary,tokens)},rows=(await history(fresh)).forServer();assert.equal(rows.currentSequence,'2');assert.deepEqual(rows.versions.map(row=>row.pickup_return_enabled),[false,true]);assert.deepEqual((await lookup(fresh,initialRequest)).forServer(),initialResult);assert.deepEqual((await lookup(fresh,changeRequest)).forServer(),changeResult);
});
test('original replay and stale-version conflict preserve original records without another operation or audit',async()=>{
 const before=await facts();assert.deepEqual((await save(owner,changeRequest)).forServer(),changeResult);
 const stale=request(owner,'1',{...initialFulfillmentModes,reason:'Outdated second-device change'});assert.deepEqual((await save(owner,stale)).forServer(),{state:'conflict',reason:'version',currentSequence:'2'});assert.deepEqual(await facts(),before);
});
test('invalid inputs and already-aborted requests fail before submission with no persisted changes',async()=>{
 const before=await facts();await assert.rejects(save(owner,{...request(owner),payload:{...initialFulfillmentModes,pickupReturnEnabled:true}}),/FULFILLMENT_MODE_SAVE_NOT_SUBMITTED/);
 const controller=new AbortController();controller.abort();await assert.rejects(owner.api.save(owner.credential,request(owner,'2',{...initialFulfillmentModes,reason:'Never submitted'}),controller.signal),/FULFILLMENT_MODE_SAVE_NOT_SUBMITTED/);assert.deepEqual(await facts(),before);
});
test('a genuinely signed-in second business cannot read or mutate another owner mode history or original operation',async()=>{
 const before=await facts();await assert.rejects(other.api.history(other.credential,{businessId:owner.business,afterSequence:'0',pageSize:20},signal()),/FULFILLMENT_MODE_REQUEST_FAILED/);
 await assert.rejects(other.api.lookup(other.credential,{businessId:owner.business,operationId:changeRequest.operationId},signal()),/FULFILLMENT_MODE_REQUEST_FAILED/);
 await assert.rejects(save(other,request(owner,'2',{...initialFulfillmentModes,reason:'Forbidden cross-business change'})),/FULFILLMENT_MODE_SAVE_OUTCOME_UNKNOWN/);assert.deepEqual(await facts(),before);
});
test('recovery write pause preserves original lookup and read history while refusing new changes',async()=>{
 await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[owner.business]);
 try{const before=await facts();await assert.rejects(save(owner,request(owner,'2',{...initialFulfillmentModes,reason:'Blocked during synthetic recovery'})),/RECOVERY_REVIEW_REQUIRED/);assert.deepEqual((await lookup(owner,changeRequest)).forServer(),changeResult);assert.equal((await history(owner)).forServer().currentSequence,'2');assert.deepEqual(await facts(),before);}finally{await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[owner.business]);}
});
test('sign-out invalidates subsequent saves and reads without changing the retained mode settings',async()=>{
 await lifecycle.logout(owner.credential,signal());const before=await facts();await assert.rejects(save(owner,request(owner,'2',{...initialFulfillmentModes,reason:'Signed-out attempt'})),/FULFILLMENT_MODE_SAVE_NOT_SUBMITTED/);await assert.rejects(history(owner),/FULFILLMENT_MODE_REQUEST_FAILED/);assert.deepEqual(await facts(),before);
});
