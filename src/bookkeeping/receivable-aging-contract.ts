import {customerDate,customerInstant,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason,requireFinanceAccount as check} from './finance-account-contract.ts';

export const receivableAgingBuckets=['current','days1To30','days31To60','days61To90','days91Plus'] as const;
const nonnegative=(value:unknown):value is string=>typeof value==='string'&&/^(0|[1-9][0-9]{0,29})$/.test(value);
const pageSize=100;
const bucket=(days:number)=>days===0?'current':days<=30?'days1To30':days<=60?'days31To60':days<=90?'days61To90':'days91Plus';

export function parseReceivableAging(value:unknown,businessId:string,throughOn:string|null){
  check(exact(value,['schemaVersion','businessId','throughOn','observedAt','timeZone','currency','scope','itemCount','totalCents','buckets','rows'])
    &&value.schemaVersion===1&&customerUuid(businessId)&&value.businessId===businessId&&value.currency==='USD'
    &&value.scope==='posted-invoices'&&customerDate(value.throughOn)&&(throughOn===null||value.throughOn===throughOn)
    &&customerInstant(value.observedAt)&&typeof value.timeZone==='string'&&/^[A-Za-z_0-9+\-/]{1,80}$/.test(value.timeZone)
    &&nonnegative(value.itemCount)&&nonnegative(value.totalCents)&&exact(value.buckets,receivableAgingBuckets)
    &&Array.isArray(value.rows));
  const date=value.throughOn;
  const itemCount=BigInt(value.itemCount);
  const buckets=value.buckets;
  check(BigInt(value.rows.length)===(itemCount>BigInt(pageSize)?BigInt(pageSize):itemCount));
  const shown={current:0n,days1To30:0n,days31To60:0n,days61To90:0n,days91Plus:0n};
  const invoiceIds=new Set<string>();
  const receivableIds=new Set<string>();
  let previous='';
  const rows=value.rows.map((row:unknown)=>{
    check(exact(row,['receivableId','invoiceId','invoiceNumber','customerId','customerName','issuedOn','dueOn','outstandingCents','daysOverdue'])
      &&customerUuid(row.receivableId)&&customerUuid(row.invoiceId)&&customerUuid(row.customerId)
      &&typeof row.invoiceNumber==='string'&&/^[A-Za-z0-9][A-Za-z0-9-]{0,79}-[1-9][0-9]{0,18}$/.test(row.invoiceNumber)
      &&financeAccountReviewReason(row.customerName)&&customerDate(row.issuedOn)&&customerDate(row.dueOn)
      &&row.issuedOn<=date&&row.issuedOn<=row.dueOn&&nonnegative(row.outstandingCents)&&row.outstandingCents!=='0');
    const days=Math.max(0,(Date.parse(date)-Date.parse(row.dueOn))/86400000);
    const order=row.dueOn+row.receivableId;
    check(row.daysOverdue===days&&!invoiceIds.has(row.invoiceId)&&!receivableIds.has(row.receivableId)&&order>previous);
    invoiceIds.add(row.invoiceId);
    receivableIds.add(row.receivableId);
    previous=order;
    shown[bucket(days)]+=BigInt(row.outstandingCents);
    return {receivableId:row.receivableId,invoiceId:row.invoiceId,invoiceNumber:row.invoiceNumber,customerId:row.customerId,
      customerName:row.customerName,issuedOn:row.issuedOn,dueOn:row.dueOn,outstandingCents:row.outstandingCents,daysOverdue:days};
  });
  const truncated=itemCount>BigInt(rows.length);
  let total=0n;
  for(const key of receivableAgingBuckets){
    const amount=buckets[key];
    check(nonnegative(amount));
    const cents=BigInt(amount);
    check(truncated?cents>=shown[key]:cents===shown[key]);
    total+=cents;
  }
  check(total===BigInt(value.totalCents)&&(!truncated||total>Object.values(shown).reduce((sum,amount)=>sum+amount,0n)));
  return {throughOn:date,observedAt:value.observedAt,timeZone:value.timeZone,totalCents:value.totalCents,
    itemCount:value.itemCount,buckets:buckets as Record<typeof receivableAgingBuckets[number],string>,rows,truncated};
}
