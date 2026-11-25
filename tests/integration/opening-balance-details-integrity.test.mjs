// Controlled authority fixture and direct fixture inserts prove database guards.
// There is still no application writer or normalizer/command acceptance here.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {normalizeOpeningBalanceDetails,openingBalanceDetailKinds} from '../../src/bookkeeping/opening-balance-details-contract.ts';
const document={reference:'Fictional retained opening detail',sha256:'a'.repeat(64)};
async function transaction(client,fn){await client.query('BEGIN');try{const result=await fn();await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}}
async function command(client,name,args){return(await client.query('SELECT crest_commands.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS value',args)).rows[0].value;}
test('held opening detail history requires exact audit, source coverage, account pins and retained identities',{timeout:180000},async()=>{
 const sandbox=await migrationSandbox();
 try{
  const target=await sandbox.database(),admin=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(admin,target);
  assert.equal((await sandbox.apply(target,await sandbox.prefix(142))).history.length,142);
  for(const file of ['20270219180000_opening_balance_details_storage.sql','20270220180000_opening_balance_details_integrity.sql']){
   await sandbox.applyHeldSql(admin,await readFile(new URL('../../planning/proposals/'+file,import.meta.url),'utf8'));
  }
  const web=await sandbox.connect(target),finance=await sandbox.connect(target);
  await web.query('SET ROLE crest_web');await finance.query('SET ROLE crest_finance_preview');
  const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const owner=await createConfirmedBookingFixture({client:admin,web,bootstrap})();
  await admin.query("INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin) SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1",[owner.business,owner.actor]);
  const auth=()=>[...owner.auth(),owner.epoch],accountId=randomUUID();
  const identity={code:'1010',accountType:'asset',normalSide:'debit',controlKind:'cash',reportRole:'money'};
  await transaction(finance,()=>command(finance,'save_finance_account',[...auth(),randomUUID(),1,accountId,'0',{identity,name:'Fictional cash',active:true,reason:null}]));
  const unknown={state:'unknown',evidence:null,note:'Not approved'};
  const worksheet=await transaction(finance,()=>command(finance,'save_fictional_opening_worksheet',[...auth(),randomUUID(),'0',{
   cutoverOn:'2026-06-01',cutoverAt:'2026-06-01T00:00:00Z',source:document,equityBasis:'Retain fictional evidence only',banks:[],
   controls:Object.fromEntries(['receivables','customerFunds','supplierPayables','taxLiabilities','otherLiabilities','cashAndChecks','wallets','otherAssets'].map(key=>[key,unknown])),
  }]));
  const parent=(await admin.query('SELECT id FROM crest.opening_worksheet_revisions WHERE business_id=$1 AND revision=1',[owner.business])).rows[0].id;
  assert.equal(worksheet.state,'committed');
  const account=version=>({schemaVersion:1,id:accountId,currency:'USD',version,name:'Fictional cash',active:true,...identity});
  function body(version='1'){
   const item={itemId:randomUUID(),kind:'cash',sourceNamespace:'fixture.cash',externalId:randomUUID(),accountId,accountVersion:version,amountCents:'10000',evidence:document,detail:{location:'Business cash box',countedAt:'2026-05-31T23:59:59.999999Z'}};
   return normalizeOpeningBalanceDetails({schemaVersion:1,reason:'Retain opening cash evidence',items:[item],reviews:openingBalanceDetailKinds.map(kind=>({kind,state:kind==='cash'?'source_recorded':'unknown',evidence:kind==='cash'?document:null,note:'Fictional source only'}))},{cutoverOn:'2026-06-01',cutoverAt:'2026-06-01T00:00:00.000000Z'},[account(version)]);
  }
  const receipt=(row)=>(admin.query('SELECT crest_private.opening_balance_details_receipt(s) AS value FROM crest.opening_balance_details_schedule_revisions s WHERE id=$1',[row])).then(r=>r.rows[0].value);
  async function seed(evidence,revision=2,{missingItem=false,badAudit=false,badOperation=false}={}){
   return transaction(admin,async()=>{
    const operation=randomUUID(),auditId=randomUUID(),scheduleId=randomUUID();
    const prior=revision===1?null:(await admin.query('SELECT id FROM crest.opening_balance_details_schedule_revisions WHERE business_id=$1 AND worksheet_revision_id=$2 AND revision=$3',[owner.business,parent,revision-1])).rows[0]?.id;
    const previous=prior?await receipt(prior):null;
    await admin.query("INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES($1,$2,$3,$4,1,$5,$6,$3,'manual')",[owner.business,operation,owner.actor,badOperation?'fixture.wrong_command':'finance.opening_balance_details.save',owner.epoch,'b'.repeat(64)]);
    await admin.query("INSERT INTO crest.opening_balance_details_schedule_revisions(id,business_id,worksheet_revision_id,revision,operation_id,audit_event_id,recorded_by,evidence,evidence_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,encode(sha256(convert_to($8::jsonb::text,'UTF8')),'hex'))",[scheduleId,owner.business,parent,revision,operation,auditId,owner.actor,JSON.stringify(evidence)]);
    if(!missingItem)for(const [index,item]of evidence.items.entries()){
     await admin.query('INSERT INTO crest.opening_balance_details_origins(id,business_id,source_namespace,external_id,operation_id,recorded_by) VALUES($1,$2,$3,$4,$5,$6)',[item.itemId,owner.business,item.sourceNamespace,item.externalId,operation,owner.actor]);
     await admin.query('INSERT INTO crest.opening_balance_details_items(id,business_id,origin_id,source_kind,operation_id,recorded_by) VALUES($1,$2,$1,$3,$4,$5)',[item.itemId,owner.business,item.kind,operation,owner.actor]);
     await admin.query('INSERT INTO crest.opening_balance_details_item_revisions(business_id,schedule_revision_id,item_id,origin_id,source_kind,sequence,account_id,account_version,amount_cents,evidence,detail,operation_id,recorded_by) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[owner.business,scheduleId,item.itemId,item.kind,index+1,item.accountId,item.accountVersion,item.amountCents,item.evidence,item.detail,operation,owner.actor]);
    }
    const saved=await receipt(scheduleId);
    await admin.query("INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin) VALUES($1,$2,$3,$4,$4,'opening_balance_details_schedule_revisions',$5,$6,'review',$7,$8,'manual')",[auditId,owner.business,operation,owner.actor,scheduleId,revision,badAudit?'Wrong reason':evidence.reason,{schemaVersion:1,before:previous,after:saved}]);
    await admin.query("UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=$3 WHERE business_id=$1 AND operation_id=$2",[owner.business,operation,saved]);
    return saved;
   });
  }
  const before=(await admin.query('SELECT count(*)::integer AS count FROM crest.financial_events')).rows[0].count;
  const first=await seed(body(),1);assert.equal(first.revision,'1');assert.equal(first.evidence.items[0].amountCents,'10000');
  const counts=async()=>(await admin.query('SELECT (SELECT count(*)::integer FROM crest.opening_balance_details_schedule_revisions) AS schedules,(SELECT count(*)::integer FROM crest.opening_balance_details_item_revisions) AS items')).rows[0];
  await assert.rejects(seed(body(),2,{missingItem:true}),/OPENING_BALANCE_DETAILS_ITEM_COVERAGE_REQUIRED/);
  await assert.rejects(seed(body(),2,{badAudit:true}),/OPENING_BALANCE_DETAILS_AUDIT_REQUIRED/);
  await assert.rejects(seed(body(),2,{badOperation:true}),/OPENING_BALANCE_DETAILS_AUDIT_REQUIRED/);
  const totals=structuredClone(body());totals.totals.cash.amountCents='1';await assert.rejects(seed(totals),/OPENING_BALANCE_DETAILS_TOTALS_REQUIRED/);
  const wrong=structuredClone(body());wrong.cutoverAt='2026-06-01T00:00:00.000001Z';await assert.rejects(seed(wrong),/OPENING_BALANCE_DETAILS_BOUNDARY_REQUIRED/);
  const masquerade=structuredClone(body());masquerade.items[0].kind='other_asset';masquerade.items[0].detail={description:'Cannot replace cash control',basisEvidence:document};masquerade.totals.cash={amountCents:'0',itemCount:0};masquerade.totals.other_asset={amountCents:'10000',itemCount:1};
  await assert.rejects(seed(masquerade),/OPENING_BALANCE_DETAILS_ACCOUNT_REQUIRED/);
  await assert.rejects(transaction(admin,()=>admin.query("INSERT INTO crest.opening_balance_details_origins(id,business_id,source_namespace,external_id,operation_id,recorded_by) VALUES($1,$2,'fixture','orphan',$3,$4)",[randomUUID(),owner.business,first.operationId,owner.actor])),/OPENING_BALANCE_DETAILS_ORIGIN_AUDIT_REQUIRED/);
  assert.deepEqual(await counts(),{schedules:1,items:1});assert.deepEqual(await receipt(first.scheduleRevisionId),first);
  await transaction(finance,()=>command(finance,'save_finance_account',[...auth(),randomUUID(),1,accountId,'1',{identity:null,name:'Fictional cash reviewed again',active:true,reason:'Retain a new version'}]));
  await assert.rejects(seed(body()),/OPENING_BALANCE_DETAILS_ACCOUNT_REQUIRED/);
  const second=await seed(body('2'));assert.equal(second.revision,'2');assert.deepEqual(await receipt(first.scheduleRevisionId),first);
  assert.deepEqual(await counts(),{schedules:2,items:2});assert.equal((await admin.query('SELECT count(*)::integer AS count FROM crest.financial_events')).rows[0].count,before);
  assert.equal((await admin.query("SELECT has_table_privilege('crest_finance_account_owner','crest.opening_balance_details_schedule_revisions','INSERT') AS allowed")).rows[0].allowed,false);
  assert.equal((await admin.query("SELECT has_function_privilege('crest_finance_preview','crest_private.opening_balance_details_receipt(crest.opening_balance_details_schedule_revisions)','EXECUTE') AS allowed")).rows[0].allowed,false);
  console.log('Held integrity SHA256='+createHash('sha256').update(await readFile(new URL('../../planning/proposals/20270220180000_opening_balance_details_integrity.sql',import.meta.url))).digest('hex')+'; fixture revisions and refusal rollback retained; no app writer granted.');
 }finally{await sandbox.close();}
});
