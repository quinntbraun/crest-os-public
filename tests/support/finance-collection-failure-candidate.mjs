import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {collectionFailureSourceAddedColumns,collectionFailureSourceCoverage} from '../../src/bookkeeping/collection-failure-source.ts';
import {tipReturnExportCoverage} from './finance-tip-return-candidate.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
export const collectionFailureVersion='20261219180000';
export const collectionFailureFile=collectionFailureVersion+'_fictional_collection_failure.sql';
const baseRegistryHash='57aad539a97f2be4288949e3864ff196fcbd8fe4f5b83b69a348be0d1d99c1ea';
const parts=['finance-collection-failure.sql','finance-collection-failure-options.sql','finance-collection-failure-report.sql',
  'finance-collection-failure-source.sql','finance-collection-failure-export-access.sql'];

export async function collectionFailureMigration(root){
  const chunks=['-- Registered fictional P11. The migration coordinator owns the transaction.\n'];
  for(const part of parts){
    const name='planning/proposals/'+part;
    chunks.push('\nRESET ROLE;\n-- BEGIN REVIEWED '+name+'\n',await readFile(join(root,name),'utf8'),
      '\nRESET ROLE;\n-- END REVIEWED '+name+'\n');
  }
  return chunks.join('');
}

export async function collectionFailureRecoveryProfile(directory,root){
  const priorBytes=await readFile(join(root,'tests/support/registered94-migration-checksums.json'));
  assert.equal(hash(priorBytes),baseRegistryHash);
  const {migrations}=JSON.parse(priorBytes);
  assert.equal(migrations.length,94);
  const coverage=await tipReturnExportCoverage(root);
  const source=await collectionFailureMigration(root),sha256=hash(source);
  const registry=await readFile(join(directory,'supabase/migration-checksums.json'));
  assert.equal(await readFile(join(directory,'supabase/migrations',collectionFailureFile),'utf8'),source);
  const reviewed=[...migrations,{version:collectionFailureVersion,file:collectionFailureFile,sha256}];
  assert.deepEqual(JSON.parse(registry).migrations,reviewed);
  const added=new Map(Object.entries(collectionFailureSourceAddedColumns));
  const tables=coverage.tables.map(table=>{
    const fields=added.get(table.table);
    if(!fields)return table;
    added.delete(table.table);
    return {...table,required:[...table.required,...fields]};
  });
  assert.equal(added.size,0);
  return {profile:Object.freeze({schemaVersion:95,registrySha256:hash(registry),heldCollectionFailureMigrationSha256:sha256}),
    versions:reviewed.map(row=>row.version),coverage:{...coverage,migrationCount:95,tables:[...tables,...collectionFailureSourceCoverage]}};
}
