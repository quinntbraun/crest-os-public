import {customerDate,customerInstant,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {requireFinanceAccount as check} from './finance-account-contract.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';

// One issued invoice, never an inference from an absent positive payment choice.
export function parseInvoiceOutstanding(value:unknown,businessId:string,customerId:string,invoiceId:string){
 check(customerUuid(businessId)&&customerUuid(customerId)&&customerUuid(invoiceId));
 if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
 const metadata=['state','schemaVersion','businessId','customerId','invoiceId','invoiceNumber','currency',
  'issuedOn','dueOn','throughOn','observedAt','timeZone','originalCents'];
 check(exact(value,metadata)||exact(value,[...metadata,'outstandingCents']));
 const state=value.state;
 check(state==='ready'||state==='not_effective');
 check(exact(value,state==='ready'?[...metadata,'outstandingCents']:metadata));
 check(value.schemaVersion===1&&value.businessId===businessId&&value.customerId===customerId&&value.invoiceId===invoiceId
  &&typeof value.invoiceNumber==='string'&&/^[A-Za-z0-9][A-Za-z0-9-]{0,79}-[1-9][0-9]{0,18}$/.test(value.invoiceNumber)
  &&value.currency==='USD'&&customerDate(value.issuedOn)&&customerDate(value.dueOn)&&value.dueOn>=value.issuedOn
  &&customerDate(value.throughOn)&&customerInstant(value.observedAt)
  &&typeof value.timeZone==='string'&&/^[A-Za-z_0-9+\-/]{1,80}$/.test(value.timeZone)
  &&isFinanceCents(value.originalCents));
 const snapshot={schemaVersion:1 as const,businessId,customerId,invoiceId,invoiceNumber:value.invoiceNumber,currency:'USD' as const,
  issuedOn:value.issuedOn,dueOn:value.dueOn,throughOn:value.throughOn,observedAt:value.observedAt,
  timeZone:value.timeZone,originalCents:value.originalCents};
 if(state==='not_effective'){check(value.issuedOn>value.throughOn);return {state:'not_effective' as const,...snapshot};}
 check(value.issuedOn<=value.throughOn&&isFinanceCents(value.outstandingCents)
  &&BigInt(value.outstandingCents)<=BigInt(value.originalCents));
 return {state:'ready' as const,...snapshot,outstandingCents:value.outstandingCents};
}
