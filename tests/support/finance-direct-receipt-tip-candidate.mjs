import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { directReceiptTipSourceAddedColumns } from '../../src/bookkeeping/direct-receipt-tip-source.ts';
import { refundTransferExportCoverage, refundTransferFile } from './finance-refund-transfer-candidate.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const priorRegistryHash = '03db5113e00585da6f8966b4a8c5f8da5955ab59f987d75671d8d4732eb57f4b';
const priorMigrationHash = '52ec69175560b3e049ca376c6f8bcfcd07cf7897afb47e1147cd7ca543a0eac8';
export const directReceiptTipVersion = '20261221180000';
export const directReceiptTipFile = directReceiptTipVersion + '_fictional_direct_receipt_tip.sql';
const parts = ['', '-lineage', '-options', '-report-control', '-source', '-export-access'];

export async function directReceiptTipMigration(root) {
  const source = ['-- Registered fictional direct receipt tips. The migration coordinator owns the transaction.\n'];
  for (const part of parts) {
    const name = 'planning/proposals/finance-direct-receipt-tip' + part + '.sql';
    source.push('\nRESET ROLE;\n-- BEGIN REVIEWED ' + name + '\n', await readFile(join(root,name),'utf8'),
      '\nRESET ROLE;\n-- END REVIEWED ' + name + '\n');
  }
  return source.join('');
}

export async function directReceiptTipRecoveryProfile(directory, root) {
  const frozen = await readFile(join(root,'tests/support/registered96-migration-checksums.json'));
  assert.equal(hash(frozen),priorRegistryHash);
  const baseline = JSON.parse(frozen);
  assert.equal(baseline.migrations.length,96);
  assert.equal(baseline.migrations.at(-1).file,refundTransferFile);
  assert.equal(hash(await readFile(join(directory,'supabase/migrations',refundTransferFile))),priorMigrationHash);
  const prior = await refundTransferExportCoverage(root);
  assert.equal(prior.migrationCount,96);
  const source = await directReceiptTipMigration(root), sha256 = hash(source);
  assert.equal(await readFile(join(directory,'supabase/migrations',directReceiptTipFile),'utf8'),source);
  const reviewed = [...baseline.migrations,{version:directReceiptTipVersion,file:directReceiptTipFile,sha256}];
  const registry = await readFile(join(directory,'supabase/migration-checksums.json'));
  assert.deepEqual(JSON.parse(registry),{...baseline,migrations:reviewed});
  const added = new Map(Object.entries(directReceiptTipSourceAddedColumns));
  const tables = prior.tables.map(table=>{
    const fields=added.get(table.table);
    if(!fields)return table;
    added.delete(table.table);
    return {...table,required:[...table.required,...fields]};
  });
  assert.equal(added.size,0);
  const schemaVersion=reviewed.length;
  return {profile:Object.freeze({schemaVersion,registrySha256:hash(registry),heldDirectReceiptTipMigrationSha256:sha256}),
    versions:reviewed.map(row=>row.version),coverage:{...prior,migrationCount:schemaVersion,tables}};
}
