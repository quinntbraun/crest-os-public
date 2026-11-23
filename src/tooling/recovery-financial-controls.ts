// Private snapshot controls for restoration comparison, not a financial report
// or a second implementation of every business/subledger reconciliation rule.
import {isLiveRecoveryBackupSnapshot} from './recovery-backup-lease.ts';
import type {RecoveryBackupSnapshot} from './recovery-backup-lease.ts';
import {verifyRecoveryFundingRoots} from './recovery-funding-roots.ts';

type Stage='snapshot'|'amount_columns'|'cent_totals'|'funding_roots'|'journal_lines'|'journal_entries'|'trial_balance'|'manifest';
export class RecoveryFinancialControlsError extends Error{readonly stage:Stage|undefined;constructor(stage?:Stage){super('RECOVERY_FINANCIAL_CONTROLS_REVIEW_REQUIRED');this.name='RecoveryFinancialControlsError';this.stage=stage;}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryFinancialControlsError();}
const identifier=(value:string)=>'"'+value.replaceAll('"','""')+'"';
function integer(value:unknown){require(typeof value==='string'&&/^-?(?:0|[1-9][0-9]{0,79})$/.test(value));return BigInt(value);}
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);

export async function captureRecoveryFinancialControls(snapshot:RecoveryBackupSnapshot,signal:AbortSignal){
 let stage:Stage='snapshot';
 try{
  require(isLiveRecoveryBackupSnapshot(snapshot));const query:RecoveryBackupSnapshot['query']=async(sql,values)=>{require(isLiveRecoveryBackupSnapshot(snapshot));signal.throwIfAborted();const result=await snapshot.query(sql,values);signal.throwIfAborted();return result;};
  await query('SET LOCAL search_path=pg_catalog');
  const state=(await query("SELECT current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation")).rows[0];require(state?.read_only==='on'&&state.isolation==='repeatable read');
  stage='amount_columns';const shape=(await query("SELECT n.nspname AS schema,c.relname AS table,a.attname AS column,a.atttypid::integer AS type,pg_catalog.format_type(a.atttypid,a.atttypmod) AS formatted_type,EXISTS(SELECT 1 FROM pg_attribute b WHERE b.attrelid=c.oid AND b.attname='business_id' AND b.attnum>0 AND NOT b.attisdropped) AS business_scoped FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('crest','crest_private') AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped AND right(a.attname,6)='_cents' ORDER BY n.nspname COLLATE \"C\",c.relname COLLATE \"C\",a.attname COLLATE \"C\"")).rows;
  require(shape.length>0&&shape.length<=2048&&shape.every(column=>[20,21,23].includes(column.type)||column.type===1700&&/^numeric\([1-9][0-9]{0,3},0\)$/.test(column.formatted_type)));
  const tables=new Map<string,{schema:string;table:string;columns:string[];businessScoped:boolean}>();
  for(const column of shape){const key=column.schema+'.'+column.table,table=tables.get(key)??{schema:column.schema,table:column.table,columns:[] as string[],businessScoped:column.business_scoped};table.columns.push(column.column);tables.set(key,table);}
  stage='cent_totals';const centTotals=[];let observations=0;
  for(const table of tables.values()){
   const sums=table.columns.flatMap((name,index)=>[`count(${identifier(name)})::text AS ${identifier('count_'+index)}`,`coalesce(sum(${identifier(name)}::numeric),0)::text AS ${identifier('sum_'+index)}`]);
   const rows=(await query(`SELECT ${table.businessScoped?'business_id::text':'NULL::text'} AS business_id,count(*)::text AS row_count,${sums.join(',')} FROM ONLY ${identifier(table.schema)}.${identifier(table.table)}${table.businessScoped?' GROUP BY business_id ORDER BY business_id':''}`)).rows;require(rows.length<=10000);let rowCount=0n;
   const groups=rows.map(row=>{
    require(table.businessScoped?uuid(row.business_id):row.business_id===null);const count=integer(row.row_count);require(count>=0n&&count<=10000000n);rowCount+=count;
    const columns=table.columns.map((name,index)=>{const nonNull=integer(row['count_'+index]),sum=integer(row['sum_'+index]);require(nonNull>=0n&&nonNull<=count);observations++;require(observations<=100000);return Object.freeze({column:name,nonNullRows:nonNull.toString(),sumCents:sum.toString()});});
    return Object.freeze({businessId:row.business_id as string|null,rowCount:count.toString(),columns:Object.freeze(columns)});
   });centTotals.push(Object.freeze({...table,columns:Object.freeze(table.columns),rowCount:rowCount.toString(),groups:Object.freeze(groups)}));
  }
  stage='funding_roots';await verifyRecoveryFundingRoots(snapshot,signal);
  stage='journal_lines';require((await query('SELECT NOT EXISTS(SELECT 1 FROM crest.journal_lines l LEFT JOIN crest.journal_entries e ON e.business_id=l.business_id AND e.id=l.entry_id WHERE e.id IS NULL OR l.debit_cents<0 OR l.credit_cents<0 OR NOT((l.debit_cents>0)<>(l.credit_cents>0))) AS valid')).rows[0]?.valid===true);
  async function pages(sql:string){
   const rows:Record<string,unknown>[]=[];await query('DECLARE crest_recovery_finance NO SCROLL CURSOR FOR '+sql);
   try{for(;;){const page=(await query('FETCH FORWARD 256 FROM crest_recovery_finance')).rows;if(!page.length)break;rows.push(...page);require(rows.length<=100000);}}finally{await query('CLOSE crest_recovery_finance');}return rows;
  }
  stage='journal_entries';let totalDebit=0n,totalCredit=0n;
  const entries=(await pages('SELECT e.business_id::text,e.id::text AS entry_id,count(l.id)::text AS line_count,coalesce(sum(l.debit_cents::numeric),0)::text AS debit,coalesce(sum(l.credit_cents::numeric),0)::text AS credit FROM crest.journal_entries e LEFT JOIN crest.journal_lines l ON l.business_id=e.business_id AND l.entry_id=e.id GROUP BY e.business_id,e.id ORDER BY e.business_id,e.id')).map(row=>{
   const debit=integer(row.debit),credit=integer(row.credit),lineCount=integer(row.line_count);require(uuid(row.business_id)&&uuid(row.entry_id)&&lineCount>0n&&debit>0n&&debit===credit);totalDebit+=debit;totalCredit+=credit;return Object.freeze({businessId:row.business_id,entryId:row.entry_id,lineCount:lineCount.toString(),debitCents:debit.toString(),creditCents:credit.toString()});
  });
  stage='trial_balance';const trialBalance=(await pages('SELECT a.business_id::text,a.id::text AS account_id,a.currency,coalesce(sum(l.debit_cents::numeric),0)::text AS debit,coalesce(sum(l.credit_cents::numeric),0)::text AS credit FROM crest.accounts a LEFT JOIN crest.journal_lines l ON l.business_id=a.business_id AND l.account_id=a.id GROUP BY a.business_id,a.id ORDER BY a.business_id,a.id')).map(row=>{
   const debit=integer(row.debit),credit=integer(row.credit);require(uuid(row.business_id)&&uuid(row.account_id)&&row.currency==='USD'&&debit>=0n&&credit>=0n);return Object.freeze({businessId:row.business_id,accountId:row.account_id,currency:'USD' as const,debitCents:debit.toString(),creditCents:credit.toString(),netDebitCents:(debit-credit).toString()});
  });
  require(trialBalance.reduce((sum,row)=>sum+BigInt(row.debitCents),0n)===totalDebit&&trialBalance.reduce((sum,row)=>sum+BigInt(row.creditCents),0n)===totalCredit);
  stage='manifest';const evidence=Object.freeze({profile:'crest.private-financial-recovery-controls.v1' as const,snapshotId:snapshot.id,centTotals:Object.freeze(centTotals),entries:Object.freeze(entries),trialBalance:Object.freeze(trialBalance),journalDebitCents:totalDebit.toString(),journalCreditCents:totalCredit.toString(),journalBalanced:true as const,fullBusinessReconciliationVerified:false as const,completeBackup:false as const});require(Buffer.byteLength(JSON.stringify(evidence))<=8388608);return Object.freeze({forRecoveryTools:()=>evidence,toJSON():never{throw new RecoveryFinancialControlsError();}});
 }catch{throw new RecoveryFinancialControlsError(stage);}
}
