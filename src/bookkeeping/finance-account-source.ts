import { createHash } from 'node:crypto';
import {
  customerDate, customerInstant, customerUuid, customerVersion, exactCustomerObject,
} from '../customer/customer-contract.ts';
import {parseFinanceTaxApproval} from './finance-tax-contract.ts';

export const financeAccountSourceColumns = {
  accounts: ['id','business_id','code','account_type','normal_side','control_kind','report_role','currency',
    'first_version','created_at','created_by','operation_id','origin'],
  account_versions: ['id','business_id','account_id','version','previous_version','name','active','reason',
    'audit_event_id','created_at','created_by','operation_id','origin'],
  account_mapping_versions: ['id','business_id','purpose','version','previous_version','account_id','effective_from','reason',
    'audit_event_id','created_at','created_by','operation_id','origin'],
} as const;

export const financeTaxSourceColumns=['id','business_id','jurisdiction','applicability','service_id','scope_key',
  'version','previous_version','effective_from','treatment','rate','verification_evidence','reason','synthetic',
  'audit_event_id','created_at','created_by','operation_id','origin'] as const;
const sourceColumns={...financeAccountSourceColumns,tax_profiles:financeTaxSourceColumns} as const;

type Entity = keyof typeof sourceColumns;
type AccountEntity = keyof Pick<typeof financeAccountSourceColumns, 'accounts'|'account_versions'>;
type Row = Readonly<Record<string, string | boolean | null>>;
type Tables = Readonly<Record<AccountEntity, readonly Row[]>>;
const nullable = new Set(['control_kind','previous_version','reason']);
const nullableTax = new Set(['service_id','rate','verification_evidence']);
const decimal = new Set(['first_version','version','previous_version']);
const accountTypes = ['asset','liability','equity','revenue','contra_revenue','expense'];
const role = /^[a-z][a-z0-9_]{0,63}$/;
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const trimSpaces = (value: string) => value.replace(/^ +| +$/g, '');

function printable(value: string) {
  return [...value].every(character => {
    const point = character.codePointAt(0)!;
    return point >= 32 && (point < 127 || point > 159);
  });
}

function requireSource(value: unknown): asserts value {
  if (!value) throw new Error('FINANCE_ACCOUNT_SOURCE_REVIEW_REQUIRED');
}

function sourceRows(entity: Entity, value: unknown, businessId: string): Row[] {
  const fields = sourceColumns[entity];
  requireSource(Array.isArray(value) && value.length <= 10_000);
  const rows = value.map(input => {
    requireSource(exactCustomerObject(input, fields) && input.business_id === businessId);
    for (const field of fields) {
      const item = input[field];
      if (item === null && (nullable.has(field) || entity === 'account_mapping_versions' && field === 'account_id'
        || entity === 'tax_profiles' && nullableTax.has(field))) continue;
      if (field === 'active' || field === 'synthetic') { requireSource(typeof item === 'boolean'); continue; }
      requireSource(typeof item === 'string' && Buffer.from(item).toString('utf8') === item && !item.includes('\0'));
      if (field === 'id' || field.endsWith('_id') || field === 'created_by') requireSource(customerUuid(item));
      else if (field === 'created_at') requireSource(customerInstant(item));
      else if (field === 'effective_from') requireSource(customerDate(item));
      else if (decimal.has(field)) requireSource(customerVersion(item));
    }
    requireSource(input.origin === 'manual');
    return input as Row;
  });
  requireSource(new Set(rows.map(row => row.id)).size === rows.length);
  return rows.sort((a,b) => String(a.id).localeCompare(String(b.id)));
}

function checkAccountHistory({ accounts, account_versions: versions }: Tables) {
  const accountIds = new Set(accounts.map(row => row.id));
  const codes = new Set(accounts.map(row => row.code));
  requireSource(codes.size === accounts.length);
  for (const account of accounts) {
    const { code, account_type: type, normal_side: side, control_kind: control, report_role: report } = account;
    requireSource(typeof code === 'string' && code === trimSpaces(code) && [...code].length >= 1 && [...code].length <= 64
      && printable(code) && accountTypes.includes(String(type))
      && (control === null || role.test(String(control))) && role.test(String(report))
      && account.currency === 'USD' && account.first_version === '1');
    const expectedSide = report === 'contra_asset' ? 'credit' : report === 'contra_equity' ? 'debit'
      : type === 'asset' || type === 'contra_revenue' || type === 'expense' ? 'debit' : 'credit';
    requireSource(side === expectedSide && (report !== 'contra_asset' || type === 'asset')
      && (report !== 'contra_equity' || type === 'equity')
      && (report === 'owner_custody') === (control === 'owner_custody')
      && (report !== 'owner_custody' || type === 'asset'));
  }
  const byAccount = new Map<string, Map<bigint, Row>>();
  const audits = new Set();
  for (const row of versions) {
    const accountId = row.account_id;
    requireSource(typeof accountId === 'string' && accountIds.has(accountId) && !audits.has(row.audit_event_id));
    audits.add(row.audit_event_id);
    const name = row.name;
    requireSource(typeof name === 'string' && name === trimSpaces(name) && [...name].length >= 1 && [...name].length <= 200
      && printable(name));
    let chain = byAccount.get(accountId);
    if (!chain) { chain = new Map(); byAccount.set(accountId, chain); }
    const version = BigInt(String(row.version));
    requireSource(!chain.has(version) && row.previous_version === (version === 1n ? null : String(version - 1n))
      && (row.reason === null ? version === 1n : typeof row.reason === 'string'
        && [...trimSpaces(row.reason)].length >= 1 && [...trimSpaces(row.reason)].length <= 1000));
    chain.set(version, row);
  }
  for (const account of accounts) {
    const chain = byAccount.get(String(account.id));
    const first = chain?.get(1n);
    requireSource(chain && first && first.operation_id === account.operation_id && first.created_by === account.created_by);
    for (const version of chain.keys()) requireSource(version === 1n || chain.has(version - 1n));
  }
}

function checkMappingHistory(accounts: readonly Row[], mappings: readonly Row[]) {
  const accountIds = new Set(accounts.map(row => row.id));
  const latest = new Map<string, Row>();
  const audits = new Set();
  const operations = new Set();
  const ordered = [...mappings].sort((left, right) => String(left.effective_from).localeCompare(String(right.effective_from)));
  for (const row of ordered) {
    const purpose = String(row.purpose);
    const previous = latest.get(purpose);
    const reason = row.reason;
    requireSource(role.test(purpose) && (row.account_id === null
      ? previous !== undefined && previous.account_id !== null : accountIds.has(row.account_id))
      && typeof reason === 'string' && reason === trimSpaces(reason) && [...reason].length >= 1 && [...reason].length <= 1000
      && printable(reason) && !audits.has(row.audit_event_id) && !operations.has(row.operation_id)
      && row.previous_version === (previous?.version ?? null)
      && row.version === String(BigInt(String(previous?.version ?? '0')) + 1n)
      && (previous === undefined || String(row.effective_from) > String(previous.effective_from)));
    audits.add(row.audit_event_id);
    operations.add(row.operation_id);
    latest.set(purpose, row);
  }
}

function checkTaxHistory(profiles: readonly Row[]) {
  const latest = new Map<string, Row>();
  const audits = new Set();
  const operations = new Set();
  const ordered = [...profiles].sort((left, right) => String(left.effective_from).localeCompare(String(right.effective_from)));
  for (const row of ordered) {
    const approval=parseFinanceTaxApproval({jurisdiction:row.jurisdiction,applicability:row.applicability,serviceId:row.service_id,
      effectiveFrom:row.effective_from,treatment:row.treatment,rate:row.rate,verificationEvidence:row.verification_evidence,reason:row.reason});
    const scopeKey=approval.applicability==='tip'?'tip':'service:'+approval.serviceId;
    const key=JSON.stringify([approval.jurisdiction,scopeKey]);
    const previous=latest.get(key);
    requireSource(row.scope_key===scopeKey&&row.synthetic===true&&!audits.has(row.audit_event_id)&&!operations.has(row.operation_id)
      &&row.previous_version===(previous?.version??null)&&row.version===String(BigInt(String(previous?.version??'0'))+1n)
      &&(previous===undefined||String(row.effective_from)>String(previous.effective_from)));
    audits.add(row.audit_event_id);
    operations.add(row.operation_id);
    latest.set(key,row);
  }
}

/** Format one authorized snapshot. This does not grant capture or distribution access. */
export function formatFinanceAccountSource(input: {
  businessId: string; snapshotToken: string; rows: Readonly<Record<AccountEntity, unknown>>;
  expectedCounts: Readonly<Record<AccountEntity, number>>;
  mappingSnapshot?: Readonly<{ rows: unknown; expectedCount: number }>;
  taxSnapshot?: Readonly<{ rows: unknown; expectedCount: number }>;
}) {
  const { businessId, snapshotToken } = input;
  requireSource(customerUuid(businessId) && /^[a-f0-9]{64}$/.test(snapshotToken));
  const accounts = sourceRows('accounts', input.rows.accounts, businessId);
  const versions = sourceRows('account_versions', input.rows.account_versions, businessId);
  const mappings = input.mappingSnapshot ? sourceRows('account_mapping_versions', input.mappingSnapshot.rows, businessId) : [];
  const taxProfiles = input.taxSnapshot ? sourceRows('tax_profiles', input.taxSnapshot.rows, businessId) : [];
  const rows = { accounts, account_versions: versions, account_mapping_versions: mappings, tax_profiles: taxProfiles };
  checkAccountHistory(rows);
  checkMappingHistory(accounts, mappings);
  checkTaxHistory(taxProfiles);
  const entities: Entity[] = ['accounts','account_versions'];
  const expectedCounts: Partial<Record<Entity, number>> = {...input.expectedCounts};
  if(input.mappingSnapshot){
    entities.push('account_mapping_versions');
    expectedCounts.account_mapping_versions = input.mappingSnapshot.expectedCount;
  }
  if(input.taxSnapshot){
    entities.push('tax_profiles');
    expectedCounts.tax_profiles = input.taxSnapshot.expectedCount;
  }
  const files = entities.flatMap(entity => {
    const fields = sourceColumns[entity];
    requireSource(rows[entity].length === expectedCounts[entity]);
    const escapes: {row_id:string;column:string;apostrophe_prefix:true}[] = [];
    const lines = [fields.map(quote).join(',')];
    let bytes = Buffer.byteLength(lines[0]!) + 2;
    for (const row of rows[entity]) {
      const line = fields.map(column => {
        const cell = row[column];
        if (cell === null) return quote('\\N');
        const escaped = String(cell).replaceAll('\\', '\\\\');
        if (typeof cell === 'string' && (escaped.startsWith("'") || /^[=+\-@]/.test(escaped.trimStart()))) {
          escapes.push({row_id:String(row.id),column,apostrophe_prefix:true});
          return quote("'" + escaped);
        }
        return quote(escaped);
      }).join(',');
      bytes += Buffer.byteLength(line) + 2;
      requireSource(bytes <= 8 * 1024 * 1024);
      lines.push(line);
    }
    return [
      { name:entity+'.csv', content:lines.join('\r\n')+'\r\n' },
      { name:entity+'_escape_map.json', content:JSON.stringify({schemaVersion:1,entity,businessId,snapshotToken,escapes})+'\n' },
      { name:entity+'_dictionary.json', content:JSON.stringify({schemaVersion:1,entity,columns:fields,
        format:'UTF-8 RFC4180 CRLF',key:'id',null:'\\N',booleans:entity==='account_versions'?['active']:entity==='tax_profiles'?['synthetic']:[],
        exactText:fields.filter(column=>decimal.has(column)||column==='created_at'||column==='effective_from'||column==='rate'),
        decode:'Remove only mapped apostrophes, then decode paired backslashes. Treat unescaped \\N as null.'})+'\n' },
    ];
  });
  const manifest = JSON.stringify({schemaVersion:input.taxSnapshot?3:input.mappingSnapshot?2:1,scope:'finance_account_sources',businessId,snapshotToken,
    recordCounts:expectedCounts,referenceClosureComplete:false,completePortableExport:false,completeBackup:false,
    parts:files.map(({name,content})=>({name,bytes:Buffer.byteLength(content),
      sha256:createHash('sha256').update(content).digest('hex')}))})+'\n';
  return { files, manifest };
}
