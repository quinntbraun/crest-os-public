import {strToU8,zipSync} from 'fflate';
import {parseDropoffCustody} from './dropoff-custody-contract';

const columns=['id','business_id','case_id','job_id','job_vehicle_id','vehicle_id','version','action','effective_at','recorded_at',
 'authorization_config_id','person_name','location_text','location_instructions','notes','missing_photo_reason',
 'acknowledgement_confirmed','condition_photo_id','policy_acknowledgement_text','condition_photo_required'] as const;
const maxBytes=8*1024*1024;
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
function check(value:unknown):asserts value{if(!value)throw Error('CUSTODY_ARCHIVE_REVIEW_REQUIRED');}

export async function buildDropoffCustodyArchive(value:unknown,scope:Parameters<typeof parseDropoffCustody>[1]){
 const custody=parseDropoffCustody(value,scope);
 check(custody.state!=='absent');
 const binding={schemaVersion:1,profile:'crest.dropoff-custody-history.v1',businessId:custody.businessId,
  jobId:custody.jobId,jobVehicleId:custody.jobVehicleId,vehicleId:custody.vehicleId,caseId:custody.caseId,
  throughVersion:custody.version,completeCrestExport:false,completeBackup:false,originalHashInputsIncluded:false,unsavedDraftIncluded:false};
 const escapes:{row_id:string;column:typeof columns[number];apostrophe_prefix:true}[]=[];
 const records=custody.events.map(event=>({
  id:event.eventId,business_id:custody.businessId,case_id:event.caseId,job_id:event.jobId,job_vehicle_id:event.jobVehicleId,
  vehicle_id:event.vehicleId,version:event.version,action:event.action,effective_at:event.effectiveAt,recorded_at:event.recordedAt,
  authorization_config_id:event.authorizationConfigId,person_name:event.person.displayName,location_text:event.location.locationText,
  location_instructions:event.location.instructions,notes:event.notes,missing_photo_reason:event.missingPhotoReason,
  acknowledgement_confirmed:event.acknowledgementConfirmed,condition_photo_id:'conditionPhotoId'in event?event.conditionPhotoId:null,
  policy_acknowledgement_text:custody.policy!.acknowledgementText,condition_photo_required:custody.policy!.conditionPhotoRequired
 }));
 const lines=records.map(row=>columns.map(column=>{
  const original=row[column];
  if(original===null)return quote('\\N');
  let cell=String(original).replaceAll('\\','\\\\');
  if(typeof original==='string'&&(cell.startsWith("'")||/^[=+@-]/.test(cell.trimStart()))){
   cell="'"+cell;escapes.push({row_id:row.id,column,apostrophe_prefix:true});
  }
  return quote(cell);
 }).join(','));
 const parts:Record<string,Uint8Array<ArrayBuffer>>={
  'custody_history.csv':strToU8([columns.map(quote).join(','),...lines].join('\r\n')+'\r\n'),
  'custody_history_escape_map.json':strToU8(JSON.stringify({...binding,escapes})+'\n'),
  'saved_custody_history.json':strToU8(JSON.stringify({...binding,custody})+'\n'),
  'dictionary.json':strToU8(JSON.stringify({...binding,columns,booleans:['acknowledgement_confirmed','condition_photo_required'],
   csv:'UTF-8 RFC4180 CRLF with all cells quoted.',
   decode:'Unescaped \\N is null. Remove one leading apostrophe only from mapped cells, then unescape paired backslashes.',
   coverage:'Saved handoff display history for one booked vehicle through the stated version, including its retained policy and condition-photo IDs.',
   excluded:['photo_bytes','temporary_photo_access_urls','original_operation_payloads_and_receipts','audit_hash_inputs','referenced_customer_vehicle_job_and_configuration_sources']})+'\n')
 };
 check(Object.values(parts).reduce((size,bytes)=>size+bytes.byteLength,0)<=maxBytes);
 const files=await Promise.all(Object.entries(parts).map(async([name,bytes])=>{
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return {name,bytes:bytes.byteLength,sha256:[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')};
 }));
 parts['manifest.json']=strToU8(JSON.stringify({...binding,files})+'\n');
 const archive=zipSync(parts,{level:0});
 check(archive.byteLength<=maxBytes);
 return new Uint8Array(archive);
}
