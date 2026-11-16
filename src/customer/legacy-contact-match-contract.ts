import {customerUuid,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';

export type LegacyHintKind='phone'|'email'|'vin';
export const legacyMatchBodyLimit=131072;
export const legacyMatchHintLimit=1000;
const invalidHint=/[\p{Cc}\p{Cs}]/u;

export function parseLegacyHintRequest(value:unknown,domain:'customer'|'vehicle'){
 check(exact(value,['kind','hints']));
 const {kind,hints}=value;
 check(domain==='customer'?(kind==='phone'||kind==='email'):kind==='vin');
 check(Array.isArray(hints)&&hints.length>=1&&hints.length<=legacyMatchHintLimit);
 const maxLength=kind==='vin'?128:512;
 check(hints.every(hint=>typeof hint==='string'&&hint.length>0&&[...hint].length<=maxLength&&!invalidHint.test(hint)));
 return Object.freeze({kind:kind as LegacyHintKind,hints:Object.freeze([...hints] as string[])});
}

export function legacyMatchCounts(value:unknown,businessId:string,kind:LegacyHintKind,length:number){
 check(customerUuid(businessId)&&exact(value,['schemaVersion','businessId','kind','counts'])&&
  value.schemaVersion===1&&value.businessId===businessId&&value.kind===kind&&Array.isArray(value.counts)&&
  value.counts.length===length&&value.counts.every(count=>Number.isSafeInteger(count)&&count>=0));
 return Object.freeze([...value.counts] as number[]);
}

export function summarizeLegacyMatches(value:unknown,businessId:string,kind:LegacyHintKind,length:number){
 const fields=kind==='vin'?['vin']:['phone','email'];
 check(exact(value,['schemaVersion','businessId',...fields])&&value.schemaVersion===1&&value.businessId===businessId);
 const rows=value[kind];
 check(Array.isArray(rows)&&rows.length===length&&fields.every(field=>field===kind||
  Array.isArray(value[field])&&value[field].length===0));
 const counts=rows.map(row=>{
  check(exact(row,['count','firstIds'])&&Number.isSafeInteger(row.count)&&Number(row.count)>=0&&
   Array.isArray(row.firstIds)&&row.firstIds.length===Math.min(Number(row.count),5)&&
   row.firstIds.every((id,index,all)=>customerUuid(id)&&(index===0||id>all[index-1])));
  return Number(row.count);
 });
 return Object.freeze({schemaVersion:1,businessId,kind,counts:Object.freeze(counts)});
}
