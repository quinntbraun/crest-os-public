// Test reconstruction on empty PostgreSQL. The source application schema and
// its accounting commands are deliberately unavailable on this connection.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readSourceExportCsv } from '../../src/security/source-export-csv-reader.ts';

const names=[
  'accounting_periods','accounting_period_locks','invoice_series','invoice_number_reservations','tax_payable_mapping_versions',
  'invoice_exemption_evidence','invoices','invoice_items','billing_consumptions','atomic_finance_groups','financial_events',
  'receivable_items','invoice_tax_payable_movements','journal_entries','journal_lines','external_money_evidence','payments',
  'money_movements','funding_origins','funding_partitions','allocation_events','posted_expenses','allocation_unapplications',
  'customer_fund_lots','customer_fund_applications','tip_realizations','fund_lot_range_consumptions',
];
const links={
  accounting_period_locks:{period_id:'accounting_periods'},
  invoice_number_reservations:{series_id:'invoice_series',issued_source_id:'invoices'},
  invoices:{reservation_id:'invoice_number_reservations'},
  invoice_items:{invoice_id:'invoices',exemption_evidence_id:'invoice_exemption_evidence'},
  billing_consumptions:{invoice_item_id:'invoice_items'},
  financial_events:{group_id:'atomic_finance_groups',invoice_id:'invoices',period_id:'accounting_periods',payment_id:'payments',
    posted_expense_id:'posted_expenses',unapplication_id:'allocation_unapplications',fund_application_id:'customer_fund_applications',
    tip_realization_id:'tip_realizations'},
  receivable_items:{invoice_id:'invoices'},
  invoice_tax_payable_movements:{event_id:'financial_events',invoice_item_id:'invoice_items',mapping_id:'tax_payable_mapping_versions'},
  journal_entries:{event_id:'financial_events'},
  journal_lines:{entry_id:'journal_entries',invoice_item_id:'invoice_items',receivable_id:'receivable_items',
    tax_payable_movement_id:'invoice_tax_payable_movements',money_movement_id:'money_movements',allocation_event_id:'allocation_events',
    unapplication_id:'allocation_unapplications',fund_lot_id:'customer_fund_lots',fund_application_id:'customer_fund_applications',
    tip_realization_id:'tip_realizations'},
  money_movements:{event_id:'financial_events',evidence_id:'external_money_evidence'},
  funding_origins:{payment_id:'payments'},
  funding_partitions:{origin_id:'funding_origins'},
  allocation_events:{event_id:'financial_events',partition_id:'funding_partitions',receivable_id:'receivable_items'},
  posted_expenses:{evidence_id:'external_money_evidence'},
  allocation_unapplications:{allocation_id:'allocation_events'},
  customer_fund_lots:{unapplication_id:'allocation_unapplications',origin_id:'funding_origins',parent_partition_id:'funding_partitions'},
  customer_fund_applications:{fund_lot_id:'customer_fund_lots',receivable_id:'receivable_items'},
  tip_realizations:{fund_lot_id:'customer_fund_lots',tax_mapping_id:'tax_payable_mapping_versions'},
  fund_lot_range_consumptions:{fund_lot_id:'customer_fund_lots',fund_application_id:'customer_fund_applications',tip_realization_id:'tip_realizations'},
};
const creditLinks={
  financial_events:{invoice_credit_id:'invoice_credits'},
  journal_lines:{invoice_credit_id:'invoice_credits'},
  invoice_credits:{invoice_item_id:'invoice_items',receivable_id:'receivable_items',original_tax_movement_id:'invoice_tax_payable_movements'},
};
const integers=new Set(['version','previous_version','generation','previous_generation','draft_revision','receipt_revision',
  'number_sequence','position','commit_sequence','event_sequence','period_generation','reopened_generation','template_version','entry_sequence',
  'first_cent','last_cent','cents']);
const q=identifier=>{
  assert.match(identifier,/^[a-z][a-z0-9_]{0,62}$/);
  return '"'+identifier+'"';
};
const table=name=>'neutral_finance.'+q(name);
function columnType(column){
  if(column==='opening_boundary')return 'boolean';
  if(column==='id'||column.endsWith('_id')&&!['external_id','external_account_id'].includes(column)||column==='created_by'||column==='recovery_epoch')return 'uuid';
  if(column.endsWith('_cents')||integers.has(column))return 'bigint';
  if(column.endsWith('_on')||['month_start','valid_from','valid_through','effective_from'].includes(column))return 'date';
  return 'text';
}

export async function exerciseNeutralFinanceImport(connection,files,businessId,{includeCredits=false,includePairedCredits=false}={}){
  assert(!includePairedCredits||includeCredits);
  const parts=new Map(files.map(file=>[file.name,file.content]));
  const {tables}=JSON.parse(parts.get('dictionary.json'));
  assert.deepEqual(tables.map(row=>row.name),[...names,...includeCredits?['invoice_credits']:[],
    ...includePairedCredits?['paired_invoice_credit_releases']:[]]);
  assert.equal((await connection.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname IN('auth','crest','crest_private','crest_commands','neutral_finance')")).rows[0].n,0);
  const exports={};
  await connection.query('BEGIN');
  try{
    await connection.query("SET LOCAL search_path=pg_catalog; SET LOCAL datestyle='ISO, YMD'; CREATE SCHEMA neutral_finance");
    for(const {name,columns} of tables){
      const {escapes}=JSON.parse(parts.get(name+'_escape_map.json'));
      const records=readSourceExportCsv(parts.get(name+'.csv'),escapes,{
        columns,booleans:name==='accounting_periods'?['opening_boundary']:[],maxRows:10000,
      });
      assert(records.every(row=>row.business_id===businessId));
      exports[name]=records;
      await connection.query(`CREATE TABLE ${table(name)} (
        ${columns.map(column=>q(column)+' '+columnType(column)).join(',')},
        PRIMARY KEY(id), UNIQUE(business_id,id), CHECK(business_id IS NOT NULL))`);
      for(const row of records)await connection.query(`INSERT INTO ${table(name)} VALUES(${columns.map((_,index)=>'$'+(index+1)).join(',')})`,
        columns.map(column=>row[column]));
    }
    for(const [name,columns] of Object.entries(links)){
      for(const [column,target] of Object.entries(columns))await connection.query(
        `ALTER TABLE ${table(name)} ADD FOREIGN KEY(business_id,${q(column)}) REFERENCES ${table(target)}(business_id,id)`);
    }
    if(includeCredits){
      for(const [name,columns] of Object.entries(creditLinks)){
        for(const [column,target] of Object.entries(columns))await connection.query(
          `ALTER TABLE ${table(name)} ADD FOREIGN KEY(business_id,${q(column)}) REFERENCES ${table(target)}(business_id,id)`);
      }
      assert(exports.invoice_credits.length>0);
      const {rows}=await connection.query(`
        SELECT c.id,c.inclusive_cents::text AS cents,c.tax_cents::text AS tax,
          count(*) FILTER(WHERE l.purpose='credit_ar')::int AS ar_lines,
          sum(l.credit_cents) FILTER(WHERE l.purpose='credit_ar')::text AS credited,
          coalesce(sum(l.debit_cents) FILTER(WHERE l.purpose='credit_tax'),0)::text AS tax_reversed
        FROM neutral_finance.invoice_credits c
        JOIN neutral_finance.financial_events e ON (e.business_id,e.invoice_credit_id)=(c.business_id,c.id) AND e.template='P07'
        JOIN neutral_finance.journal_entries j ON (j.business_id,j.event_id)=(e.business_id,e.id)
        JOIN neutral_finance.journal_lines l ON (l.business_id,l.entry_id,l.invoice_credit_id)=(j.business_id,j.id,c.id)
        GROUP BY c.id`);
      assert.equal(rows.length,exports.invoice_credits.length);
      assert(rows.every(row=>row.ar_lines===1&&row.cents===row.credited&&row.tax===row.tax_reversed));
      await connection.query('SAVEPOINT neutral_wrong_credit_link');
      await assert.rejects(connection.query('UPDATE neutral_finance.invoice_credits SET invoice_item_id=$1',[randomUUID()]),{code:'23503'});
      await connection.query('ROLLBACK TO SAVEPOINT neutral_wrong_credit_link');
    }
    if(includePairedCredits){
      for(const [column,target] of [['invoice_credit_id','invoice_credits'],['unapplication_id','allocation_unapplications']]){
        await connection.query(`ALTER TABLE neutral_finance.paired_invoice_credit_releases
          ADD FOREIGN KEY(business_id,${q(column)}) REFERENCES ${table(target)}(business_id,id)`);
      }
      const {rows}=await connection.query(`
        SELECT l.id, l.reviewed_ar_cents::text AS reviewed_ar, c.inclusive_cents::text AS credit_cents,
          (u.last_cent-u.first_cent+1)::text AS release_cents, (credit.group_id=release.group_id) AS same_group,
          credit.event_sequence::int AS credit_sequence, release.event_sequence::int AS release_sequence
        FROM neutral_finance.paired_invoice_credit_releases l
        JOIN neutral_finance.invoice_credits c ON (c.business_id,c.id)=(l.business_id,l.invoice_credit_id)
        JOIN neutral_finance.allocation_unapplications u ON (u.business_id,u.id)=(l.business_id,l.unapplication_id)
        JOIN neutral_finance.financial_events credit ON (credit.business_id,credit.invoice_credit_id)=(l.business_id,c.id)
          AND credit.template='P07'
        JOIN neutral_finance.financial_events release ON (release.business_id,release.unapplication_id)=(l.business_id,u.id)
          AND release.template='P05'
        ORDER BY l.id`);
      assert(rows.length>0);
      assert.equal(rows.length,exports.paired_invoice_credit_releases.length);
      assert(rows.every(row=>row.same_group&&row.release_sequence===1&&row.credit_sequence===2
        &&BigInt(row.reviewed_ar)+BigInt(row.release_cents)===BigInt(row.credit_cents)));
      await connection.query('SAVEPOINT neutral_wrong_paired_link');
      await assert.rejects(connection.query('UPDATE neutral_finance.paired_invoice_credit_releases SET unapplication_id=$1',[randomUUID()]),{code:'23503'});
      await connection.query('ROLLBACK TO SAVEPOINT neutral_wrong_paired_link');
    }
    const balance=(await connection.query(`
      SELECT count(*)::int AS entries,coalesce(sum(debit),0)::text AS debit,coalesce(sum(credit),0)::text AS credit,
        coalesce(bool_and(debit=credit),true) AS balanced
      FROM (
        SELECT j.id,sum(l.debit_cents::numeric) AS debit,sum(l.credit_cents::numeric) AS credit
        FROM neutral_finance.journal_entries j JOIN neutral_finance.journal_lines l ON (l.business_id,l.entry_id)=(j.business_id,j.id)
        GROUP BY j.id
      ) grouped`)).rows[0];
    assert.equal(balance.balanced,true);
    assert.equal(balance.entries,exports.journal_entries.length);
    assert.equal((await connection.query(`
      SELECT count(*)::int AS broken FROM neutral_finance.fund_lot_range_consumptions a
      JOIN neutral_finance.fund_lot_range_consumptions b
        ON (a.business_id,a.fund_lot_id)=(b.business_id,b.fund_lot_id) AND a.id<b.id
      WHERE a.first_cent<=b.last_cent AND b.first_cent<=a.last_cent`)).rows[0].broken,0);
    assert.equal((await connection.query(`
      SELECT count(*)::int AS broken FROM neutral_finance.tip_realizations t
      LEFT JOIN neutral_finance.fund_lot_range_consumptions r
        ON (r.business_id,r.tip_realization_id)=(t.business_id,t.id)
      WHERE (r.fund_lot_id,r.first_cent,r.last_cent) IS DISTINCT FROM (t.fund_lot_id,t.first_cent,t.last_cent)
        OR t.inclusive_cents::numeric<>t.net_cents::numeric+t.tax_cents::numeric`)).rows[0].broken,0);
    for(const {name,columns} of tables){
      const projection=columns.map(column=>columnType(column)==='boolean'?q(column):q(column)+'::text AS '+q(column));
      const result=await connection.query(`SELECT ${projection.join(',')} FROM ${table(name)} ORDER BY id`);
      assert.deepEqual(result.rows,exports[name],name+' exact exported values');
    }
    if(exports.tip_realizations.length){
      await connection.query('SAVEPOINT neutral_wrong_link');
      await assert.rejects(connection.query('UPDATE neutral_finance.tip_realizations SET fund_lot_id=$1',[randomUUID()]),{code:'23503'});
      await connection.query('ROLLBACK TO SAVEPOINT neutral_wrong_link');
    }
    await connection.query('COMMIT');
    return {tables:tables.length,sourceRows:Object.values(exports).reduce((total,rows)=>total+rows.length,0),...balance};
  }catch(error){
    await connection.query('ROLLBACK');
    throw error;
  }
}
