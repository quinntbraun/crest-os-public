import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {after,before,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {createFieldOperationFixture} from '../support/field-operation-fixture.mjs';
import {captureFieldWorkspaceFixture} from '../support/field-workspace-source-fixture.mjs';
import {formatFieldSourceCsv} from '../../src/operations/field-source.ts';
import {formatFieldWorkspaceSources} from '../../src/operations/field-workspace-source.ts';
import {readCustomerCsv} from '../support/customer-fixture.ts';

const read='crest_commands.read_review_message_outcome(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)';
const write='crest_commands.record_review_message_outcome(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,uuid,jsonb)';
const candidate=await readFile(new URL('../../planning/proposals/review-message-outcomes.sql',import.meta.url),'utf8');
const access=await readFile(new URL('../../planning/proposals/review-message-outcome-access.sql',import.meta.url),'utf8');
const value=async(c,sql,args=[])=> (await c.query(sql,args)).rows[0].value;
let sandbox,client,web,second,login,fixtures;

before(async()=>{
 sandbox=await migrationSandbox();
 const target=await sandbox.database();
 client=await sandbox.connect(target);
 await sandbox.apply(target,await sandbox.prefix(0),true);
 await installProviderSchema(client,target);
 assert.equal((await sandbox.apply(target,await sandbox.prefix(63))).history.length,63);
 await client.query('BEGIN');
 try{
  await client.query('ALTER TABLE crest.message_events DISABLE TRIGGER completion_stamp');
  await assert.rejects(client.query(candidate),{code:'42501',message:'CREST_REVIEW_OUTCOME_SOURCE_REVIEW_REQUIRED'});
 }finally{await client.query('ROLLBACK');}
 await client.query(candidate);
 await client.query('BEGIN');
 try{
  await client.query("ALTER FUNCTION crest_private.original_operation_reference_valid(jsonb) SET statement_timeout='1s'");
  await assert.rejects(client.query(access),{code:'42501',message:'CREST_REVIEW_OUTCOME_ACCESS_REVIEW_REQUIRED'});
 }finally{await client.query('ROLLBACK');}
 await client.query(access);
 for(const role of ['crest_web','anon','authenticated','crest_export'])for(const routine of [read,write]){
  assert.equal(await value(client,"SELECT has_function_privilege($1,$2,'EXECUTE') value",[role,routine]),false);
 }
 await client.query('GRANT EXECUTE ON FUNCTION '+read+', '+write+' TO crest_web');
 login='crest_review_'+randomBytes(8).toString('hex');
 const password=randomBytes(32).toString('hex');
 await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");
 await sandbox.admin.query('GRANT crest_web TO '+login);
 const url=new URL(target);url.username=login;url.password=password;
 web=await sandbox.connect(url.toString());await web.query('SET ROLE crest_web');
 second=await sandbox.connect(url.toString());await second.query('SET ROLE crest_web');
 const accepted=createConfirmedBookingFixture({client,web,bootstrap:await value(client,
  "SELECT id value FROM crest_private.actors WHERE system_key='security_bootstrap'")});
 fixtures=createFieldOperationFixture({client,web,accepted});
},{timeout:240000});

after(async()=>{
 await second?.end();await web?.end();
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
const count=(table,operation)=>value(client,'SELECT count(*)::int value FROM '+table+' WHERE operation_id=$1',[operation]);

test('reads a saved preparation only within the authorized business and excludes suppressed drafts',async()=>{
 const p=await completed(),other=await completed({contact:false});
 const head=await readHead(p);
 assert.deepEqual(Object.keys(head).sort(),['businessId','effectiveAt','eventId','jobId','kind','messageId','reason','schemaVersion']);
 assert.equal(head.businessId,p.business);
 assert.equal(head.messageId,p.completion.receipt.messageId);
 assert.equal(head.kind,'prepared');
 assert.equal(head.reason,null);
 assert.deepEqual(await readHead(other),{state:'absent'});
 assert.deepEqual(await readHead(other,p.job),{state:'absent'});
 assert.deepEqual(await readHead(p,randomUUID()),{state:'absent'});
 assert.deepEqual(await record(other,head,'opened'),{state:'conflict',reason:'message'});
});

test('records opened, failed, skipped and explicit sent evidence without rewriting the saved draft',async()=>{
 const p=await completed(),prepared=await readHead(p),message=prepared.messageId;
 const draft=await value(client,'SELECT to_jsonb(m) value FROM crest.messages m WHERE id=$1',[message]);
 const opening=randomUUID(),opened=await record(p,prepared,'opened',null,{operation:opening});
 assert.equal(opened.state,'committed');
 assert.equal(opened.receipt.kind,'opened');
 assert.equal(opened.receipt.priorEventId,prepared.eventId);
 assert.equal(opened.receipt.auditIds.length,1);
 assert.deepEqual(await record(p,prepared,'opened',null,{operation:opening}),opened);
 assert.deepEqual(await record(p,prepared,'skipped','Synthetic different request',{operation:opening}),{state:'conflict',reason:'operation'});
 const openedHead=await readHead(p);
 await assert.rejects(record(p,openedHead,'failed'),{code:'22023',message:'CREST_REVIEW_OUTCOME_INPUT_REQUIRED'});
 assert.equal((await record(p,openedHead,'failed','Synthetic native app unavailable')).state,'committed');
 const failedHead=await readHead(p);
 assert.equal(failedHead.kind,'failed');
 assert.equal(failedHead.reason,'Synthetic native app unavailable');
 assert.equal((await record(p,failedHead,'skipped','Synthetic owner deferred outreach')).state,'committed');
 const skipped=await readHead(p);
 assert.equal(skipped.kind,'skipped');
 const sent=await record(p,skipped,'owner_confirmed_sent');
 assert.equal(sent.state,'committed');
 assert.equal(sent.receipt.kind,'owner_confirmed_sent');
 assert.equal(sent.receipt.actorId,p.actor);
 assert.equal((await readHead(p)).eventId,sent.receipt.eventId);
 assert.deepEqual(await record(p,await readHead(p),'opened'),{state:'conflict',reason:'sent'});
 assert.deepEqual(await record(p,skipped,'owner_confirmed_sent'),{state:'conflict',reason:'version'});
 assert.deepEqual(await record(p,prepared,'opened',null,{operation:opening}),opened);
 assert.deepEqual(await value(client,'SELECT to_jsonb(m) value FROM crest.messages m WHERE id=$1',[message]),draft);
 assert.deepEqual((await client.query('SELECT kind FROM crest.message_events WHERE message_id=$1 ORDER BY kind',[message])).rows.map(x=>x.kind),
  ['failed','opened','owner_confirmed_sent','prepared','skipped']);
 assert.equal(await count('crest_private.audit_events',sent.receipt.operationId),1);
 assert.equal(await count('crest.job_events',sent.receipt.operationId),0);
});

test('serializes concurrent saves against the same predecessor and leaves no losing operation',async()=>{
 const p=await completed(),head=await readHead(p),first=randomUUID(),other=randomUUID();
 const attempts=await Promise.all([record(p,head,'opened',null,{operation:first}),
  record(p,head,'skipped','Synthetic defer',{operation:other,connection:second})]);
 assert.equal(attempts.filter(r=>r.state==='committed').length,1);
 const firstWon=attempts[0].state==='committed',loser=firstWon?other:first,winner=attempts[firstWon?0:1];
 assert.deepEqual(attempts[firstWon?1:0],{state:'conflict',reason:'version'});
 for(const table of ['crest_private.operations','crest_private.audit_events','crest.message_events'])assert.equal(await count(table,loser),0);
 assert.equal((await readHead(p)).eventId,winner.receipt.eventId);
});

test('denies out-of-command outcome insertion and keeps both sources append-only',async()=>{
 const p=await completed(),head=await readHead(p);
 await assert.rejects(client.query(
  "INSERT INTO crest.message_events(business_id,job_id,message_id,kind,effective_at,created_by,operation_id) VALUES($1,$2,$3,'owner_confirmed_sent',clock_timestamp(),$4,$5)",
  [p.business,p.job,head.messageId,p.actor,randomUUID()]),{code:'42501',message:'CREST_REVIEW_OUTCOME_CONTEXT_REQUIRED'});
 await assert.rejects(client.query("UPDATE crest.message_events SET kind='owner_confirmed_sent' WHERE id=$1",[head.eventId]),{code:'55000'});
 await assert.rejects(client.query('DELETE FROM crest.messages WHERE id=$1',[head.messageId]),{code:'55000'});
 assert.deepEqual(await readHead(p),head);
});

test('recovers an exact original without the private reason and fences a retired request',async()=>{
 const p=await completed(),prepared=await readHead(p),operationId=randomUUID();
 const original={schemaVersion:1,businessId:p.business,commandType:'operations.message.record_outcome',
  reference:{operationId,recoveryEpoch:p.epoch,jobId:p.job,messageId:prepared.messageId,
   priorEventId:prepared.eventId,action:'failed'}};
 const lookup=(input=original)=>value(web,'SELECT crest_commands.lookup_scheduling_original($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...p.auth(),input]);
 assert.deepEqual(await lookup(),{state:'absent'});
 const saved=await record(p,prepared,'failed','Synthetic private outcome reason',{operation:operationId});
 assert.equal(saved.state,'committed');
 const expected={schemaVersion:1,original,result:{state:'committed',receipt:{schemaVersion:1,
  commandType:original.commandType,businessId:p.business,actorId:p.actor,operationId,recoveryEpoch:p.epoch,
  subjectId:prepared.messageId,sourceRecordId:saved.receipt.eventId,sourceVersion:'1',sourceAuditIds:saved.receipt.auditIds}}};
 assert.deepEqual(await lookup(),expected);
 for(const key of ['messageId','priorEventId','jobId','action']){
  const altered={...original,reference:{...original.reference,[key]:key==='action'?'skipped':randomUUID()}};
  assert.deepEqual(await lookup(altered),{state:'conflict',reason:'operation'});
 }
 await assert.rejects(lookup({...original,reference:{...original.reference,reason:'Synthetic private data'}}),
  {code:'22023',message:'CREST_REVIEW_OUTCOME_INPUT_REQUIRED'});
 const latest=await readHead(p),discarded={...original,reference:{...original.reference,
  operationId:randomUUID(),priorEventId:latest.eventId,action:'opened'}};
 const retired=await value(web,'SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',
  [...p.auth(),p.epoch,discarded,'Synthetic owner discarded the interrupted action']);
 assert.equal(retired.state,'retired');
 assert.deepEqual(await record(p,latest,'opened',null,{operation:discarded.reference.operationId}),
  {state:'conflict',reason:'operation'});
 assert.equal((await record(p,latest,'opened')).state,'committed');
 assert.deepEqual(await lookup(),expected);
 assert.deepEqual(await lookup(discarded),{state:'absent'});
});

test('exports the original draft and its outcome chain, and refuses a forged predecessor',async()=>{
 const p=await completed(),prepared=await readHead(p);
 const opened=await record(p,prepared,'opened');
 const sent=await record(p,await readHead(p),'owner_confirmed_sent');
 assert.equal(opened.state,'committed');assert.equal(sent.state,'committed');
 await client.query('SET ROLE crest_export');
 let source;
 try{source=await captureFieldWorkspaceFixture(client,p.business);}finally{await client.query('RESET ROLE');}
 const {parts}=formatFieldWorkspaceSources(source),files=new Map(parts.map(part=>[part.name,part.content]));
 const [keys,...data]=readCustomerCsv(files.get('message_events.csv'));
 const events=data.map(row=>Object.fromEntries(keys.map((key,i)=>[key,row[i]])));
 assert.equal(events.find(event=>event.id===prepared.eventId)?.kind,'prepared');
 assert.equal(events.find(event=>event.id===opened.receipt.eventId)?.kind,'opened');
 assert.equal(events.find(event=>event.id===sent.receipt.eventId)?.kind,'owner_confirmed_sent');
 assert.ok(files.get('messages.csv').includes('https://example.invalid/crest-review'));
 const altered=structuredClone(source.field),history=JSON.parse(altered.historyEvidence);
 const entry=history.records.find(item=>item.kind==='operation'&&JSON.parse(item.canonicalEvidence).row.operation_id===sent.receipt.operationId);
 const operation=JSON.parse(entry.canonicalEvidence),result=JSON.parse(operation.row.result);
 result.request.priorEventId=prepared.eventId;
 result.receipt.priorEventId=prepared.eventId;
 operation.row.result=JSON.stringify(result);
 entry.canonicalEvidence=JSON.stringify(operation);
 entry.evidenceHash=createHash('sha256').update(entry.canonicalEvidence).digest('hex');
 history.evidenceBytes=history.records.reduce((total,item)=>total+Buffer.byteLength(item.canonicalEvidence),0);
 altered.historyEvidence=JSON.stringify(history);
 assert.throws(()=>formatFieldSourceCsv(altered),/FIELD_SOURCE_REVIEW_REQUIRED/);
});

