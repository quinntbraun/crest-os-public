// Registered48 plus unregistered financial source construction; no activation.
// Actual export LOGIN, held snapshots and neutral same-cluster CSV reimport.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {verifyExportCoverage} from '../../src/tooling/export-coverage.ts';
import {formatExpenseSourceCsv,expenseSourceTables} from '../../src/bookkeeping/expenses/expense-source-csv.ts';
import {readCustomerCsv} from '../support/customer-fixture.ts';
let sandbox,client,target,ownsRole=false,exportLogin,exporter,baseline,f,source;
const value=(query,args=[])=>client.query(query,args).then(r=>r.rows[0].value);
async function transaction(fn){await client.query('BEGIN');try{const r=await fn();await client.query('COMMIT');return r;}catch(e){await client.query('ROLLBACK');throw e;}}
const issuer='https://auth.example.com/auth/v1';
async function state(){
 const bootstrap=await value("SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'"),subject=randomUUID();
 const actor=await value("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic expense owner',$1,$2,$3,$3,'manual') RETURNING id AS value",[issuer,subject,bootstrap]);
 const f=await transaction(async()=>{const business=await value("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic expenses','UTC',$1,$1,'manual') RETURNING id AS value",[actor]);await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);const epoch=await value("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch AS value",[business,actor]);return {business,actor,epoch,subject};});
 await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,`synthetic-${subject}@example.com`]);
 f.provider=randomUUID();f.session=randomUUID();f.hash=randomBytes(32);
 await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[f.provider,subject]);
 await client.query("WITH observed AS MATERIALIZED(SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[f.session,actor,f.provider,f.hash,randomBytes(32)]);return f;
}

const auth=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+300000),f.business];
const payload={paidOn:'2026-10-28',amountCents:'1299',currency:'USD',category:'supplies',description:'Synthetic wash soap',vendor:null,paymentMethod:'card',reference:null,notes:null,voided:false,changeReason:null};
const request=(patch={})=>({id:randomUUID(),operation:randomUUID(),version:'0',payload:{...payload},...patch});
async function asWeb(fn){return transaction(async()=>{await client.query('SET LOCAL ROLE crest_web');return fn();});}
const save=(f,r)=>asWeb(()=>value('SELECT crest_commands.save_expense($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS value',[...auth(f),f.epoch,r.operation,r.id,r.version,r.payload]));

async function receiptFixture(f){const expense=request();await save(f,expense);const r={id:randomUUID(),operation:randomUUID(),expense:expense.id};const result=await asWeb(()=>value('SELECT crest_commands.reserve_expense_receipt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS value',[...auth(f),f.epoch,r.operation,r.id,r.expense,'1','image/png',100]));assert.equal(result.state,'committed');return {...r,record:result.receipt.record};}
async function publication(f,r){const reservation=r.record.reservation,candidate={status:'PrivateValidatedCandidate',validationVersion:'crest-image-v1-sharp-0.35.5',source:{sha256:'a'.repeat(64),byteSize:100,detectedType:'image/png',width:1,height:1},original:{key:reservation.originalKey,byteSize:100,sha256:'a'.repeat(64)},preview:{key:reservation.previewKey,byteSize:64,sha256:'b'.repeat(64),contentType:'image/jpeg',width:1,height:1}},operation=randomUUID();const result=await asWeb(()=>value('SELECT crest_commands.publish_expense_receipt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS value',[...auth(f),f.epoch,operation,r.id,candidate]));assert.equal(result.state,'committed');return {operation,record:result.receipt.record};}

async function observed(){return (await client.query("SELECT n.nspname||'.'||c.relname AS table,a.attname AS column FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('crest','crest_private') AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2")).rows;}
async function snapshot(work){await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{return await work();}finally{await exporter.query('ROLLBACK');}}
async function context(business){return (await exporter.query('SELECT crest_commands.expense_source_snapshot_context($1) AS value',[business])).rows[0].value;}
async function pages(business,c){const rows={};for(const group of ['expenses','receipts']){rows[group]=[];let lastId=null,lastRevision=null;for(let n=0;;n++){assert(n<10000);const result=(await exporter.query('SELECT crest_commands.expense_source_snapshot_'+group+'($1,$2,$3,$4,1) AS value',[business,c.snapshotToken,lastId,lastRevision])).rows[0].value;assert.equal(result.snapshotToken,c.snapshotToken);assert.equal(result.businessId,business);rows[group].push(...result[group]);if(!result.hasMore)break;const last=result[group].at(-1);assert(last);lastId=last[expenseSourceTables[group].key[0]];lastRevision=last.revision;}}return {businessId:business,snapshotToken:c.snapshotToken,commercialSnapshotToken:c.commercialSnapshotToken,expectedCounts:c.expectedCounts,rows};}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);await sandbox.apply(target,await sandbox.prefix(48));baseline=await observed();
 for(const file of ['owner-expenses.sql','owner-expense-receipts.sql','owner-expenses-activity.sql','owner-expenses-original.sql','owner-expense-receipts-original.sql','owner-expenses-resolution.sql','owner-expenses-source.sql']){await transaction(async()=>client.query(await readFile(new URL('../../planning/proposals/'+file,import.meta.url),'utf8')));if(file==='owner-expenses.sql')ownsRole=true;}
 exportLogin='crest_expense_source_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await client.query("CREATE ROLE "+exportLogin+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await client.query('GRANT crest_export TO '+exportLogin);const url=new URL(target);url.username=exportLogin;url.password=password;exporter=new pg.Client({connectionString:url.toString()});await exporter.connect();await exporter.query('SET ROLE crest_export');
 f=await state();const receipt=await receiptFixture(f);await publication(f,receipt);await save(f,request({id:receipt.expense,version:'1',payload:{...payload,amountCents:'1399',description:'=Synthetic, "quote" é 😀\n\\N',notes:'Comma, newline\n and literal \\N',changeReason:'Synthetic correction'}}));await save(f,request({id:receipt.expense,version:'2',payload:{...payload,amountCents:'1399',description:'=Synthetic, "quote" é 😀\n\\N',notes:'Comma, newline\n and literal \\N',voided:true,changeReason:'Synthetic void'}}));await save(f,request());
},{timeout:240000});
after(async()=>{try{await exporter?.end();if(exportLogin)await client.query('DROP ROLE '+exportLogin);if(ownsRole){await client.query('DROP OWNED BY crest_expense_owner CASCADE');await client.query('DROP ROLE crest_expense_owner');}}finally{await sandbox?.close();}});

test('candidate49 source coverage exactly accounts for the two financial tables and17 added columns',async()=>{
 const previous=JSON.parse(await readFile(new URL('../support/registered48-export-coverage.json',import.meta.url),'utf8')),candidate=JSON.parse(await readFile(new URL('../../planning/proposals/owner-expenses-coverage.json',import.meta.url),'utf8'));verifyExportCoverage(previous,baseline,48);assert.equal(baseline.length,893);const actual=await observed();assert.equal(actual.length,910);assert.equal(new Set(actual.map(r=>r.table)).size,56);verifyExportCoverage(candidate,actual,49);assert.equal(actual.filter(r=>r.table==='crest.expense_revisions').length,7);assert.equal(actual.filter(r=>r.table==='crest.expense_receipt_revisions').length,10);
});
test('source credential has no raw financial reads and ordinary web cannot invoke source routines',async()=>{
 await assert.rejects(exporter.query('SELECT * FROM crest.expense_revisions'),e=>e.code==='42501');await assert.rejects(asWeb(()=>value('SELECT crest_commands.expense_source_snapshot_context($1) AS value',[f.business])),e=>e.code==='42501');await exporter.query('RESET ROLE');await assert.rejects(context(f.business),e=>e.code==='42501');await exporter.query('SET ROLE crest_export');await assert.rejects(context(f.business),e=>e.code==='25001');
});
test('empty business produces truthful empty source tables, distinct snapshot binding and no financial leakage',async()=>{
 const foreign=await state();await snapshot(async()=>{const c=await context(foreign.business),input=await pages(foreign.business,c);assert.deepEqual(input.expectedCounts,{expenses:'0',receipts:'0'});const files=formatExpenseSourceCsv(input);assert.equal(readCustomerCsv(files.expenses.csv).length,1);assert.equal(readCustomerCsv(files.receipts.csv).length,1);assert(!files.expenses.csv.includes(f.business));assert.equal(JSON.parse(files.manifest).completeBackup,false);});
});
test('held export preserves every correction and receipt revision while excluding a later committed expense',async()=>{
 await snapshot(async()=>{const c=await context(f.business);assert.deepEqual(c.expectedCounts,{expenses:'4',receipts:'2'});await save(f,request());source=await pages(f.business,c);assert.equal(source.rows.expenses.length,4);assert.equal(source.rows.receipts.length,2);assert.equal(source.rows.expenses.filter(r=>r.payload.voided).length,1);formatExpenseSourceCsv(source);});
 await snapshot(async()=>assert.equal((await context(f.business)).expectedCounts.expenses,'5'));
});
test('wrong token, malformed composite cursor, foreign-scope token and excess page size are refused',async()=>{
 const foreign=await state();for(const fault of ['token','id-only','revision-only','revision-zero','size','foreign'])await snapshot(async()=>{const c=await context(f.business),business=fault==='foreign'?foreign.business:f.business;await assert.rejects(exporter.query('SELECT crest_commands.expense_source_snapshot_expenses($1,$2,$3,$4,$5) AS value',[business,fault==='token'?'a'.repeat(64):c.snapshotToken,fault==='id-only'||fault==='revision-zero'?randomUUID():null,fault==='revision-only'?'1':fault==='revision-zero'?'0':null,fault==='size'?21:1]),e=>e.code==='22023');});
});
test('all17 physical source columns round-trip through CSV into an empty neutral database',async()=>{
 assert(source);const files=formatExpenseSourceCsv(source),neutral=await sandbox.connect(await sandbox.database());try{
 for(const group of ['expenses','receipts']){const spec=expenseSourceTables[group],matrix=readCustomerCsv(files[group].csv),header=matrix.shift();assert.deepEqual(header,[...spec.columns]);const decoded=matrix.map(cells=>Object.fromEntries(header.map((column,index)=>{let value=cells[index];if(value==='\\N')return [column,null];value=value.replaceAll('\\\\','\\');return [column,spec.json.includes(column)?JSON.parse(value):value];})));assert.deepEqual(decoded,source.rows[group]);
 const types=c=>spec.json.includes(c)?'jsonb':['revision','expense_revision'].includes(c)?'numeric(20,0)':c.endsWith('_id')?'uuid':'text';await neutral.query('CREATE TABLE '+spec.entity+'('+spec.columns.map(c=>'"'+c+'" '+types(c)).join(',')+')');for(const row of decoded)await neutral.query('INSERT INTO '+spec.entity+' VALUES('+spec.columns.map((_,i)=>'$'+(i+1)).join(',')+')',spec.columns.map(c=>spec.json.includes(c)&&row[c]!==null?JSON.stringify(row[c]):row[c]));const projection=spec.columns.map(c=>"'"+c+"',"+(['revision','expense_revision'].includes(c)?c+'::text':c)).join(',');assert.deepEqual((await neutral.query('SELECT jsonb_build_object('+projection+') AS value FROM '+spec.entity+' ORDER BY '+spec.key.join(','))).rows.map(r=>r.value),source.rows[group]);
 }
 assert.equal(JSON.parse(files.references).externalReferenceClosureVerified,false);assert.equal(JSON.parse(files.manifest).referenceClosureComplete,false);
 }finally{await neutral.end();}
});
test('source formatter refuses missing or mismatched expense/receipt revisions and count claims',()=>{
 for(const mutate of [v=>{v.expectedCounts.expenses='999';},v=>{v.rows.receipts[0].expense_revision='99';},v=>{v.rows.expenses[0].actor_id='not-an-actor';},v=>{v.rows.expenses[0].created_by=randomUUID();},v=>{v.rows.receipts.push(v.rows.receipts[0]);v.expectedCounts.receipts=String(v.rows.receipts.length);}]){const changed=structuredClone(source);mutate(changed);assert.throws(()=>formatExpenseSourceCsv(changed));}
});
