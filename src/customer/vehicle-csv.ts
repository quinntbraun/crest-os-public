// Isolated server/export tooling. Source rows must be collected in one owned
// read-only repeatable-read transaction; this formatter does not authorize one.
import {createHash} from 'node:crypto';
import {vehicleColumns,parseVehicle} from './vehicle-contract.ts';
import {customerUuid,requireCustomer} from './customer-contract.ts';
import type {Vehicle} from './vehicle-contract.ts';
const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function formatVehicleCsv(input:{businessId:string;snapshotToken:string;expectedRowCount:string;rows:readonly Vehicle[]}){
  requireCustomer(customerUuid(input.businessId)&&typeof input.snapshotToken==='string'&&/^[a-f0-9]{64}$/.test(input.snapshotToken)&&typeof input.expectedRowCount==='string'&&/^(0|[1-9][0-9]{0,3})$/.test(input.expectedRowCount)&&Number(input.expectedRowCount)<=1000&&Array.isArray(input.rows)&&input.rows.length===Number(input.expectedRowCount));
  const businessId=input.businessId,snapshotToken=input.snapshotToken,rows=Array.from(input.rows,r=>parseVehicle(r,businessId)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  requireCustomer(new Set(rows.map(r=>r.id)).size===rows.length);
  const escapes:{row_id:string;column:string;apostrophe_prefix:true}[]=[];
  const lines=[vehicleColumns.map(quote).join(',')];let bytes=Buffer.byteLength(lines[0]!)+2;
  for(const row of rows){
    const cells=vehicleColumns.map(column=>{
      const original=row[column];if(original===null)return quote('\\N');
      let value=String(original).replaceAll('\\','\\\\');
      const trimmed=value.replace(/^\s+/,'');
      if(typeof original==='string'&&(value.startsWith("'")||['=','+','-','@'].includes(trimmed[0]??''))){value="'"+value;escapes.push({row_id:row.id,column,apostrophe_prefix:true});}
      return quote(value);
    });
    const line=cells.join(',');bytes+=Buffer.byteLength(line)+2;requireCustomer(bytes<=8*1024*1024);lines.push(line);
  }
  const csv=lines.join('\r\n')+'\r\n',escapeMap=JSON.stringify({schemaVersion:1,entity:'vehicles',businessId,snapshotToken,escapes})+'\n';
  const dictionary=JSON.stringify({schemaVersion:1,entity:'vehicles',columns:vehicleColumns,null:'\\N',csv:'UTF-8 RFC4180 CRLF',scalarTypes:{version:'exact decimal string',year:'nullable PostgreSQL integer',created_at:'UTC instant with microseconds',updated_at:'UTC instant with microseconds',archived_at:'nullable UTC instant with microseconds'},decode:'Parse CSV; unescaped \\N is null; remove exactly the apostrophe indicated in escape_map for that row/column; unescape paired backslashes. Never guess an escape from appearance.',completeness:'Current vehicle-directory columns only; not a complete Crest export or backup.'})+'\n';
  const manifest=JSON.stringify({schemaVersion:1,scope:'vehicle_directory',businessId,snapshotToken,rowCount:String(rows.length),completeCrestExport:false,completeBackup:false,parts:[['vehicles.csv',csv],['vehicle_escape_map.json',escapeMap],['vehicle_dictionary.json',dictionary]].map(([name,content])=>({name,bytes:Buffer.byteLength(content!),sha256:hash(content!)}))})+'\n';
  return Object.freeze({csv,escapeMap,dictionary,manifest});
}
