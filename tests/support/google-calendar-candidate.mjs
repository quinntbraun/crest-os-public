import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const proposal = name => 'planning/proposals/google-calendar-' + name + '.sql';
const coverageFile = 'tests/support/google-calendar-candidate-export-coverage.json';

// Registered Calendar proof uses only frozen source bytes, never a workstation cache.
export const googleCalendarCandidateParts = Object.freeze(['outbox','dispatch','oauth-attempt','disconnect','credentials',
  'destination-creation','initial-consent','setup-state','worker-material','job-status','portable-source','runner'].map(proposal));
export const googleCalendarCandidateFile = '20261211180000_fictional_google_calendar.sql';
const version = '20261211180000';
const parentRegistrySha256 = '2d1bc625ae0218a165241192e11a041190ae71d0762ca72bb23b36a2c7ec6257';
const parentCoverageSha256 = '96d049786ad1b6f50760a70beb968a8393b0e3a116f522eaeee55a33437e23f9';
const expectedMigrationSha256 = '5fe52fd4f4d1af3640dbdf91f2a7fbe6efef027c1d8e582486db3f8ccd0f34bd';
const expectedRegistrySha256 = 'fe99060ba5b3d6edee5d85f5d636ade8bf806e93917c1a7ffb22a0cff7e76f60';

export async function googleCalendarCandidate(sandbox) {
  const root = sandbox.root, schema86 = await sandbox.prefix(86), schema87 = await sandbox.prefix(87);
  const registryBytes = await readFile(join(schema87, 'supabase/migration-checksums.json'));
  assert.equal(hash(registryBytes), expectedRegistrySha256);
  const registry = JSON.parse(registryBytes), versions = registry.migrations.map(entry => entry.version);
  const coverage = JSON.parse(await readFile(join(root, 'tests/support/registered87-export-coverage.json')));
  return { directory: schema87, schema86, sha256: expectedMigrationSha256, coverage, registrySha256: expectedRegistrySha256, versions, parentRegistrySha256 };
}

export async function googleCalendarCandidateRecoveryProfile(candidate, root) {
  assert.equal(candidate.parentRegistrySha256, parentRegistrySha256);
  assert.equal(candidate.registrySha256, expectedRegistrySha256);
  assert.equal(candidate.sha256, expectedMigrationSha256);
  const frozen = await readFile(join(root, 'tests/support/registered86-migration-checksums.json'));
  assert.equal(hash(frozen), parentRegistrySha256);
  assert.deepEqual(await readFile(join(candidate.schema86, 'supabase/migration-checksums.json')), frozen);
  const registry = await readFile(join(candidate.directory, 'supabase/migration-checksums.json'));
  assert.equal(hash(registry), expectedRegistrySha256);
  const entries = JSON.parse(registry).migrations;
  assert.deepEqual(entries.slice(0, 86), JSON.parse(frozen).migrations);
  assert.deepEqual(entries.slice(86), [{ version, file: googleCalendarCandidateFile, sha256: expectedMigrationSha256 }]);
  assert.deepEqual(entries.map(entry => entry.version), candidate.versions);
  const migration = await readFile(join(candidate.directory, 'supabase/migrations', googleCalendarCandidateFile));
  assert.equal(hash(migration), expectedMigrationSha256);
  let offset = Buffer.byteLength('-- P20 fictional Google Calendar. The migration coordinator owns the transaction.\n');
  for (const path of googleCalendarCandidateParts) {
    const bytes = await readFile(join(root, path));
    offset += Buffer.byteLength('\nRESET ROLE;\n-- BEGIN REVIEWED ' + path + '\n');
    assert(migration.subarray(offset, offset + bytes.length).equals(bytes), path);
    offset += bytes.length + Buffer.byteLength('\nRESET ROLE;\n-- END REVIEWED ' + path + '\n');
  }
  assert.equal(offset, migration.length);
  const baseline = await readFile(join(root, 'tests/support/registered86-export-coverage.json'));
  assert.equal(hash(baseline), parentCoverageSha256);
  const additional = JSON.parse(await readFile(join(root, coverageFile)));
  const priorCoverage = JSON.parse(baseline);
  assert.equal(additional.tables.length, 24);
  assert.deepEqual(candidate.coverage, { ...priorCoverage, migrationCount: 87, tables: [...priorCoverage.tables, ...additional.tables] });
  return { profile: Object.freeze({ schemaVersion: 87, registrySha256: candidate.registrySha256, heldGoogleCalendarMigrationSha256: candidate.sha256 }),
    versions: candidate.versions, coverage: candidate.coverage };
}
