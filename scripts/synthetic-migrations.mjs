// Narrow local Linux runner: public migration inputs/dependencies are copied;
// private workspace configuration is never mounted. Only the generated local
// synthetic database credential is supplied to this explicit construction task.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cp,mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import pg from 'pg';

export async function requireSyntheticJobCompletion(connectionString){
 await requireSyntheticReader(connectionString,'crest_commands.read_job_completion_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)','SYNTHETIC_JOB_COMPLETION_MIGRATION_REQUIRED');
}

export async function requireSyntheticJobMileage(connectionString){
 await requireSyntheticReader(connectionString,'crest_commands.read_job_mileage_trips(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer)','SYNTHETIC_JOB_MILEAGE_MIGRATION_REQUIRED');
}

export async function requireSyntheticSupportTrips(connectionString){
 for(const signature of [
  'read_support_trips(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid,integer)',
  'read_support_trip_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,integer)',
  'read_support_trip_mileage(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)'
 ])await requireSyntheticReader(connectionString,'crest_commands.'+signature,'SYNTHETIC_SUPPORT_TRIP_MIGRATION_REQUIRED');
}

export async function requireSyntheticUnfulfilledCancellation(connectionString){
 await requireSyntheticReader(connectionString,
  'crest_commands.read_unfulfilled_cancellation_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)',
  'SYNTHETIC_UNFULFILLED_CANCELLATION_MIGRATION_REQUIRED');
}

export async function requireSyntheticWorkTime(connectionString){
 await requireSyntheticReader(connectionString,
  'crest_commands.read_job_work_time(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)',
  'SYNTHETIC_WORK_TIME_MIGRATION_REQUIRED');
}

export async function requireSyntheticWorkBoundary(connectionString){
 await requireSyntheticReader(connectionString,
  'crest_commands.correct_job_work_boundary(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)',
  'SYNTHETIC_WORK_BOUNDARY_MIGRATION_REQUIRED');
}

export async function requireSyntheticWorkStart(connectionString){
 for(const signature of [
  'read_job_work_start(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)',
  'correct_job_work_start(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)'
 ])await requireSyntheticReader(connectionString,'crest_commands.'+signature,'SYNTHETIC_WORK_START_MIGRATION_REQUIRED');
}

export async function requireSyntheticWorkEnd(connectionString){
 for(const signature of [
  'read_job_work_end(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)',
  'correct_job_work_end(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)'
 ])await requireSyntheticReader(connectionString,'crest_commands.'+signature,'SYNTHETIC_WORK_END_MIGRATION_REQUIRED');
}

export async function requireSyntheticMobileDeparture(connectionString){
 for(const signature of [
  'read_mobile_departure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)',
  'correct_mobile_departure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb)'
 ])await requireSyntheticReader(connectionString,'crest_commands.'+signature,'SYNTHETIC_MOBILE_DEPARTURE_MIGRATION_REQUIRED');
}

export async function requireSyntheticReviewOutcome(connectionString){
 for(const signature of [
  'read_review_message_outcome(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)',
  'record_review_message_outcome(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,uuid,jsonb)'
 ])await requireSyntheticReader(connectionString,'crest_commands.'+signature,'SYNTHETIC_REVIEW_OUTCOME_MIGRATION_REQUIRED');
}

export async function requireSyntheticReviewHistory(connectionString){
 await requireSyntheticReader(connectionString,'crest_commands.read_review_message_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,text,uuid)','SYNTHETIC_REVIEW_HISTORY_MIGRATION_REQUIRED');
}

export async function requireSyntheticMaintenanceFollowUp(connectionString){
 for(const signature of [
  'save_maintenance_follow_up(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)',
  'read_maintenance_follow_up(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint)',
  'list_maintenance_follow_ups(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,timestamptz,timestamptz,uuid)'
 ])await requireSyntheticReader(connectionString,'crest_commands.'+signature,'SYNTHETIC_MAINTENANCE_FOLLOW_UP_MIGRATION_REQUIRED');
}

export async function requireSyntheticDropoffCustody(connectionString){
 for(const signature of [
  'read_dropoff_job_custody(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)',
  'save_dropoff_handoff(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,integer,jsonb)',
  'read_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)',
  'save_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,jsonb)',
  'list_dropoff_collections(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid)'
 ])await requireSyntheticReader(connectionString,'crest_commands.'+signature,'SYNTHETIC_DROPOFF_CUSTODY_MIGRATION_REQUIRED');
}

export async function requireSyntheticDropoffPolicyRevision(connectionString){
 await requireSyntheticReader(connectionString,
  'crest_commands.revise_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,jsonb)',
  'SYNTHETIC_DROPOFF_POLICY_REVISION_MIGRATION_REQUIRED','20261122180000');
}

export async function requireSyntheticPickupCustody(connectionString){
 const authority='bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid';
 await requireSyntheticReader(connectionString,[
  'read_pickup_trips('+authority+',uuid,timestamptz,uuid)',
  'record_pickup_trip('+authority+',uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)',
  'read_pickup_collection('+authority+',uuid,uuid)',
  'collect_pickup_vehicle('+authority+',uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb)',
  'read_pickup_policy('+authority+',bigint)',
  'save_pickup_policy('+authority+',uuid,uuid,bigint,jsonb)',
  'reserve_pickup_photo('+authority+',uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,integer)'
 ].map(signature=>'crest_commands.'+signature),'SYNTHETIC_PICKUP_CUSTODY_MIGRATION_REQUIRED','20261123180000');
}

export async function requireSyntheticPickupReturnWorkflow(connectionString){
 const authority='bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid';
 await requireSyntheticReader(connectionString,[
  'release_pickup_vehicle('+authority+',uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)',
  'fail_pickup_return('+authority+',uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)',
  'reserve_pickup_return_photo('+authority+',uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,integer)',
  'list_pickup_returns('+authority+',timestamptz,uuid)'
 ].map(signature=>'crest_commands.'+signature),'SYNTHETIC_PICKUP_RETURN_WORKFLOW_MIGRATION_REQUIRED','20261124180000');
}

export async function requireSyntheticFinanceAccountConfiguration(connectionString,businessId,taxProfiles=false,categoryMappings=false,moneyChannels=false,invoicePreparation=false,invoiceDrafts=false,invoiceIssue=false,directReceipts=false,sameDayExpenses=false,trialBalance=false,paymentCorrections=false,fundApplications=false,heldTips=false,invoiceCredits=false,paidInvoiceCredits=false,serviceRefunds=false,receivableAging=false,customerFundsReport=false){
 assert(typeof fundApplications==='boolean'&&(!fundApplications||paymentCorrections));
 assert(typeof heldTips==='boolean'&&(!heldTips||fundApplications&&taxProfiles));
 assert(typeof invoiceCredits==='boolean'&&(!invoiceCredits||heldTips));
 assert(typeof paidInvoiceCredits==='boolean'&&(!paidInvoiceCredits||invoiceCredits));
 assert(typeof serviceRefunds==='boolean'&&(!serviceRefunds||paidInvoiceCredits&&directReceipts));
 assert(typeof paymentCorrections==='boolean'&&(!paymentCorrections||trialBalance));
 assert(typeof trialBalance==='boolean'&&(!trialBalance||sameDayExpenses));
 assert(typeof sameDayExpenses==='boolean'&&(!sameDayExpenses||directReceipts&&categoryMappings));
 assert(typeof directReceipts==='boolean'&&(!directReceipts||invoiceIssue&&moneyChannels));
 assert(typeof invoiceIssue==='boolean'&&(!invoiceIssue||taxProfiles&&invoiceDrafts));
 assert.equal(typeof invoiceDrafts,'boolean');
 assert.equal(typeof invoicePreparation,'boolean');
 assert.equal(typeof taxProfiles,'boolean');assert.equal(typeof categoryMappings,'boolean');assert.equal(typeof moneyChannels,'boolean');
 const authority='bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid';
 const signatures=[
  'save_finance_account('+authority+',uuid,uuid,integer,uuid,bigint,jsonb)',
  'lookup_finance_account_operation('+authority+',uuid,uuid,uuid,bigint)',
  'retire_finance_account_save('+authority+',uuid,uuid,uuid,uuid,bigint,text)',
  'list_finance_accounts('+authority+',text,boolean,integer)',
  'read_finance_account_history('+authority+',uuid,bigint,integer)',
  'approve_fixed_finance_mapping('+authority+',uuid,uuid,text,bigint,uuid,date,text)',
  'lookup_fixed_finance_mapping_operation('+authority+',uuid,uuid,text,bigint)',
  'retire_fixed_finance_mapping_approval('+authority+',uuid,uuid,uuid,text,bigint,text)',
  'resolve_fixed_finance_mapping('+authority+',text,date)',
  'read_fixed_finance_mapping_history('+authority+',text,bigint,integer)',
  'fixed_finance_mapping_editor('+authority+',text)'
 ];
 if(taxProfiles)signatures.push(
  'approve_finance_tax_profile('+authority+',uuid,uuid,text,text,uuid,bigint,date,text,numeric,text,text)',
  'lookup_finance_tax_profile_approval('+authority+',uuid,uuid,bigint)',
  'retire_finance_tax_profile_approval('+authority+',uuid,uuid,uuid,bigint,text)',
  'preview_finance_tax_charge('+authority+',text,text,uuid,date,bigint,bigint)',
  'read_finance_tax_profile_history('+authority+',text,text,uuid,bigint,integer)'
 );
 if(categoryMappings)signatures.push('list_expense_category_mapping_accounts('+authority+',text,text,integer)');
 if(moneyChannels)signatures.push(
  'save_money_channel('+authority+',uuid,uuid,uuid,bigint,jsonb)',
  'lookup_money_channel_operation('+authority+',uuid,uuid,uuid,bigint)',
  'retire_money_channel_operation('+authority+',uuid,uuid,uuid,uuid,bigint,text)',
  'read_money_channels('+authority+',uuid,integer)',
  'read_money_channel_history('+authority+',uuid,bigint,integer)',
  'list_money_channel_accounts('+authority+',text,text,text,integer)'
 );
 if(invoicePreparation)signatures.push('read_invoice_preparation('+authority+',uuid)');
 if(invoiceDrafts)signatures.push(
  'save_invoice_draft('+authority+',uuid,uuid,uuid,bigint,uuid,date,uuid[],text)',
  'read_invoice_draft('+authority+',uuid,bigint)',
  'list_invoice_drafts('+authority+',uuid,uuid)',
  'lookup_invoice_draft_operation('+authority+',uuid,uuid,uuid,bigint,uuid)',
  'retire_invoice_draft_operation('+authority+',uuid,uuid,uuid,uuid,bigint,uuid,text)'
 );
 if(invoiceIssue)signatures.push(
  'read_fictional_invoice_setup('+authority+',date)',
  'configure_fictional_invoice_setup('+authority+',uuid,uuid,jsonb)',
  'review_invoice_issue_accounts('+authority+',uuid,bigint,jsonb)',
  'prepare_reviewed_invoice_issue('+authority+',uuid,bigint,jsonb)',
  'issue_reviewed_invoice('+authority+',uuid,uuid,uuid,bigint,jsonb,text)',
  'read_issued_invoice('+authority+',uuid)',
  'lookup_invoice_issue('+authority+',uuid,uuid,uuid,bigint)',
  'retire_invoice_issue('+authority+',uuid,uuid,uuid,uuid,bigint,text)',
  'read_invoice_tax_payable_mapping('+authority+',text)',
  'approve_invoice_tax_payable_mapping('+authority+',uuid,uuid,text,bigint,uuid,date,text)',
  'lookup_invoice_tax_payable_mapping_approval('+authority+',uuid,uuid,text,bigint)',
  'read_invoice_exemption_evidence('+authority+',uuid,bigint,uuid,text,uuid)',
  'approve_invoice_exemption_evidence('+authority+',uuid,uuid,uuid,bigint,uuid,text,uuid,bigint,date,date,text,text)'
 );
 if(directReceipts)signatures.push(
  'read_direct_fictional_receipt_options('+authority+',uuid,date)',
  'lookup_direct_fictional_receipt('+authority+',uuid,uuid,uuid)',
  'retire_direct_fictional_receipt('+authority+',uuid,uuid,uuid,uuid,text)',
  'record_direct_fictional_receipt('+authority+',uuid,uuid,uuid,uuid,uuid,bigint,date,bigint,text,text,jsonb,jsonb)'
 );
 if(sameDayExpenses)signatures.push(
  'read_fictional_same_day_expense_options('+authority+',uuid)',
  'lookup_fictional_same_day_expense('+authority+',uuid,uuid,uuid)',
  'retire_fictional_same_day_expense('+authority+',uuid,uuid,uuid,uuid,text)',
  'post_fictional_same_day_expense('+authority+',uuid,uuid,uuid,uuid,bigint,uuid,bigint,uuid,date,date,text,bigint,uuid,text,text,text,jsonb)'
 );
 if(trialBalance)signatures.push(
  'read_fictional_trial_balance('+authority+',date)',
  'read_fictional_journal('+authority+',date,uuid,uuid,integer)'
 );
 if(paymentCorrections)signatures.push(
  'list_fictional_invoice_payment_allocations('+authority+',uuid,uuid)',
  'read_fictional_allocation_unapplication_options('+authority+',uuid,uuid,date)',
  'lookup_fictional_allocation_unapplication('+authority+',uuid,uuid,uuid)',
  'retire_fictional_allocation_unapplication('+authority+',uuid,uuid,uuid,uuid,text)',
  'unapply_fictional_payment_allocation('+authority+',uuid,uuid,uuid,uuid,uuid,uuid,date,bigint,bigint,text)',
  'read_fictional_trial_balance_v2('+authority+',date)',
  'read_fictional_journal_v2('+authority+',date,uuid,uuid,integer)'
 );
 if(fundApplications)signatures.push(
  'read_fictional_customer_funds_application_options('+authority+',uuid,uuid,date)',
  'lookup_fictional_customer_fund_application('+authority+',uuid,uuid,uuid)',
  'retire_fictional_customer_fund_application('+authority+',uuid,uuid,uuid,uuid,text)',
  'apply_fictional_customer_funds('+authority+',uuid,uuid,uuid,uuid,uuid,uuid,date,bigint,bigint,text)',
  'read_fictional_trial_balance_v3('+authority+',date)',
  'read_fictional_journal_v3('+authority+',date,uuid,uuid,integer)'
 );
 if(heldTips)signatures.push(
  'read_fictional_held_tip_options('+authority+',uuid,text,date)',
  'lookup_fictional_held_tip('+authority+',uuid,uuid,uuid)',
  'retire_fictional_held_tip('+authority+',uuid,uuid,uuid,uuid,text)',
  'realize_fictional_held_tip('+authority+',uuid,uuid,uuid,uuid,uuid,date,bigint,bigint,text,uuid,uuid,uuid,text,text)',
  'read_fictional_trial_balance_v4('+authority+',date)',
  'read_fictional_journal_v4('+authority+',date,uuid,uuid,integer)'
 );
 if(invoiceCredits)signatures.push(
  'read_fictional_invoice_credit_options('+authority+',uuid,uuid,date)',
  'lookup_fictional_invoice_credit('+authority+',uuid,uuid,uuid)',
  'retire_fictional_invoice_credit('+authority+',uuid,uuid,uuid,uuid,text)',
  'credit_fictional_open_invoice_line('+authority+',uuid,uuid,uuid,uuid,uuid,date,bigint,bigint,uuid,text)',
  'read_fictional_trial_balance_v5('+authority+',date)',
  'read_fictional_journal_v5('+authority+',date,uuid,uuid,integer)'
 );
 if(paidInvoiceCredits)signatures.push(
  'read_fictional_paired_invoice_credit_options('+authority+',uuid,uuid,uuid,date)',
  'lookup_fictional_paired_invoice_credit('+authority+',uuid,uuid,uuid,uuid)',
  'retire_fictional_paired_invoice_credit('+authority+',uuid,uuid,uuid,uuid,uuid,text)',
  'credit_fictional_paid_invoice_line('+authority+',uuid,uuid,uuid,uuid,uuid,date,bigint,bigint,uuid,uuid,uuid,bigint,bigint,uuid,bigint,text)'
 );
 if(serviceRefunds)signatures.push(
  'list_fictional_service_refund_credits('+authority+',uuid,uuid)',
  'read_fictional_service_refund_options('+authority+',uuid,uuid,date)',
  'lookup_fictional_service_refund('+authority+',uuid,uuid,uuid)',
  'retire_fictional_service_refund('+authority+',uuid,uuid,uuid,uuid,text)',
  'record_fictional_service_refund('+authority+',uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,date,bigint,bigint,text,text,jsonb)',
  'read_fictional_trial_balance_v6('+authority+',date)',
  'read_fictional_journal_v6('+authority+',date,uuid,uuid,integer)'
 );
 assert(typeof customerFundsReport==='boolean'&&(!customerFundsReport||serviceRefunds));
 if(customerFundsReport)signatures.push('read_fictional_customer_funds('+authority+',date)');
 assert(typeof receivableAging==='boolean'&&(!receivableAging||serviceRefunds));
 if(receivableAging)signatures.push('read_fictional_receivable_aging('+authority+',date)');
 const qualified=signatures.map(signature=>'crest_commands.'+signature);
 const missing='SYNTHETIC_FINANCE_ACCOUNT_MIGRATION_REQUIRED';
 const client=new pg.Client({connectionString,connectionTimeoutMillis:5000,statement_timeout:5000});
 try{
  await client.connect();
  const versions=['20261125180000'];
  if(taxProfiles||categoryMappings)versions.push('20261126180000');
  if(categoryMappings)versions.push('20261127180000');
  if(moneyChannels)versions.push('20261128180000');
  if(invoicePreparation)versions.push('20261129180000');
  if(invoiceDrafts)versions.push('20261130180000');
  if(invoiceIssue)versions.push('20261201180000');
  if(directReceipts)versions.push('20261202180000');
  if(sameDayExpenses)versions.push('20261203180000');
  if(trialBalance)versions.push('20261204180000');
  if(paymentCorrections)versions.push('20261205180000');
  if(fundApplications)versions.push('20261206180000');
  if(heldTips)versions.push('20261207180000');
  if(invoiceCredits)versions.push('20261208180000');
  if(paidInvoiceCredits)versions.push('20261209180000');
  if(serviceRefunds)versions.push('20261210180000');
  if(receivableAging)versions.push('20261212180000');
  if(customerFundsReport)versions.push('20261214180000');
  const migration=await client.query('SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=ANY($1::text[])',[versions]);
  assert(migration.rowCount===versions.length,missing);
  const {rows}=await client.query(`
   SELECT bool_and(coalesce(has_function_privilege('crest_finance_preview',oid,'EXECUTE')
     AND NOT has_function_privilege('crest_web',oid,'EXECUTE'),false)) AS allowed
   FROM (SELECT to_regprocedure(signature) AS oid FROM unnest($1::text[]) AS signatures(signature)) routines`,[qualified]);
  assert(rows[0]?.allowed===true,missing);
  if(businessId!==undefined){
   const control=await client.query('SELECT 1 FROM crest_private.finance_controls WHERE business_id=$1',[businessId]);
   assert(control.rowCount===1,'SYNTHETIC_FINANCE_ACCOUNT_SETUP_REQUIRED');
  }
 }finally{await client.end();}
}

async function requireSyntheticReader(connectionString,signature,missing,version){
 const client=new pg.Client({connectionString,connectionTimeoutMillis:5000,statement_timeout:5000});
 try{
  await client.connect();
  if(version){
   const migration=await client.query('SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=$1',[version]);
   assert(migration.rowCount===1,missing);
  }
  await client.query('SET ROLE crest_web');
  const signatures=Array.isArray(signature)?signature:[signature];
  const {rows}=await client.query("SELECT bool_and(coalesce(has_function_privilege(to_regprocedure(signature),'EXECUTE'),false)) AS available FROM unnest($1::text[]) AS signatures(signature)",[signatures]);
  assert(rows[0]?.available===true,missing);
 }finally{await client.end();}
}

// Resolve the existing installed closure from the checkout's package context.
// Worktrees may share their ancestor's locked installation. Do not mount that
// ancestor or copy unrelated packages/private workspace state into the runner.
export async function copySyntheticPgDependencies({root,output}){
 const require=createRequire(join(root,'package.json')),copied=new Map();
 async function dependency(name,parentRequire=require){
  assert(/^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(name));
  let source=dirname(parentRequire.resolve(name)),pkg;
  for(let depth=0;depth<8;depth++){
   try{const candidate=JSON.parse(await readFile(join(source,'package.json'),'utf8'));if(candidate.name===name){pkg=candidate;break;}}
   catch(error){if(error.code!=='ENOENT')throw error;}
   const parent=dirname(source);if(parent===source)break;source=parent;
  }
  assert(pkg,'SYNTHETIC_DEPENDENCY_PACKAGE_REQUIRED');
  // This narrow flattened closure must not silently substitute another nested
  // version. A future conflicting lockfile graph requires explicit review.
  if(copied.has(name)){assert.equal(copied.get(name),source,'SYNTHETIC_DEPENDENCY_CONFLICT');return;}
  copied.set(name,source);await cp(source,join(output,'node_modules',name),{recursive:true});
  const next=createRequire(join(source,'package.json'));
  for(const child of Object.keys(pkg.dependencies??{}))await dependency(child,next);
 }
 await dependency('pg');
}

export async function applySyntheticMigrations({root,directory,state,bootstrap=false}){
 assert(/^[a-f0-9]{16}$/.test(state.id)&&state.databaseContainer===`crest-synthetic-db-${state.id}`&&state.databaseName===`crest_migrate_${state.id}`);
 const input=join(directory,bootstrap?'public-bootstrap-input':'public-migration-input'),tools=join(directory,'linux-tools'),ledger=join(directory,'migration-ledger');
 await mkdir(join(input,'src/tooling'),{recursive:true,mode:0o700});await mkdir(join(input,'supabase/migrations'),{recursive:true});await mkdir(join(input,'node_modules'),{recursive:true});await mkdir(tools,{recursive:true});await mkdir(ledger,{recursive:true});
 for(const file of ['migration-coordinator.ts','migrations.ts','migration-cli-diagnostic.ts'])await copyFile(join(root,'src/tooling',file),join(input,'src/tooling',file));
 const registry=JSON.parse(await readFile(join(root,'supabase/migration-checksums.json'),'utf8'));if(bootstrap)registry.migrations=[];
 await writeFile(join(input,'supabase/migration-checksums.json'),JSON.stringify(registry)+'\n');
 for(const entry of registry.migrations)await copyFile(join(root,'supabase/migrations',entry.file),join(input,'supabase/migrations',entry.file));
 // Copy only the locked public pg dependency closure, never application state.
 await copySyntheticPgDependencies({root,output:input});
 const pins=JSON.parse(await readFile(join(root,'release/toolchain.json'),'utf8')),sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();assert(/^[a-f0-9]{40}$/.test(sourceCommit));
 await writeFile(join(input,'package.json'),'{"type":"module"}\n');await writeFile(join(input,'toolchain.json'),JSON.stringify(pins));
 const runner=`import {readFile,writeFile,access} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import {applyTestMigrations} from './src/tooling/migration-coordinator.ts';
const pins=JSON.parse(await readFile('/workspace/toolchain.json','utf8'));
let cached=false;try{const bytes=await readFile('/tools/cli.tar.gz');cached=createHash('sha256').update(bytes).digest('hex')===pins.supabaseCli.linuxAmd64Sha256;}catch{}
if(!cached){const response=await fetch('https://github.com/supabase/cli/releases/download/v'+pins.supabaseCli.version+'/supabase_linux_amd64.tar.gz',{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('SYNTHETIC_CLI_DOWNLOAD_FAILED');const bytes=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==pins.supabaseCli.linuxAmd64Sha256)throw Error('SYNTHETIC_CLI_INTEGRITY_FAILED');await writeFile('/tools/cli.tar.gz',bytes);}
execFileSync('tar',['-xzf','/tools/cli.tar.gz','-C','/tools']);await access('/tools/supabase');
try{const receipt=await applyTestMigrations({environment:'test',connectionString:process.env.CREST_SYNTHETIC_URL,workspace:'/workspace',ledgerRoot:'/ledger',cliPath:'/tools/supabase',sourceCommit:${JSON.stringify(sourceCommit)},bootstrapEmpty:${bootstrap}});console.log('Synthetic migration receipt verified: '+receipt.history.length+' registered migrations.');}catch(error){console.error(typeof error.message==='string'&&/^[A-Z_]+$/.test(error.message)?error.message:'SYNTHETIC_MIGRATIONS_FAILED');process.exitCode=1;}`;
 await writeFile(join(input,'run.mjs'),runner);
 const url=`postgresql://supabase_admin:${state.databasePassword}@127.0.0.1:5432/${state.databaseName}`;
 execFileSync('docker',['run','--rm','--network',`container:${state.databaseContainer}`,'--mount',`type=bind,source=${input},target=/workspace,readonly`,'--mount',`type=bind,source=${tools},target=/tools`,'--mount',`type=bind,source=${ledger},target=/ledger`,'--workdir','/workspace','--env','CREST_SYNTHETIC_URL',pins.nodeImage,'node','run.mjs'],{env:{...process.env,CREST_SYNTHETIC_URL:url},stdio:['ignore','pipe','pipe'],timeout:180000,maxBuffer:2*1024*1024});
}
