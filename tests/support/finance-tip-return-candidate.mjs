import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tipReturnSourceAddedColumns, tipReturnSourceCoverage } from '../../src/bookkeeping/tip-return-source.ts';
import { excessReturnSourceAddedColumns, excessReturnSourceCoverage } from '../../src/bookkeeping/excess-return-source.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
const baselineVersion = 93;
const priorRegistryHash = '93f8f85653ab78e08ad11ce139e22518ec312b6b803d7160aa3864497132f871';
const candidateVersion = '20261218180000';
const candidateFile = candidateVersion + '_fictional_tip_return.sql';
const registeredRegistryHash = '57aad539a97f2be4288949e3864ff196fcbd8fe4f5b83b69a348be0d1d99c1ea';
const registeredMigrationHash = '64c2bb2a7f239907d28ec7743c422de3cde16734b6badda9cb6f1ccca2583a8c';
const parts = ['storage', 'posting', 'command', 'retirement', 'options', 'report', 'source'];
const migrationPath = directory => join(directory, 'supabase/migrations', candidateFile);
const registryPath = directory => join(directory, 'supabase/migration-checksums.json');

async function baseline(root) {
  const prior = await readFile(join(root, 'tests/support/registered93-migration-checksums.json'));
  assert.equal(hash(prior), priorRegistryHash);
  const { migrations } = JSON.parse(prior);
  assert.equal(migrations.length, baselineVersion);
  const priorCoverage = JSON.parse(await readFile(join(root, 'tests/support/registered87-export-coverage.json'), 'utf8'));
  assert.equal(priorCoverage.migrationCount, 87);
  const added = new Map(Object.entries(excessReturnSourceAddedColumns));
  const tables = priorCoverage.tables.map(row => {
    if (row.table === 'crest.customer_fund_lots') return {...row, required: [...row.required, 'receipt_event_id']};
    if (!added.has(row.table)) return row;
    const fields = added.get(row.table);
    added.delete(row.table);
    return {...row, required: [...row.required, ...fields]};
  });
  assert.equal(added.size, 0);
  const coverage = {...priorCoverage, migrationCount: baselineVersion, tables: [...tables, excessReturnSourceCoverage]};
  return { migrations, coverage };
}

async function migration(root) {
  const chunks = ['-- Registered fictional P10. The migration coordinator owns the transaction.\n'];
  for (const part of parts) {
    const name = 'planning/proposals/finance-tip-return-' + part + '.sql';
    chunks.push('\nRESET ROLE;\n-- BEGIN REVIEWED ' + name + '\n');
    chunks.push(await readFile(join(root, name), 'utf8'));
    chunks.push('\nRESET ROLE;\n-- END REVIEWED ' + name + '\n');
  }
  return chunks.join('');
}

export async function prepareTipReturnCandidate(sandbox) {
  const directory = await sandbox.prefix(94);
  await tipReturnCandidateRecoveryProfile(directory, sandbox.root);
  return directory;
}

export async function tipReturnCandidateRecoveryProfile(directory, root) {
  const { migrations, coverage } = await baseline(root);
  const source = await migration(root);
  const sha256 = hash(source);
  const registry = await readFile(registryPath(directory));
  assert.equal(sha256, registeredMigrationHash);
  assert.equal(hash(registry), registeredRegistryHash);
  assert.equal(await readFile(migrationPath(directory), 'utf8'), source);
  const reviewed = [...migrations, { version: candidateVersion, file: candidateFile, sha256 }];
  assert.deepEqual(JSON.parse(registry).migrations, reviewed);
  const added = new Map(Object.entries(tipReturnSourceAddedColumns));
  const tables = coverage.tables.map(row => {
    if (!added.has(row.table)) return row;
    const fields = added.get(row.table);
    added.delete(row.table);
    return { ...row, required: [...row.required, ...fields] };
  });
  assert.equal(added.size, 0);
  const schemaVersion = baselineVersion + 1;
  return { profile: Object.freeze({ schemaVersion, registrySha256: hash(registry), heldTipReturnMigrationSha256: sha256 }),
    versions: reviewed.map(row => row.version),
    coverage: { ...coverage, migrationCount: schemaVersion, tables: [...tables, ...tipReturnSourceCoverage] } };
}
