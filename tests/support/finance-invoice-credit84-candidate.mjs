import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { financeHeldTip83Candidate } from './finance-held-tip83-candidate.mjs';
import { invoiceCreditSourceAddedColumns, invoiceCreditSourceCoverage } from '../../src/bookkeeping/invoice-credit-source.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
export const invoiceCredit84Parts = Object.freeze([
  'finance-invoice-credit', 'finance-invoice-credit-operations', 'finance-invoice-credit-source',
]);
export const invoiceCredit84Version = '20261208180000';
export const invoiceCredit84File = invoiceCredit84Version + '_finance_invoice_credit.sql';
export const invoiceCredit84PriorRegistrySha256 = 'c8c1964e3a5453c50468f4bcbcf9b20474b43a77edec8851b5cef4b266327c5c';

export async function financeInvoiceCredit84Candidate(sandbox) {
  const previous = await financeHeldTip83Candidate(sandbox);
  assert.equal(previous.registrySha256,invoiceCredit84PriorRegistrySha256);
  const { directory, coverage: baseline } = previous;
  const registry = JSON.parse(await readFile(join(directory, 'supabase/migration-checksums.json')));
  assert.equal(registry.migrations.length,83);
  let sql = '-- Held P07 invoice credit and private source. The migration coordinator owns the transaction.\n';
  const parts = [];
  for (const name of invoiceCredit84Parts) {
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
  registry.migrations.push({ version: invoiceCredit84Version, file: invoiceCredit84File, sha256 });
  const registryBytes = Buffer.from(JSON.stringify(registry, null, 2) + '\n');
  const shared = new Set(Object.keys(invoiceCreditSourceAddedColumns));
  const coverage = { ...baseline, migrationCount: 84, tables: [...baseline.tables.map(entry => {
    const added = invoiceCreditSourceAddedColumns[entry.table];
    if (!added) return entry;
    assert(shared.delete(entry.table));
    assert(added.every(column => !entry.required.includes(column)));
    return { ...entry, required: [...entry.required, ...added] };
  }), ...invoiceCreditSourceCoverage] };
  assert.equal(shared.size, 0);
  assert.equal(new Set(coverage.tables.map(entry => entry.table)).size, coverage.tables.length);
  await writeFile(join(directory, 'supabase/migrations', invoiceCredit84File), bytes, { flag: 'wx' });
  await writeFile(join(directory, 'supabase/migration-checksums.json'), registryBytes);
  return { directory, file: invoiceCredit84File, sha256, bytes: bytes.length, parts, registrySha256: hash(registryBytes),
    previousRegistrySha256: invoiceCredit84PriorRegistrySha256, previous, coverage };
}
