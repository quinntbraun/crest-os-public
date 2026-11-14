import { createHash } from 'node:crypto';
import { customerDate, customerInstant, customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { readSourceExportCsv } from '../security/source-export-csv-reader.ts';

const columns = {
  accounting_periods:'id business_id starts_on month_start through_on time_zone opening_boundary created_by operation_id created_at',
  accounting_period_locks:'id business_id period_id generation previous_generation state evidence_ref created_by operation_id created_at',
  invoice_series:'id business_id label recovery_epoch kind incident_id approval_reason created_by operation_id created_at',
  invoice_number_reservations:'id business_id full_number series_id number_sequence issued_source_id incident_id external_evidence recovery_epoch created_by operation_id created_at',
  tax_payable_mapping_versions:'id business_id jurisdiction version previous_version account_id effective_from reason audit_event_id created_at created_by operation_id',
  invoice_exemption_evidence:'id business_id draft_id draft_revision outcome_id customer_id jurisdiction profile_id version previous_version valid_from valid_through evidence_reference reason audit_event_id created_at created_by operation_id',
  invoices:'id business_id draft_id draft_revision job_id customer_id reservation_id invoice_number issued_on due_on time_zone customer_snapshot location_snapshot total_cents currency created_at created_by operation_id',
  invoice_items:'id business_id invoice_id position outcome_id completion_part_id partition_id agreement_id entitlement_version_id service_version_id tax_profile_id exemption_evidence_id gross_inclusive_cents discount_inclusive_cents gross_net_cents discount_net_cents net_cents tax_cents total_cents description created_at created_by operation_id',
  billing_consumptions:'id business_id invoice_item_id partition_id consumed_cents created_at created_by operation_id',
  atomic_finance_groups:'id business_id commit_sequence recovery_epoch created_by operation_id created_at',
  financial_events:'id business_id group_id event_sequence invoice_id period_id period_generation reopened_generation effective_on time_zone template template_version zero_effect_reason posted_at',
  receivable_items:'id business_id invoice_id account_id customer_id original_cents due_on',
  invoice_tax_payable_movements:'id business_id event_id invoice_item_id tax_profile_id mapping_id account_id jurisdiction cents',
  journal_entries:'id business_id event_id entry_sequence',
  journal_lines:'id business_id entry_id invoice_item_id receivable_id account_id fixed_mapping_id tax_payable_movement_id purpose debit_cents credit_cents',
} as const;
type Group=keyof typeof columns;
type Row=Readonly<Record<string,string|boolean|null>>;
export const invoiceSourceGroups=Object.freeze(Object.keys(columns) as Group[]);
export const invoiceSourceCoverage=Object.freeze(invoiceSourceGroups.map(group=>Object.freeze({
  table:'crest.'+group,scope:'business' as const,required:Object.freeze(columns[group].split(' ')),
  excluded:Object.freeze([]),partialEvidenceGroup:null,
})));
const groups=invoiceSourceGroups;
const nullable:Partial<Record<Group,readonly string[]>>={
  accounting_period_locks:['previous_generation'],invoice_series:['incident_id'],
  invoice_number_reservations:['series_id','number_sequence','issued_source_id','incident_id','external_evidence'],
  tax_payable_mapping_versions:['previous_version','account_id'],invoice_exemption_evidence:['previous_version'],
  invoice_items:['exemption_evidence_id'],financial_events:['reopened_generation','zero_effect_reason'],
  journal_lines:['receivable_id','fixed_mapping_id','tax_payable_movement_id'],
};
const dateColumns=new Set(['starts_on','month_start','through_on','effective_from','valid_from','valid_through','issued_on','due_on','effective_on']);
const jsonColumns=new Set(['customer_snapshot','location_snapshot']);
const intColumns=new Set(['generation','previous_generation','number_sequence','version','previous_version','draft_revision','position',
  'commit_sequence','event_sequence','period_generation','reopened_generation','template_version','entry_sequence','cents']);
const cap=10_000, maxBytes=16*1024*1024;
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
const hash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
const count=(value:unknown):value is string=>typeof value==='string'&&/^(0|[1-9][0-9]{0,4})$/.test(value)&&Number(value)<=cap;

function check(value:unknown):asserts value {
  if(!value)throw Error('INVOICE_SOURCE_REVIEW_REQUIRED');
}

function verifyRow(value:unknown,group:Group,businessId:string,fields:readonly string[]):Row {
  check(exact(value,fields)&&value.business_id===businessId);
  for(const field of fields){
    const cell=value[field];
    if(cell===null&&nullable[group]?.includes(field))continue;
    if(field==='opening_boundary'){check(typeof cell==='boolean');continue;}
    check(typeof cell==='string'&&!cell.includes('\0')&&Buffer.from(cell).toString('utf8')===cell);
    if(field==='id'||field.endsWith('_id')||field==='created_by'||field==='recovery_epoch')check(customerUuid(cell));
    if(field==='created_at'||field==='posted_at')check(customerInstant(cell));
    if(dateColumns.has(field))check(customerDate(cell));
    if(field.endsWith('_cents')||intColumns.has(field))check(/^(0|[1-9][0-9]{0,18})$/.test(cell)&&BigInt(cell)<=9223372036854775807n);
    if(jsonColumns.has(field)){
      const parsed:unknown=JSON.parse(cell);
      check(parsed&&typeof parsed==='object'&&!Array.isArray(parsed));
    }
  }
  return value as Row;
}

type Query=(text:string,params:unknown[])=>Promise<unknown>;

/** The caller supplies one already authorized, read-only repeatable-read export transaction. */
export async function captureInvoiceSource(businessId:string,query:Query) {
  check(customerUuid(businessId));
  const context=await query('SELECT crest_commands.invoice_source_snapshot_context($1::uuid) AS result',[businessId]);
  check(exact(context,['schemaVersion','scope','businessId','snapshotToken','historySnapshotToken','counts'])
    && context.schemaVersion===1&&context.scope==='invoice_posting_sources'&&context.businessId===businessId
    && typeof context.snapshotToken==='string'&&/^[a-f0-9]{64}$/.test(context.snapshotToken)
    && typeof context.historySnapshotToken==='string'&&/^[a-f0-9]{64}$/.test(context.historySnapshotToken)
    && exact(context.counts,groups));
  const rows={} as Record<Group,Row[]>;
  let bytes=0,totalRows=0;
  for(const group of groups){
    const expected=context.counts[group], fields=columns[group].split(' ');
    check(count(expected));
    totalRows+=Number(expected);
    check(totalRows<=cap);
    const records:Row[]=[];
    let after:string|null=null, hasMore=true;
    while(hasMore){
      const page=await query('SELECT crest_commands.invoice_source_snapshot_page($1::uuid,$2::text,$3::text,$4::uuid,$5::integer) AS result',
        [businessId,context.snapshotToken,group,after,20]);
      check(exact(page,['schemaVersion','businessId','snapshotToken','group','rows','hasMore'])
        && page.schemaVersion===1&&page.businessId===businessId&&page.snapshotToken===context.snapshotToken&&page.group===group
        && typeof page.hasMore==='boolean'&&Array.isArray(page.rows)&&page.rows.length<=20&&(!page.hasMore||page.rows.length>0));
      bytes+=Buffer.byteLength(JSON.stringify(page));
      check(bytes<=maxBytes);
      for(const value of page.rows){
        const row=verifyRow(value,group,businessId,fields),id=row.id;
        check(typeof id==='string'&&(after===null||id>after));
        records.push(row);
        after=id;
      }
      check(records.length<=Number(expected));
      hasMore=page.hasMore;
    }
    check(records.length===Number(expected));
    rows[group]=records;
  }
  return {businessId,snapshotToken:context.snapshotToken,historySnapshotToken:context.historySnapshotToken,counts:context.counts,rows};
}

/** Formats the private invoice portion of an authorized same-snapshot source capture. */
export function formatInvoiceSource(input:unknown) {
  check(exact(input,['businessId','snapshotToken','historySnapshotToken','counts','rows'])&&customerUuid(input.businessId)
    && typeof input.snapshotToken==='string'&&/^[a-f0-9]{64}$/.test(input.snapshotToken)
    && typeof input.historySnapshotToken==='string'&&/^[a-f0-9]{64}$/.test(input.historySnapshotToken)
    && exact(input.counts,groups)&&exact(input.rows,groups));
  const {businessId,snapshotToken,historySnapshotToken,counts,rows}=input;
  const files:{name:string;content:string}[]=[];
  let bytes=0,totalRows=0;
  const add=(name:string,content:string)=>{
    bytes+=Buffer.byteLength(content);check(bytes<=maxBytes);
    files.push({name,content});
  };
  for(const group of groups){
    const fields=columns[group].split(' '),source=rows[group],expected=counts[group];
    check(count(expected)&&Array.isArray(source)&&source.length===Number(expected));
    totalRows+=source.length;
    check(totalRows<=cap);
    const records=source.map(row=>verifyRow(row,group,businessId,fields))
      .sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    check(new Set(records.map(row=>row.id)).size===records.length);
    const escapes:{row_id:string;column:string;apostrophe_prefix:true}[]=[];
    const csv=[fields.map(quote).join(',')];
    let csvBytes=Buffer.byteLength(csv[0]!)+2;
    for(const row of records){
      const line=fields.map(column=>{
        const cell=row[column];
        if(cell===null)return quote('\\N');
        let text=String(cell).replaceAll('\\','\\\\');
        if(typeof cell==='string'&&(text.startsWith("'")||/^[=+\-@]/.test(text.trimStart()))){
          text="'"+text;
          escapes.push({row_id:String(row.id),column,apostrophe_prefix:true});
        }
        return quote(text);
      }).join(',');
      csvBytes+=Buffer.byteLength(line)+2;
      check(bytes+csvBytes<=maxBytes);
      csv.push(line);
    }
    const content=csv.join('\r\n')+'\r\n';
    const booleans=fields.filter(field=>field==='opening_boundary');
    const decoded=readSourceExportCsv(content,escapes,{columns:fields,booleans,maxRows:cap});
    check(decoded.length===records.length&&decoded.every((row,index)=>fields.every(field=>row[field]===records[index]?.[field])));
    add(group+'.csv',content);
    add(group+'_escape_map.json',JSON.stringify({schemaVersion:1,entity:group,businessId,snapshotToken,escapes})+'\n');
    add(group+'_dictionary.json',JSON.stringify({schemaVersion:1,entity:group,columns:fields,key:'id',null:'\\N',
      jsonTextColumns:fields.filter(field=>jsonColumns.has(field)),
      booleanColumns:booleans,
      format:'UTF-8 RFC4180 CRLF',
      decode:'Import as text. Treat unescaped \\N as SQL null. Remove only the mapped apostrophe, then unescape paired backslashes. Retain exact JSON text.'})+'\n');
  }
  const manifest=JSON.stringify({schemaVersion:1,scope:'issued_invoice_sources',businessId,snapshotToken,historySnapshotToken,recordCounts:counts,
    referenceClosureComplete:false,completePortableExport:false,completeBackup:false,
    parts:files.map(({name,content})=>({name,bytes:Buffer.byteLength(content),sha256:hash(content)}))})+'\n';
  return {files,manifest};
}
