import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fundApplicationSourceAddedColumns, fundApplicationSourceCoverage } from '../../src/bookkeeping/fund-application-source.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
export const fundApplication82Parts = Object.freeze([
  'finance-funds-apply', 'finance-funds-apply-operations', 'finance-funds-apply-source',
]);
export const fundApplication82Version = '20261206180000';
export const fundApplication82File = fundApplication82Version + '_finance_customer_fund_application.sql';
export const fundApplication82PriorRegistrySha256 = 'e30fcbac28d51a4b9e870c6f7da972fe5d7adf0bfadce3fab0249172c7a8ae8f';
export const fundApplication82PriorCoverageSha256 = '8a47eb4566de1e1b05095ee8948859071d8e4a7637509a88dc6441b2f1fd995e';

export async function readFrozen81(root) {
  const frozenRegistry = await readFile(join(root, 'tests/support/registered81-migration-checksums.json'));
  const frozenCoverage = await readFile(join(root, 'tests/support/registered81-export-coverage.json'));
  assert.equal(hash(frozenRegistry), fundApplication82PriorRegistrySha256);
  assert.equal(hash(frozenCoverage), fundApplication82PriorCoverageSha256);
  const registry = JSON.parse(frozenRegistry), coverage = JSON.parse(frozenCoverage);
  assert.equal(registry.migrations.length, 81);
  assert.equal(coverage.migrationCount, 81);
  return { registry, coverage };
}

export async function financeFundApplication82Candidate(sandbox) {
  const { registry, coverage: baseline } = await readFrozen81(sandbox.root);
  const directory = await sandbox.prefix(81);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'supabase/migration-checksums.json'))), registry);
  let sql = '-- Held P04 application and private source. The migration coordinator owns the transaction.\n';
  const parts = [];
  for (const name of fundApplication82Parts) {
    const path = 'planning/proposals/' + name + '.sql';
    const body = await readFile(join(sandbox.root, path));
    sql += '\nRESET ROLE;\n-- BEGIN REVIEWED ' + path + '\n';
    const offset = Buffer.byteLength(sql);
    sql += body.toString('utf8');
    assert(Buffer.from(sql).subarray(offset).equals(body));
    parts.push({ path, offset, bytes: body.length, sha256: hash(body) });
    sql += '\nRESET ROLE;\n-- END REVIEWED ' + path + '\n';
  }
  const bytes = Buffer.from(sql), sha256 = hash(bytes);
  registry.migrations.push({ version: fundApplication82Version, file: fundApplication82File, sha256 });
  const registryBytes = Buffer.from(JSON.stringify(registry, null, 2) + '\n');
  const shared = new Set(Object.keys(fundApplicationSourceAddedColumns));
  const coverage = { ...baseline, migrationCount: 82, tables: [...baseline.tables.map(entry => {
    const added = fundApplicationSourceAddedColumns[entry.table];
    if (!added) return entry;
    assert(shared.delete(entry.table));
    assert(added.every(column => !entry.required.includes(column)));
    return { ...entry, required: [...entry.required, ...added] };
  }), ...fundApplicationSourceCoverage] };
  assert.equal(shared.size, 0);
  assert.equal(new Set(coverage.tables.map(entry => entry.table)).size, coverage.tables.length);
  await writeFile(join(directory, 'supabase/migrations', fundApplication82File), bytes, { flag: 'wx' });
  await writeFile(join(directory, 'supabase/migration-checksums.json'), registryBytes);
  return { directory, file: fundApplication82File, sha256, bytes: bytes.length, parts, registrySha256: hash(registryBytes),
    previousRegistrySha256: fundApplication82PriorRegistrySha256, coverage };
}
