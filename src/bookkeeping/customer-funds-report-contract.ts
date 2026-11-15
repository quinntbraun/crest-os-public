import {customerDate,customerDisplayName,customerInstant,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {requireFinanceAccount as check} from './finance-account-contract.ts';

const nonnegative=(value:unknown):value is string=>typeof value==='string'&&/^(0|[1-9][0-9]{0,29})$/.test(value);
const pageSize=100n;

export function parseCustomerFundsReport(value:unknown,businessId:string,throughOn:string|null){
  check(exact(value,['schemaVersion','businessId','throughOn','observedAt','timeZone','currency','lotCount','totalCents','rows'])
    &&value.schemaVersion===1&&customerUuid(businessId)&&value.businessId===businessId&&value.currency==='USD'
    &&customerDate(value.throughOn)&&(throughOn===null||value.throughOn===throughOn)&&customerInstant(value.observedAt)
    &&typeof value.timeZone==='string'&&/^[A-Za-z_0-9+\-/]{1,80}$/.test(value.timeZone)
    &&nonnegative(value.lotCount)&&nonnegative(value.totalCents)&&Array.isArray(value.rows));
  const date=value.throughOn;
  const count=BigInt(value.lotCount);
  const shown=BigInt(value.rows.length);
  check(shown===(count>pageSize?pageSize:count));
  const lotIds=new Set<string>();
  let previous='';
  let shownCents=0n;
  const rows=value.rows.map((row:unknown)=>{
    check(exact(row,['lotId','originId','customerId','customerName','heldOn','heldCents'])
      &&customerUuid(row.lotId)&&customerUuid(row.originId)&&customerUuid(row.customerId)
      &&customerDisplayName(row.customerName)&&customerDate(row.heldOn)&&row.heldOn<=date
      &&nonnegative(row.heldCents)&&row.heldCents!=='0');
    const order=row.heldOn+row.lotId;
    check(order>previous&&!lotIds.has(row.lotId));
    previous=order;
    lotIds.add(row.lotId);
    shownCents+=BigInt(row.heldCents);
    return {lotId:row.lotId,originId:row.originId,customerId:row.customerId,customerName:row.customerName,
      heldOn:row.heldOn,heldCents:row.heldCents};
  });
  const truncated=count>shown;
  const total=BigInt(value.totalCents);
  check(truncated?total>=shownCents+count-shown:total===shownCents);
  return {throughOn:date,lotCount:value.lotCount,totalCents:value.totalCents,rows,truncated};
}
