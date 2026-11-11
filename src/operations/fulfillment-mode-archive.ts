import {zipSync,strToU8} from 'fflate';
import {fulfillmentModeColumns,parseFulfillmentModeHistory,parseFulfillmentModeVersion} from './fulfillment-mode-contract';
import {requireBooking as check} from './confirmed-booking-contract';
const limit=8*1024*1024,quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
export async function buildFulfillmentModeArchive(businessId:string,latest:unknown,input:readonly unknown[],
 allowDropoffPolicyRevisions=false):Promise<Uint8Array<ArrayBuffer>>{
 const head=parseFulfillmentModeVersion(latest,businessId);check(BigInt(head.sequence)<=1000n&&BigInt(input.length)===BigInt(head.sequence));
 const versions:ReturnType<typeof parseFulfillmentModeVersion>[]=[];
 for(let index=0;index<input.length;index+=20){const page=parseFulfillmentModeHistory({schemaVersion:1,businessId,currentSequence:head.sequence,versions:input.slice(index,index+20),hasMore:index+20<input.length},businessId,String(index),20);check(!('state'in page));versions.push(...page.versions);}
 check(new Set(versions.map(row=>row.id)).size===versions.length&&new Set(versions.map(row=>row.operation_id)).size===versions.length);
 check(fulfillmentModeColumns.every(key=>versions.at(-1)![key]===head[key]));
 for(let index=1;index<versions.length;index++){
  const a=versions[index-1]!,b=versions[index]!;
  // The authenticated schema68 history can append a policy while retaining
  // the flags. The database verifies the policy and its audit at commit.
  check(a.mobile_enabled!==b.mobile_enabled||a.dropoff_enabled!==b.dropoff_enabled||
   a.pickup_return_enabled!==b.pickup_return_enabled||allowDropoffPolicyRevisions===true&&b.dropoff_enabled);
 }
 const scope={schemaVersion:1,profile:'crest.service-arrangement-history.v1',businessId,throughSequence:head.sequence,latestVersionId:head.id,completeCrestExport:false,completeBackup:false,originalHashInputsIncluded:false,unsavedDraftIncluded:false},parts:Record<string,Uint8Array>={},escapes:{row_id:string;column:string;apostrophe_prefix:true}[]=[];
 let total=0;const add=(name:string,text:string)=>{const bytes=strToU8(text);total+=bytes.length;check(total<=limit);parts[name]=bytes;};
 const lines=[fulfillmentModeColumns.map(quote).join(',')];for(const row of versions)lines.push(fulfillmentModeColumns.map(column=>{const original=row[column];if(original===null)return quote('\\N');let value=String(original).replaceAll('\\','\\\\');if(typeof original==='string'&&(value.startsWith("'")||['=','+','-','@'].includes(value.replace(/^\s+/,'')[0]??''))){value="'"+value;escapes.push({row_id:row.id,column,apostrophe_prefix:true});}return quote(value);}).join(','));
 add('service_arrangements.csv',lines.join('\r\n')+'\r\n');add('escape_map.json',JSON.stringify({...scope,escapes})+'\n');add('saved_history.json',JSON.stringify({...scope,versions})+'\n');
 add('dictionary.json',JSON.stringify({...scope,columns:fulfillmentModeColumns,csv:'UTF-8 RFC4180 CRLF; all cells quoted',null:'Unescaped \\N',decode:'Parse CSV; unescaped \\N is null. Remove exactly one leading apostrophe only for mapped cells, then unescape paired backslashes. IDs, sequences and timestamps remain strings. Boolean text is true/false.',coverage:'Complete immutable service-arrangement display history through the selected sequence only.',excluded:['original_operation_payloads_and_receipts','audit_event_hash_inputs','jobs_and_other_business_records','configuration_credentials','attachments']})+'\n');
 const manifest=[];for(const [name,bytes]of Object.entries(parts)){const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes));manifest.push({name,bytes:bytes.length,sha256:[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')});}add('manifest.json',JSON.stringify({...scope,parts:manifest})+'\n');const archive=zipSync(parts,{level:0});check(archive.length<=limit);return new Uint8Array(archive);
}
