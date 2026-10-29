// Genuine Auth/TOTP + restricted web login + real PostgreSQL/COMMIT. Direct
// loopback HTTP is an explicit disposable test boundary, not deployed TLS or
// browser cookie acceptance. No traces, credentials or provider response dumps.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';

import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {TOTP,URI} from 'otpauth';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {startRealAuthService,authResult} from '../support/real-auth-service.mjs';
import {createProviderBoundary} from '../../src/security/provider-auth.ts';
import {createLiveProviderSessionLookup} from '../../src/security/provider-session-db.ts';
import {createProviderTokenStore} from '../../src/security/provider-token-store.ts';
import {createSessionLifecycle} from '../../src/security/session-lifecycle.ts';



import {createExpenseDirectory} from '../../src/bookkeeping/expenses/expense-directory.ts';
import {createReceiptDirectory} from '../../src/bookkeeping/expenses/receipt-directory.ts';
const receiptSql=await readFile(new URL('../../planning/proposals/owner-expense-receipts.sql',import.meta.url),'utf8');
let sandbox,target,client,service,login,config,boundary,tokens,lifecycle,bootstrap,ownsRole=false;
const signal=()=>new AbortController().signal;
async function transaction(run){await client.query('BEGIN');try{const r=await run();await client.query('COMMIT');return r;}catch(e){await client.query('ROLLBACK');throw e;}}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);await sandbox.apply(target,await sandbox.prefix(45));
 const sql=await readFile(new URL('../../planning/proposals/owner-expenses.sql',import.meta.url),'utf8');await transaction(()=>client.query(sql));ownsRole=true;await transaction(()=>client.query(receiptSql));
 login='crest_expense_http_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;config={connectionString:url.toString(),environment:'test'};
 service=await startRealAuthService(target);boundary=createProviderBoundary({issuer:service.issuer,publicKey:service.publicKey,environment:'test'},createLiveProviderSessionLookup(config));tokens=await createProviderTokenStore('synthetic-expense-http',[{id:'synthetic-expense-http',key:randomBytes(32)}]);lifecycle=createSessionLifecycle(config,boundary,tokens);bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
},{timeout:240000});
after(async()=>{try{await service?.close();if(login)await sandbox.admin.query('DROP ROLE '+login);if(ownsRole){await client.query('DROP OWNED BY crest_expense_owner CASCADE');await client.query('DROP ROLE crest_expense_owner');}}finally{await sandbox?.close();}});async function fixture(){
 const email='synthetic-quote-'+randomUUID()+'@example.com',password=randomBytes(32).toString('base64url'),user=authResult(await service.admin.admin.createUser({email,password,email_confirm:true}),'quote_user').user;assert(user?.id);
 const sdk=service.sdk();await sdk.initialize();authResult(await sdk.signInWithPassword({email,password}),'quote_enroll_password');const factor=authResult(await sdk.mfa.enroll({factorType:'totp',friendlyName:'Synthetic quote MFA'}),'quote_enroll'),totp=URI.parse(factor.totp.uri);assert(totp instanceof TOTP);authResult(await sdk.mfa.challengeAndVerify({factorId:factor.id,code:totp.generate()}),'quote_enroll_verify');
 const f=await transaction(async()=>{
  const actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic quote HTTP owner',$1,$2,$3,$3,'manual') RETURNING id",[service.issuer,user.id,bootstrap])).rows[0].id;
  const business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic quote HTTP business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);const epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;return {actor,business,epoch};
 });
 const issued=await lifecycle.login({email,password,factorId:factor.id,code:totp.generate()},{subject:user.id},false,signal()),credential=issued.cookieValueForResponse();
 return {...f,issued,subject:user.id,factorId:factor.id,credential,api:createExpenseDirectory(config,boundary,tokens)};
}const payload={paidOn:'2026-10-28',amountCents:'1299',currency:'USD',category:'supplies',description:'Synthetic MFA receipt expense',vendor:null,paymentMethod:'card',reference:null,notes:null,voided:false,changeReason:null};
test('genuine MFA owner reserves, reopens and publishes typed private receipt metadata',async()=>{const f=await fixture(),expenseId=randomUUID(),receiptId=randomUUID(),directory=createReceiptDirectory(config,boundary,tokens);await f.api.save(f.credential,{businessId:f.business,recoveryEpoch:f.epoch,operationId:randomUUID(),expenseId,expectedRevision:'0',payload},signal());const request={businessId:f.business,recoveryEpoch:f.epoch,operationId:randomUUID(),receiptId,expenseId,expenseRevision:'1',declaredType:'image/png',byteSize:100};const record=await directory.reserve(f.credential,request,signal());assert.deepEqual(await directory.reserve(f.credential,request,signal()),record);assert.deepEqual(await directory.read(f.credential,f.business,receiptId,signal()),record);await directory.writable(f.credential,record.reservation,signal());const prepared={status:'PrivateValidatedCandidate',validationVersion:'crest-image-v1-sharp-0.35.5',source:{sha256:'a'.repeat(64),byteSize:100,detectedType:'image/png',width:1,height:1},original:{key:record.reservation.originalKey,byteSize:100,sha256:'a'.repeat(64)},preview:{key:record.reservation.previewKey,byteSize:64,sha256:'b'.repeat(64),contentType:'image/jpeg',width:1,height:1}};const operation=randomUUID(),published=await directory.publish(f.credential,record.reservation,operation,prepared,signal());assert.equal(published.receiptVersion,'2');assert.deepEqual(await directory.publish(f.credential,record.reservation,operation,prepared,signal()),published);assert.equal((await directory.read(f.credential,f.business,receiptId,signal())).candidate.source.sha256,prepared.source.sha256);await lifecycle.logout(f.credential,signal());await assert.rejects(directory.read(f.credential,f.business,receiptId,signal()));});