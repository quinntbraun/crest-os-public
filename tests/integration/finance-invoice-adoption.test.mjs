import assert from 'node:assert/strict';
import {test} from 'node:test';
import {financeInvoice77Candidate} from '../support/finance-invoice77-candidate.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {inventory,recoveryCluster} from '../support/recovery-drill.mjs';
import {verifyExportCoverage} from '../../src/tooling/export-coverage.ts';
import {requireSyntheticFinanceAccountConfiguration} from '../../scripts/synthetic-migrations.mjs';

test('the exact invoice candidate adds only its covered tables to a retained schema76 database',
  {timeout:120000},async()=>{
    const cluster=await recoveryCluster();
    let sandbox;
    try{
      sandbox=await migrationSandbox(cluster.testDatabaseUrl);
      const target=await sandbox.database(),admin=await sandbox.connect(target);
      await sandbox.apply(target,await sandbox.prefix(0),true);
      await installProviderSchema(admin,target);
      const previous=await sandbox.apply(target,await sandbox.prefix(76));
      await assert.rejects(requireSyntheticFinanceAccountConfiguration(target,undefined,true,true,true,true,true,true),
        {message:'SYNTHETIC_FINANCE_ACCOUNT_MIGRATION_REQUIRED'});
      const before=await inventory(admin);
      assert(before.some(row=>row.rows>0));
      const candidate=await financeInvoice77Candidate(sandbox);
      const applied=await sandbox.apply(target,candidate.directory);
      assert.equal(applied.registrySha256,candidate.registrySha256);
      assert.equal(applied.history.length,77);
      await requireSyntheticFinanceAccountConfiguration(target,undefined,true,true,true,true,true,true);
      assert.deepEqual(applied.history.slice(0,76),previous.history);
      const after=await inventory(admin);
      const added=new Set(candidate.coverage.tables.slice(-15).map(entry=>entry.table));
      const retained=rows=>rows.filter(row=>row.schema!=='supabase_migrations'&&!added.has(row.schema+'.'+row.name));
      assert.deepEqual(retained(after),retained(before));
      const newTables=after.filter(row=>added.has(row.schema+'.'+row.name));
      assert.equal(newTables.length,15);
      assert(newTables.every(row=>row.rows===0));
      const {rows:columns}=await admin.query(`
        SELECT n.nspname||'.'||c.relname AS "table",a.attname AS "column"
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN('crest','crest_private') AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped
      `);
      assert.equal(verifyExportCoverage(candidate.coverage,columns,77).tables,candidate.coverage.tables.length);
      assert.deepEqual((await sandbox.apply(target,candidate.directory)).history,applied.history);
    }finally{
      try{await sandbox?.close();}finally{await cluster.close();}
    }
  });
