import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {collectionFailureGroupedRecreditSourceColumns,collectionFailureGroupedRecreditSourceCoverage}
  from '../../src/bookkeeping/collection-failure-grouped-recredit-source.ts';
import {collectionFailureRecreditFile,collectionFailureRecreditRecoveryProfile} from './finance-collection-failure-recredit-candidate.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const priorRegistryHash='bb752d579e2442d20dcc21723edb272332464dea9d5ea36b41d5603c7323181b';
const priorMigrationHash='d1f871aed731db515ca6385f6611cc1765cb2dfe696b6ff179a1df6450237f39';
export const collectionFailureGroupedRecreditVersion='20261224180000';
export const collectionFailureGroupedRecreditFile=collectionFailureGroupedRecreditVersion+'_fictional_collection_failure_grouped_recredit.sql';
const parts=['','-operations','-consumption','-report','-source','-export-access'];

export async function collectionFailureGroupedRecreditMigration(root){
  const source=['-- Registered fictional grouped recovery after incoming failure. The migration coordinator owns the transaction.\n'];
  for(const part of parts){
    const name='planning/proposals/finance-collection-failure-grouped-recredit'+part+'.sql';
    source.push('\nRESET ROLE;\n-- BEGIN REVIEWED '+name+'\n',await readFile(join(root,name),'utf8'),
      '\nRESET ROLE;\n-- END REVIEWED '+name+'\n');
  }
  return source.join('');
}

export async function collectionFailureGroupedRecreditRecoveryProfile(directory,priorDirectory,feeDirectory,tipDirectory,root){
  const frozen=await readFile(join(root,'tests/support/registered99-migration-checksums.json'));
  assert.equal(hash(frozen),priorRegistryHash);
  const baseline=JSON.parse(frozen);
  assert.equal(baseline.migrations.length,99);
  assert.equal(baseline.migrations.at(-1).file,collectionFailureRecreditFile);
  assert.equal(hash(await readFile(join(directory,'supabase/migrations',collectionFailureRecreditFile))),priorMigrationHash);
  const prior=(await collectionFailureRecreditRecoveryProfile(priorDirectory,feeDirectory,tipDirectory,root)).coverage;
  assert.equal(prior.migrationCount,99);
  const migration=await collectionFailureGroupedRecreditMigration(root),sha256=hash(migration);
  assert.equal(await readFile(join(directory,'supabase/migrations',collectionFailureGroupedRecreditFile),'utf8'),migration);
  const reviewed=[...baseline.migrations,{version:collectionFailureGroupedRecreditVersion,file:collectionFailureGroupedRecreditFile,sha256}];
  const registry=await readFile(join(directory,'supabase/migration-checksums.json'));
  assert.deepEqual(JSON.parse(registry),{...baseline,migrations:reviewed});
  const additions=new Map(Object.entries(collectionFailureGroupedRecreditSourceColumns));
  const tables=prior.tables.map(table=>{
    const fields=additions.get(table.table);
    if(!fields)return table;
    additions.delete(table.table);
    return {...table,required:[...table.required,...fields]};
  });
  assert.equal(additions.size,0);
  const schemaVersion=reviewed.length;
  const coverage={...prior,migrationCount:schemaVersion,tables:[...tables,...collectionFailureGroupedRecreditSourceCoverage]};
  return {profile:Object.freeze({schemaVersion,registrySha256:hash(registry),heldCollectionFailureGroupedRecreditMigrationSha256:sha256}),
    versions:reviewed.map(row=>row.version),coverage};
}
