import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {customerDate,customerUuid,customerVersion,exactCustomerObject as exact} from '../../customer/customer-contract.ts';
import {parseReceiptCandidate,parseReceiptReservation} from './receipt-contract.ts';
import {parseSupplierBillDraftRevision} from './supplier-bill-draft-contract.ts';
import {parseSupplierPayableReview,parseSupplierPayableReviewRequest} from './supplier-payable-review-contract.ts';
import {supplierPayableSourceColumns as columns} from './supplier-payable-source-columns.ts';

type Row=Readonly<Record<string,unknown>>;
type History=Readonly<{operation:readonly Row[];audit_event:readonly Row[]}>;
type Table=keyof typeof columns;
const commands=[
 'bookkeeping.supplier_bill.original.reserve','bookkeeping.supplier_bill.original.publish',
 'finance.supplier_bill.accrual','finance.supplier_bill.settle',
] as const;
const entities=['supplier_bill_original_intents','supplier_bill_originals','supplier_payables','supplier_payable_settlements'];
const actions=['reserve','publish','post','post'];
const tables=Object.keys(columns) as Table[];
export const supplierPayableFile='supplier_payable_source.json';
export const isSupplierPayableOperation=(row:Row)=>commands.some(command=>command===row.command_type);
function check(ok:unknown):asserts ok{if(!ok)throw Error('SUPPLIER_PAYABLE_SOURCE_REQUIRED');}
function json(value:unknown){
 check(typeof value==='string'&&Buffer.byteLength(value)<=4194304);
 return JSON.parse(value) as unknown;
}
function integer(value:unknown){
 check(typeof value==='string'&&/^(0|-?[1-9][0-9]{0,18})$/.test(value));
 const result=BigInt(value);
 check(result>=-9223372036854775808n&&result<=9223372036854775807n);
 return result;
}

export function verifySupplierPayableSource(value:unknown,businessId:string,drafts:unknown,history:History,
 legacyRows:(table:Table)=>readonly Row[]=()=>[]){
 check(customerUuid(businessId)&&exact(value,['schemaVersion','scope','businessId','tables'])&&value.schemaVersion===1
  &&value.scope==='supplier_payable_source'&&value.businessId===businessId&&exact(value.tables,tables)
  &&Buffer.byteLength(JSON.stringify(value))<=4194304
  &&drafts!==null&&typeof drafts==='object'&&'revisions' in drafts&&Array.isArray(drafts.revisions));
 const draftMap=new Map(drafts.revisions.map(raw=>{
  const draft=parseSupplierBillDraftRevision(raw,businessId);
  return [draft.billId+':'+draft.revision,draft] as const;
 }));
 const operations=new Map(history.operation.filter(isSupplierPayableOperation).map(row=>[row.operation_id,row]));
 const audits=new Map(history.audit_event.filter(row=>entities.includes(String(row.entity_kind))).map(row=>[row.operation_id,row]));
 check(operations.size===history.operation.filter(isSupplierPayableOperation).length
  &&audits.size===history.audit_event.filter(row=>entities.includes(String(row.entity_kind))).length);
 function reconcile(row:Row,kind:number,receipt:Row,reason:unknown){
  const op=operations.get(row.operation_id),audit=audits.get(row.operation_id);
  const delta={schemaVersion:1,before:null,after:receipt};
  check(op&&audit&&op.command_type===commands[kind]&&op.business_id===businessId&&op.actor_id===row.created_by
   &&op.state==='committed'&&op.origin==='manual'&&op.import_row_id===null
   &&String(op.schema_version)==='1'&&String(op.result_schema_version)==='1'&&same(json(op.result),receipt)
   &&audit.business_id===businessId&&audit.actor_id===row.created_by&&audit.entity_id===row.id&&audit.entity_kind===entities[kind]
   &&String(audit.entity_version)==='1'&&audit.action===actions[kind]&&audit.reason===reason&&same(json(audit.delta),delta)
   &&typeof audit.hash_input==='string'&&audit.hash_input===audit.payload
   &&createHash('sha256').update(audit.hash_input).digest('hex')===audit.event_hash);
  const payload=json(audit.payload);
  check(payload&&typeof payload==='object'&&'operationId' in payload&&payload.operationId===row.operation_id
   &&'delta' in payload&&same(payload.delta,delta));
  operations.delete(row.operation_id);
  audits.delete(row.operation_id);
  return op;
 }

 let count=0;
 const byTable=new Map<Table,Map<string,Row>>();
 for(const name of tables){
  const rows=value.tables[name], indexed=new Map<string,Row>();
  check(Array.isArray(rows));
  count+=rows.length;
  check(count<=10000);
  const oldIds=new Set(legacyRows(name).map(row=>row.id));
  let prior='';
  for(const row of rows){
   check(exact(row,columns[name])&&customerUuid(row.id)&&row.id>prior&&row.business_id===businessId&&!oldIds.has(row.id));
   indexed.set(row.id,row);
   prior=row.id;
  }
  byTable.set(name,indexed);
 }
 const list=(table:Table)=>[...byTable.get(table)!.values()];
 function lookup(table:Table,id:unknown){
  check(customerUuid(id));
  const row=byTable.get(table)!.get(id);
  check(row);
  return row;
 }
 function index(rows:readonly Row[],column:string){
  const mapped=new Map(rows.map(row=>[row[column],row]));
  check(mapped.size===rows.length);
  return mapped;
 }
 function group(rows:readonly Row[],column:string){
  const mapped=new Map<unknown,Row[]>();
  for(const row of rows){
   const entries=mapped.get(row[column])??[];
   entries.push(row);
   mapped.set(row[column],entries);
  }
  return mapped;
 }

 const intents=list('supplier_bill_original_intents');
 const reservations=new Map<unknown,ReturnType<typeof parseReceiptReservation>>();
 for(const row of intents){
  const draft=draftMap.get(String(row.bill_id)+':'+String(row.bill_revision));
  check(draft&&draft.payload.documentReference===row.document_reference);
  const originalKey='originals/'+businessId+'/'+String(row.id);
  const previewKey='previews/'+businessId+'/'+String(row.id);
  const stagingKey='staging/'+businessId+'/'+String(row.id)+'/'+String(row.dispatch_id);
  const wire={businessId,originalId:row.id,billId:row.bill_id,billRevision:row.bill_revision,recoveryEpoch:row.recovery_epoch,
   declaredType:row.media_type,byteSize:Number(integer(row.byte_size)),dispatchId:row.dispatch_id,stagingKey,originalKey,previewKey};
  const {originalId:receiptId,billId:expenseId,billRevision:expenseRevision,...binding}=wire;
  const reservation=parseReceiptReservation({receiptId,expenseId,expenseRevision,...binding});
  const op=reconcile(row,0,{schemaVersion:1,reservation:wire},null);
  check(op.recovery_epoch===row.recovery_epoch);
  reservations.set(row.id,reservation);
 }
 for(const row of list('supplier_bill_originals')){
  const intent=lookup('supplier_bill_original_intents',row.id);
  const reservation=reservations.get(row.id);
  check(reservation&&['bill_id','bill_revision','media_type','byte_size','created_by','document_reference']
   .every(field=>intent[field]===row[field])&&row.object_key===reservation.originalKey);
  const candidate=parseReceiptCandidate(row.candidate,reservation);
  check(row.file_sha256===candidate.original.sha256);
  const op=reconcile(row,1,{schemaVersion:1,originalId:row.id,billId:row.bill_id,billRevision:row.bill_revision,sha256:row.file_sha256},null);
  check(op.recovery_epoch===intent.recovery_epoch);
 }

 const events=list('financial_events'),entries=list('journal_entries'),journalLines=list('journal_lines');
 const eventByAccrual=index(events.filter(row=>row.template==='P14'),'supplier_payable_id');
 const eventBySettlement=index(events.filter(row=>row.template==='P15'),'supplier_payable_settlement_id');
 const entriesByEvent=index(entries,'event_id'),linesByEntry=group(journalLines,'entry_id');
 const movementByEvent=index(list('money_movements'),'event_id');
 const payables=list('supplier_payables'),settlements=list('supplier_payable_settlements');
 check(events.length===eventByAccrual.size+eventBySettlement.size&&events.length===entries.length
  &&events.length===list('atomic_finance_groups').length&&eventByAccrual.size===payables.length
  &&eventBySettlement.size===settlements.length&&settlements.length===movementByEvent.size
  &&settlements.length===list('external_money_evidence').length);
 index(events,'group_id');
 index(payables,'bill_id');
 index(settlements,'evidence_id');
 function ledger(event:Row|undefined,row:Row,kind:'supplier_payable_id'|'supplier_payable_settlement_id'){
  check(event&&event[kind]===row.id&&event[kind==='supplier_payable_id'?'supplier_payable_settlement_id':'supplier_payable_id']===null
   &&event.template_version==='1'&&event.event_sequence==='1'&&event.zero_effect_reason===null&&customerDate(event.effective_on)
   &&Object.entries(event).every(([key,cell])=>!key.endsWith('_id')||['business_id','group_id','period_id',kind].includes(key)||cell===null));
  const financeGroup=lookup('atomic_finance_groups',event.group_id);
  const entry=entriesByEvent.get(event.id),lines=entry&&linesByEntry.get(entry.id);
  check(entry&&entry.entry_sequence==='1'&&lines&&lines.length>=2&&financeGroup.operation_id===row.operation_id
   &&financeGroup.created_by===row.created_by&&integer(financeGroup.commit_sequence)>0n);
  const lineLinks=['id','business_id','entry_id','account_id','fixed_mapping_id','money_movement_id',kind];
  for(const line of lines)check(line[kind]===row.id&&Object.entries(line)
   .every(([key,cell])=>!key.endsWith('_id')||lineLinks.includes(key)||cell===null));
  check(lines.reduce((sum,line)=>sum+integer(line.debit_cents)-integer(line.credit_cents),0n)===0n);
  linesByEntry.delete(entry.id);
  return {event,financeGroup,lines};
 }

 for(const row of payables){
  const original=lookup('supplier_bill_originals',row.original_id);
  const draft=draftMap.get(String(row.bill_id)+':'+String(row.bill_revision));
  const raw=row.review;
  check(draft&&original.bill_id===row.bill_id&&customerVersion(original.bill_revision)&&customerVersion(row.bill_revision)
   &&BigInt(original.bill_revision)<=BigInt(row.bill_revision)&&raw!==null&&typeof raw==='object'
   &&'purchaseTaxTreatment' in raw&&'reviewReason' in raw&&'periodId' in raw&&'periodGeneration' in raw);
  const request=parseSupplierPayableReviewRequest({billId:row.bill_id,revision:row.bill_revision,originalId:row.original_id,
   taxTreatment:raw.purchaseTaxTreatment,reason:raw.reviewReason});
  const review=parseSupplierPayableReview({state:'ready',originalId:row.original_id,plan:raw,candidates:[]},businessId,request);
  check(review.state==='ready');
  const {plan}=review;
  const {event,financeGroup,lines}=ledger(eventByAccrual.get(row.id),row,'supplier_payable_id');
  check(plan.documentReference===original.document_reference&&plan.documentSha256===original.file_sha256
   &&plan.documentReference===draft.payload.documentReference&&plan.incurredOn===draft.payload.incurredOn
   &&plan.dueOn===draft.payload.dueOn&&plan.vendor===draft.payload.vendor&&plan.taxCents===draft.payload.purchaseTaxCents
   &&plan.totalCents===draft.payload.grossCents&&row.gross_cents===plan.totalCents&&event.effective_on===plan.incurredOn
   &&event.period_id===raw.periodId&&event.period_generation===raw.periodGeneration&&!movementByEvent.has(event.id)
   &&Array.isArray(row.duplicate_payable_ids)&&row.duplicate_payable_ids.every((id,index,ids)=>customerUuid(id)&&id!==row.id
    &&byTable.get('supplier_payables')!.has(id)&&(index===0||String(ids[index-1])<id))
   &&(row.duplicate_payable_ids.length===0?row.distinct_reason===null:typeof row.distinct_reason==='string'&&row.distinct_reason.trim().length>0));
  check(lines.length===plan.lines.length&&plan.lines.length===draft.payload.splits.length+1);
  const unverified=[...lines];
  for(const item of plan.lines){
   if(item.category===null)check(row.payable_account_id===item.accountId&&row.payable_mapping_id===item.mappingId);
   else check(draft.payload.splits.some(split=>split.category===item.category&&split.grossCents===item.debitCents));
   const line=unverified.findIndex(candidate=>candidate.purpose===(item.category===null?'supplier_bill_payable':'supplier_bill_cost')
    &&candidate.account_id===item.accountId&&candidate.fixed_mapping_id===item.mappingId&&candidate.money_movement_id===null
    &&candidate.debit_cents===item.debitCents&&candidate.credit_cents===item.creditCents);
   check(line>=0);
   unverified.splice(line,1);
  }
  const receipt={schemaVersion:1,businessId,payableId:row.id,billId:row.bill_id,billRevision:row.bill_revision,originalId:row.original_id,
   operationId:row.operation_id,eventId:event.id,grossCents:row.gross_cents,reviewSha256:plan.sha256,
   duplicatePayableIds:row.duplicate_payable_ids,distinctReason:row.distinct_reason};
  check(reconcile(row,2,receipt,raw.reviewReason).recovery_epoch===financeGroup.recovery_epoch);
 }

 const payments=[];
 for(const row of settlements){
  const payable=lookup('supplier_payables',row.payable_id),evidence=lookup('external_money_evidence',row.evidence_id);
  const {event,financeGroup,lines}=ledger(eventBySettlement.get(row.id),row,'supplier_payable_settlement_id');
  const movement=movementByEvent.get(event.id),paid=integer(row.paid_cents),remaining=integer(row.remaining_before_cents)-paid;
  const originalEvent=eventByAccrual.get(payable.id);
  check(movement&&originalEvent&&customerDate(row.actual_on)&&customerDate(originalEvent.effective_on)
   &&row.actual_on>=originalEvent.effective_on&&row.actual_on===event.effective_on
   &&paid>0n&&remaining>=0n&&movement.signed_cents===String(-paid)&&movement.evidence_id===evidence.id
   &&evidence.external_account_id===movement.account_id&&evidence.signed_cents===movement.signed_cents
   &&evidence.confirmed_on===row.actual_on&&evidence.currency==='USD'&&evidence.normalization_rule==='exact_case_v1'
   &&customerUuid(row.channel_version_id)&&lines.length===2);
  check(lines.some(line=>line.purpose==='supplier_settlement_payable'&&line.account_id===payable.payable_account_id
   &&line.fixed_mapping_id===payable.payable_mapping_id&&line.money_movement_id===null&&line.debit_cents===row.paid_cents&&line.credit_cents==='0')
   &&lines.some(line=>line.purpose==='supplier_settlement_money'&&line.account_id===movement.account_id
    &&line.fixed_mapping_id===null&&line.money_movement_id===movement.id&&line.debit_cents==='0'&&line.credit_cents===row.paid_cents));
  const receipt={schemaVersion:1,businessId,payableId:payable.id,settlementId:row.id,operationId:row.operation_id,actualOn:row.actual_on,
   paidCents:row.paid_cents,remainingCents:String(remaining),channelVersionId:row.channel_version_id,evidenceId:evidence.id,eventId:event.id,movementId:movement.id};
  check(reconcile(row,3,receipt,row.confirmation).recovery_epoch===financeGroup.recovery_epoch);
  const postedSequence=integer(financeGroup.commit_sequence);
  check(postedSequence>integer(lookup('atomic_finance_groups',originalEvent.group_id).commit_sequence));
  payments.push({payable,paid,remaining,postedSequence});
 }
 payments.sort((a,b)=>a.postedSequence<b.postedSequence?-1:a.postedSequence>b.postedSequence?1:0);
 const balances=new Map<unknown,bigint>();
 for(const {payable,paid,remaining} of payments){
  const before=balances.get(payable.id)??integer(payable.gross_cents);
  check(before-paid===remaining);
  balances.set(payable.id,remaining);
 }
 check(operations.size===0&&audits.size===0&&linesByEntry.size===0);
 const debitCents=journalLines.reduce((sum,line)=>sum+integer(line.debit_cents),0n);
 return {rows:count,debitCents,balancedJournalEntries:entries.length,originals:byTable.get('supplier_bill_originals')!.size,payables:payables.length,settlements:settlements.length};
}

export async function captureSupplierPayableSource(businessId:string,query:(sql:string,args:unknown[])=>Promise<unknown[]>){
 const rows=await query('SELECT crest_commands.supplier_payable_source_snapshot($1::uuid) AS result',[businessId]);
 check(rows.length===1&&exact(rows[0],['result']));
 return rows[0].result;
}
