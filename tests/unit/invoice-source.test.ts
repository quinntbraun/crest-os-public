import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { captureInvoiceSource, formatInvoiceSource, invoiceSourceGroups } from '../../src/bookkeeping/invoice-source';
import { readSourceExportCsv } from '../../src/security/source-export-csv-reader';

const businessId='00000000-0000-4000-8000-000000000001';
const rowId='00000000-0000-4000-8000-000000000002';
const snapshotToken='a'.repeat(64);
const historySnapshotToken='b'.repeat(64);
const row={
  id:rowId,business_id:businessId,full_number:' =HYPERLINK("fictional")',series_id:rowId,
  number_sequence:'9223372036854775807',issued_source_id:null,incident_id:null,external_evidence:'\\N',
  recovery_epoch:rowId,created_by:rowId,operation_id:rowId,created_at:'2026-11-13T06:12:30.000123Z',
};
const group='invoice_number_reservations';

function snapshot(){
  return {
    businessId,snapshotToken,historySnapshotToken,
    counts:Object.fromEntries(invoiceSourceGroups.map(name=>[name,name===group?'1':'0'])),
    rows:Object.fromEntries(invoiceSourceGroups.map(name=>[name,name===group?[row]:[]])),
  };
}

describe('private invoice source',()=>{
  it('decodes exact cents and precision without treating formula text or literal null as data types',()=>{
    const result=formatInvoiceSource(snapshot());
    const file=(name:string)=>result.files.find(item=>item.name===name)?.content;
    const csv=file(group+'.csv')!;
    const dictionary=JSON.parse(file(group+'_dictionary.json')!);
    const {escapes}=JSON.parse(file(group+'_escape_map.json')!);
    expect(escapes).toEqual([{row_id:rowId,column:'full_number',apostrophe_prefix:true}]);
    expect(readSourceExportCsv(csv,escapes,{columns:dictionary.columns,maxRows:1})).toEqual([row]);
    const manifest=JSON.parse(result.manifest);
    expect(manifest.historySnapshotToken).toBe(historySnapshotToken);
    expect(manifest.completeBackup).toBe(false);
    expect(manifest.parts).toContainEqual({
      name:group+'.csv',bytes:Buffer.byteLength(csv),sha256:createHash('sha256').update(csv).digest('hex'),
    });
  });

  it('retains PostgreSQL JSON text without rounding large numbers',()=>{
    const value=snapshot();
    const json='{"serial": 9007199254740993, "location": "Fictional"}';
    const invoice={
      id:rowId,business_id:businessId,draft_id:rowId,draft_revision:'1',job_id:rowId,customer_id:rowId,
      reservation_id:rowId,invoice_number:'TEST-1',issued_on:'2026-11-13',due_on:'2026-11-14',
      time_zone:'America/Indianapolis',customer_snapshot:json,location_snapshot:'{}',total_cents:'25000',
      currency:'USD',created_at:row.created_at,created_by:rowId,operation_id:rowId,
    };
    const result=formatInvoiceSource({
      ...value,counts:{...value.counts,invoices:'1'},rows:{...value.rows,invoices:[invoice]},
    });
    const file=(name:string)=>result.files.find(item=>item.name===name)?.content;
    const dictionary=JSON.parse(file('invoices_dictionary.json')!);
    expect(readSourceExportCsv(file('invoices.csv'),[],{columns:dictionary.columns,maxRows:1})).toEqual([invoice]);
  });

  it('binds the closed collection to one tenant, snapshot and ordered cursor',async()=>{
    const expected=snapshot();
    const {counts}=expected;
    const fetch=(sql:string,params:unknown[])=>{
      if(sql.includes('snapshot_context'))return {schemaVersion:1,scope:'invoice_posting_sources',
        businessId,snapshotToken,historySnapshotToken,counts};
      const [business,token,name,cursor,limit]=params;
      expect([business,token,cursor,limit]).toEqual([businessId,snapshotToken,null,20]);
      return {schemaVersion:1,businessId,snapshotToken,group:name,rows:name===group?[row]:[],hasMore:false};
    };
    await expect(captureInvoiceSource(businessId,async(sql,args)=>fetch(sql,args))).resolves.toEqual(expected);
    await expect(captureInvoiceSource(businessId,async(sql,args)=>{
      const response=fetch(sql,args);
      return sql.includes('snapshot_page')?{...response,snapshotToken:'c'.repeat(64)}:response;
    })).rejects.toThrow('INVOICE_SOURCE_REVIEW_REQUIRED');
    await expect(captureInvoiceSource(businessId,async(sql,args)=>{
      const response=fetch(sql,args);
      return sql.includes('snapshot_page')?{...response,rows:[]}:response;
    })).rejects.toThrow('INVOICE_SOURCE_REVIEW_REQUIRED');
    expect(()=>formatInvoiceSource({...expected,rows:{
      ...expected.rows,[group]:[{...row,business_id:rowId}],
    }})).toThrow('INVOICE_SOURCE_REVIEW_REQUIRED');
  });
});
