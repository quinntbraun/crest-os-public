import {customerInstant,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {requireBooking as check} from './confirmed-booking-contract.ts';

export type CollectionCursor=Readonly<{afterReceivedAt:string|null;afterCaseId:string|null}>;

const dropoffStates=['awaiting_collection','return_required'] as const;
const pickupStates=['awaiting_return','returning','ready_for_handoff','return_stopped','return_failed'] as const;
type DropoffState=typeof dropoffStates[number];
export type PickupReturnState=typeof pickupStates[number];
export type CustodyQueueState=DropoffState|PickupReturnState;
type CollectionRow<State extends CustodyQueueState>=Readonly<{caseId:string;jobId:string;jobVehicleId:string;receivedAt:string;
 state:State;vehicleLabel:string;customerName:string}>;
export type CollectionPage<State extends CustodyQueueState=DropoffState>=Readonly<{
 schemaVersion:1;businessId:string;hasMore:boolean;rows:readonly CollectionRow<State>[]
}>;
export function parseCollectionCursor(value:unknown):CollectionCursor{
 check(exact(value,['afterReceivedAt','afterCaseId']));
 check(value.afterReceivedAt===null&&value.afterCaseId===null||
  customerInstant(value.afterReceivedAt)&&customerUuid(value.afterCaseId));
 return Object.freeze({afterReceivedAt:value.afterReceivedAt as string|null,afterCaseId:value.afterCaseId as string|null});
}
function label(value:unknown):value is string{
 return typeof value==='string'&&value.trim().length>0&&[...value].length<=200&&
  [...value].every(character=>{const point=character.codePointAt(0)!;return point>=32&&point!==127&&(point<0xd800||point>0xdfff);});
}
function parseQueuePage<State extends CustodyQueueState>(value:unknown,businessId:string,cursor:CollectionCursor,states:readonly State[]):CollectionPage<State>{
 const after=parseCollectionCursor(cursor);
 check(customerUuid(businessId)&&exact(value,['schemaVersion','businessId','hasMore','rows'])&&value.schemaVersion===1&&
  value.businessId===businessId&&typeof value.hasMore==='boolean'&&Array.isArray(value.rows)&&value.rows.length<=25&&
  (!value.hasMore||value.rows.length===25));
 const seen=new Set<string>();
 let lastAt=after.afterReceivedAt,lastId=after.afterCaseId;
 const rows=value.rows.map((row:unknown)=>{
  check(exact(row,['caseId','jobId','jobVehicleId','receivedAt','state','vehicleLabel','customerName'])&&
   customerUuid(row.caseId)&&customerUuid(row.jobId)&&customerUuid(row.jobVehicleId)&&customerInstant(row.receivedAt)&&
   label(row.vehicleLabel)&&label(row.customerName)&&
   !seen.has(row.caseId)&&(lastAt===null||row.receivedAt>lastAt||row.receivedAt===lastAt&&row.caseId>lastId!));
  const state=states.find(candidate=>candidate===row.state);check(state);
  seen.add(row.caseId);lastAt=row.receivedAt;lastId=row.caseId;
  const {caseId,jobId,jobVehicleId,receivedAt,vehicleLabel,customerName}=row;
  return Object.freeze({caseId,jobId,jobVehicleId,receivedAt,state,vehicleLabel,customerName});
 });
 return Object.freeze({schemaVersion:1,businessId,hasMore:value.hasMore,rows:Object.freeze(rows)});
}
export function parseCollectionPage(value:unknown,businessId:string,cursor:CollectionCursor){
 return parseQueuePage(value,businessId,cursor,dropoffStates);
}
export function parsePickupReturnPage(value:unknown,businessId:string,cursor:CollectionCursor){
 return parseQueuePage(value,businessId,cursor,pickupStates);
}
