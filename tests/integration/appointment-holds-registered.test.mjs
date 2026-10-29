import {formatHoldSourceCsv} from '../../src/operations/appointment-hold-csv.ts';
import {decodeCustomerCsv} from '../support/customer-fixture.ts';
import {formatBusinessHistoryCsv} from '../../src/security/business-history-csv.ts';
import {verifyBusinessHistoryEvidence} from '../../src/security/business-history-evidence.ts';
// Actual PostgreSQL storage + independent encrypted restore, synthetic only.
// Admin fixtures below are not trusted hold commands or a usable scheduling UI.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,after,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupDatabase,restoreDatabase,restoreLegacy46Database,connect,inventory,keyPair,privateWorkspace,recoveryCluster} from '../support/recovery-drill.mjs';
import {holdColumns,holdPayloadKeys,parseStoredHold,parseHoldCommitted} from '../../src/operations/appointment-hold-contract.ts';
let sandbox,target,client,bootstrap,prior,a,b,cluster,restored,login,web;
const value=async(c,q,args=[])=>(await c.query(q,args)).rows[0]?.value;
async function tx(c,work){await c.query('BEGIN');try{const result=await work();await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}}
async function state(){
 const subject=randomUUID(),issuer='https://auth.example.com/auth/v1';
 const actor=await value(client,"INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic hold owner',$1,$2,$3,$3,'manual') RETURNING id AS value",[issuer,subject,bootstrap]);
 const f=await tx(client,async()=>{const business=await value(client,"INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic hold business','America/Indiana/Indianapolis',$1,$1,'manual') RETURNING id AS value",[actor]);await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);const epoch=await value(client,"INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch AS value",[business,actor]);return{business,actor,epoch};});
 await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,'synthetic-'+subject+'@example.com']);
 const provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);
 await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,subject]);
 await client.query("WITH observed AS MATERIALIZED(SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[session,actor,provider,hash,randomBytes(32)]);
 const customer=randomUUID(),lead=randomUUID(),auth=[hash,session,actor,issuer,subject,provider,new Date(Date.now()+300000),f.business];
 const customerResult=await value(client,'SELECT crest_commands.save_customer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS value',[...auth,f.epoch,randomUUID(),customer,{displayName:'Synthetic hold customer',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null}]);assert.equal(customerResult.state,'committed');
 const leadResult=await value(client,'SELECT crest_commands.save_lead($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS value',[...auth,f.epoch,randomUUID(),lead,{label:'Synthetic prospective inquiry',customerId:null,sourceId:null,referralText:null,phone:null,email:null,requestedScope:null,availability:'Owner-recorded availability remains unchanged',estimatedCents:null,followUpAt:null,notes:null}]);assert.equal(leadResult.state,'committed');
 return{...f,customer,lead,auth};
}
const base=f=>({id:randomUUID(),business_id:f.business,hold_id:randomUUID(),sequence:'1',replaces_sequence:null,customer_id:f.customer,lead_id:null,label:'Synthetic unconfirmed hold',state:'proposed',start_at:'2026-10-29T14:00:00.000000Z',end_at:'2026-10-29T15:30:00.000000Z',timezone:'America/Indiana/Indianapolis',local_start:'2026-10-29T10:00:00.000000',local_end:'2026-10-29T11:30:00.000000',start_offset_minutes:-240,end_offset_minutes:-240,notes:null,reason:null});
const evidence=async()=>({holds:(await client.query('SELECT crest_private.appointment_hold_projection(h) AS value FROM crest.appointment_hold_versions h ORDER BY id')).rows,operations:(await client.query('SELECT to_jsonb(o) AS value FROM crest_private.operations o ORDER BY id')).rows,audit:(await client.query('SELECT to_jsonb(a) AS value FROM crest_private.audit_events a ORDER BY id')).rows});
let registry46,exporter,sourceRows;
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);registry46=await sandbox.apply(target,await sandbox.prefix(46));
 const signatures=["crest_commands.submit_quote_review(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,bigint,bigint,text)","crest_commands.save_quote_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,bigint,jsonb)"];
 const definitions=async()=>(await client.query('SELECT oid::regprocedure::text AS signature,pg_get_functiondef(oid) AS source FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY 1',[signatures])).rows,before=await definitions();
 prior=await sandbox.apply(target,await sandbox.prefix(47));assert.equal(prior.history.length,47);assert.deepEqual(prior.history.slice(0,46),registry46.history);assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(47))).history,prior.history);assert.deepEqual(await definitions(),before);
 bootstrap=await value(client,"SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'");a=await state();b=await state();
 login='crest_hold_registered_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web,crest_export TO '+login);const u=new URL(target);u.username=login;u.password=password;web=await connect(u.toString());await web.query('SET ROLE crest_web');exporter=await connect(u.toString());await exporter.query('SET ROLE crest_export');
},{timeout:240000});
after(async()=>{await restored?.end();await cluster?.close();await exporter?.end();await web?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
const save=(f,r,c=web)=>value(c,'SELECT crest_commands.save_appointment_hold($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[...f.auth,f.epoch,r.operation,r.hold,r.sequence,r.payload]);
const request=f=>({operation:randomUUID(),hold:randomUUID(),sequence:'0',payload:Object.fromEntries(holdPayloadKeys.map(k=>[k,base(f)[k]]))});
let firstRequest,firstReceipt,lastReceipt;
test('registered47 restricted saves retain originals and immutable withdrawal history',async()=>{
 firstRequest=request(a);firstReceipt=await save(a,firstRequest);parseHoldCommitted(firstReceipt,a.business,firstRequest.operation);const before=await evidence();assert.deepEqual(await save(a,firstRequest),firstReceipt);assert.deepEqual(await evidence(),before);
 const revised={...firstRequest,operation:randomUUID(),sequence:'1',payload:{...firstRequest.payload,label:'=Unicode proposal é 😀',notes:"'Private scope; literal \\\\N",reason:'Owner revised proposed time'}};assert.equal((await save(a,revised)).receipt.sequence,'2');
 lastReceipt=await save(a,{...revised,operation:randomUUID(),sequence:'2',payload:{...revised.payload,state:'withdrawn',reason:'No confirmed booking'}});assert.equal(lastReceipt.receipt.sequence,'3');
 assert.deepEqual(await value(web,'SELECT crest_commands.lookup_appointment_hold_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...a.auth,firstRequest.operation]),firstReceipt);
 await assert.rejects(web.query('SELECT * FROM crest.appointment_hold_versions'),e=>e.code==='42501');
});
test('stale, foreign-parent and paused writes preserve prior source',async()=>{
 const before=await evidence();assert.deepEqual(await save(a,{...firstRequest,operation:randomUUID()}),{state:'conflict',reason:'version',currentSequence:'3'});assert.deepEqual(await evidence(),before);
 await assert.rejects(save(a,{...request(a),payload:{...request(a).payload,customer_id:b.customer}}),e=>e.code==='23503');
 await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[a.business]);await assert.rejects(save(a,request(a)),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[a.business]);
});
test('original retirement prevents a lost absent save and preserves earlier quote review kind',async()=>{
 const r=request(a),original={schemaVersion:1,businessId:a.business,commandType:'operations.appointment_hold.save',reference:{operationId:r.operation,recoveryEpoch:a.epoch,holdId:r.hold,expectedSequence:'0'}};
 const retired=await value(web,'SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value',[...a.auth,a.epoch,original,'Owner cannot recover lost private draft']);assert.equal(retired.state,'retired');
 assert.deepEqual(await save(a,r),{state:'conflict',reason:'operation'});assert.equal(await value(client,'SELECT count(*)::int AS value FROM crest.appointment_hold_versions WHERE business_id=$1 AND hold_id=$2',[a.business,r.hold]),0);
 assert.equal(await value(client,"SELECT crest_private.original_operation_reference_valid($1) AS value",[{schemaVersion:1,businessId:a.business,commandType:'quote.review.approve',reference:{operationId:randomUUID(),recoveryEpoch:a.epoch,familyId:randomUUID(),revisionId:randomUUID(),expectedFamilyVersion:'1',expectedRevisionVersion:'1',expectedContentVersion:'1',approvalId:randomUUID()}}]),true);
});
async function collect(c,business){
 const context=await value(c,'SELECT crest_commands.appointment_hold_snapshot_context($1) AS value',[business]),rows=[];let after=null;
 for(let i=0;i<10001;i++){const page=await value(c,'SELECT crest_commands.appointment_hold_snapshot_versions($1,$2,$3,1) AS value',[business,context.snapshotToken,after]);assert.equal(page.businessId,business);assert.equal(page.snapshotToken,context.snapshotToken);for(const row of page.versions){parseStoredHold(row,business);assert(after===null||row.id>after);rows.push(row);after=row.id;}if(!page.hasMore){assert.equal(String(rows.length),context.expectedVersionCount);return rows;}assert.equal(page.versions.length,1);}throw Error('pagination did not terminate');
}
async function txMode(c,work){await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{const result=await work();await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}}
test('source reader requires one snapshot and binds tenant/token/pages with all22 columns',async()=>{
 await assert.rejects(value(exporter,'SELECT crest_commands.appointment_hold_snapshot_context($1) AS value',[a.business]),e=>e.code==='25001');
 sourceRows=await txMode(exporter,()=>collect(exporter,a.business));assert.equal(sourceRows.length,3);assert.deepEqual(sourceRows,(await client.query('SELECT crest_private.appointment_hold_projection(h) AS value FROM crest.appointment_hold_versions h WHERE business_id=$1 ORDER BY id',[a.business])).rows.map(r=>r.value));
 await txMode(exporter,async()=>{const c=await value(exporter,'SELECT crest_commands.appointment_hold_snapshot_context($1) AS value',[b.business]);await assert.rejects(value(exporter,'SELECT crest_commands.appointment_hold_snapshot_versions($1,$2,NULL,1) AS value',[a.business,c.snapshotToken]),e=>e.code==='22023');});
});
test('registered47 inventory covers all763 fields with unchanged credential exclusions',async()=>{
 const {verifyExportCoverage}=await import('../../src/tooling/export-coverage.ts'),coverage=JSON.parse(await readFile(new URL('../../planning/SECURITY_EXPORT_COVERAGE.json',import.meta.url),'utf8'));
 const observed=(await client.query("SELECT n.nspname||'.'||c.relname AS table,a.attname AS column FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname IN('crest','crest_private') AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2")).rows;
 assert.deepEqual(verifyExportCoverage(coverage,observed,47),{assurance:'schema_inventory_only',tables:47,requiredColumns:753,excludedColumns:10,partialEvidenceTables:9,completePortableExport:false,completeBackup:false});
});
test('encrypted47 independent restore rejects46 identity and preserves source, operations and audit bytes',async()=>{
 cluster=await recoveryCluster();const directory=await privateWorkspace(),keys=await keyPair(directory);const backup=await backupDatabase(client,target,directory,keys.recipient);assert.equal(backup.manifest.schemaVersion,47);const destination=await cluster.database();restored=await connect(destination);await assert.rejects(restoreLegacy46Database(directory,keys.path,destination),/SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest/);assert.deepEqual(await inventory(restored),[]);
 await restoreDatabase(directory,keys.path,destination);assert.deepEqual(await inventory(restored),backup.manifest.rows);assert.deepEqual((await restored.query('SELECT crest_private.appointment_hold_projection(h) AS value FROM crest.appointment_hold_versions h WHERE business_id=$1 ORDER BY id',[a.business])).rows.map(r=>r.value),sourceRows);await assert.rejects(restored.query('UPDATE crest.appointment_hold_versions SET label=label'),e=>e.code==='55000');assert.deepEqual((await restored.query('SELECT to_jsonb(o) AS value FROM crest_private.operations o ORDER BY id')).rows,(await client.query('SELECT to_jsonb(o) AS value FROM crest_private.operations o ORDER BY id')).rows);
},{timeout:180000});


async function captureHistory(c,business){const context=await value(c,'SELECT crest_commands.business_history_export_context($1) AS value',[business]),records=[];for(const kind of ['operation','audit_event']){let after=null,done=false;for(let i=0;i<100;i++){const rows=(await c.query('SELECT * FROM crest_commands.business_history_export_page($1,$2,$3,$4,20)',[business,context.snapshotToken,kind,after])).rows;if(!rows.length){done=true;break;}for(const row of rows)records.push({kind,recordId:row.record_id,representation:row.representation,canonicalEvidence:row.canonical_evidence,evidenceHash:row.evidence_hash});after=rows.at(-1).record_id;}assert(done);}const serialized=JSON.stringify({formatVersion:1,assurance:'snapshot_bytes_only',generationId:randomUUID(),context,evidenceBytes:records.reduce((n,row)=>n+Buffer.byteLength(row.canonicalEvidence),0),records}),verified=verifyBusinessHistoryEvidence(serialized,{businessId:business}),csv=formatBusinessHistoryCsv(serialized,{businessId:business});const operations=decodeCustomerCsv(csv.operations.csv,csv.operations.escapeMap).map(row=>({...row,schema_version:Number(row.schema_version),result_schema_version:Number(row.result_schema_version)})),audits=decodeCustomerCsv(csv.audits.csv,csv.audits.escapeMap);assert.deepEqual(operations,records.filter(row=>row.kind==='operation').map(row=>JSON.parse(row.canonicalEvidence).row));assert.deepEqual(audits,records.filter(row=>row.kind==='audit_event').map(row=>JSON.parse(row.canonicalEvidence).row));return {records,operations,audits,verified,csv};}
test('actual coordinator refuses changed46 predecessor atomically in a separate owned cluster',async()=>{
 const guardCluster=await recoveryCluster();let guardSandbox,guardAdmin;
 try{guardSandbox=await migrationSandbox(guardCluster.testDatabaseUrl);const owned=await guardSandbox.database();guardAdmin=await guardSandbox.connect(owned);await guardSandbox.apply(owned,await guardSandbox.prefix(0),true);await installProviderSchema(guardAdmin,owned);await guardSandbox.apply(owned,await guardSandbox.prefix(46));await guardAdmin.query('ALTER FUNCTION crest_private.original_operation_reference_valid(jsonb) STABLE');const before=await inventory(guardAdmin);
 await assert.rejects(guardSandbox.apply(owned,await guardSandbox.prefix(47)),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);assert.deepEqual(await inventory(guardAdmin),before);assert.equal(await value(guardAdmin,'SELECT count(*)::int AS value FROM supabase_migrations.schema_migrations'),46);assert.equal(await value(guardAdmin,"SELECT to_regclass('crest.appointment_hold_versions') AS value"),null);assert.equal(await value(guardAdmin,"SELECT count(*)::int AS value FROM pg_roles WHERE rolname IN('crest_hold_owner','crest_hold_integrity_owner')"),0);
 }finally{await guardSandbox?.close();await guardCluster.close();}
},{timeout:180000});


test('same-snapshot source CSV and paired history independently reimport private source bytes',async()=>{
 await txMode(exporter,async()=>{
  const rows=await collect(exporter,a.business),context=await value(exporter,'SELECT crest_commands.appointment_hold_snapshot_context($1) AS value',[a.business]),history=await captureHistory(exporter,a.business),files=formatHoldSourceCsv({businessId:a.business,snapshotToken:context.snapshotToken,expectedVersionCount:context.expectedVersionCount,versions:rows});
  const decoded=decodeCustomerCsv(files.versionsCsv,files.escapeMap).map(row=>({...row,start_offset_minutes:Number(row.start_offset_minutes),end_offset_minutes:Number(row.end_offset_minutes)}));assert.deepEqual(decoded,rows);
  for(const row of rows){assert(history.audits.some(event=>event.entity_kind==='appointment_holds'&&event.entity_id===row.hold_id&&event.entity_version===row.sequence));assert(history.operations.some(op=>op.operation_id===row.operation_id&&op.command_type==='operations.appointment_hold.save'));}
  assert.equal(JSON.parse(files.manifest).completeBackup,false);
  const neutral=await connect(await cluster.database());
  try{
   const type=key=>['sequence','replaces_sequence'].includes(key)?'bigint':['start_offset_minutes','end_offset_minutes'].includes(key)?'integer':['start_at','end_at','created_at'].includes(key)?'timestamptz':['local_start','local_end'].includes(key)?'timestamp':'text';
   await neutral.query('CREATE TABLE retained_proposals('+holdColumns.map(key=>'"'+key+'" '+type(key)).join(',')+')');
   for(const row of decoded)await neutral.query('INSERT INTO retained_proposals VALUES('+holdColumns.map((_,i)=>'$'+(i+1)).join(',')+')',holdColumns.map(key=>row[key]));
   const projection=holdColumns.map(key=>{
    let expression='"'+key+'"';
    if(['sequence','replaces_sequence'].includes(key))expression+='::text';
    else if(['start_at','end_at','created_at'].includes(key))expression='to_char('+expression+' AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\')';
    else if(['local_start','local_end'].includes(key))expression='to_char('+expression+',\'YYYY-MM-DD"T"HH24:MI:SS.US\')';
    return "'"+key+"',"+expression;
   }).join(',');
   assert.deepEqual((await neutral.query('SELECT jsonb_build_object('+projection+') AS value FROM retained_proposals ORDER BY id')).rows.map(r=>r.value),rows);
   assert.equal(await value(neutral,'SELECT count(*)::int AS value FROM pg_trigger WHERE NOT tgisinternal'),0);
  }finally{await neutral.end();}
 });
});
