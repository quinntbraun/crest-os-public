import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {invoiceSourceCoverage} from '../../src/bookkeeping/invoice-source.ts';

export const financeInvoice77Parts=Object.freeze([
  'finance-invoice-exemption-evidence','finance-invoice-issue-tax-review','finance-invoice-issue-account-review',
  'finance-issuance-prerequisites','finance-issuance-period-fence','finance-invoice-setup',
  'finance-issued-invoice-source','finance-invoice-ledger','finance-invoice-issue','finance-invoice-posting-source-export',
]);
const sha=value=>createHash('sha256').update(value).digest('hex');

export async function financeInvoice77Candidate(sandbox){
  const frozen=await readFile(join(sandbox.root,'tests/support/registered76-migration-checksums.json'));
  const registry=JSON.parse(frozen);
  assert.equal(registry.migrations.length,76);
  const directory=await sandbox.prefix(76);
  assert.deepEqual(JSON.parse(await readFile(join(directory,'supabase/migration-checksums.json'))),registry);
  let sql='-- BR11 invoice numbering, exact issue, immutable journal and private source capture.\n'
    +'-- The migration coordinator owns the atomic transaction. Financial activation remains separate.\n';
  const parts=[];
  for(const part of financeInvoice77Parts){
    const path='planning/proposals/'+part+'.sql',body=await readFile(join(sandbox.root,path));
    sql+='\nRESET ROLE;\n-- BEGIN REVIEWED '+path+'\n';
    const offset=Buffer.byteLength(sql);
    sql+=body.toString('utf8');
    assert(Buffer.from(sql).subarray(offset).equals(body));
    parts.push(Object.freeze({path,offset,bytes:body.length,sha256:sha(body)}));
    sql+='\nRESET ROLE;\n-- END REVIEWED '+path+'\n';
  }
  const bytes=Buffer.from(sql),version='20261201180000',file=version+'_finance_invoice_issue.sql';
  const entry={version,file,sha256:sha(bytes)};
  registry.migrations.push(entry);
  const registryBytes=Buffer.from(JSON.stringify(registry,null,2)+'\n');
  const coverage=JSON.parse(await readFile(join(sandbox.root,'tests/support/registered76-export-coverage.json')));
  assert.equal(coverage.migrationCount,76);
  assert(coverage.tables.every(table=>!invoiceSourceCoverage.some(source=>source.table===table.table)));
  coverage.migrationCount=77;
  coverage.tables.push(...invoiceSourceCoverage);
  await writeFile(join(directory,'supabase/migrations',file),bytes,{flag:'wx'});
  await writeFile(join(directory,'supabase/migration-checksums.json'),registryBytes);
  return Object.freeze({directory,file,sha256:entry.sha256,bytes:bytes.length,registrySha256:sha(registryBytes),
    previousRegistrySha256:sha(frozen),parts:Object.freeze(parts),coverage});
}
