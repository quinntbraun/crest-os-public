import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {collectionFailureRecreditSourceColumns,collectionFailureRecreditSourceCoverage} from '../../src/bookkeeping/collection-failure-recredit-source.ts';
import {refundTransferFeeFile,refundTransferFeeRecoveryProfile} from './finance-refund-transfer-fee-candidate.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const priorRegistryHash='e32ed52f9355b5b047d472f49d57b883da8560db53b322ee3aa51ea287a8a7fa';
const priorMigrationHash='8aedbff39ea12d2cea1008a4e4a1b63b4db80db6b3fb46d6743cc24af4c61fa0';
export const collectionFailureRecreditVersion='20261223180000';
export const collectionFailureRecreditFile=collectionFailureRecreditVersion+'_fictional_collection_failure_held_recredit.sql';
const parts=['','-consumption','-report','-source','-export-access'];

export async function collectionFailureRecreditMigration(root){
  const source=['-- Registered fictional restored held funds after incoming failure. The migration coordinator owns the transaction.\n'];
  for(const part of parts){
    const name='planning/proposals/finance-collection-failure-held-recredit'+part+'.sql';
    source.push('\nRESET ROLE;\n-- BEGIN REVIEWED '+name+'\n',await readFile(join(root,name),'utf8'),
      '\nRESET ROLE;\n-- END REVIEWED '+name+'\n');
  }
  return source.join('');
}

export async function collectionFailureRecreditRecoveryProfile(directory,priorDirectory,directTipDirectory,root){
  const frozen=await readFile(join(root,'tests/support/registered98-migration-checksums.json'));
  assert.equal(hash(frozen),priorRegistryHash);
  const baseline=JSON.parse(frozen);
  assert.equal(baseline.migrations.length,98);
  assert.equal(baseline.migrations.at(-1).file,refundTransferFeeFile);
  assert.equal(hash(await readFile(join(directory,'supabase/migrations',refundTransferFeeFile))),priorMigrationHash);
  const prior=(await refundTransferFeeRecoveryProfile(priorDirectory,directTipDirectory,root)).coverage;
  assert.equal(prior.migrationCount,98);
  const migration=await collectionFailureRecreditMigration(root),sha256=hash(migration);
  assert.equal(await readFile(join(directory,'supabase/migrations',collectionFailureRecreditFile),'utf8'),migration);
  const reviewed=[...baseline.migrations,{version:collectionFailureRecreditVersion,file:collectionFailureRecreditFile,sha256}];
  const registry=await readFile(join(directory,'supabase/migration-checksums.json'));
  assert.deepEqual(JSON.parse(registry),{...baseline,migrations:reviewed});
  const additions=new Map(Object.entries(collectionFailureRecreditSourceColumns));
  const tables=prior.tables.map(table=>{
    const fields=additions.get(table.table);
    if(!fields)return table;
    additions.delete(table.table);
    return {...table,required:[...table.required,...fields]};
  });
  assert.equal(additions.size,0);
  const schemaVersion=reviewed.length;
  const coverage={...prior,migrationCount:schemaVersion,tables:[...tables,collectionFailureRecreditSourceCoverage]};
  return {profile:Object.freeze({schemaVersion,registrySha256:hash(registry),heldCollectionFailureRecreditMigrationSha256:sha256}),
    versions:reviewed.map(row=>row.version),coverage};
}
