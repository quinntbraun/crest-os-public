import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {createFieldOperationFixture} from '../support/field-operation-fixture.mjs';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {parseReviewMessageHistory} from '../../src/operations/review-message-history-contract.ts';

const historyRoutine='crest_commands.read_review_message_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,text,uuid)';
const value=async(c,sql,args=[])=> (await c.query(sql,args)).rows[0].value;
let sandbox,client,web,login,fixtures,accepted;

before(async()=>{
 sandbox=await migrationSandbox();
 const target=await sandbox.database();
 client=await sandbox.connect(target);
 await sandbox.apply(target,await sandbox.prefix(0),true);
 await installProviderSchema(client,target);
 assert.equal((await sandbox.apply(target,await sandbox.prefix(64))).history.length,64);
 assert.equal(await value(client,'SELECT to_regprocedure($1) IS NULL value',[historyRoutine]),true);
 assert.equal((await sandbox.apply(target)).history.length,65);
 for(const role of ['anon','authenticated','crest_export'])
  assert.equal(await value(client,"SELECT has_function_privilege($1,$2,'EXECUTE') value",[role,historyRoutine]),false);
 assert.equal(await value(client,"SELECT EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.oid=$1::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') value",[historyRoutine]),false);
 assert.equal(await value(client,"SELECT has_function_privilege('crest_web',$1,'EXECUTE') value",[historyRoutine]),true);
 login='crest_review_'+randomBytes(8).toString('hex');
 const password=randomBytes(32).toString('hex');
 await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");
 await sandbox.admin.query('GRANT crest_web TO '+login);
 const url=new URL(target);url.username=login;url.password=password;
 web=await sandbox.connect(url.toString());await web.query('SET ROLE crest_web');
 accepted=createConfirmedBookingFixture({client,web,bootstrap:await value(client,
  "SELECT id value FROM crest_private.actors WHERE system_key='security_bootstrap'")});
 fixtures=createFieldOperationFixture({client,web,accepted});
},{timeout:240000});

after(async()=>{
 await web?.end();
 if(login)await sandbox.admin.query('DROP ROLE '+login);
 await sandbox?.close();
});

async function completed({contact=true}={}){
 const p=await fixtures.fixture({contact});
 await fixtures.field(p,'direct_arrive');
 const body=await fixtures.completion(p);
 if(contact){
  body.review.reviewUrl='https://example.invalid/crest-review';
  body.review.expectedCustomerVersion='2';
  body.review.contactReviewReason='Synthetic owner verified the preferred phone';
 }
 const result=await value(web,'SELECT crest_commands.complete_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
  [...p.auth(),p.epoch,randomUUID(),p.job,p.version,body]);
 assert.equal(result.state,'committed');
 assert.equal(result.receipt.messageId!==null,contact);
 return {...p,completion:result};
}
const readHead=(p,job=p.job)=>value(web,'SELECT crest_commands.read_review_message_outcome($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...p.auth(),job]);
const record=(p,head,kind,reason=null,{operation=randomUUID(),connection=web}={})=>
 value(connection,'SELECT crest_commands.record_review_message_outcome($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) value',[
  ...p.auth(),p.epoch,operation,head.jobId,head.messageId,head.eventId,{kind,reason},
 ]);

const readHistory = (p, kind, id, cursor=null, connection=web) => value(connection,
 'SELECT crest_commands.read_review_message_history($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value',
 [...p.auth(),kind,id,cursor?.source??null,cursor?.id??null]);

test('job and customer read their saved preparation and subsequent outcomes without exposing message or recipient text',async()=>{
 const p=await completed(),head=await readHead(p);
 const failed=await record(p,head,'failed','Synthetic native app failure');
 assert.equal(failed.state,'committed');
 const sent=await record(p,await readHead(p),'owner_confirmed_sent');
 assert.equal(sent.state,'committed');
 const page=parseReviewMessageHistory(await readHistory(p,'job',p.job),p.business,{kind:'job',id:p.job});
 const customer=parseReviewMessageHistory(await readHistory(p,'customer',p.customer),p.business,{kind:'customer',id:p.customer});
 assert.deepEqual(page.entries,customer.entries);
 assert.deepEqual(page.entries.map(row=>row.kind),['owner_confirmed_sent','failed','prepared']);
 assert.equal(page.entries[1].reason,'Synthetic native app failure');
 assert.equal(page.entries[0].actorId,p.actor);
 assert.equal(page.entries[0].id,sent.receipt.eventId);
 assert.equal(page.entries[0].channel,'text');
 assert.equal(page.next,null);
 assert(!JSON.stringify(page).includes('+12025550123'));
 assert(!JSON.stringify(page).includes('https://example.invalid/crest-review'));
});

test('preserves the reason a request was never prepared and returns the same empty shape for other business or missing IDs',async()=>{
 const p=await completed({contact:false}),other=await completed();
 const scope={kind:'customer',id:p.customer};
 const page=parseReviewMessageHistory(await readHistory(p,scope.kind,scope.id),p.business,scope);
 assert.equal(page.entries.length,1);
 assert.equal(page.entries[0].source,'request');
 assert.equal(page.entries[0].messageId,null);
 assert.equal(page.entries[0].channel,null);
 assert.equal(page.entries[0].kind,'pending');
 assert.equal(page.entries[0].suppression,'no_contact');
 assert.equal(page.entries[0].reason,p.booking.payload.appointment.contact_snapshot.reason);
 for(const [kind,id] of [['job',other.job],['customer',other.customer],['job',randomUUID()]]) {
  const hidden=await readHistory(p,kind,id);
  assert.deepEqual(hidden.entries,[]);
  assert.equal(hidden.next,null);
 }
 await assert.rejects(readHistory(p,'customer',p.customer,{source:'event',id:(await readHead(other)).eventId}),
  {code:'22023',message:'CREST_REVIEW_HISTORY_CURSOR_UNAVAILABLE'});
 await assert.rejects(readHistory(p,'customer',p.customer,{source:'invalid',id:randomUUID()}),{code:'22023'});
 await assert.rejects(readHistory(p,'jobs',p.job),{code:'22023'});
});

test('reads later pages without duplicating entries when another outcome is recorded between pages',async()=>{
 const p=await completed(),expected=[(await readHead(p)).eventId];
 for(let i=0;i<22;i++){
  const saved=await record(p,await readHead(p),'opened','Synthetic history entry '+i);
  assert.equal(saved.state,'committed');
  expected.unshift(saved.receipt.eventId);
 }
 const scope={kind:'job',id:p.job};
 const first=parseReviewMessageHistory(await readHistory(p,scope.kind,scope.id),p.business,scope);
 assert.equal(first.entries.length,20);
 assert.deepEqual(first.next,{source:'event',id:expected[19]});
 assert.equal((await record(p,await readHead(p),'failed','Synthetic later failure')).state,'committed');
 const secondPage=parseReviewMessageHistory(await readHistory(p,scope.kind,scope.id,first.next),p.business,scope);
 assert.equal(secondPage.next,null);
 assert.deepEqual([...first.entries,...secondPage.entries].map(row=>row.id),expected);
 assert.throws(()=>parseReviewMessageHistory({...first,next:{source:'event',id:expected[0]}},p.business,scope));
 assert.throws(()=>parseReviewMessageHistory({...first,entries:[...first.entries].reverse()},p.business,scope));
 assert.throws(()=>parseReviewMessageHistory({...first,entries:[{...first.entries[0],jobId:randomUUID()},...first.entries.slice(1)]},p.business,scope));
});

test('a customer sees both completed visits and a job can only read its own review history',async()=>{
 const first=await completed(),second=await accepted(first,{customerId:first.customer});
 const booking=confirmedBookingRequest(second);
 booking.expectedModeSequence='1';
 booking.payload.expectedCustomerVersion='2';
 for(const key of ['start_at','end_at','local_start','local_end']){
  booking.payload.appointment[key]=booking.payload.appointment[key].replace('2026-11-03','2026-11-04');
 }
 const saved=await value(web,'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
  [...second.auth(),second.epoch,booking.operationId,booking.jobId,booking.expectedModeSequence,booking.payload]);
 assert.equal(saved.state,'committed',JSON.stringify(saved));
 second.job=booking.jobId;second.version='1';
 await fixtures.field(second,'direct_arrive');
 const body=await fixtures.completion(second);
 body.review.expectedCustomerVersion='2';
 const completion=await value(web,'SELECT crest_commands.complete_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
  [...second.auth(),second.epoch,randomUUID(),second.job,second.version,body]);
 assert.equal(completion.state,'committed');
 const customer=await readHistory(first,'customer',first.customer);
 const firstVisit=await readHistory(first,'job',first.job);
 const secondVisit=await readHistory(first,'job',second.job);
 assert.deepEqual(customer.entries.map(row=>row.jobId),[second.job,first.job]);
 assert.deepEqual(customer.entries.map(row=>row.kind),['pending','prepared']);
 assert.deepEqual(firstVisit.entries,[customer.entries[1]]);
 assert.deepEqual(secondVisit.entries,[customer.entries[0]]);
});
