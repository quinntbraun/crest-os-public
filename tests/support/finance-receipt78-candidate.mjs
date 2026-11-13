import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { receiptSourceAddedColumns, receiptSourceCoverage } from '../../src/bookkeeping/receipt-source.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
export const receipt78Files = Object.freeze(['finance-receipt-direct', 'finance-receipt-source-export']);
export const receipt78Version = '20261202180000';
export const receipt78File = receipt78Version + '_finance_direct_receipts.sql';

export async function financeReceipt78Candidate(sandbox) {
  const registered = await readFile(join(sandbox.root, 'tests/support/registered77-migration-checksums.json'));
  const registry = JSON.parse(registered);
  assert.equal(registry.migrations.length, 77);
  const directory = await sandbox.prefix(77);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'supabase/migration-checksums.json'))), registry);
  let sql = '-- Held direct P03 and private receipt source. The migration coordinator owns the transaction.\n';
  const parts = [];
  for (const name of receipt78Files) {
    const path = 'planning/proposals/' + name + '.sql';
    const body = await readFile(join(sandbox.root, path));
    sql += '\nRESET ROLE;\n-- BEGIN REVIEWED ' + path + '\n';
    const offset = Buffer.byteLength(sql);
    sql += body.toString('utf8');
    assert(Buffer.from(sql).subarray(offset).equals(body));
    parts.push({ path, offset, bytes: body.length, sha256: hash(body) });
    sql += '\nRESET ROLE;\n-- END REVIEWED ' + path + '\n';
  }
  const bytes = Buffer.from(sql);
  const sha256 = hash(bytes);
  registry.migrations.push({ version: receipt78Version, file: receipt78File, sha256 });
  const registryBytes = Buffer.from(JSON.stringify(registry, null, 2) + '\n');
  const baselineCoverage = JSON.parse(await readFile(join(sandbox.root, 'tests/support/registered77-export-coverage.json')));
  assert.equal(baselineCoverage.migrationCount, 77);
  const shared = new Set(Object.keys(receiptSourceAddedColumns));
  const coverage = { ...baselineCoverage, migrationCount: 78,
    tables: [...baselineCoverage.tables.map(entry => {
      const added = receiptSourceAddedColumns[entry.table];
      if (!added) return entry;
      assert(shared.delete(entry.table));
      assert(added.every(column => !entry.required.includes(column)));
      return { ...entry, required: [...entry.required, ...added] };
    }), ...receiptSourceCoverage] };
  assert.equal(shared.size, 0);
  assert.equal(new Set(coverage.tables.map(entry => entry.table)).size, coverage.tables.length);
  await writeFile(join(directory, 'supabase/migrations', receipt78File), bytes, { flag: 'wx' });
  await writeFile(join(directory, 'supabase/migration-checksums.json'), registryBytes);
  return { directory, file: receipt78File, sha256, bytes: bytes.length, parts, registrySha256: hash(registryBytes),
    previousRegistrySha256: hash(registered), coverage };
}
