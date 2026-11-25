// Proposed140 only, in an owned disposable database. No runtime enablement.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {workspaceExport140Candidate} from '../support/workspace-export140-candidate.mjs';
import {captureCurrentBusinessRows140} from '../../src/security/current-business-source.ts';
import {formatCurrentBusinessPortableSource} from '../../src/security/current-business-portable-source.ts';
import {readCurrentBusinessCsv} from '../../src/security/current-business-source-csv.ts';
import {createCurrentBusinessSourceCollector} from '../../src/security/business-foundation-collector.ts';
import {custodyFixture} from '../support/source-export-custody-fixture.mjs';
import {createCurrentBusinessExportWorker} from '../../src/security/business-source-export-worker.ts';
import {parseSourceExportDownloadCatalogue} from '../../src/security/source-export-download-contract.ts';
const document=reference=>({reference,sha256:'a'.repeat(64)});
async function command(client,name,args){return(await client.query('SELECT crest_commands.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS result',args.map(value=>Array.isArray(value)?JSON.stringify(value):value))).rows[0].result;}
async function transaction(client,run){await client.query('BEGIN');try{const result=await run();await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}}
test('proposed140 keeps deposit exports tenant-scoped, snapshot-consistent and reversible',{timeout:180000},async()=>{
 const sandbox=await migrationSandbox();let login,reader,custody;
 try{
  const target=await sandbox.database(),admin=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(admin,target);assert.equal((await sandbox.apply(target)).history.length,139);
  const candidate=await workspaceExport140Candidate(sandbox);assert.equal((await sandbox.apply(target,candidate.directory)).history.length,140);
  const web=await sandbox.connect(target);await web.query('SET ROLE crest_web');const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const seed=createConfirmedBookingFixture({client:admin,web,bootstrap}),owner=await seed(),other=await seed();
  const finance=await sandbox.connect(target);await finance.query('SET ROLE crest_finance_preview');
  const unknown={state:'unknown',evidence:null,note:'Fictional control remains under review'};
  const worksheet={cutoverOn:'2026-06-01',cutoverAt:'2026-06-01T00:00:00Z',source:document('Fictional cutover'),equityBasis:'Fictional retained sources',banks:[],controls:Object.fromEntries(['receivables','customerFunds','supplierPayables','taxLiabilities','otherLiabilities','cashAndChecks','wallets','otherAssets'].map(key=>[key,unknown]))};
  const roots=[];
  for(const principal of [owner,other]){
   await admin.query("INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin) SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1",[principal.business,principal.actor]);
   await transaction(finance,()=>command(finance,'save_fictional_opening_worksheet',[...principal.auth(),principal.epoch,randomUUID(),'0',worksheet]));
   const root={rootId:randomUUID(),sourceNamespace:'legacy.receipts',externalId:principal===owner?'=receipt,"owner",\\N':'PRIVATE OTHER BUSINESS',receivedOn:'2026-05-01',receivedCents:principal===owner?'9007199254740993':'10000',receiptEvidence:document('Fictional original receipt'),reductions:[],items:[{itemId:randomUUID(),customerId:principal.customer,heldCents:principal===owner?'9007199254740993':'10000',obligationEvidence:document('Fictional obligation'),refundableCeilingCents:null,refundEvidence:null}]};
   await transaction(finance,()=>command(finance,'save_fictional_opening_funds_schedule',[...principal.auth(),principal.epoch,randomUUID(),'1','0',[root],'Fictional deposit review']));
   if(principal===owner)roots.push(root);
  }
  const financialCounts=async()=>(await admin.query('SELECT (SELECT count(*)::text FROM crest.financial_events) AS events,(SELECT count(*)::text FROM crest.journal_entries) AS journals,(SELECT count(*)::text FROM crest.journal_lines) AS lines')).rows[0],before=await financialCounts();
  const request=await transaction(web,()=>command(web,'request_current_source_export_v6_for_execution',[...owner.auth(),owner.epoch,randomUUID(),randomUUID(),'a'.repeat(40)]));assert.equal(request.state,'created');assert.equal(request.result.receipt.job.source_schema_version,140);
  const legacy=await transaction(web,()=>command(web,'request_current_source_export_v5_for_execution',[...other.auth(),other.epoch,randomUUID(),randomUUID(),'a'.repeat(40)]));assert.equal(legacy.state,'created');assert.equal(legacy.result.receipt.job.source_schema_version,138);
  const password=randomBytes(32).toString('hex');login='crest_workspace140_'+randomBytes(8).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_export TO '+login+' WITH INHERIT FALSE,SET TRUE');
  const endpoint=new URL(target);endpoint.username=login;endpoint.password=password;reader=new pg.Client({connectionString:endpoint.toString(),options:'-c role=crest_export'});await reader.connect();
  await assert.rejects(reader.query('SELECT * FROM crest.opening_funds_origins'),{code:'42501'});
  await assert.rejects(reader.query("SELECT crest_commands.business_source_page_v2($1,'crest.opening_funds_origins',NULL,NULL,100)",[owner.business]),{code:'25001'});
  await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  let changed=false;
  const first=await captureCurrentBusinessRows140(owner.business,async(sql,args)=>{
   if(!changed&&args[1]==='crest.opening_funds_origins'){
    changed=true;const revised=structuredClone(roots);revised[0].items[0].refundableCeilingCents='0';revised[0].items[0].refundEvidence=document('Fictional documented zero');
    await transaction(finance,()=>command(finance,'save_fictional_opening_funds_schedule',[...owner.auth(),owner.epoch,randomUUID(),'1','1',revised,'Concurrent fictional deposit revision']));
   }
   return(await reader.query(sql,args)).rows;
  },()=>{});
  assert.equal(first.profile,'crest.current-business-rows.v2');assert.equal(first.sources.length,170);assert(changed);
  const saved=first.sources.find(source=>source.source==='crest.opening_funds_schedule_revisions');assert.equal(saved.rows.length,1);assert.equal(JSON.parse(saved.rows[0].evidence).totals.heldCents,'9007199254740993');assert.equal(JSON.parse(saved.rows[0].evidence).totals.refundableCeilingCents,null);
  assert.equal(first.sources.find(source=>source.source==='crest.opening_funds_origins').rows.length,1);assert(!JSON.stringify(first).includes('PRIVATE OTHER BUSINESS'));
  const portable=formatCurrentBusinessPortableSource(first,{appReleaseId:'a'.repeat(40),sourceSchemaVersion:140});
  const map=JSON.parse(Buffer.from(portable.files['current_business_escape_map.json']).toString());
  for(const source of first.sources.filter(source=>source.source.startsWith('crest.opening_funds_'))){const name=source.source.replace('.','_')+'.csv';assert.deepEqual(readCurrentBusinessCsv(Buffer.from(portable.files[name]).toString(),source.columns,map[name]),source.rows);}
  const neutral=await sandbox.connect(await sandbox.database());await neutral.query(Buffer.from(portable.files['business_records_reimport.txt']).toString());
  await reader.query('ROLLBACK');
  await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const second=await captureCurrentBusinessRows140(owner.business,async(sql,args)=>(await reader.query(sql,args)).rows,()=>{});assert.equal(second.sources.find(source=>source.source==='crest.opening_funds_schedule_revisions').rows.length,2);await reader.query('ROLLBACK');
  const collector=createCurrentBusinessSourceCollector({environment:'test',connectionString:endpoint.toString(),businessId:owner.business,migrationIdentity:candidate.registry.migrations.map(row=>({version:row.version,name:row.file.slice(15,-4)}))});
  const collected=await collector(new AbortController().signal),full=formatCurrentBusinessPortableSource(collected.forCurrentBusinessServer(),{appReleaseId:'a'.repeat(40),sourceSchemaVersion:140},collected.forCurrentBusinessIdentityServer(),collected.forCurrentBusinessSessionServer(),collected.forCurrentBusinessProviderServer());
  const manifest=JSON.parse(full.manifest);assert.equal(manifest.sourceSchemaVersion,140);assert.equal(manifest.completeBackup,false);assert.equal(manifest.completePortableExport,false);assert.equal(collected.forCurrentBusinessServer().profile,'crest.current-business-rows.v2');
  for(const source of second.sources.filter(source=>source.source.startsWith('crest.opening_funds_'))){const table=source.source.replace('.','_');const rows=(await neutral.query('SELECT * FROM crest_portable_source."'+table+'" ORDER BY id')).rows;assert.deepEqual(rows,first.sources.find(item=>item.source===source.source).rows);}
  const jobId=request.result.receipt.job.id,leaseId=randomUUID();
  const claimed=await command(web,'claim_source_export',[...owner.auth(),owner.epoch,randomUUID(),jobId,'1',leaseId]);
  custody=await custodyFixture(async()=>{});
  const stages={authorize:'authorize_source_export_worker',snapshot:'record_source_export_snapshot',intent:'record_source_export_part_intent',verified:'record_source_export_part_verified',ready:'record_source_export_ready'},readyOperation=randomUUID();
  const jobs=Object.fromEntries(Object.entries(stages).map(([stage,name])=>[stage,value=>command(web,name,[...owner.auth(),owner.epoch,...stage==='ready'?[readyOperation,claimed.receipt.job.version]:[],JSON.stringify(value)])]));
  const worker=createCurrentBusinessExportWorker({businessId:owner.business,appReleaseId:'a'.repeat(40),sourceSchemaVersion:140},collector,custody.store,jobs);
  const delivered=(await worker.run({formatVersion:1,profile:'crest.current-business-source-bundle.v1',businessId:owner.business,actorId:owner.actor,exportJobId:jobId,recoveryEpoch:owner.epoch,leaseId},new AbortController().signal)).forServer();
  const page=await command(web,'read_source_export_download_page',[...owner.auth(),jobId,delivered.generationId,0]);
  const download=parseSourceExportDownloadCatalogue(page,owner.business,{exportJobId:jobId,generationId:delivered.generationId,afterOrdinal:0});
  assert.equal(download.sourceSchemaVersion,140);assert(custody.requests.some(item=>item.method==='PUT'));assert(custody.requests.some(item=>item.method==='GET'));
  assert.deepEqual(await financialCounts(),before);
  assert.equal(JSON.parse(await readFile(new URL('../../supabase/migration-checksums.json',import.meta.url),'utf8')).migrations.length,139);
 }finally{await custody?.close();if(reader)await reader.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox.close();}
});
