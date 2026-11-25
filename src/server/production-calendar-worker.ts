import 'server-only';
import compatibility from '../../release/compatibility.json' with {type:'json'};
import {productionReleaseAccepted,productionCalendarWorkerBaseCapabilities,createProductionCapabilities} from '../security/production-capabilities.ts';
import {readConfigurationFile} from './production-configuration.ts';
import {parseEvidenceJson} from '../security/provider-evidence-json.ts';
import {googleCalendarOAuthClient} from '../operations/google-calendar-oauth.ts';
import {prepareProductionGoogleCalendarTick} from '../operations/google-calendar-worker.ts';

function require(value:unknown):asserts value{if(!value)throw Error('PRODUCTION_CALENDAR_WORKER_CONFIGURATION_REQUIRED');}
type Configuration={businessId:string;origin:string;connectionString:string;clientId:string;clientSecret:string;credentialKeyId:string;calendarKeyMaterial:Buffer};
export function parseProductionCalendarWorkerProfile(source:string){
 try{
  require(Buffer.byteLength(source,'utf8')<=65536);const input=parseEvidenceJson(source);require(input!==null&&typeof input==='object'&&!Array.isArray(input));const value=input as Record<string,unknown>;
  const fields=['schemaVersion','businessId','origin','connectionString','clientId','clientSecret','credentialKeyId','calendarKeyMaterial'];
  require(Object.keys(value).length===fields.length&&fields.every(field=>Object.hasOwn(value,field))&&value.schemaVersion===1);
  require(typeof value.businessId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.businessId));
  require(typeof value.origin==='string'&&value.origin.length<=2048);const origin=new URL(value.origin);require(origin.protocol==='https:'&&origin.origin===value.origin&&!origin.username&&!origin.password);
  require(typeof value.clientId==='string');googleCalendarOAuthClient(value.clientId,value.origin+'/api/google-calendar/callback');
  require(typeof value.clientSecret==='string'&&value.clientSecret.length>=16&&value.clientSecret.length<=4096&&!/[\p{Cc}\p{Cf}\s]/u.test(value.clientSecret));
  require(typeof value.credentialKeyId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value.credentialKeyId));
  require(typeof value.calendarKeyMaterial==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value.calendarKeyMaterial));const material=Buffer.from(value.calendarKeyMaterial,'base64url');require(material.length===32&&material.toString('base64url')===value.calendarKeyMaterial);
  require(typeof value.connectionString==='string'&&value.connectionString.length<=4096&&!/\p{Cc}/u.test(value.connectionString));const database=new URL(value.connectionString);
  require(['postgres:','postgresql:'].includes(database.protocol)&&database.hostname&&database.username&&database.password&&database.pathname.length>1&&!database.search&&!database.hash);
  return new CalendarWorkerProfile({businessId:value.businessId,origin:value.origin,connectionString:value.connectionString,clientId:value.clientId,clientSecret:value.clientSecret,credentialKeyId:value.credentialKeyId,calendarKeyMaterial:material});
 }catch{throw Error('PRODUCTION_CALENDAR_WORKER_CONFIGURATION_REQUIRED');}
}
class CalendarWorkerProfile{
 #value:Configuration;
 constructor(value:Configuration){this.#value=value;Object.freeze(this);}
 toJSON():never{throw Error('PRODUCTION_CALENDAR_WORKER_CONFIGURATION_REQUIRED');}
 async open(){
  try{
   require(productionReleaseAccepted(compatibility));const value=this.#value;
   return await prepareProductionGoogleCalendarTick({...value,environment:'production',productionCapabilities:createProductionCapabilities(compatibility,value.businessId,[...productionCalendarWorkerBaseCapabilities,'googleCalendar'])});
  }catch{throw Error('PRODUCTION_CALENDAR_WORKER_CONFIGURATION_REQUIRED');}
 }
}
export async function readProductionCalendarWorkerProfile(path:string){
 try{return parseProductionCalendarWorkerProfile(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await readConfigurationFile(path,65536,true)));}
 catch{throw Error('PRODUCTION_CALENDAR_WORKER_CONFIGURATION_REQUIRED');}
}
