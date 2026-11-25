import 'server-only';
import {googleCalendarOAuthClient} from '../operations/google-calendar-oauth.ts';
export type ProductionGoogleCalendarConfiguration=Readonly<{connectionString:string;clientId:string;clientSecret:string;verifierKeyId:string;credentialKeyId:string;calendarKeyMaterial:Uint8Array;googleOwner:string}>;
function require(value:unknown):asserts value{if(!value)throw Error('PRODUCTION_CALENDAR_CONFIGURATION_REQUIRED');}
const fields=['connectionString','clientId','clientSecret','verifierKeyId','credentialKeyId','calendarKeyMaterial','googleOwner'];
export function validateProductionCalendarConfiguration(input:ProductionGoogleCalendarConfiguration,origin:string){
 try{
  require(input!==null&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===fields.length&&fields.every(field=>Object.hasOwn(input,field)));
  googleCalendarOAuthClient(input.clientId,origin+'/api/google-calendar/callback');
  require(typeof input.clientSecret==='string'&&input.clientSecret.length>=16&&input.clientSecret.length<=4096&&!/[\p{Cc}\p{Cf}\s]/u.test(input.clientSecret));
  require([input.verifierKeyId,input.credentialKeyId].every(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id))&&input.verifierKeyId!==input.credentialKeyId);
  require(input.calendarKeyMaterial instanceof Uint8Array&&input.calendarKeyMaterial.byteLength===32);
  require(typeof input.googleOwner==='string'&&input.googleOwner.length<=254&&/^[^\s@\p{Cc}\p{Cf}\p{Cs}]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/u.test(input.googleOwner));
  require(typeof input.connectionString==='string'&&input.connectionString.length<=4096&&!/\p{Cc}/u.test(input.connectionString));const connection=new URL(input.connectionString);
  require(['postgres:','postgresql:'].includes(connection.protocol)&&connection.hostname&&connection.username&&connection.password&&connection.pathname.length>1&&!connection.search&&!connection.hash);
  return Object.freeze({...input,calendarKeyMaterial:Buffer.from(input.calendarKeyMaterial)});
 }catch{throw Error('PRODUCTION_CALENDAR_CONFIGURATION_REQUIRED');}
}
export function validateCalendarRuntimeConnection(webConnection:string,calendarConnection:string){
 try{
  const web=new URL(webConnection),calendar=new URL(calendarConnection);
  for(const connection of [web,calendar])require(['postgres:','postgresql:'].includes(connection.protocol)&&connection.hostname&&connection.username&&connection.password&&connection.pathname.length>1&&!connection.search&&!connection.hash);
  require(web.hostname===calendar.hostname&&web.port===calendar.port&&web.pathname===calendar.pathname&&decodeURIComponent(web.username)!==decodeURIComponent(calendar.username));
 }catch{throw Error('PRODUCTION_CALENDAR_CONFIGURATION_REQUIRED');}
}
export function parseProductionCalendarConfiguration(input:unknown,origin:string){
 try{
  require(input!==null&&typeof input==='object'&&!Array.isArray(input));const value=input as Record<string,unknown>;
  require(Object.keys(value).length===fields.length&&fields.every(field=>Object.hasOwn(value,field)));
  require(typeof value.connectionString==='string'&&typeof value.clientId==='string'&&typeof value.clientSecret==='string'&&typeof value.verifierKeyId==='string'&&typeof value.credentialKeyId==='string'&&typeof value.googleOwner==='string');
  require(typeof value.calendarKeyMaterial==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value.calendarKeyMaterial));const key=Buffer.from(value.calendarKeyMaterial,'base64url');require(key.length===32&&key.toString('base64url')===value.calendarKeyMaterial);
  return validateProductionCalendarConfiguration({connectionString:value.connectionString,clientId:value.clientId,clientSecret:value.clientSecret,verifierKeyId:value.verifierKeyId,credentialKeyId:value.credentialKeyId,googleOwner:value.googleOwner,calendarKeyMaterial:key},origin);
 }catch{throw Error('PRODUCTION_CALENDAR_CONFIGURATION_REQUIRED');}
}
