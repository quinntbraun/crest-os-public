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
const refundLinks={
  financial_events:{service_refund_id:'service_credit_refunds'},
  journal_lines:{service_refund_id:'service_credit_refunds'},
  fund_lot_range_consumptions:{service_refund_id:'service_credit_refunds'},
  service_credit_refunds:{pair_id:'paired_invoice_credit_releases',fund_lot_id:'customer_fund_lots',evidence_id:'external_money_evidence'},
};
const excessReturnLinks={
  financial_events:{excess_return_id:'excess_receipt_returns'},
  journal_lines:{excess_return_id:'excess_receipt_returns'},
  fund_lot_range_consumptions:{excess_return_id:'excess_receipt_returns'},
  excess_receipt_returns:{receipt_event_id:'financial_events',fund_lot_id:'customer_fund_lots',evidence_id:'external_money_evidence'},
};
const tipReturnLinks={
  financial_events:{tip_return_id:'tip_returns'},
  journal_lines:{tip_return_id:'tip_returns'},
  tip_returns:{tip_realization_id:'tip_realizations',evidence_id:'external_money_evidence'},
  tip_realization_range_consumptions:{tip_return_id:'tip_returns',tip_realization_id:'tip_realizations'},
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

export async function exerciseNeutralFinanceImport(connection,files,businessId,{
  includeCredits=false,includePairedCredits=false,includeServiceRefunds=false,includeExcessReceipts=false,includeExcessReturns=false,includeTipReturns=false,
}={}){
  assert(!includePairedCredits||includeCredits);
  assert(!includeServiceRefunds||includePairedCredits);
  assert(!includeExcessReceipts||includeServiceRefunds);
  assert(!includeExcessReturns||includeExcessReceipts);
  assert(!includeTipReturns||includeExcessReturns);
  const parts=new Map(files.map(file=>[file.name,file.content]));
  const {tables}=JSON.parse(parts.get('dictionary.json'));
  assert.deepEqual(tables.map(row=>row.name),[...names,...includeCredits?['invoice_credits']:[],
    ...includePairedCredits?['paired_invoice_credit_releases']:[],...includeServiceRefunds?['service_credit_refunds']:[],
    ...includeExcessReturns?['excess_receipt_returns']:[],...includeTipReturns?['tip_returns','tip_realization_range_consumptions']:[]]);
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
      if(rows.length){
        await connection.query('SAVEPOINT neutral_wrong_credit_link');
        await assert.rejects(connection.query('UPDATE neutral_finance.invoice_credits SET invoice_item_id=$1',[randomUUID()]),{code:'23503'});
        await connection.query('ROLLBACK TO SAVEPOINT neutral_wrong_credit_link');
      }
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
      assert.equal(rows.length,exports.paired_invoice_credit_releases.length);
      assert(rows.every(row=>row.same_group&&row.release_sequence===1&&row.credit_sequence===2
        &&BigInt(row.reviewed_ar)+BigInt(row.release_cents)===BigInt(row.credit_cents)));
      if(rows.length){
        await connection.query('SAVEPOINT neutral_wrong_paired_link');
        await assert.rejects(connection.query('UPDATE neutral_finance.paired_invoice_credit_releases SET unapplication_id=$1',[randomUUID()]),{code:'23503'});
        await connection.query('ROLLBACK TO SAVEPOINT neutral_wrong_paired_link');
      }
    }
    if(includeServiceRefunds){
      for(const [name,columns] of Object.entries(refundLinks)){
        for(const [column,target] of Object.entries(columns))await connection.query(
          `ALTER TABLE ${table(name)} ADD FOREIGN KEY(business_id,${q(column)}) REFERENCES ${table(target)}(business_id,id)`);
      }
      const {rows}=await connection.query(`
        SELECT r.id, r.cents::text, m.signed_cents::text, count(*)::int AS lines,
          (m.evidence_id=r.evidence_id AND m.account_id=r.account_id) AS exact_evidence,
          (r.fund_lot_id,r.first_cent,r.last_cent)=(s.fund_lot_id,s.first_cent,s.last_cent) AS exact_range,
          count(*) FILTER(WHERE l.purpose='refund_funds' AND l.debit_cents=r.cents AND l.credit_cents=0 AND l.fund_lot_id=r.fund_lot_id)::int AS debit_lines,
          count(*) FILTER(WHERE l.purpose='refund_money' AND l.credit_cents=r.cents AND l.debit_cents=0 AND l.money_movement_id=m.id)::int AS credit_lines
        FROM neutral_finance.service_credit_refunds r
        JOIN neutral_finance.financial_events e ON (e.business_id,e.service_refund_id)=(r.business_id,r.id) AND e.template='P08'
        JOIN neutral_finance.fund_lot_range_consumptions s ON (s.business_id,s.service_refund_id)=(r.business_id,r.id)
        JOIN neutral_finance.money_movements m ON (m.business_id,m.event_id)=(e.business_id,e.id)
        JOIN neutral_finance.journal_entries j ON (j.business_id,j.event_id)=(e.business_id,e.id)
        JOIN neutral_finance.journal_lines l ON (l.business_id,l.entry_id,l.service_refund_id)=(j.business_id,j.id,r.id)
        GROUP BY r.id,m.id,s.id`);
      assert.equal(rows.length,exports.service_credit_refunds.length);
      assert(rows.every(row=>row.lines===2&&row.debit_lines===1&&row.credit_lines===1&&row.exact_evidence&&row.exact_range
        &&BigInt(row.signed_cents)===-BigInt(row.cents)));
      if(rows.length){
        await connection.query('SAVEPOINT neutral_wrong_refund_link');
        await assert.rejects(connection.query('UPDATE neutral_finance.service_credit_refunds SET fund_lot_id=$1',[randomUUID()]),{code:'23503'});
        await connection.query('ROLLBACK TO SAVEPOINT neutral_wrong_refund_link');
      }
    }
    if(includeExcessReceipts){
      await connection.query('ALTER TABLE neutral_finance.customer_fund_lots ADD FOREIGN KEY(business_id,receipt_event_id) REFERENCES neutral_finance.financial_events(business_id,id)');
      const {rows}=await connection.query(`
        SELECT l.id,l.original_cents::text AS held,
          count(*) FILTER(WHERE jl.purpose='receipt_funds' AND jl.fund_lot_id=l.id AND jl.credit_cents=l.original_cents)::int AS held_lines,
          count(*) FILTER(WHERE jl.purpose='receipt_money' AND jl.debit_cents=p.gross_cents)::int AS money_lines
        FROM neutral_finance.customer_fund_lots l
        JOIN neutral_finance.financial_events e ON (e.business_id,e.id)=(l.business_id,l.receipt_event_id) AND e.template='P03'
        JOIN neutral_finance.payments p ON (p.business_id,p.id)=(e.business_id,e.payment_id)
        JOIN neutral_finance.journal_entries j ON (j.business_id,j.event_id)=(e.business_id,e.id)
        JOIN neutral_finance.journal_lines jl ON (jl.business_id,jl.entry_id)=(j.business_id,j.id)
        GROUP BY l.id`);
      assert.deepEqual(rows.map(row=>row.held).sort(),exports.customer_fund_lots.filter(lot=>lot.receipt_event_id!==null).map(lot=>lot.original_cents).sort());
      assert(rows.every(row=>row.held_lines===1&&row.money_lines===1));
    }
    if(includeExcessReturns){
      for(const [name,columns] of Object.entries(excessReturnLinks)){
        for(const [column,target] of Object.entries(columns))await connection.query(
          'ALTER TABLE '+table(name)+' ADD FOREIGN KEY(business_id,'+q(column)+') REFERENCES '+table(target)+'(business_id,id)');
      }
      const {rows}=await connection.query(`
        SELECT r.id,r.cents::text,count(*)::int AS lines,
          r.cents=r.last_cent-r.first_cent+1 AND r.first_cent>=p.first_cent AND r.last_cent<=p.last_cent
           AND (r.fund_lot_id,r.first_cent,r.last_cent)=(s.fund_lot_id,s.first_cent,s.last_cent) AS exact_range,
          (m.evidence_id,m.account_id,m.signed_cents)=(r.evidence_id,r.account_id,-r.cents)
           AND (proof.external_account_id,proof.confirmed_on,proof.signed_cents)=(r.account_id::text,r.actual_on,-r.cents) AS exact_evidence,
          count(*) FILTER(WHERE line.purpose='excess_return_funds' AND line.debit_cents=r.cents AND line.credit_cents=0
           AND line.fund_lot_id=lot.id AND line.account_id=lot.account_id AND line.fixed_mapping_id=lot.mapping_id)::int AS debit_lines,
          count(*) FILTER(WHERE line.purpose='excess_return_money' AND line.credit_cents=r.cents AND line.debit_cents=0
           AND line.money_movement_id=m.id AND line.account_id=m.account_id)::int AS credit_lines
        FROM neutral_finance.excess_receipt_returns r
        JOIN neutral_finance.customer_fund_lots lot ON (lot.business_id,lot.id,lot.receipt_event_id)=(r.business_id,r.fund_lot_id,r.receipt_event_id)
        JOIN neutral_finance.financial_events original ON (original.business_id,original.id)=(r.business_id,r.receipt_event_id) AND original.template='P03'
        JOIN neutral_finance.funding_origins o ON (o.business_id,o.id,o.payment_id,o.customer_id)=(lot.business_id,lot.origin_id,original.payment_id,lot.customer_id)
        JOIN neutral_finance.funding_partitions p ON (p.business_id,p.id,p.origin_id)=(lot.business_id,lot.parent_partition_id,o.id)
        JOIN neutral_finance.financial_events e ON (e.business_id,e.excess_return_id)=(r.business_id,r.id) AND e.template='P09'
        JOIN neutral_finance.fund_lot_range_consumptions s ON (s.business_id,s.excess_return_id)=(r.business_id,r.id)
        JOIN neutral_finance.money_movements m ON (m.business_id,m.event_id)=(e.business_id,e.id)
        JOIN neutral_finance.external_money_evidence proof ON (proof.business_id,proof.id)=(r.business_id,r.evidence_id)
        JOIN neutral_finance.journal_entries j ON (j.business_id,j.event_id)=(e.business_id,e.id)
        JOIN neutral_finance.journal_lines line ON (line.business_id,line.entry_id,line.excess_return_id)=(j.business_id,j.id,r.id)
        GROUP BY r.id,s.id,p.id,m.id,proof.id`);
      assert.equal(rows.length,exports.excess_receipt_returns.length);
      assert(rows.every(row=>row.lines===2&&row.debit_lines===1&&row.credit_lines===1&&row.exact_range&&row.exact_evidence));
      if(rows.length){
        await connection.query('SAVEPOINT neutral_wrong_excess_return');
        await assert.rejects(connection.query('UPDATE neutral_finance.excess_receipt_returns SET receipt_event_id=$1',[randomUUID()]),{code:'23503'});
        await connection.query('ROLLBACK TO SAVEPOINT neutral_wrong_excess_return');
      }
    }
    if(includeTipReturns){
      for(const [name,columns] of Object.entries(tipReturnLinks)){
        for(const [column,target] of Object.entries(columns))await connection.query(
          'ALTER TABLE '+table(name)+' ADD FOREIGN KEY(business_id,'+q(column)+') REFERENCES '+table(target)+'(business_id,id)');
      }
      await connection.query('ALTER TABLE neutral_finance.tip_returns ADD UNIQUE(business_id,id,tip_realization_id)');
      await connection.query('ALTER TABLE neutral_finance.tip_realization_range_consumptions ADD FOREIGN KEY(business_id,tip_return_id,tip_realization_id) REFERENCES neutral_finance.tip_returns(business_id,id,tip_realization_id)');
      const {rows}=await connection.query(`
        WITH portions AS (
          SELECT x.business_id,x.tip_return_id,sum(x.last_cent-x.first_cent+1)::bigint AS cents,
            sum(div(2*t.net_cents::numeric*x.last_cent+t.inclusive_cents,2*t.inclusive_cents::numeric)
              -div(2*t.net_cents::numeric*(x.first_cent-1)+t.inclusive_cents,2*t.inclusive_cents::numeric))::bigint AS net,
            bool_and(x.first_cent>0 AND x.last_cent BETWEEN x.first_cent AND t.inclusive_cents) AS bounds
          FROM neutral_finance.tip_realization_range_consumptions x JOIN neutral_finance.tip_realizations t
            ON (t.business_id,t.id)=(x.business_id,x.tip_realization_id)
          GROUP BY x.business_id,x.tip_return_id
        )
        SELECT r.id,r.cents::text,r.net_cents::text,r.tax_cents::text,count(*)::int AS lines,
          p.bounds AND (r.cents,r.net_cents,r.tax_cents)=(p.cents,p.net,p.cents-p.net) AS exact_slices,
          (m.evidence_id,m.account_id,m.signed_cents)=(r.evidence_id,r.account_id,-r.cents)
            AND (proof.external_account_id,proof.confirmed_on,proof.signed_cents)=(r.account_id::text,r.actual_on,-r.cents) AS exact_evidence,
          count(*) FILTER(WHERE line.purpose='tip_return_revenue' AND line.debit_cents=r.net_cents AND line.credit_cents=0
            AND line.account_id=t.revenue_account_id AND line.fixed_mapping_id=t.revenue_mapping_id)::int AS revenue_lines,
          count(*) FILTER(WHERE line.purpose='tip_return_tax' AND line.debit_cents=r.tax_cents AND line.credit_cents=0
            AND line.account_id=t.tax_account_id)::int AS tax_lines,
          count(*) FILTER(WHERE line.purpose='tip_return_money' AND line.credit_cents=r.cents AND line.debit_cents=0
            AND line.money_movement_id=m.id AND line.account_id=m.account_id)::int AS money_lines
        FROM neutral_finance.tip_returns r
        JOIN portions p ON (p.business_id,p.tip_return_id)=(r.business_id,r.id)
        JOIN neutral_finance.tip_realizations t ON (t.business_id,t.id)=(r.business_id,r.tip_realization_id)
        JOIN neutral_finance.financial_events original ON (original.business_id,original.tip_realization_id)=(t.business_id,t.id)
          AND original.template='P06' AND original.effective_on<=r.actual_on
        JOIN neutral_finance.financial_events e ON (e.business_id,e.tip_return_id)=(r.business_id,r.id) AND e.template='P10'
        JOIN neutral_finance.money_movements m ON (m.business_id,m.event_id)=(e.business_id,e.id)
        JOIN neutral_finance.external_money_evidence proof ON (proof.business_id,proof.id)=(r.business_id,r.evidence_id)
        JOIN neutral_finance.journal_entries j ON (j.business_id,j.event_id)=(e.business_id,e.id)
        JOIN neutral_finance.journal_lines line ON (line.business_id,line.entry_id,line.tip_return_id)=(j.business_id,j.id,r.id)
        GROUP BY r.id,m.id,proof.id,p.bounds,p.cents,p.net`);
      assert.equal(rows.length,exports.tip_returns.length);
      assert(rows.every(row=>row.exact_slices&&row.exact_evidence&&row.money_lines===1
        &&row.revenue_lines===Number(row.net_cents!=='0')&&row.tax_lines===Number(row.tax_cents!=='0')
        &&row.lines===row.money_lines+row.revenue_lines+row.tax_lines));
      assert.equal((await connection.query(`
        SELECT count(*)::int AS broken FROM neutral_finance.tip_realization_range_consumptions a
        JOIN neutral_finance.tip_realization_range_consumptions b
          ON (a.business_id,a.tip_realization_id)=(b.business_id,b.tip_realization_id) AND a.id<b.id
        WHERE a.first_cent<=b.last_cent AND b.first_cent<=a.last_cent`)).rows[0].broken,0);
      if(rows.length){
        await connection.query('SAVEPOINT neutral_wrong_tip_return');
        await assert.rejects(connection.query('UPDATE neutral_finance.tip_realization_range_consumptions SET tip_return_id=$1',[randomUUID()]),{code:'23503'});
        await connection.query('ROLLBACK TO SAVEPOINT neutral_wrong_tip_return');
      }
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
