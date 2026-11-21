import {customerInstant,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract';
import {parseFinanceAccountHistory,requireFinanceAccount as check} from './finance-account-contract';
import {parseFinanceTaxHistory} from './finance-tax-contract';
import type {FinanceTaxScope} from './finance-tax-contract';
import {parseMoneyChannelHistory} from './finance-money-channel-contract';

export type FinanceHistoryRecording=Readonly<{recordedAt:string;actorId:string}>;
export type FinanceHistoryPage<T extends object>={rows:(T&{recording?:FinanceHistoryRecording})[];hasMore:boolean};

function recordedHistory<T extends object>(value:unknown,legacy:(value:unknown)=>{rows:T[];hasMore:boolean}){
 check(!!value&&typeof value==='object'&&!Array.isArray(value));
 const envelope=value as Record<string,unknown>;
 check(envelope.schemaVersion===2&&Array.isArray(envelope.rows)&&envelope.rows.length<=25);
 const recordings:FinanceHistoryRecording[]=[];
 const rows=envelope.rows.map(row=>{
  check(!!row&&typeof row==='object'&&!Array.isArray(row));
  const {recording,...base}=row as Record<string,unknown>;
  check(exact(recording,['recordedAt','actorId']));
  const {recordedAt,actorId}=recording;check(customerInstant(recordedAt)&&customerUuid(actorId));
  recordings.push(Object.freeze({recordedAt,actorId}));return base;
 });
 const parsed=legacy({...envelope,schemaVersion:1,rows});
 return {...parsed,rows:parsed.rows.map((row,index)=>Object.freeze({...row,recording:recordings[index]!}))};
}

export function parseFinanceAccountHistoryEvidence(value:unknown,businessId:string,accountId:string,afterVersion:string){
 return recordedHistory(value,legacy=>parseFinanceAccountHistory(legacy,businessId,accountId,afterVersion));
}
export function parseMoneyChannelHistoryEvidence(value:unknown,businessId:string,channelId:string,beforeVersion:string|null){
 return recordedHistory(value,legacy=>parseMoneyChannelHistory(legacy,businessId,channelId,beforeVersion));
}
export function parseFinanceTaxHistoryEvidence(value:unknown,businessId:string,scope:FinanceTaxScope,beforeVersion:string|null){
 const result=recordedHistory(value,legacy=>parseFinanceTaxHistory(legacy,businessId,scope,beforeVersion));
 check(result.rows.every(row=>row.recording.actorId===row.reviewedBy));
 return result;
}
