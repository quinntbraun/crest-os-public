import 'server-only';
export type ProductionFinanceExportConfiguration=Readonly<{connectionString:string}>;
function require(value:unknown):asserts value{if(!value)throw Error('PRODUCTION_FINANCE_EXPORT_CONFIGURATION_REQUIRED');}
export function parseProductionFinanceExportConfiguration(value:unknown):ProductionFinanceExportConfiguration{
 try{
  require(value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&Object.hasOwn(value,'connectionString'));
  const connectionString=(value as Record<string,unknown>).connectionString;
  require(typeof connectionString==='string'&&connectionString.length<=4096&&!/[\p{Cc}\p{Cf}]/u.test(connectionString));const url=new URL(connectionString);
  require(['postgres:','postgresql:'].includes(url.protocol)&&url.hostname&&url.username&&url.password&&url.pathname.length>1&&!url.search&&!url.hash);
  return Object.freeze({connectionString});
 }catch{throw Error('PRODUCTION_FINANCE_EXPORT_CONFIGURATION_REQUIRED');}
}
export function validateFinanceExportConnection(webConnection:string,input:ProductionFinanceExportConfiguration,financeConnection?:string){
 try{
  const {connectionString}=parseProductionFinanceExportConfiguration(input),web=new URL(webConnection),exporter=new URL(connectionString);
  require(['postgres:','postgresql:'].includes(web.protocol)&&web.hostname&&web.username&&web.password&&web.pathname.length>1&&!web.search&&!web.hash);
  require(web.hostname===exporter.hostname&&web.port===exporter.port&&web.pathname===exporter.pathname&&decodeURIComponent(web.username)!==decodeURIComponent(exporter.username));
  if(financeConnection)require(decodeURIComponent(new URL(financeConnection).username)!==decodeURIComponent(exporter.username));
 }catch{throw Error('PRODUCTION_FINANCE_EXPORT_CONFIGURATION_REQUIRED');}
}
