import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { financeInvoiceCredit84Candidate } from './finance-invoice-credit84-candidate.mjs';
import { pairedInvoiceCreditSourceCoverage } from '../../src/bookkeeping/paired-invoice-credit-source.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
export const pairedInvoiceCredit85Parts = Object.freeze([
  'finance-invoice-credit-paired', 'finance-invoice-credit-paired-operations', 'finance-invoice-credit-paired-source',
]);
export const pairedInvoiceCredit85Version = '20261209180000';
export const pairedInvoiceCredit85File = pairedInvoiceCredit85Version + '_finance_paired_invoice_credit.sql';
export const pairedInvoiceCredit85PriorRegistrySha256 = '8de9b617e1e1c58501b74bfd80a5e839e62cf2adcb26c8fd97118766a3d43923';

export async function financePairedInvoiceCredit85Candidate(sandbox,previous) {
  previous ??= await financeInvoiceCredit84Candidate(sandbox);
  assert.equal(previous.registrySha256,pairedInvoiceCredit85PriorRegistrySha256);
  const { directory, coverage: baseline } = previous;
  const registry = JSON.parse(await readFile(join(directory, 'supabase/migration-checksums.json')));
  assert.equal(registry.migrations.length,84);
  let sql = '-- Held E08 paired invoice credit and private source. The migration coordinator owns the transaction.\n';
  const parts = [];
  for (const name of pairedInvoiceCredit85Parts) {
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
  registry.migrations.push({ version: pairedInvoiceCredit85Version, file: pairedInvoiceCredit85File, sha256 });
  const registryBytes = Buffer.from(JSON.stringify(registry, null, 2) + '\n');
  const coverage = { ...baseline, migrationCount: 85, tables: [...baseline.tables,pairedInvoiceCreditSourceCoverage] };
  assert.equal(new Set(coverage.tables.map(entry => entry.table)).size, coverage.tables.length);
  await writeFile(join(directory, 'supabase/migrations', pairedInvoiceCredit85File), bytes, { flag: 'wx' });
  await writeFile(join(directory, 'supabase/migration-checksums.json'), registryBytes);
  return { directory, file: pairedInvoiceCredit85File, sha256, bytes: bytes.length, parts, registrySha256: hash(registryBytes),
    previousRegistrySha256: pairedInvoiceCredit85PriorRegistrySha256, previous, coverage };
}
