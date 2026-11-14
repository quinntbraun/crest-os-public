import { customerDate, customerUuid, customerVersion, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { financeAccountReviewReason, requireFinanceAccount as check } from './finance-account-contract.ts';

const labelValid=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/.test(value);
const zoneValid=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=128;

export function parseInvoiceSetupRequest(value:unknown) {
  if(exact(value,['kind','label','reason'])&&value.kind==='invoice_series'){
    check(labelValid(value.label)&&financeAccountReviewReason(value.reason));
    return {kind:'invoice_series' as const,label:value.label,reason:value.reason};
  }
  check(exact(value,['kind','startsOn','reason'])&&value.kind==='accounting_period'
    && customerDate(value.startsOn)&&financeAccountReviewReason(value.reason));
  return {kind:'accounting_period' as const,startsOn:value.startsOn,reason:value.reason};
}

export function parseInvoiceSetupWrite(value:unknown) {
  check(exact(value,['operationId','recoveryEpoch','request'])&&customerUuid(value.operationId)&&customerUuid(value.recoveryEpoch));
  return {operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,request:parseInvoiceSetupRequest(value.request)};
}

function series(value:unknown,withOperation=false) {
  const fields=['id','label','recoveryEpoch','kind'];
  check(exact(value,withOperation?[...fields,'operationId']:fields)&&customerUuid(value.id)&&labelValid(value.label)
    && customerUuid(value.recoveryEpoch)&&(value.kind==='original'||withOperation&&value.kind==='recovery')
    && (!withOperation||customerUuid(value.operationId)));
  return {id:value.id,label:value.label,recoveryEpoch:value.recoveryEpoch,kind:value.kind,operationId:value.operationId};
}

function period(value:unknown,detail:'receipt'|'opening'|'current') {
  const fields=['id','startsOn','throughOn','timeZone','openingBoundary'];
  const extra=detail==='current'?['operationId','state','generation']:detail==='opening'?['operationId']:[];
  check(exact(value,[...fields,...extra])&&customerUuid(value.id)&&customerDate(value.startsOn)&&customerDate(value.throughOn)
    && value.startsOn<=value.throughOn&&zoneValid(value.timeZone)&&typeof value.openingBoundary==='boolean'
    && (detail==='receipt'||customerUuid(value.operationId)));
  const status=detail==='current'?value.state:undefined;
  check(detail!=='current'||(status==='open'||status==='locked')&&customerVersion(value.generation,true));
  return {id:value.id,startsOn:value.startsOn,throughOn:value.throughOn,timeZone:value.timeZone,openingBoundary:value.openingBoundary,
    state:status,operationId:value.operationId};
}

export function parseInvoiceSetupRead(value:unknown,businessId:string,requestedOn:string|null) {
  check(exact(value,['schemaVersion','businessId','today','requestedOn','timeZone','series','openingPeriod','period'])
    && value.schemaVersion===1&&value.businessId===businessId&&customerDate(value.today)&&customerDate(value.requestedOn)
    && value.requestedOn===(requestedOn??value.today)&&zoneValid(value.timeZone));
  return {today:value.today,requestedOn:value.requestedOn,timeZone:value.timeZone,
    series:value.series===null?null:series(value.series,true),
    openingPeriod:value.openingPeriod===null?null:period(value.openingPeriod,'opening'),
    period:value.period===null?null:period(value.period,'current')};
}

export function parseInvoiceSetupResult(value:unknown,businessId:string,write:ReturnType<typeof parseInvoiceSetupWrite>) {
  if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')return {state:'conflict'} as const;
  check(exact(value,['state','receipt'])&&value.state==='committed');
  const {receipt}=value,{request}=write;
  check(exact(receipt,['schemaVersion','businessId','operationId','kind','record','auditEventId','reason'])
    && receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.operationId===write.operationId
    && receipt.kind===request.kind&&receipt.reason===request.reason&&customerUuid(receipt.auditEventId));
  if(request.kind==='invoice_series'){
    const saved=series(receipt.record);
    check(saved.label===request.label&&saved.recoveryEpoch===write.recoveryEpoch);
  }else check(period(receipt.record,'receipt').startsOn===request.startsOn);
  return {state:'committed',receipt} as const;
}
