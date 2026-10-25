// Formatting only. Capture requires a separately authorized, single database
// snapshot; delivery requires private custody. Neither authority is granted here.
import {createHash} from 'node:crypto';
import {customerUuid,requireCustomer as check} from './customer-contract.ts';
import {leadConversionColumns,conversionLinkColumns,parseLeadConversionCollection} from './lead-conversion-record.ts';

type Input=Readonly<{businessId:string;snapshotToken:string;expectedConversionCount:string;expectedLinkCount:string;conversions:readonly unknown[];links:readonly unknown[]}>;
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
function count(v:unknown):v is string{return typeof v==='string'&&/^(0|[1-9][0-9]{0,3})$/.test(v)&&Number(v)<=1000;}
export function formatLeadConversionCsv(input:Input){
 check(customerUuid(input.businessId)&&typeof input.snapshotToken==='string'&&/^[a-f0-9]{64}$/.test(input.snapshotToken)
  &&count(input.expectedConversionCount)&&count(input.expectedLinkCount)&&Array.isArray(input.conversions)&&Array.isArray(input.links)
  &&input.conversions.length===Number(input.expectedConversionCount)&&input.links.length===Number(input.expectedLinkCount));
 const businessId=input.businessId,snapshotToken=input.snapshotToken,collection=parseLeadConversionCollection(input.conversions,input.links,businessId);
 let bytes=0;
 function serialize(entity:string,columns:readonly string[],rows:readonly object[]){
  const escapes:{row_id:string;column:string;apostrophe_prefix:true}[]=[],lines=[columns.map(quote).join(',')];bytes+=Buffer.byteLength(lines[0]!)+2;
  for(const raw of rows){const row=raw as Record<string,unknown>;const cells=columns.map(column=>{
   const original=row[column];check(original!==undefined);if(original===null)return quote('\\N');
   let value=(typeof original==='object'?JSON.stringify(original):String(original)).replaceAll('\\','\\\\');
   if(typeof original==='string'&&(value.startsWith("'")||['=','+','-','@'].includes(value.replace(/^\s+/,'')[0]??''))){value="'"+value;escapes.push({row_id:String(row.id),column,apostrophe_prefix:true});}
   return quote(value);
  });const line=cells.join(',');bytes+=Buffer.byteLength(line)+2;check(bytes<=8*1024*1024);lines.push(line);}
  const csv=lines.join('\r\n')+'\r\n',escapeMap=JSON.stringify({schemaVersion:1,entity,businessId,snapshotToken,escapes})+'\n';
  const dictionary=JSON.stringify({schemaVersion:1,entity,columns,null:'\\N',csv:'UTF-8 RFC4180 CRLF',scalarTypes:{request:'lead_conversions only: complete schema1 JSON command; parse JSON without converting decimal version/coordinate strings to Number',versions:'All *_version and version columns are exact bigint decimal strings',instants:'converted_at/created_at/updated_at are UTC instants with microseconds',identities:'Typed UUID references; CSV does not prove referenced source existence'},decode:'Parse CSV; unescaped \\N is null; remove exactly the apostrophe indicated by this entity escape_map for that row/column; unescape paired backslashes; parse request as JSON. Never infer an escape from appearance.',completeness:'Complete current conversion/link columns in this snapshot only; related source/audit/customer data require their own sources. Not a complete Crest export or backup.'})+'\n';
  return Object.freeze({csv,escapeMap,dictionary});
 }
 const conversions=serialize('lead_conversions',leadConversionColumns,collection.conversions),links=serialize('conversion_links',conversionLinkColumns,collection.links);
 const parts=[...Object.entries(conversions).map(([kind,content])=>({name:'lead_conversions'+(kind==='csv'?'.csv':kind==='escapeMap'?'_escape_map.json':'_dictionary.json'),content})),...Object.entries(links).map(([kind,content])=>({name:'conversion_links'+(kind==='csv'?'.csv':kind==='escapeMap'?'_escape_map.json':'_dictionary.json'),content}))];
 const manifest=JSON.stringify({schemaVersion:1,scope:'lead_conversion',businessId,snapshotToken,conversionCount:input.expectedConversionCount,linkCount:input.expectedLinkCount,completeCrestExport:false,completeBackup:false,parts:parts.map(({name,content})=>({name,bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex')}))})+'\n';
 return Object.freeze({conversions,links,manifest});
}
