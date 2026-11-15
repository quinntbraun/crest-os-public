import {createHash} from 'node:crypto';
import {strFromU8,unzipSync} from 'fflate';
import {expect,it} from 'vitest';
import {formatMileageHistoryCsv} from '../../src/operations/mileage-csv';
import {buildMileageHistoryArchive} from '../../src/operations/mileage-history-archive';

const id=(number:number)=>'00000000-0000-4000-8000-'+String(number).padStart(12,'0');
const timestamp='2026-11-09T00:00:00.000000Z';

it('downloads exact mileage history and an independently verifiable, spreadsheet-safe CSV page',async()=>{
 const businessId=id(1),legId=id(2),legVersion=id(3),actor=id(4),operation=id(5);
 const notes='=SUM(1,2)\n\\N,é';
 const evidence={id:id(6),business_id:businessId,leg_id:legId,leg_version_id:legVersion,
  operator_actor_id:actor,sequence:'1',replaces_id:null,source:'manual_actual',movement_kind:'business_rig',
  actual_miles:'14.7500',estimate_miles:null,estimate_source:null,odometer_start:null,odometer_end:null,
  allocation_state:'unallocated',notes,reason:null,confirmed_at:timestamp,confirmed_by:actor,
  created_at:timestamp,created_by:actor,operation_id:operation,origin:'manual'};
 const audit={id:id(7),business_id:businessId,operation_id:operation,actor_id:actor,entity_kind:'mileage_evidence',
  entity_id:legId,entity_version:'1',action:'create',reason:null,delta:{schemaVersion:1,before:null,after:evidence},
  recorded_at:timestamp,origin:'manual'};
 const page={schemaVersion:1,state:'loaded',businessId,legId,afterVersion:'0',throughVersion:'1',
  observedLegVersionId:legVersion,evidence:[evidence],allocations:[],audits:[audit],hasMore:false,nextAfterVersion:null};
 const binding={businessId,legId,afterVersion:'0',throughVersion:'1'};
 const files=unzipSync(await buildMileageHistoryArchive(page,binding));
 const reference=formatMileageHistoryCsv(page,binding);
 expect(strFromU8(files['manifest.json']!)).toBe(reference.manifest);
 expect(Object.keys(files).sort()).toEqual([...Object.keys(reference.files),'manifest.json'].sort());
 for(const [name,content]of Object.entries(reference.files))expect(strFromU8(files[name]!)).toBe(content);
 const manifest=JSON.parse(strFromU8(files['manifest.json']!));
 expect(manifest).toMatchObject({scope:'mileage_history_page',completeCrestExport:false,completeBackup:false});
 for(const part of manifest.parts){
  expect(files[part.name]!.byteLength).toBe(part.bytes);
  expect(createHash('sha256').update(files[part.name]!).digest('hex')).toBe(part.sha256);
 }
 expect(JSON.parse(strFromU8(files['mileage_history.json']!)).evidence[0].notes).toBe(notes);
 expect(strFromU8(files['mileage_evidence.csv']!)).toContain('"\'=SUM(1,2)\n\\\\N,é"');
 expect(JSON.parse(strFromU8(files['mileage_escape_map.json']!)).escapes)
  .toContainEqual({entity:'mileage_evidence',row_id:evidence.id,column:'notes',apostrophe_prefix:true});
 await expect(buildMileageHistoryArchive(page,{...binding,legId:id(8)})).rejects.toThrow();
});
