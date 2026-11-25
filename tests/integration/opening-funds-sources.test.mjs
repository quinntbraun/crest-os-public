import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {normalizeOpeningFundsEvidence,verifyOpeningFundsEvidence} from '../../src/bookkeeping/opening-funds-evidence.ts';
const document=reference=>({reference,sha256:createHash('sha256').update(reference).digest('hex')});
async function command(client,name,args){return(await client.query('SELECT crest_commands.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS value',args.map(value=>Array.isArray(value)?JSON.stringify(value):value))).rows[0].value;}
async function transaction(client,callback){await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');try{const result=await callback();await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}}
test('held customer-funds storage retains origins and obligations with atomic audit and original-result recovery',{timeout:240000},async()=>{
 const sandbox=await migrationSandbox();try{
  const target=await sandbox.database(),admin=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(admin,target);assert.equal((await sandbox.apply(target)).history.length,138);
  await sandbox.applyHeldSql(admin,await readFile(new URL('../../planning/proposals/20270202180000_opening_funds_sources.sql',import.meta.url),'utf8'));
  const web=await sandbox.connect(target),finance=await sandbox.connect(target);await web.query('SET ROLE crest_web');await finance.query('SET ROLE crest_finance_preview');
  const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap}),owner=await makeOwner(),second=await makeOwner(owner),other=await makeOwner();
  await admin.query("INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin) SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1",[owner.business,owner.actor]);
  const authority=()=>[...owner.auth(),owner.epoch],run=(name,args)=>transaction(finance,()=>command(finance,name,args));
  const unknown={state:'unknown',evidence:null,note:'No opening conclusion yet'},body={cutoverOn:'2026-06-01',cutoverAt:'2026-06-01T00:00:00Z',source:document('Synthetic boundary'),equityBasis:'Synthetic evidenced net position',banks:[],controls:Object.fromEntries(['receivables','customerFunds','supplierPayables','taxLiabilities','otherLiabilities','cashAndChecks','wallets','otherAssets'].map(key=>[key,unknown]))};
  await run('save_fictional_opening_worksheet',[...authority(),randomUUID(),'0',body]);
  const root={rootId:randomUUID(),sourceNamespace:'synthetic.legacy',externalId:'receipt-001',receivedOn:'2026-05-01',receivedCents:'15000',receiptEvidence:document('Synthetic receipt'),reductions:[{kind:'application',reference:'job-001',occurredOn:'2026-05-10',amountCents:'5000',evidence:document('Synthetic historical application')}],items:[{itemId:randomUUID(),customerId:owner.customer,heldCents:'6000',obligationEvidence:document('Synthetic obligation1'),refundableCeilingCents:null,refundEvidence:null},{itemId:randomUUID(),customerId:second.customer,heldCents:'4000',obligationEvidence:document('Synthetic obligation2'),refundableCeilingCents:'0',refundEvidence:document('Synthetic nonrefundable basis')}]};
  const reason='Retain synthetic pre-cutover obligations',operation=randomUUID(),args=[...authority(),operation,'1','0',[root],reason];
  const counts=async()=>(await admin.query('SELECT (SELECT count(*)::text FROM crest.financial_events) AS events,(SELECT count(*)::text FROM crest.journal_entries) AS journals,(SELECT count(*)::text FROM crest.journal_lines) AS lines,(SELECT count(*)::text FROM crest.accounting_periods) AS periods')).rows[0];const before=await counts();
  const saved=await run('save_fictional_opening_funds_schedule',args);assert.equal(saved.state,'committed');assert.equal(saved.receipt.revision,'1');assert.deepEqual(saved.receipt.evidence,normalizeOpeningFundsEvidence({schemaVersion:1,roots:[root],reason},'2026-06-01'));verifyOpeningFundsEvidence(saved.receipt.evidence);
  assert.deepEqual(await run('save_fictional_opening_funds_schedule',args),saved);assert.deepEqual(await run('lookup_fictional_opening_funds_save',[...authority(),operation,owner.epoch]),saved);
  const changed=structuredClone(root);changed.items[0].refundableCeilingCents='2000';changed.items[0].refundEvidence=document('Synthetic partial refund basis');
  const revised=await run('save_fictional_opening_funds_schedule',[...authority(),randomUUID(),'1','1',[changed],reason]);assert.equal(revised.receipt.revision,'2');assert.equal(revised.receipt.evidence.totals.refundableCeilingCents,'2000');assert.deepEqual(await run('save_fictional_opening_funds_schedule',args),saved);
  const projection=await run('read_fictional_opening_funds_schedule',[...authority(),'1']);assert.deepEqual(projection.schedule,revised.receipt);
  const saveChanged=(roots,worksheet='1',revision='2')=>run('save_fictional_opening_funds_schedule',[...authority(),randomUUID(),worksheet,revision,roots,reason]);
  await assert.rejects(saveChanged([changed],'2'),{message:'OPENING_WORKSHEET_REVISION_CONFLICT'});await assert.rejects(saveChanged([changed],'1','0'),{message:'OPENING_FUNDS_REVISION_CONFLICT'});
  const wrongCustomer=structuredClone(changed);wrongCustomer.items[0].customerId=other.customer;await assert.rejects(saveChanged([wrongCustomer]),{message:'OPENING_FUNDS_CUSTOMER_REQUIRED'});
  const rebound=structuredClone(changed);rebound.items[0].customerId=second.customer;await assert.rejects(saveChanged([rebound]),{message:'OPENING_FUNDS_ITEM_IDENTITY_CONFLICT'});
  const reboundOrigin=structuredClone(changed);reboundOrigin.externalId='different-receipt';await assert.rejects(saveChanged([reboundOrigin]),{message:'OPENING_FUNDS_ORIGIN_IDENTITY_CONFLICT'});
  const alias=structuredClone(changed);alias.rootId=randomUUID();alias.items=alias.items.map(item=>({...item,itemId:randomUUID()}));await assert.rejects(saveChanged([alias]),{code:'23505'});
  const imbalance=structuredClone(changed);imbalance.items[0].heldCents='6001';await assert.rejects(saveChanged([imbalance]),{message:'OPENING_FUNDS_BALANCE_REQUIRED'});
  const tooRefundable=structuredClone(changed);tooRefundable.items[0].refundableCeilingCents='6001';await assert.rejects(saveChanged([tooRefundable]),{message:'OPENING_FUNDS_REFUND_CEILING_REQUIRED'});
  assert.equal((await run('save_fictional_opening_funds_schedule',[...authority(),operation,'1','0',[changed],reason])).state,'conflict');
  await assert.rejects(transaction(web,()=>command(web,'read_fictional_opening_funds_schedule',[...authority(),'1'])),{code:'42501'});
  await assert.rejects(run('read_fictional_opening_funds_schedule',[...owner.auth(),randomUUID(),'1']),{message:'RECOVERY_REVIEW_REQUIRED'});
  await assert.rejects(run('read_fictional_opening_funds_schedule',[...other.auth().slice(0,-1),owner.business,owner.epoch,'1']),{code:'42501'});
  await assert.rejects(finance.query('SELECT * FROM crest.opening_funds_origins'),{code:'42501'});
  await assert.rejects(admin.query("UPDATE crest.opening_funds_items SET customer_id=$1 WHERE id=$2",[second.customer,root.items[0].itemId]),{code:'55000',message:'CREST_RETAINED_COMMAND_HISTORY'});
  await assert.rejects(admin.query('TRUNCATE crest.opening_funds_schedule_revisions'),{code:'55000',message:'CREST_RETAINED_COMMAND_HISTORY'});
  await assert.rejects(transaction(admin,()=>admin.query("INSERT INTO crest.opening_funds_origins(id,business_id,source_namespace,external_id,operation_id,recorded_by) VALUES($1,$2,'synthetic.forged','orphan',$3,$4)",[randomUUID(),owner.business,operation,owner.actor])),{message:'OPENING_FUNDS_ORIGIN_AUDIT_REQUIRED'});
  const absent=randomUUID();assert.equal((await run('lookup_fictional_opening_funds_save',[...authority(),absent,owner.epoch])).state,'absent');assert.equal((await run('retire_fictional_opening_funds_save',[...authority(),absent,owner.epoch,'Discard the absent synthetic save'])).state,'retired');assert.equal((await run('save_fictional_opening_funds_schedule',[...authority(),absent,'1','2',[changed],reason])).state,'retired');
  const exporter=await sandbox.connect(target);await exporter.query('SET ROLE crest_export');
  await assert.rejects(command(exporter,'opening_funds_source_snapshot',[owner.business]),{message:'OPENING_FUNDS_SOURCE_SNAPSHOT_REQUIRED'});
  await assert.rejects(command(web,'opening_funds_source_snapshot',[owner.business]),{code:'42501'});
  await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{
   const source=await command(exporter,'opening_funds_source_snapshot',[owner.business]);assert.equal(source.origins.length,1);assert.equal(source.items.length,2);assert.equal(source.revisions.length,2);assert.equal(source.catalogRegistered,false);assert.equal(source.completeBusinessExport,false);assert.equal(source.origins[0].external_id,root.externalId);assert.deepEqual(source.revisions.map(r=>r.receipt),[saved.receipt,revised.receipt]);for(const revision of source.revisions){assert.equal(createHash('sha256').update(revision.evidenceText).digest('hex'),revision.row.evidence_sha256);assert.deepEqual(JSON.parse(revision.evidenceText),revision.receipt.evidence);}
   const empty=await command(exporter,'opening_funds_source_snapshot',[other.business]);assert.deepEqual(empty.origins,[]);assert.deepEqual(empty.items,[]);assert.deepEqual(empty.revisions,[]);
  }finally{await exporter.query('ROLLBACK');}
  const rows=(await admin.query('SELECT (SELECT count(*)::int FROM crest.opening_funds_origins) AS origins,(SELECT count(*)::int FROM crest.opening_funds_items) AS items,(SELECT count(*)::int FROM crest.opening_funds_schedule_revisions) AS revisions')).rows[0];assert.deepEqual(rows,{origins:1,items:2,revisions:2});assert.deepEqual(await counts(),before);assert.equal((await admin.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,138);
 }finally{await sandbox.close();}
});
