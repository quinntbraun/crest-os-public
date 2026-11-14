import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectionFailureSourceAddedColumns, collectionFailureSourceCoverage } from '../../src/bookkeeping/collection-failure-source.ts';
import { refundTransferSourceAddedColumns, refundTransferSourceCoverage } from '../../src/bookkeeping/refund-transfer-source.ts';
import { tipReturnExportCoverage } from './finance-tip-return-candidate.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const priorRegistryHash = 'e9961c5011779f6326ad01c79d17ef6cdc50008293637bc9718964f4ced0285a';
const priorVersion = '20261219180000';
const priorFile = priorVersion + '_fictional_collection_failure.sql';
const priorMigrationHash = '321d195d999b93e6895f7b0ca18e5e2857a98d3e20249c525c3c2b83a00e12d1';
export const refundTransferVersion = '20261220180000';
export const refundTransferFile = refundTransferVersion + '_fictional_refund_transfer.sql';
const parts = ['finance-refund-transfer-adjustment.sql', 'finance-refund-transfer-recovery.sql', 'finance-refund-transfer-report.sql',
  'finance-refund-transfer-adjustment-options.sql', 'finance-refund-transfer-source.sql', 'finance-refund-transfer-export-access.sql'];

export async function refundTransferMigration(root) {
  const chunks = ['-- Registered fictional refund transfers. The migration coordinator owns the transaction.\n'];
  for (const part of parts) {
    const name = 'planning/proposals/' + part;
    chunks.push('\nRESET ROLE;\n-- BEGIN REVIEWED ' + name + '\n', await readFile(join(root, name), 'utf8'),
      '\nRESET ROLE;\n-- END REVIEWED ' + name + '\n');
  }
  return chunks.join('');
}

function extendCoverage(coverage, addedColumns, addedTables) {
  const added = new Map(Object.entries(addedColumns));
  const tables = coverage.tables.map(table => {
    const fields = added.get(table.table);
    if (!fields) return table;
    added.delete(table.table);
    return { ...table, required: [...table.required, ...fields] };
  });
  assert.equal(added.size, 0);
  return { ...coverage, migrationCount: coverage.migrationCount + 1, tables: [...tables, ...addedTables] };
}

export async function refundTransferExportCoverage(root) {
  const coverage95=extendCoverage(await tipReturnExportCoverage(root),collectionFailureSourceAddedColumns,collectionFailureSourceCoverage);
  return extendCoverage(coverage95,refundTransferSourceAddedColumns,refundTransferSourceCoverage);
}

export async function refundTransferRecoveryProfile(directory, root) {
  const priorRegistry = await readFile(join(root, 'tests/support/registered95-migration-checksums.json'));
  assert.equal(hash(priorRegistry), priorRegistryHash);
  const baseline = JSON.parse(priorRegistry);
  assert.equal(baseline.migrations.length, 95);
  assert.deepEqual(baseline.migrations.at(-1), { version: priorVersion, file: priorFile, sha256: priorMigrationHash });
  assert.equal(hash(await readFile(join(directory, 'supabase/migrations', priorFile))), priorMigrationHash);
  const source = await refundTransferMigration(root), sha256 = hash(source);
  assert.equal(await readFile(join(directory, 'supabase/migrations', refundTransferFile), 'utf8'), source);
  const reviewed = [...baseline.migrations, { version: refundTransferVersion, file: refundTransferFile, sha256 }];
  const registry = await readFile(join(directory, 'supabase/migration-checksums.json'));
  assert.deepEqual(JSON.parse(registry), { ...baseline, migrations: reviewed });
  const coverage = await refundTransferExportCoverage(root);
  assert.equal(coverage.migrationCount, reviewed.length);
  return { profile: Object.freeze({ schemaVersion: reviewed.length, registrySha256: hash(registry), heldRefundTransferMigrationSha256: sha256 }),
    versions: reviewed.map(row => row.version), coverage };
}
