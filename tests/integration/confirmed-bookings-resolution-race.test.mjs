// Actual unique-key waits between separate restricted sessions. No provider
// fake presented as MFA; genuine HTTP/Auth acceptance lives in the auth suite.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {parseSchedulingOriginal} from '../../src/operations/scheduling-original-contract.ts';
let sandbox,target,client,web,webUrl,login,fixture;
const value=async(c,q,args=[])=>(await c.query(q,args)).rows[0]?.value;
async function transaction(c,work){await c.query('BEGIN');try{const result=await work();await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}}
const modules=['fulfillment-mode-storage','fulfillment-mode-commands','confirmed-bookings-storage','confirmed-bookings-history','confirmed-bookings-invariants','confirmed-bookings-job-invariants','confirmed-bookings-commands','confirmed-bookings-reads','confirmed-bookings-enable','confirmed-bookings-cancel','confirmed-bookings-reschedule','confirmed-bookings-reschedule-commands','confirmed-bookings-resolution','confirmed-bookings-original','confirmed-bookings-context'];
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);await sandbox.apply(target,await sandbox.prefix(49));
 await transaction(client,async()=>{for(const name of modules)await client.query(await readFile(new URL('../../planning/proposals/'+name+'.sql',import.meta.url),'utf8'));});await sandbox.apply(target,await sandbox.prefix(49));
 login='crest_booking_recovery_race_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;webUrl=url.toString();web=await open();fixture=createConfirmedBookingFixture({client,web,bootstrap:await value(client,"SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'")});
},{timeout:240000});
after(async()=>{await web?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
async function open(){const c=await sandbox.connect(webUrl);await c.query('SET ROLE crest_web');await c.query("SET statement_timeout='5s'");return c;}
async function sibling(f){
 const provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,f.subject]);
 await client.query("WITH observed AS MATERIALIZED(SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[session,f.actor,provider,hash,randomBytes(32)]);
 return {...f,auth:()=>[hash,session,f.actor,'https://auth.example.com/auth/v1',f.subject,provider,new Date(Date.now()+300000),f.business]};
}
const bookSql='SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value';
const modeSql='SELECT crest_commands.save_fulfillment_modes($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12) AS value';
const retireSql='SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value';
async function plan(f,kind){
 const q=confirmedBookingRequest(f),operation=q.operationId;let sql,args,reference;
 if(kind.startsWith('operations.fulfillment_modes.')){
  if(kind.endsWith('.save'))assert.equal((await transaction(web,()=>value(web,modeSql,[...f.auth(),f.epoch,randomUUID(),'0',{mobileEnabled:true,dropoffEnabled:true,pickupReturnEnabled:false,reason:null}]))).state,'committed');
  const initial=kind.endsWith('.initialize'),sequence=initial?'0':'1';sql=modeSql;args=[f.epoch,operation,sequence,{mobileEnabled:initial,dropoffEnabled:true,pickupReturnEnabled:false,reason:initial?null:'Owner pauses new fictional mobile visits'}];reference={operationId:operation,recoveryEpoch:f.epoch,expectedSequence:sequence};
 }else if(kind==='operations.job.book'){
  sql=bookSql;args=[f.epoch,operation,q.jobId,'0',q.payload];reference={operationId:operation,recoveryEpoch:f.epoch,jobId:q.jobId,expectedModeSequence:'0'};
 }else{
  const saved=await transaction(web,()=>value(web,bookSql,[...f.auth(),f.epoch,randomUUID(),q.jobId,'0',q.payload]));assert.equal(saved.state,'committed');reference={operationId:operation,recoveryEpoch:f.epoch,jobId:q.jobId,expectedJobVersion:'1'};
  if(kind==='operations.job.cancel'){sql='SELECT crest_commands.cancel_scheduled_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value';args=[f.epoch,operation,q.jobId,'1',{reason:'Owner records fictional cancellation',customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null}}];}
  else{const appointment=Object.fromEntries(Object.entries(q.payload.appointment).filter(([key])=>!['customer_confirmation','unknown_travel_reviewed'].includes(key)));Object.assign(appointment,{start_at:'2026-11-14T14:00:00.654321Z',end_at:'2026-11-14T15:00:00.654321Z',local_start:'2026-11-14T14:00:00.654321',local_end:'2026-11-14T15:00:00.654321'});reference={...reference,action:'propose',latestAppointmentId:saved.receipt.appointmentId};sql='SELECT crest_commands.change_job_schedule($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value';args=[f.epoch,operation,q.jobId,'1',{action:'propose',reason:'Customer requests this alternative fictional time',latestAppointmentId:saved.receipt.appointmentId,expectedModeSequence:'1',appointment,customerConfirmation:null,conflictReview:null}];}
 }
 return {sql,args,original:parseSchedulingOriginal({schemaVersion:1,businessId:f.business,commandType:kind,reference})};
}
async function observedUniqueWait(waiter,blocker){
 const limit=Date.now()+3000;while(Date.now()<limit){await client.query('SELECT pg_stat_clear_snapshot()');if(await value(client,"SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.pid=$1 AND a.wait_event_type='Lock' AND a.wait_event='transactionid' AND $2=ANY(pg_blocking_pids(a.pid)) AND EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.relation='crest_private.operations'::regclass AND l.mode='RowExclusiveLock' AND l.granted)) AS value",[waiter,blocker]))return;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('actual original-operation unique-key wait required');
}
for(const kind of ['operations.fulfillment_modes.initialize','operations.fulfillment_modes.save','operations.job.book','operations.job.cancel','operations.job.reschedule'])for(const first of ['original','retirement'])test(kind+' serializes '+first+' first at the actual shared operation key',async()=>{
 const f=await fixture(),other=await sibling(f),p=await plan(f,kind),a=await open(),b=await open();let settled;
 const retireArgs=principal=>[...principal.auth(),f.epoch,p.original,'Owner explicitly retires this fictional lost original'];
 try{
  const blocker=await value(a,'SELECT pg_backend_pid() AS value'),waiter=await value(b,'SELECT pg_backend_pid() AS value');await a.query('BEGIN');const initial=await value(a,first==='original'?p.sql:retireSql,first==='original'?[...f.auth(),...p.args]:retireArgs(f));assert.equal(initial.state,first==='original'?'committed':'retired');
  settled=Promise.allSettled([value(b,first==='original'?retireSql:p.sql,first==='original'?retireArgs(other):[...other.auth(),...p.args])]);await observedUniqueWait(waiter,blocker);await a.query('COMMIT');const [next]=await settled;if(next.status==='rejected')throw next.reason;assert.equal(next.value.state,first==='original'?'original_recorded':'conflict');if(first==='retirement')assert.equal(next.value.reason,'operation');
  assert.equal(await value(client,'SELECT count(*)::int AS value FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[f.business,p.original.reference.operationId]),1);assert.equal(await value(client,'SELECT command_type AS value FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[f.business,p.original.reference.operationId]),first==='original'?kind:'operation.retire');
 }finally{await a.query('ROLLBACK').catch(()=>{});await settled?.catch(()=>{});await Promise.all([a.end(),b.end()]);}
});
