import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { heldTipSourceAddedColumns, heldTipSourceCoverage } from '../../src/bookkeeping/held-tip-source.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
export const heldTip83Parts = Object.freeze([
  'finance-held-tip', 'finance-held-tip-operations', 'finance-held-tip-source',
]);
export const heldTip83Version = '20261207180000';
export const heldTip83File = heldTip83Version + '_finance_held_tip.sql';
export const heldTip83PriorRegistrySha256 = '6a1621e878ddbfba68795dc530840dc4ee656d0a41dff47927212c652d3162d5';
export const heldTip83PriorCoverageSha256 = 'afa9df341039216fa32d3f9253ddc8b09d7671bf513923f4fd0b95a58b0e5cb2';

export async function readFrozen82(root) {
  const frozenRegistry = await readFile(join(root, 'tests/support/registered82-migration-checksums.json'));
  const frozenCoverage = await readFile(join(root, 'tests/support/registered82-export-coverage.json'));
  assert.equal(hash(frozenRegistry), heldTip83PriorRegistrySha256);
  assert.equal(hash(frozenCoverage), heldTip83PriorCoverageSha256);
  const registry = JSON.parse(frozenRegistry), coverage = JSON.parse(frozenCoverage);
  assert.equal(registry.migrations.length, 82);
  assert.equal(coverage.migrationCount, 82);
  return { registry, coverage };
}

export async function financeHeldTip83Candidate(sandbox) {
  const { registry, coverage: baseline } = await readFrozen82(sandbox.root);
  const directory = await sandbox.prefix(82);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'supabase/migration-checksums.json'))), registry);
  let sql = '-- Held P06 tip realization and private source. The migration coordinator owns the transaction.\n';
  const parts = [];
  for (const name of heldTip83Parts) {
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
  registry.migrations.push({ version: heldTip83Version, file: heldTip83File, sha256 });
  const registryBytes = Buffer.from(JSON.stringify(registry, null, 2) + '\n');
  const shared = new Set(Object.keys(heldTipSourceAddedColumns));
  const coverage = { ...baseline, migrationCount: 83, tables: [...baseline.tables.map(entry => {
    const added = heldTipSourceAddedColumns[entry.table];
    if (!added) return entry;
    assert(shared.delete(entry.table));
    assert(added.every(column => !entry.required.includes(column)));
    return { ...entry, required: [...entry.required, ...added] };
  }), ...heldTipSourceCoverage] };
  assert.equal(shared.size, 0);
  assert.equal(new Set(coverage.tables.map(entry => entry.table)).size, coverage.tables.length);
  await writeFile(join(directory, 'supabase/migrations', heldTip83File), bytes, { flag: 'wx' });
  await writeFile(join(directory, 'supabase/migration-checksums.json'), registryBytes);
  return { directory, file: heldTip83File, sha256, bytes: bytes.length, parts, registrySha256: hash(registryBytes),
    previousRegistrySha256: heldTip83PriorRegistrySha256, coverage };
}
