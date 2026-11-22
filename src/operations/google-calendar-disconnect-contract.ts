import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
export type CalendarConnectionSummary=Readonly<{state:'absent'|'review'}>|Readonly<{state:'active'|'paused'|'disconnected';destinationId:string;generation:string;disconnectId:string|null}>;
export type CalendarDisconnectStatus=Readonly<{state:'delayed';disconnectId:string}>|Readonly<{state:'draining'|'ready_to_revoke'|'revoking'|'disconnected'|'revocation_uncertain';disconnectId:string;drainUntil:string;unresolvedMutations:number;reviewRequired:boolean}>;
export function parseCalendarConnectionSummary(value:unknown):CalendarConnectionSummary{
 if(exact(value,['state'])&&(value.state==='absent'||value.state==='review'))return {state:value.state};
 if(!exact(value,['state','destinationId','generation','disconnectId'])||!['active','paused','disconnected'].includes(value.state as string)||!uuid(value.destinationId)||!version(value.generation)||!(value.disconnectId===null||uuid(value.disconnectId))||value.state==='disconnected'&&value.disconnectId===null)throw Error('GOOGLE_CALENDAR_CONNECTION_UNVERIFIED');
 return {state:value.state as 'active'|'paused'|'disconnected',destinationId:value.destinationId,generation:value.generation,disconnectId:value.disconnectId as string|null};
}
export function parseCalendarDisconnectStatus(value:unknown,disconnectId:string):CalendarDisconnectStatus{
 if(!uuid(disconnectId))throw Error('GOOGLE_CALENDAR_DISCONNECT_UNVERIFIED');
 if(exact(value,['state','disconnectId'])&&value.state==='delayed'&&value.disconnectId===disconnectId)return {state:'delayed',disconnectId};
 if(!exact(value,['state','disconnectId','drainUntil','unresolvedMutations','reviewRequired'])||value.disconnectId!==disconnectId||!['draining','ready_to_revoke','revoking','disconnected','revocation_uncertain'].includes(value.state as string)||typeof value.drainUntil!=='string'||!Number.isFinite(Date.parse(value.drainUntil))||!Number.isSafeInteger(value.unresolvedMutations)||(value.unresolvedMutations as number)<0||typeof value.reviewRequired!=='boolean'||value.reviewRequired!==(value.unresolvedMutations!==0||value.state==='revocation_uncertain'))throw Error('GOOGLE_CALENDAR_DISCONNECT_UNVERIFIED');
 return {state:value.state as 'draining'|'ready_to_revoke'|'revoking'|'disconnected'|'revocation_uncertain',disconnectId,drainUntil:value.drainUntil,unresolvedMutations:value.unresolvedMutations as number,reviewRequired:value.reviewRequired};
}
