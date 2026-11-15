import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {refundTransferFeeSourceCoverage} from '../../src/bookkeeping/refund-transfer-fee-source.ts';
import {directReceiptTipFile,directReceiptTipRecoveryProfile} from './finance-direct-receipt-tip-candidate.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const priorRegistryHash='4e432a18da54cf22046ed88953b0423e688327d4fe768f8f65420f82bf341fb4';
const priorMigrationHash='ae10cc68c1f365ca2fcf1aa6f92c6743b20eac989da8a02dbccdb378e3863895';
export const refundTransferFeeVersion='20261222180000';
export const refundTransferFeeFile=refundTransferFeeVersion+'_fictional_refund_transfer_withheld_fee.sql';
const parts=['','-report','-source','-export-access'];

export async function refundTransferFeeMigration(root) {
  const source=['-- Registered fictional provider-withheld refund fees. The migration coordinator owns the transaction.\n'];
  for(const part of parts){
    const name='planning/proposals/finance-refund-transfer-withheld-fee'+part+'.sql';
    source.push('\nRESET ROLE;\n-- BEGIN REVIEWED '+name+'\n',await readFile(join(root,name),'utf8'),
      '\nRESET ROLE;\n-- END REVIEWED '+name+'\n');
  }
  return source.join('');
}

export async function refundTransferFeeRecoveryProfile(directory,priorDirectory,root) {
  const frozen=await readFile(join(root,'tests/support/registered97-migration-checksums.json'));
  assert.equal(hash(frozen),priorRegistryHash);
  const baseline=JSON.parse(frozen);
  assert.equal(baseline.migrations.length,97);
  assert.equal(baseline.migrations.at(-1).file,directReceiptTipFile);
  assert.equal(hash(await readFile(join(directory,'supabase/migrations',directReceiptTipFile))),priorMigrationHash);
  const prior=(await directReceiptTipRecoveryProfile(priorDirectory,root)).coverage;
  assert.equal(prior.migrationCount,97);
  const migration=await refundTransferFeeMigration(root),sha256=hash(migration);
  assert.equal(await readFile(join(directory,'supabase/migrations',refundTransferFeeFile),'utf8'),migration);
  const reviewed=[...baseline.migrations,{version:refundTransferFeeVersion,file:refundTransferFeeFile,sha256}];
  const registry=await readFile(join(directory,'supabase/migration-checksums.json'));
  assert.deepEqual(JSON.parse(registry),{...baseline,migrations:reviewed});
  const schemaVersion=reviewed.length;
  const coverage={...prior,migrationCount:schemaVersion,tables:[...prior.tables,refundTransferFeeSourceCoverage]};
  return {profile:Object.freeze({schemaVersion,registrySha256:hash(registry),heldRefundTransferFeeMigrationSha256:sha256}),
    versions:reviewed.map(row=>row.version),coverage};
}
