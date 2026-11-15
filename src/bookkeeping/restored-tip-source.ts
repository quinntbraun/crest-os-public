import {createHash} from 'node:crypto';
import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {creditRangeComponents} from './credit-ranges.ts';

type Row=Readonly<Record<string,unknown>>;
type TextRow=Readonly<Record<string,string|null>>;
type Read=(table:string)=>readonly Row[];
type Range=Readonly<{first:bigint;last:bigint}>;

export const restoredTipSourceColumns:Readonly<Record<string,readonly string[]>>={
  tip_realizations:['restored_settlement_component_id'],
  collection_failure_components:['restored_tip_generation_id'],
  collection_failure_settlement_components:['original_tip_realization_id'],
};

function check(condition:unknown):asserts condition {
  if(!condition)throw Error('COLLECTION_RESTORED_TIP_SOURCE_REVIEW_REQUIRED');
}
const cents=(value:unknown)=>{
  check(typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value));
  return BigInt(value);
};

export function createTipSourceLineage(read:Read,restored:boolean){
  const tips=new Map(read('tip_realizations').map(row=>[row.id,row]));
  const postings=new Map(read('financial_events').filter(row=>row.template==='P06'||row.template==='P03'&&row.tip_realization_id!=null)
    .map(row=>[row.tip_realization_id,row]));
  const children=new Map((restored?read('collection_failure_settlement_components'):[]).map(row=>[row.id,row]));
  const settlements=new Map((restored?read('financial_events'):[]).filter(row=>row.collection_failure_settlement_id!=null)
    .map(row=>[row.collection_failure_settlement_id,row]));
  function posting(tip:Row){
    if(tip.restored_settlement_component_id==null)return postings.get(tip.id);
    return settlements.get(children.get(tip.restored_settlement_component_id)?.settlement_id);
  }
  function split(tip:Row,ranges:readonly Range[]){
    let original=tip;
    const first=cents(tip.first_cent),last=cents(tip.last_cent);
    for(let depth=0;original.restored_settlement_component_id!=null;depth++){
      check(depth<180);
      const child=children.get(original.restored_settlement_component_id),previous=tips.get(child?.original_tip_realization_id);
      check(child&&previous&&child.first_cent===original.first_cent&&child.last_cent===original.last_cent
        &&first>=cents(previous.first_cent)&&last<=cents(previous.last_cent)
        &&previous.fund_lot_id===original.fund_lot_id);
      original=previous;
    }
    const start=first-cents(original.first_cent);
    check(ranges.every(range=>range.first>=1n&&range.last<=last-first+1n));
    return creditRangeComponents({inclusiveCents:cents(original.inclusive_cents),netCents:cents(original.net_cents),
      taxCents:cents(original.tax_cents),discountCents:0n},
    ranges.map(range=>({first:range.first+start,last:range.last+start})));
  }
  return {posting,split};
}

export async function captureRestoredTipSource(businessId:string,historyToken:string,
  query:(sql:string,args:unknown[])=>Promise<unknown[]>){
  const result=await query('SELECT crest_commands.collection_failure_restored_tip_source_snapshot($1::uuid) AS result',[businessId]);
  check(result.length===1&&exact(result[0],['result']));
  const value=result[0].result;
  check(exact(value,['schemaVersion','businessId','historySnapshotToken','generations','settlements','failures'])
    &&value.schemaVersion===1&&value.businessId===businessId&&value.historySnapshotToken===historyToken
    &&/^[a-f0-9]{64}$/.test(historyToken)&&Buffer.byteLength(JSON.stringify(value))<=4*1024*1024+512);
  let count=0;
  function records(rows:unknown,fields?:readonly string[]){
    check(Array.isArray(rows));
    count+=rows.length;
    check(count<=1000);
    let prior='';
    return rows.map((row:unknown)=>{
      check(row!==null&&typeof row==='object'&&!Array.isArray(row)&&'id' in row&&customerUuid(row.id)&&row.id>prior
        &&Object.values(row).every(cell=>cell===null||typeof cell==='string')
        &&(fields?exact(row,fields)&&customerUuid(row[fields[1] as keyof typeof row])
          :'business_id' in row&&row.business_id===businessId&&'restored_settlement_component_id' in row
            &&customerUuid(row.restored_settlement_component_id)));
      prior=row.id;
      return row as TextRow;
    });
  }
  return {
    generations:records(value.generations),
    settlements:records(value.settlements,['id','original_tip_realization_id']),
    failures:records(value.failures,['id','restored_tip_generation_id']),
    snapshotToken:createHash('sha256').update('crest.collection-failure-restored-tip.v1:'+historyToken).digest('hex'),
  };
}
