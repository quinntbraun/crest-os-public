import 'server-only';
import {open} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createSecureContext} from 'node:tls';
import {parseEvidenceJson} from '../security/provider-evidence-json.ts';
import {createAuthenticationRuntime} from './authentication-runtime.ts';
import type {NodeConfiguration} from './node-server.ts';
import compatibility from '../../release/compatibility.json' with {type:'json'};
import {productionOperationCapabilities,validateProductionCapabilities,createProductionCapabilities,productionReleaseAccepted,productionPhotoWorkerBaseCapabilities} from '../security/production-capabilities.ts';
import type {ProductionCapability} from '../security/production-capabilities.ts';
import {financeRuntimeFeatures,validateFinanceRuntimeConnection,validateFinanceRuntimeDependencies} from '../bookkeeping/finance-runtime-configuration.ts';
import type {ProductionFinanceConfiguration} from '../bookkeeping/finance-runtime-configuration.ts';
import {parseRenderIngressConfiguration,createRenderIngress} from '../security/render-ingress.ts';
import type {RenderIngressConfiguration} from '../security/render-ingress.ts';
import type {IngressConfiguration} from '../security/trusted-transport.ts';
import {parseProductionReceiptConfiguration,openProductionReceiptRuntime} from './production-receipt-configuration.ts';
import type {ProductionReceiptConfiguration} from './production-receipt-configuration.ts';
import {parseProductionPhotoConfiguration,openProductionPhotoRuntime} from './production-photo-configuration.ts';
import type {ProductionPhotoConfiguration} from './production-photo-configuration.ts';
import {parseProductionSupplierConfiguration,openProductionSupplierRuntime} from './production-supplier-configuration.ts';
import type {ProductionSupplierConfiguration} from './production-supplier-configuration.ts';
import {parseProductionCalendarConfiguration,validateCalendarRuntimeConnection} from './production-calendar-configuration.ts';
import type {ProductionGoogleCalendarConfiguration} from './production-calendar-configuration.ts';
import {parseProductionFinanceExportConfiguration,validateFinanceExportConnection} from './production-finance-export-configuration.ts';
import type {ProductionFinanceExportConfiguration} from './production-finance-export-configuration.ts';
import {parseProductionSourceExportConfiguration} from './production-source-export-configuration.ts';
import type {ProductionSourceExportConfiguration} from './production-source-export-configuration.ts';
import {openProductionSourceExportRuntime} from './production-source-export-runtime.ts';
import type {ProductionSourceExportRuntime} from './production-source-export-runtime.ts';
export {productionReleaseAccepted} from '../security/production-capabilities.ts';

type ObjectValue=Record<string,unknown>;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export class ProductionConfigurationError extends Error{
 constructor(){super('PRODUCTION_CONFIGURATION_REQUIRED');this.name='ProductionConfigurationError';}
}
function require(value:unknown):asserts value{if(!value)throw new ProductionConfigurationError();}
function exact(value:unknown,fields:readonly string[]):asserts value is ObjectValue{
 require(value!==null&&typeof value==='object'&&!Array.isArray(value));
 require(Object.keys(value).length===fields.length&&fields.every(field=>Object.hasOwn(value,field)));
}
function text(value:unknown,maximum=4096):value is string{return typeof value==='string'&&value.length>0&&value.length<=maximum&&!Array.from(value).some(character=>character.charCodeAt(0)<32||character.charCodeAt(0)===127);}
function file(value:unknown):asserts value is string{require(text(value)&&isAbsolute(value));}
function key(value:unknown):Buffer{
 require(typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value));
 const bytes=Buffer.from(value,'base64url');require(bytes.length===32&&bytes.toString('base64url')===value);return bytes;
}

// This is an operator-owned secret profile, never a browser body or an env flag
// that enables construction-only workflows. Unsupported capabilities fail closed.
export function parseProductionProfile(source:string){
 try{
  require(Buffer.byteLength(source,'utf8')<=65536);
  const value=parseEvidenceJson(source);
  const hasExports=value!==null&&typeof value==='object'&&Object.hasOwn(value,'exports');
  const hasFinanceExports=value!==null&&typeof value==='object'&&Object.hasOwn(value,'financeExports');
  const hasFinance=value!==null&&typeof value==='object'&&Object.hasOwn(value,'finance');
  const hasReceipts=value!==null&&typeof value==='object'&&Object.hasOwn(value,'receipts');
  const hasPhotos=value!==null&&typeof value==='object'&&Object.hasOwn(value,'photos');
  const hasSupplierOriginals=value!==null&&typeof value==='object'&&Object.hasOwn(value,'supplierOriginals');
  const hasCalendar=value!==null&&typeof value==='object'&&Object.hasOwn(value,'calendar');
  const hasIngress=value!==null&&typeof value==='object'&&Object.hasOwn(value,'ingress');
  exact(value,['schemaVersion','origin','listen','businessId','authentication',hasIngress?'ingress':'tls','capabilities',...hasFinance?['finance']:[],...hasFinanceExports?['financeExports']:[],...hasExports?['exports']:[],...hasReceipts?['receipts']:[],...hasPhotos?['photos']:[],...hasSupplierOriginals?['supplierOriginals']:[],...hasCalendar?['calendar']:[]]);
  require(value.schemaVersion===1&&text(value.origin,2048)&&typeof value.businessId==='string'&&uuid.test(value.businessId));
  const origin=new URL(value.origin);
  require(origin.origin===value.origin&&origin.protocol==='https:'&&!origin.username&&!origin.password);
  exact(value.listen,['address','port']);
  require(['127.0.0.1','0.0.0.0','::1','::'].includes(value.listen.address as string)&&Number.isSafeInteger(value.listen.port)&&Number(value.listen.port)>0&&Number(value.listen.port)<=65535);
  let tls:Profile['tls'],ingress:RenderIngressConfiguration|undefined;
  if(hasIngress){ingress=parseRenderIngressConfiguration(value.ingress);require(value.listen.address==='0.0.0.0');}
  else{exact(value.tls,['keyFile','certFile']);file(value.tls.keyFile);file(value.tls.certFile);tls={keyFile:value.tls.keyFile,certFile:value.tls.certFile};}
  const auth=value.authentication;
  exact(auth,['databaseUrl','issuer','publicKey','owner','loginKey','activeKeyId','tokenKeys']);
  require(text(auth.databaseUrl)&&text(auth.issuer,2048)&&text(auth.publicKey,400));
  const database=new URL(auth.databaseUrl),issuer=new URL(auth.issuer);
  require(['postgres:','postgresql:'].includes(database.protocol)&&database.username&&database.password&&database.pathname.length>1&&!database.search&&!database.hash);
  require(issuer.protocol==='https:'&&!issuer.port&&!issuer.username&&!issuer.password&&!issuer.search&&!issuer.hash&&issuer.pathname==='/auth/v1'&&issuer.toString()===auth.issuer);
  require(/^sb_publishable_[A-Za-z0-9_-]{16,300}$/.test(auth.publicKey));
  exact(auth.owner,['subject','factorId']);
  require(typeof auth.owner.subject==='string'&&uuid.test(auth.owner.subject)&&typeof auth.owner.factorId==='string'&&uuid.test(auth.owner.factorId));
  require(typeof auth.activeKeyId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(auth.activeKeyId));
  require(Array.isArray(auth.tokenKeys)&&auth.tokenKeys.length>0&&auth.tokenKeys.length<=8);
  const keys=auth.tokenKeys.map(item=>{exact(item,['id','key']);require(typeof item.id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(item.id));return {id:item.id,key:key(item.key)};});
  require(new Set(keys.map(item=>item.id)).size===keys.length&&keys.some(item=>item.id===auth.activeKeyId));
  const loginKey=key(auth.loginKey);require(keys.every(item=>!item.key.equals(loginKey)));
  const enabled=validateProductionCapabilities(value.capabilities);
  require(enabled.includes('googleCalendar')===hasCalendar);
  const calendar=hasCalendar?parseProductionCalendarConfiguration(value.calendar,value.origin):undefined;
  if(calendar){validateCalendarRuntimeConnection(auth.databaseUrl,calendar.connectionString);require(!Buffer.from(calendar.calendarKeyMaterial).equals(loginKey)&&keys.every(item=>!Buffer.from(calendar.calendarKeyMaterial).equals(item.key)));}
  require(enabled.includes('expenseReceipts')===hasReceipts);
  const receipts=hasReceipts?parseProductionReceiptConfiguration(value.receipts):undefined;
  require(enabled.includes('dropoffPhotos')===hasPhotos);
  const photos=hasPhotos?parseProductionPhotoConfiguration(value.photos):undefined;
  require(enabled.includes('supplierOriginals')===hasSupplierOriginals);
  const supplierOriginals=hasSupplierOriginals?parseProductionSupplierConfiguration(value.supplierOriginals):undefined;
  let finance:ProductionFinanceConfiguration|undefined;
  require(enabled.includes('finance')===hasFinance);
  if(hasFinance){
   exact(value.finance,['connectionString','features']);require(text(value.finance.connectionString));
   validateFinanceRuntimeConnection(auth.databaseUrl,value.finance.connectionString);
   const features=financeRuntimeFeatures(value.finance.features);validateFinanceRuntimeDependencies(features,capability=>enabled.includes(capability));
   finance=Object.freeze({connectionString:value.finance.connectionString,features});
  }
  require(enabled.includes('financeExports')===hasFinanceExports);
  const financeExports=hasFinanceExports?parseProductionFinanceExportConfiguration(value.financeExports):undefined;
  if(financeExports){require(finance);validateFinanceExportConnection(auth.databaseUrl,financeExports,finance.connectionString);}
  require(enabled.includes('businessExports')===hasExports);
  const exports=hasExports?parseProductionSourceExportConfiguration(value.exports):undefined;
  if(exports){validateFinanceExportConnection(auth.databaseUrl,{connectionString:exports.connectionString},finance?.connectionString);for(const entry of exports.keys){const bytes=Buffer.from(entry.key,'base64url');require(!bytes.equals(loginKey)&&keys.every(key=>!bytes.equals(key.key))&&(!calendar||!bytes.equals(Buffer.from(calendar.calendarKeyMaterial))));}}
  if(supplierOriginals)require(finance?.features.supplierPayableReview===true);
  return new ProductionProfile({origin:value.origin,listen:{address:value.listen.address as string,port:value.listen.port as number},businessId:value.businessId,
   ...tls?{tls}:{},...ingress?{ingress}:{},databaseUrl:auth.databaseUrl,issuer:auth.issuer,publicKey:auth.publicKey,
   owner:{subject:auth.owner.subject,factorId:auth.owner.factorId},loginKey,activeKeyId:auth.activeKeyId,keys,capabilities:[...enabled],...finance?{finance}:{},...financeExports?{financeExports}:{},...exports?{exports}:{},...receipts?{receipts}:{},...photos?{photos}:{},...supplierOriginals?{supplierOriginals}:{},...calendar?{calendar}:{}});
 }catch{throw new ProductionConfigurationError();}
}
type Profile={origin:string;listen:{address:string;port:number};businessId:string;tls?:{keyFile:string;certFile:string};ingress?:RenderIngressConfiguration;databaseUrl:string;issuer:string;publicKey:string;
 owner:{subject:string;factorId:string};loginKey:Buffer;activeKeyId:string;keys:{id:string;key:Buffer}[];capabilities:ProductionCapability[];finance?:ProductionFinanceConfiguration;financeExports?:ProductionFinanceExportConfiguration;exports?:ProductionSourceExportConfiguration;receipts?:ProductionReceiptConfiguration;photos?:ProductionPhotoConfiguration;supplierOriginals?:ProductionSupplierConfiguration;calendar?:ProductionGoogleCalendarConfiguration};
class ProductionProfile{
 #value:Profile;
 constructor(value:Profile){this.#value=value;Object.freeze(this);}
 toJSON():never{throw new ProductionConfigurationError();}
 async forReceiptWorker(){return this.forIsolatedFileWorker('receipt');}
 async forPhotoWorker(){return this.forIsolatedFileWorker('custody-photo');}
 async forSupplierWorker(){return this.forIsolatedFileWorker('supplier-original');}
 private async forIsolatedFileWorker(kind:'receipt'|'custody-photo'|'supplier-original'){
  try{
   require(productionReleaseAccepted(compatibility));const value=this.#value;
   const required=kind==='receipt'?['customers','operationResolution','expenses']:kind==='custody-photo'?productionPhotoWorkerBaseCapabilities:['operationResolution'];
   require(!value.ingress&&!value.finance&&!value.financeExports&&!value.exports&&!value.receipts&&!value.photos&&!value.supplierOriginals&&!value.calendar&&value.tls&&value.capabilities.length===required.length&&required.every(name=>value.capabilities.some(capability=>capability===name)));
   const [key,cert]=await Promise.all([readConfigurationFile(value.tls.keyFile,65536,true),readConfigurationFile(value.tls.certFile,65536,false)]);
   createSecureContext({key,cert,minVersion:'TLSv1.2'});
   const auth=(await createAuthenticationRuntime({database:{environment:'production',connectionString:value.databaseUrl},provider:{environment:'production',issuer:value.issuer,publicKey:value.publicKey},
    owner:value.owner,loginKey:value.loginKey,activeKeyId:value.activeKeyId,keys:value.keys,ingress:{kind:'direct'}})).forServer();
   const workerCapabilities=[...value.capabilities,...kind==='receipt'?['expenseReceipts']:kind==='custody-photo'?['dropoffPhotos']:['finance','supplierOriginals']];
   return {configuration:{...auth.configuration,environment:'production' as const,businessId:value.businessId,productionCapabilities:createProductionCapabilities(compatibility,value.businessId,workerCapabilities)},
    provider:auth.provider,tokens:auth.tokens,tls:{key,cert},origin:value.origin,listen:{...value.listen}};
  }catch{throw new ProductionConfigurationError();}
 }
 async forServer(){
  let exports:ProductionSourceExportRuntime|undefined;
  let receipts:Awaited<ReturnType<typeof openProductionReceiptRuntime>>|undefined;
  let photos:Awaited<ReturnType<typeof openProductionPhotoRuntime>>|undefined;
  let supplierOriginals:Awaited<ReturnType<typeof openProductionSupplierRuntime>>|undefined;
  try{
   require(productionReleaseAccepted(compatibility));
   const value=this.#value;
   let tls:NodeConfiguration['tls'],ingress:IngressConfiguration={kind:'direct'};
   if(value.ingress){
    ingress=createRenderIngress(value.ingress);
    require(process.env.PORT!==undefined&&/^[1-9]\d{0,4}$/.test(process.env.PORT)&&Number(process.env.PORT)===value.listen.port&&process.env.CREST_HEALTH_ORIGIN===undefined);
   }else{
    require(value.tls);
    const [key,cert]=await Promise.all([readConfigurationFile(value.tls.keyFile,65536,true),readConfigurationFile(value.tls.certFile,65536,false)]);
    createSecureContext({key,cert,minVersion:'TLSv1.2'});tls={key,cert};
   }
   const authentication=await createAuthenticationRuntime({database:{environment:'production',connectionString:value.databaseUrl},provider:{environment:'production',issuer:value.issuer,publicKey:value.publicKey},
    owner:value.owner,loginKey:value.loginKey,activeKeyId:value.activeKeyId,keys:value.keys,ingress});
   const configuration:NodeConfiguration={origin:value.origin,environment:'production',...tls?{tls}:{},authentication:authentication.forServer(),business:{businessId:value.businessId}};
   for(const capability of value.capabilities)if(!productionOperationCapabilities.some(item=>item===capability))Object.assign(configuration,{[capability]:true});
   if(value.capabilities.some(capability=>productionOperationCapabilities.some(item=>item===capability)))Object.assign(configuration,{productionCapabilities:createProductionCapabilities(compatibility,value.businessId,value.capabilities)});
   if(value.finance)Object.assign(configuration,{productionFinance:value.finance});
   if(value.financeExports)Object.assign(configuration,{productionFinanceExports:value.financeExports});
   if(value.calendar)Object.assign(configuration,{productionGoogleCalendar:value.calendar});
   if(value.receipts){receipts=await openProductionReceiptRuntime(value.receipts,value.businessId,readConfigurationFile);Object.assign(configuration,{productionExpenseReceipts:receipts});}
   if(value.photos){photos=await openProductionPhotoRuntime(value.photos,value.businessId,readConfigurationFile);Object.assign(configuration,{productionDropoffPhotos:photos});}
   if(value.supplierOriginals){supplierOriginals=await openProductionSupplierRuntime(value.supplierOriginals,value.businessId,readConfigurationFile);Object.assign(configuration,{productionSupplierOriginals:supplierOriginals});}
   if(value.exports){require(configuration.authentication&&configuration.productionCapabilities);exports=await openProductionSourceExportRuntime(value.exports,value.businessId,configuration.authentication,configuration.productionCapabilities,value.finance?.connectionString);Object.assign(configuration,{productionSourceExports:exports});}
   return {configuration,listen:{...value.listen}};
  }catch{await exports?.close();receipts?.close();photos?.close();supplierOriginals?.close();throw new ProductionConfigurationError();}
 }
}
export async function readConfigurationFile(path:string,limit:number,privateFile:boolean){
 file(path);const handle=await open(path,'r');
 try{
  const stat=await handle.stat();require(stat.isFile()&&stat.size>0&&stat.size<=limit);
  if(privateFile&&process.platform!=='win32')require((stat.mode&0o077)===0);
  const bytes=Buffer.alloc(limit+1);let length=0;
  for(;;){const result=await handle.read(bytes,length,bytes.length-length,null);length+=result.bytesRead;if(result.bytesRead===0)break;require(length<=limit);}
  require(length>0&&length<=limit);return bytes.subarray(0,length);
 }finally{await handle.close();}
}
export async function readProductionProfile(path:string){
 try{
  const bytes=await readConfigurationFile(path,65536,true);
  return parseProductionProfile(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));
 }catch{throw new ProductionConfigurationError();}
}
