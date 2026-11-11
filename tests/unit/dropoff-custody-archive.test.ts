import {createHash} from 'node:crypto';
import {strFromU8,unzipSync} from 'fflate';
import {expect,it} from 'vitest';
import {buildDropoffCustodyArchive} from '../../src/operations/dropoff-custody-archive';
import {readSourceExportCsv} from '../../src/security/source-export-csv-reader';

const id=(number:number)=>'00000000-0000-4000-8000-'+String(number).padStart(12,'0');
const scope={businessId:id(1),jobId:id(2),jobVehicleId:id(3),vehicleId:id(4)};
function history(){
 const common={schemaVersion:1,caseId:id(5),jobId:scope.jobId,jobVehicleId:scope.jobVehicleId,vehicleId:scope.vehicleId,
  authorizationConfigId:id(6),location:{schemaVersion:1,kind:'manual',locationText:'Synthetic bay, "A"\nSecond line',instructions:null},
  acknowledgementConfirmed:true,notes:null};
 return {schemaVersion:1,...scope,caseId:id(5),jobState:'completed',state:'released',version:'2',
  policy:{id:id(6),acknowledgementText:' +Synthetic policy, é',conditionPhotoRequired:false},events:[
   {...common,eventId:id(7),version:'1',action:'received',effectiveAt:'2026-11-03T09:45:00.123456Z',
    recordedAt:'2026-11-03T09:45:01.654321Z',person:{schemaVersion:1,displayName:'=Synthetic formula'},
    missingPhotoReason:'\\N'},
   {...common,eventId:id(8),version:'2',action:'released',effectiveAt:'2026-11-03T11:45:00.123456Z',
    recordedAt:'2026-11-03T11:45:01.654321Z',person:{schemaVersion:1,displayName:"'Synthetic customer"},
    notes:'Synthetic comma, newline\nand \\backslash',missingPhotoReason:null,conditionPhotoId:id(9)}
  ]};
}
it('round-trips saved handoffs through an independent CSV reader and verifies every archive hash',async()=>{
 const record=history(),files=unzipSync(await buildDropoffCustodyArchive(record,scope));
 const json=(name:string)=>JSON.parse(strFromU8(files[name]!));
 const manifest=json('manifest.json'),dictionary=json('dictionary.json'),map=json('custody_history_escape_map.json');
 const rows=readSourceExportCsv(strFromU8(files['custody_history.csv']!),map.escapes,{
  columns:dictionary.columns,booleans:dictionary.booleans,maxRows:2
 });
 expect(rows).toHaveLength(2);
 expect(rows[0]).toMatchObject({id:id(7),person_name:'=Synthetic formula',missing_photo_reason:'\\N',notes:null,
  effective_at:'2026-11-03T09:45:00.123456Z',recorded_at:'2026-11-03T09:45:01.654321Z',acknowledgement_confirmed:true});
 expect(rows[1]).toMatchObject({person_name:"'Synthetic customer",condition_photo_id:id(9),missing_photo_reason:null,
  notes:'Synthetic comma, newline\nand \\backslash',condition_photo_required:false});
 expect(rows.every(row=>row.policy_acknowledgement_text===record.policy.acknowledgementText&&row.location_text===record.events[0]!.location.locationText)).toBe(true);
 expect(json('saved_custody_history.json').custody.events).toEqual(record.events);
 expect(manifest).toMatchObject({completeCrestExport:false,completeBackup:false,originalHashInputsIncluded:false,throughVersion:'2'});
 expect(manifest.files.map((file:{name:string})=>file.name).sort()).toEqual(Object.keys(files).filter(name=>name!=='manifest.json').sort());
 for(const file of manifest.files){
  expect(files[file.name]!.byteLength).toBe(file.bytes);
  expect(createHash('sha256').update(files[file.name]!).digest('hex')).toBe(file.sha256);
 }
 expect(Object.keys(files).some(name=>/https:|originals\//.test(name))).toBe(false);
});
it('refuses foreign, incomplete or missing custody records before constructing a download',async()=>{
 await expect(buildDropoffCustodyArchive(history(),{...scope,jobVehicleId:id(20)})).rejects.toThrow();
 await expect(buildDropoffCustodyArchive({...history(),events:history().events.slice(0,1)},scope)).rejects.toThrow();
 await expect(buildDropoffCustodyArchive({state:'absent'},scope)).rejects.toThrow();
});
it('preserves expected vehicles with an empty CSV and complete snapshot metadata',async()=>{
 const record={...history(),version:'0',caseId:null,jobState:'scheduled',state:'expected',events:[]};
 const files=unzipSync(await buildDropoffCustodyArchive(record,scope));
 expect(JSON.parse(strFromU8(files['saved_custody_history.json']!)).custody.state).toBe('expected');
 expect(strFromU8(files['custody_history.csv']!).split('\r\n')).toHaveLength(2);
});
