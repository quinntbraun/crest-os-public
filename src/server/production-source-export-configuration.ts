import 'server-only';
import {parseReceiptStorageConfiguration} from './production-receipt-configuration.ts';
import {parseProductionFinanceExportConfiguration} from './production-finance-export-configuration.ts';
import type {R2ObjectConfiguration} from '../files/private-object-store.ts';
export type ProductionSourceExportConfiguration=Readonly<{connectionString:string;storage:R2ObjectConfiguration;activeKeyId:string;keys:readonly Readonly<{id:string;key:string}>[]}>;
function require(value:unknown):asserts value{if(!value)throw Error('PRODUCTION_SOURCE_EXPORT_CONFIGURATION_REQUIRED');}
function exact(value:unknown,fields:readonly string[]):asserts value is Record<string,unknown>{require(value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&fields.every(field=>Object.hasOwn(value,field)));}
export function parseProductionSourceExportConfiguration(input:unknown):ProductionSourceExportConfiguration{
 try{
  exact(input,['connectionString','storage','activeKeyId','keys']);const {connectionString}=parseProductionFinanceExportConfiguration({connectionString:input.connectionString}),storage=parseReceiptStorageConfiguration(input.storage);
  require(typeof input.activeKeyId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(input.activeKeyId)&&Array.isArray(input.keys)&&input.keys.length>=1&&input.keys.length<=8);
  const keys=input.keys.map(key=>{exact(key,['id','key']);require(typeof key.id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(key.id)&&typeof key.key==='string'&&/^[A-Za-z0-9_-]{43}$/.test(key.key));const bytes=Buffer.from(key.key,'base64url');require(bytes.length===32&&bytes.toString('base64url')===key.key);return Object.freeze({id:key.id,key:key.key});});
  require(new Set(keys.map(key=>key.id)).size===keys.length&&new Set(keys.map(key=>key.key)).size===keys.length&&keys.some(key=>key.id===input.activeKeyId));
  return Object.freeze({connectionString,storage,activeKeyId:input.activeKeyId,keys:Object.freeze(keys)});
 }catch{throw Error('PRODUCTION_SOURCE_EXPORT_CONFIGURATION_REQUIRED');}
}
