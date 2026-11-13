import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { postedExpenseSourceAddedColumns, postedExpenseSourceCoverage } from '../../src/bookkeeping/posted-expense-source.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
export const expense79Files = Object.freeze(['finance-expense-same-day', 'finance-expense-same-day-source']);
export const expense79Version = '20261203180000';
export const expense79File = expense79Version + '_finance_same_day_expenses.sql';

export async function financeExpense79Candidate(sandbox) {
  const registered = await readFile(join(sandbox.root, 'tests/support/registered78-migration-checksums.json'));
  const registry = JSON.parse(registered);
  assert.equal(registry.migrations.length, 78);
  const directory = await sandbox.prefix(78);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'supabase/migration-checksums.json'))), registry);
  let sql = '-- Held same-day P12 and private expense source. The migration coordinator owns the transaction.\n';
  const parts = [];
  for (const name of expense79Files) {
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
  registry.migrations.push({ version: expense79Version, file: expense79File, sha256 });
  const registryBytes = Buffer.from(JSON.stringify(registry, null, 2) + '\n');
  const baselineCoverage = JSON.parse(await readFile(join(sandbox.root, 'tests/support/registered78-export-coverage.json')));
  assert.equal(baselineCoverage.migrationCount, 78);
  const shared = new Set(Object.keys(postedExpenseSourceAddedColumns));
  const coverage = { ...baselineCoverage, migrationCount: 79,
    tables: [...baselineCoverage.tables.map(entry => {
      const added = postedExpenseSourceAddedColumns[entry.table];
      if (!added) return entry;
      assert(shared.delete(entry.table));
      assert(added.every(column => !entry.required.includes(column)));
      return { ...entry, required: [...entry.required, ...added] };
    }), postedExpenseSourceCoverage] };
  assert.equal(shared.size, 0);
  assert.equal(new Set(coverage.tables.map(entry => entry.table)).size, coverage.tables.length);
  await writeFile(join(directory, 'supabase/migrations', expense79File), bytes, { flag: 'wx' });
  await writeFile(join(directory, 'supabase/migration-checksums.json'), registryBytes);
  return { directory, file: expense79File, sha256, bytes: bytes.length, parts, registrySha256: hash(registryBytes),
    previousRegistrySha256: hash(registered), coverage };
}
