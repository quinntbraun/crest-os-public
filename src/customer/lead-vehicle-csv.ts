// Partial source extraction. The caller owns one authorized repeatable-read
// snapshot. Formatting grants no capture or private-download authority.
import {createHash} from 'node:crypto';
import {customerUuid,requireCustomer} from './customer-contract.ts';
import {leadVehicleColumns,parseLeadVehicle} from './lead-vehicle-contract.ts';
import type {LeadVehicle} from './lead-vehicle-contract.ts';

type Input=Readonly<{businessId:string;snapshotToken:string;expectedRowCount:string;rows:readonly LeadVehicle[]}>;
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
export function formatLeadVehicleCsv(input:Input){
 requireCustomer(customerUuid(input.businessId)&&typeof input.snapshotToken==='string'&&/^[a-f0-9]{64}$/.test(input.snapshotToken)
  &&typeof input.expectedRowCount==='string'&&/^(0|[1-9][0-9]{0,3})$/.test(input.expectedRowCount)&&Number(input.expectedRowCount)<=1000&&Array.isArray(input.rows)&&input.rows.length===Number(input.expectedRowCount));
 const businessId=input.businessId,snapshotToken=input.snapshotToken,rows=Array.from(input.rows,row=>parseLeadVehicle(row,businessId)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 requireCustomer(new Set(rows.map(row=>row.id)).size===rows.length);
 const escapes:{row_id:string;column:string;apostrophe_prefix:true}[]=[],lines=[leadVehicleColumns.map(quote).join(',')];let bytes=Buffer.byteLength(lines[0]!)+2;
 for(const row of rows){
  const cells=leadVehicleColumns.map(column=>{const original=row[column];if(original===null)return quote('\\N');
   let value=(typeof original==='object'?JSON.stringify(original):String(original)).replaceAll('\\','\\\\');
   if(typeof original==='string'&&(value.startsWith("'")||['=','+','-','@'].includes(value.replace(/^\s+/,'')[0]??''))){value="'"+value;escapes.push({row_id:row.id,column,apostrophe_prefix:true});}return quote(value);
  });const line=cells.join(',');bytes+=Buffer.byteLength(line)+2;requireCustomer(bytes<=8*1024*1024);lines.push(line);
 }
 const entity='lead_vehicles',csv=lines.join('\r\n')+'\r\n',escapeMap=JSON.stringify({schemaVersion:1,entity,businessId,snapshotToken,escapes})+'\n';
 const dictionary=JSON.stringify({schemaVersion:1,entity,columns:leadVehicleColumns,null:'\\N',csv:'UTF-8 RFC4180 CRLF',scalarTypes:{reported_vehicle:'versioned original JSON vehicle report; parse after CSV/text decoding',requested_services:'versioned original JSON request; not accepted scope or price',version:'exact bigint decimal string',created_at:'UTC instant with microseconds',updated_at:'UTC instant with microseconds',archived_at:'nullable UTC instant with microseconds'},decode:'Parse CSV; unescaped \\N is null; remove exactly the apostrophe indicated by escape_map for that row/column; unescape paired backslashes. Parse declared JSON columns. Retain versions and UTC instants as strings. Never infer an escape from appearance.',completeness:'Current lead-vehicle source columns only; not a complete Crest export or backup.'})+'\n';
 const manifest=JSON.stringify({schemaVersion:1,scope:'lead_vehicle_intake',businessId,snapshotToken,rowCount:String(rows.length),completeCrestExport:false,completeBackup:false,parts:[[entity+'.csv',csv],[entity+'_escape_map.json',escapeMap],[entity+'_dictionary.json',dictionary]].map(([name,content])=>({name,bytes:Buffer.byteLength(content!),sha256:createHash('sha256').update(content!).digest('hex')}))})+'\n';
 return Object.freeze({csv,escapeMap,dictionary,manifest});
}
