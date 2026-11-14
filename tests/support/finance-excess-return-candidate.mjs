import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { excessReturnSourceAddedColumns, excessReturnSourceCoverage } from '../../src/bookkeeping/excess-return-source.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
const baselineVersion = 92;
const priorRegistryHash = 'dff993306834fe99b3fd9c632db26521be073e9ae08703f3aeb1b71b8db94fd6';
const candidateVersion = '20261217180000';
const candidateFile = candidateVersion + '_fictional_excess_return.sql';
const registeredRegistryHash = '93f8f85653ab78e08ad11ce139e22518ec312b6b803d7160aa3864497132f871';
const registeredMigrationHash = '6e4dc661a8241e49b5c4e7fe45b4bcd67e50da81cab7c212d014c2c4697ea324';
const parts = ['finance-excess-return', 'finance-excess-return-options', 'finance-excess-return-retirement',
  'finance-excess-return-report', 'finance-excess-return-source'];
const migrationPath = directory => join(directory, 'supabase/migrations', candidateFile);
const registryPath = directory => join(directory, 'supabase/migration-checksums.json');

async function baseline(root) {
  const prior = await readFile(join(root, 'tests/support/registered92-migration-checksums.json'));
  assert.equal(hash(prior), priorRegistryHash);
  const { migrations } = JSON.parse(prior);
  assert.equal(migrations.length, baselineVersion);
  const priorCoverage = JSON.parse(await readFile(join(root, 'tests/support/registered87-export-coverage.json'), 'utf8'));
  assert.equal(priorCoverage.migrationCount, 87);
  const coverage = {...priorCoverage, migrationCount: baselineVersion, tables: priorCoverage.tables.map(row =>
    row.table === 'crest.customer_fund_lots' ? {...row, required: [...row.required, 'receipt_event_id']} : row)};
  return { migrations, coverage };
}

async function migration(root) {
  const chunks = ['-- Registered fictional P09. The migration coordinator owns the transaction.\n'];
  for (const name of parts) {
    const path = 'planning/proposals/' + name + '.sql';
    chunks.push('\nRESET ROLE;\n-- BEGIN REVIEWED ' + path + '\n');
    chunks.push(await readFile(join(root, path), 'utf8'));
    chunks.push('\nRESET ROLE;\n-- END REVIEWED ' + path + '\n');
  }
  return chunks.join('');
}

export async function prepareExcessReturnCandidate(sandbox) {
  const directory = await sandbox.prefix(93);
  await excessReturnCandidateRecoveryProfile(directory, sandbox.root);
  return directory;
}

export async function excessReturnCandidateRecoveryProfile(directory, root) {
  const { migrations, coverage } = await baseline(root);
  const source = await migration(root);
  const sha256 = hash(source);
  const registry = await readFile(registryPath(directory));
  assert.equal(sha256, registeredMigrationHash);
  assert.equal(hash(registry), registeredRegistryHash);
  assert.equal(await readFile(migrationPath(directory), 'utf8'), source);
  const reviewed = [...migrations, { version: candidateVersion, file: candidateFile, sha256 }];
  assert.deepEqual(JSON.parse(registry).migrations, reviewed);
  const added = new Map(Object.entries(excessReturnSourceAddedColumns));
  const tables = coverage.tables.map(row => {
    if (!added.has(row.table)) return row;
    const fields = added.get(row.table);
    added.delete(row.table);
    return { ...row, required: [...row.required, ...fields] };
  });
  assert.equal(added.size, 0);
  const schemaVersion = baselineVersion + 1;
  const expectedCoverage = { ...coverage, migrationCount: schemaVersion, tables: [...tables, excessReturnSourceCoverage] };
  return { profile: Object.freeze({ schemaVersion, registrySha256: hash(registry), heldExcessReturnMigrationSha256: sha256 }),
    versions: reviewed.map(row => row.version),
    coverage: expectedCoverage };
}
