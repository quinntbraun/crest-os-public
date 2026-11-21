import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {parseInvoiceOutstanding} from '../../src/bookkeeping/invoice-outstanding-contract.ts';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {inventory,recoveryCluster} from '../support/recovery-drill.mjs';
import {command,committed,issue} from '../support/invoice-outstanding-fixture.mjs';
import {syntheticInvoiceOutstandingAvailable} from '../../scripts/synthetic-migrations.mjs';

test('registered invoice outstanding preserves populated121 and binds actual authority and exact posted payment states',{timeout:240000},async t=>{
 const cluster=await recoveryCluster();let sandbox;
 try{
  sandbox=await migrationSandbox(cluster.testDatabaseUrl);const target=await sandbox.database(),admin=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(admin,target);await sandbox.apply(target,await sandbox.prefix(121));
  assert.equal(await syntheticInvoiceOutstandingAvailable(target),false);
  const web=await sandbox.connect(target),finance=await sandbox.connect(target),exporter=await sandbox.connect(target);
  await web.query('SET ROLE crest_web');await finance.query('SET ROLE crest_finance_preview');await exporter.query('SET ROLE crest_export');
  const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
  async function pricedOwner(paidLineDiscount=null,paidLineComplimentaryReason=null){const service=randomUUID();
   const owner=await makeOwner(undefined,{paidLineDiscount,paidLineComplimentaryReason,serviceVersionFor:async(principal,auth)=>{
   await committed(web,'save_service',[...auth(),principal.epoch,randomUUID(),1,service,'0',{code:'fictional-balance-service',active:true,
    definition:{name:'Fictional balance service',inclusions:'Interior',exclusions:'',internalGuidance:null,rangeLowCents:null,rangeHighCents:null,estimatedSeconds:null}}]);
   return (await admin.query('SELECT id FROM crest.service_versions WHERE business_id=$1 AND service_id=$2',[principal.business,service])).rows[0].id;
   }});return {owner,service};
  }
  const {owner,service}=await pricedOwner();
  const foreign=await makeOwner(),today=(await admin.query("SELECT (statement_timestamp() AT TIME ZONE 'UTC')::date::text AS value")).rows[0].value;
  const invoice=await issue({admin,web,finance,owner,service,today});assert.equal(invoice.totalCents,'25000');
  const beforeUpgrade=await inventory(admin),beforeHistory=(await admin.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows;
  await sandbox.apply(target,await sandbox.prefix(122));const afterHistory=(await admin.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows;assert.equal(afterHistory.length,122);assert.deepEqual(afterHistory.slice(0,121),beforeHistory);
  assert.deepEqual((await inventory(admin)).filter(row=>row.schema!=='supabase_migrations'),beforeUpgrade.filter(row=>row.schema!=='supabase_migrations'));
  const signature='crest_commands.read_fictional_invoice_outstanding(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)';
  const args=()=>[...owner.auth(),owner.customer,invoice.invoiceId];
  const read=async()=>parseInvoiceOutstanding(await command(finance,'read_fictional_invoice_outstanding',args()),owner.business,owner.customer,invoice.invoiceId);
  const facts=async(business=owner.business)=>{const result={};for(const table of ['invoices','receivable_items','financial_events','journal_entries','journal_lines','payments','allocation_events','money_movements'])result[table]=(await admin.query('SELECT to_jsonb(r)::text AS value FROM crest.'+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[business])).rows;result.audit=(await admin.query('SELECT to_jsonb(r)::text AS value FROM crest_private.audit_events r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[business])).rows;return result;};
  await t.test('the normal launcher enables only the adopted private reader and refuses excess grants',async()=>{
   const before=await facts();assert.equal(await syntheticInvoiceOutstandingAvailable(target),true);
   await admin.query('GRANT EXECUTE ON FUNCTION '+signature+' TO crest_web');
   try{assert.equal(await syntheticInvoiceOutstandingAvailable(target),false);}
   finally{await admin.query('REVOKE EXECUTE ON FUNCTION '+signature+' FROM crest_web');}
   assert.equal(await syntheticInvoiceOutstandingAvailable(target),true);assert.deepEqual(await facts(),before);
  });
  await t.test('unpaid snapshot has exact identity, checked date and original amount without writes',async()=>{
   const before=await facts(),result=await read();assert.equal(result.state,'ready');assert.equal(result.outstandingCents,'25000');assert.equal(result.originalCents,'25000');assert.equal(result.throughOn,today);assert.equal(result.timeZone,'UTC');assert.equal(result.invoiceNumber,invoice.invoiceNumber);assert.deepEqual(await facts(),before);
  });
  await t.test('foreign resource, wrong customer and nonexistent invoice never become a zero balance',async()=>{
   for(const values of [[...owner.auth(),foreign.customer,invoice.invoiceId],[...owner.auth(),owner.customer,randomUUID()],[...foreign.auth(),owner.customer,invoice.invoiceId]])assert.deepEqual(await command(finance,'read_fictional_invoice_outstanding',values),{state:'absent'});
  });
  await t.test('web/export/public grants and malformed or expired authority are refused',async()=>{
   for(const connection of [web,exporter])await assert.rejects(command(connection,'read_fictional_invoice_outstanding',args()),{code:'42501'});
   const publicPrivilege=await admin.query("SELECT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS value FROM pg_proc p WHERE p.oid=$1::regprocedure",[signature]);assert.equal(publicPrivilege.rows[0].value,false);
   const badHash=args();badHash[0]=randomBytes(32);await assert.rejects(command(finance,'read_fictional_invoice_outstanding',badHash),{code:'42501'});
   const expired=args();expired[6]=new Date(0);await assert.rejects(command(finance,'read_fictional_invoice_outstanding',expired),{code:'42501'});
   const missing=args();missing[9]=null;await assert.rejects(command(finance,'read_fictional_invoice_outstanding',missing),{message:'INVOICE_OUTSTANDING_INPUT_REQUIRED'});
  });
  const mutate=()=>[...owner.auth(),owner.epoch,randomUUID()],bank=randomUUID(),channel=randomUUID();
  await committed(finance,'save_finance_account',[...mutate(),1,bank,'0',{identity:{code:'1000',accountType:'asset',normalSide:'debit',controlKind:'bank',reportRole:'money'},name:'Fictional balance bank',active:true,reason:null}]);
  await committed(finance,'save_money_channel',[...mutate(),channel,'0',{identity:{accountId:bank,kind:'bank',ownershipScope:'dedicated_business',providerNamespace:'fictional-bank',maskedSuffix:'9182'},label:'Fictional balance bank',effectiveFrom:'2026-01-01',ownershipEvidence:'Fictional ownership',openingState:'verified_zero',openingOn:'2026-01-01',openingCents:'0',openingEvidence:'Fictional opening',active:true,reason:'Fictional review'}]);
  const pay=cents=>committed(finance,'record_direct_fictional_receipt',[...mutate(),randomUUID(),owner.customer,channel,'1',today,cents,'Fictional settled receipt',null,{namespace:'ledger',id:randomUUID(),rawReference:'Fictional original inflow'},{[invoice.receivableId]:cents}]);
  await t.test('partial payment changes outstanding without changing the issued original',async()=>{
   await pay('10000');const before=await facts(),result=await read();assert.equal(result.state,'ready');assert.equal(result.outstandingCents,'15000');assert.equal(result.originalCents,'25000');assert.deepEqual(await facts(),before);
  });
  await t.test('settlement produces an explicit verified zero even though payment choices omit it',async()=>{
   await pay('15000');const before=await facts(),result=await read();assert.equal(result.state,'ready');assert.equal(result.outstandingCents,'0');assert.equal(result.originalCents,'25000');const choices=await command(finance,'read_direct_fictional_receipt_options',[...owner.auth(),owner.customer,today]);assert(!choices.receivables.some(row=>row.invoiceId===invoice.invoiceId));assert.deepEqual(await facts(),before);
  });
  await t.test('an actual zero-charge issued document is verified without inventing a receivable or payment',async()=>{
   const free=await pricedOwner({kind:'fixed',cents:'25000'},'Owner approved the exact fully discounted fictional service.'),zero=await issue({admin,web,finance,...free,today});
   assert.equal(zero.totalCents,'0');assert.equal(zero.receivableId,null);const before=await facts(free.owner.business);
   const result=parseInvoiceOutstanding(await command(finance,'read_fictional_invoice_outstanding',[...free.owner.auth(),free.owner.customer,zero.invoiceId]),free.owner.business,free.owner.customer,zero.invoiceId);
   assert.equal(result.state,'ready');assert.equal(result.originalCents,'0');assert.equal(result.outstandingCents,'0');assert.deepEqual(await facts(free.owner.business),before);
  });
  await t.test('inconsistent posted source refuses a balance and a rolled-back fault leaves the original intact',async()=>{
   const before=await facts();await admin.query('BEGIN');
   try{
    await admin.query('SET LOCAL session_replication_role=replica');
    await admin.query('UPDATE crest.receivable_items SET original_cents=original_cents+1 WHERE business_id=$1 AND id=$2',[owner.business,invoice.receivableId]);
    await admin.query('SET LOCAL ROLE crest_finance_preview');
    await assert.rejects(command(admin,'read_fictional_invoice_outstanding',args()),{code:'23514'});
   }finally{await admin.query('ROLLBACK');}
   assert.deepEqual(await facts(),before);assert.equal((await read()).outstandingCents,'0');
  });
 }finally{try{await sandbox?.close();}finally{await cluster.close();}}
});
