// Browser-compatible copy of one saved immutable history prefix, not a business backup.
import {zipSync,strToU8} from 'fflate';
import {holdColumns,parseStoredHold,requireHold as check} from './appointment-hold-contract';
import type {StoredHold} from './appointment-hold-contract';
const quote=(text:string)=>'"'+text.replaceAll('"','""')+'"',limit=8*1024*1024;
export async function buildHoldArchive(input:{head:StoredHold;versions:readonly StoredHold[]}):Promise<Uint8Array<ArrayBuffer>>{
 const head=parseStoredHold(input.head,input.head.business_id);check(BigInt(head.sequence)<=1000n&&Array.isArray(input.versions)&&BigInt(input.versions.length)===BigInt(head.sequence));
 const versions=input.versions.map((value,i)=>{const row=parseStoredHold(value,head.business_id);check(row.hold_id===head.hold_id&&row.sequence===String(i+1)&&row.customer_id===head.customer_id&&row.lead_id===head.lead_id);return row;});
 check(new Set(versions.map(v=>v.id)).size===versions.length&&holdColumns.every(k=>versions.at(-1)![k]===head[k]));for(let i=1;i<versions.length;i++)check(versions[i-1]!.state!=='withdrawn');
 const escapes:{row_id:string;column:string;apostrophe_prefix:true}[]=[],lines=[holdColumns.map(quote).join(',')];let size=lines[0]!.length+2;
 for(const row of versions){const line=holdColumns.map(column=>{const original=row[column];if(original===null)return quote('\\N');let value=String(original).replaceAll('\\','\\\\');if(typeof original==='string'&&(value.startsWith("'")||['=','+','-','@'].includes(value.replace(/^\s+/,'')[0]??''))){value="'"+value;escapes.push({row_id:row.id,column,apostrophe_prefix:true});}return quote(value);}).join(',');size+=strToU8(line).length+2;check(size<=limit);lines.push(line);}
 const scope={schemaVersion:1,profile:'crest.appointment-hold-record.v1',businessId:head.business_id,holdId:head.hold_id,throughSequence:head.sequence,lastVersionId:head.id,completeCrestExport:false,completeBackup:false,referenceClosureComplete:false,unsavedDraftIncluded:false};
 const parts:Record<string,Uint8Array>={
  'appointment_hold_versions.csv':strToU8(lines.join('\r\n')+'\r\n'),
  'appointment_hold_escape_map.json':strToU8(JSON.stringify({...scope,entity:'appointment_hold_versions',escapes})+'\n'),
  'appointment_hold_original.json':strToU8(JSON.stringify({...scope,versions})+'\n'),
  'appointment_hold_dictionary.json':strToU8(JSON.stringify({...scope,columns:holdColumns,csv:'UTF-8 RFC4180 CRLF; every cell quoted',null:'Unescaped \\N',decode:'Parse CSV. Unescaped \\N is null. Remove exactly one leading apostrophe only for cells listed in escape_map, then unescape paired backslashes. Never guess an escape from appearance. Sequence/replaces_sequence remain exact decimal strings; offset_minutes fields are bounded integers.',coverage:'One saved immutable proposal history through the stated sequence. Not a whole-business snapshot or backup.',excluded:['operation_payloads_and_receipts','audit_event_hash_inputs','referenced_customer_or_lead_records','attachments','configuration','credentials']})+'\n')
 };
 check(Object.values(parts).reduce((n,p)=>n+p.length,0)<=limit);
 const manifest=[];for(const [name,bytes] of Object.entries(parts)){const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes));manifest.push({name,bytes:bytes.length,sha256:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')});}
 parts['appointment_hold_manifest.json']=strToU8(JSON.stringify({...scope,parts:manifest})+'\n');const zipped=zipSync(parts,{level:0});check(zipped.length<=limit);return new Uint8Array(zipped);
}
