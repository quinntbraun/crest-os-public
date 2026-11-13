import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unapplicationSourceAddedColumns, unapplicationSourceCoverage } from '../../src/bookkeeping/unapplication-source.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
export const unapplication81Files = Object.freeze([
  'finance-allocation-unapply', 'finance-allocation-unapply-operations', 'finance-allocation-unapply-source',
]);
export const unapplication81Version = '20261205180000';
export const unapplication81File = unapplication81Version + '_finance_allocation_unapplication.sql';

export async function financeUnapplication81Candidate(sandbox) {
  const registered = await readFile(join(sandbox.root, 'tests/support/registered80-migration-checksums.json'));
  const registry = JSON.parse(registered);
  assert.equal(registry.migrations.length, 80);
  const directory = await sandbox.prefix(80);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'supabase/migration-checksums.json'))), registry);
  let sql = '-- Held P05 and private unapplication source. The migration coordinator owns the transaction.\n';
  const parts = [];
  for (const name of unapplication81Files) {
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
  registry.migrations.push({ version: unapplication81Version, file: unapplication81File, sha256 });
  const registryBytes = Buffer.from(JSON.stringify(registry, null, 2) + '\n');
  const baselineCoverage = JSON.parse(await readFile(join(sandbox.root, 'tests/support/registered80-export-coverage.json')));
  assert.equal(baselineCoverage.migrationCount, 80);
  const shared = new Set(Object.keys(unapplicationSourceAddedColumns));
  const coverage = { ...baselineCoverage, migrationCount: 81,
    tables: [...baselineCoverage.tables.map(entry => {
      const added = unapplicationSourceAddedColumns[entry.table];
      if (!added) return entry;
      assert(shared.delete(entry.table));
      assert(added.every(column => !entry.required.includes(column)));
      return { ...entry, required: [...entry.required, ...added] };
    }), ...unapplicationSourceCoverage] };
  assert.equal(shared.size, 0);
  assert.equal(new Set(coverage.tables.map(entry => entry.table)).size, coverage.tables.length);
  await writeFile(join(directory, 'supabase/migrations', unapplication81File), bytes, { flag: 'wx' });
  await writeFile(join(directory, 'supabase/migration-checksums.json'), registryBytes);
  return { directory, file: unapplication81File, sha256, bytes: bytes.length, parts, registrySha256: hash(registryBytes),
    previousRegistrySha256: hash(registered), coverage };
}
