import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {test} from 'vitest';
import {inspectLegacyContactFile,maximumLegacyCsvBytes,maximumLegacyCsvRows,previewLegacyContacts} from '../../src/customer/legacy-contact-import-preview.ts';

const business=randomUUID();
const csv=(text:string)=>Buffer.from(text,'utf8');
const related=(firstCandidates:string[],all:string[],candidateCount=firstCandidates.length)=>({candidateCount,firstCandidates,
 evidenceSha256:createHash('sha256').update(JSON.stringify(all)).digest('hex')});
const mapping={customerSourceId:'Reference',displayName:'Name',phone:'Phone',email:'Email',customerNotes:'Notes',
 vehicleSourceId:'Vehicle ID',vehicleLabel:'Vehicle',vehicleYear:'Year',vehicleVin:'VIN'};

test('explicit mapping retains fictional source identities and flags duplicate contacts and vehicles',async()=>{
 const original=csv('\ufeffReference,Name,Phone,Email,Notes,Vehicle ID,Vehicle,Year,VIN,Balance\r\n'+
  '0008,"Fictional, Avery",(555) 018-2222,Test@Invalid.example,"Line one\r\n""Quoted""",v-004,Family SUV,2024,FAKE-VIN,lenient\r\n'+
  '0009,Fictional Bailey,5550182222,test@invalid.example,,v-007,Fictional pickup,2025,FAKEVIN,1234\r\n'+
  '0010,Fictional Chris,,,Other notes,v-004,Family SUV,2024,FAKE-VIN,0\r\n');
 const contact=randomUUID(),vehicle=randomUUID();
 const known={contacts:[{businessId:business,id:contact,phone:'5550182222',email:'test@invalid.example'}],
  vehicles:[{businessId:business,id:vehicle,vin:'FAKEVIN'}]};
 const result=await previewLegacyContacts(original,mapping,business,known);
 assert.equal(result.sourceSha256,createHash('sha256').update(original).digest('hex'));
 assert.deepEqual(result.unmappedHeaders,['Balance']);
 assert.equal(result.sourceRowCount,3);
 assert.deepEqual(result.issues,[]);
 const first=result.rows[0]!;
 assert.equal(first.row,2);
 assert.equal(first.customerSourceId,'0008');
 assert.equal(first.customer.displayName,'Fictional, Avery');
 assert.equal(first.customer.notes,'Line one\r\n"Quoted"');
 assert.equal(first.customer.email,'Test@Invalid.example');
 assert.equal(first.customer.outreachOptOut,null);
 assert.equal(first.vehicle?.sourceId,'v-004');
 assert.equal(first.vehicle?.draft.year,2024);
 assert.deepEqual(first.duplicateReview.sourceContactPhone,related(['0009'],['0008','0009']));
 assert.deepEqual(first.duplicateReview.sourceContactEmail,related(['0009'],['0008','0009']));
 assert.deepEqual(first.duplicateReview.sourceVehicleVin,related(['v-007'],['v-004','v-007']));
 assert.deepEqual(first.duplicateReview.otherSourceContactsForVehicle,related(['0010'],['0008','0010']));
 assert.deepEqual(first.duplicateReview.existingContactPhone,related([contact],[contact]));
 assert.deepEqual(first.duplicateReview.existingVehicleVin,related([vehicle],[vehicle]));
 const reordered=Object.fromEntries(Object.entries(mapping).reverse());
 assert.equal((await previewLegacyContacts(original,reordered,business,known)).previewSha256,result.previewSha256);
 await assert.rejects(()=>previewLegacyContacts(original,mapping,business,{...known,contacts:[{...known.contacts[0]!,businessId:randomUUID()}]}),
  /LEGACY_IMPORT_BUSINESS_REQUIRED/);
});

test('missing identities, conflicting revisions and unsupported cell values remain visible for review',async()=>{
 const original=csv('Id,Name,Opt out,Vehicle ID,Vehicle,Year\n'+
  '0001,Fictional Alpha,true,V001,Van,2021\n'+
  '0001,Fictional Changed Alpha,true,V001,Changed Van,2021\n'+
  '0002,Fictional Beta,unsubscribe,V002,SUV,2025\n'+
  '0003,Fictional Gamma,false,V003,Truck,21\n'+
  ',Fictional Unknown,,,,\n'+
  '0004,Fictional Delta,false,,Pickup,2024\n'+
  '0005,Fictional Epsilon,false,,,');
 const review=await previewLegacyContacts(original,{customerSourceId:'Id',displayName:'Name',outreachOptOut:'Opt out',
  vehicleSourceId:'Vehicle ID',vehicleLabel:'Vehicle',vehicleYear:'Year'},business);
 assert.equal(review.sourceRowCount,7);
 assert.deepEqual(review.issues,[
  {row:3,reason:'LEGACY_CONTACT_SOURCE_CONFLICT'},
  {row:3,reason:'LEGACY_VEHICLE_SOURCE_CONFLICT'},
  {row:4,reason:'LEGACY_OUTREACH_VALUE_REQUIRED'},
  {row:5,reason:'LEGACY_VEHICLE_YEAR_REQUIRED'},
  {row:6,reason:'LEGACY_SOURCE_ID_REQUIRED'},
  {row:7,reason:'LEGACY_SOURCE_ID_REQUIRED'},
 ]);
 assert.equal(review.rows[0]?.customer.outreachOptOut,true);
 assert.equal(review.rows.at(-1)?.customer.outreachOptOut,false);
 assert.equal(review.rows.at(-1)?.vehicle,null);
});

test('malformed CSV and ambiguous mappings fail before any records are prepared',async()=>{
 const simple={customerSourceId:'Id',displayName:'Name'};
 for(const [input,error] of [
  [csv('Id,Name\n100,"unterminated'),/LEGACY_CSV_QUOTE_REQUIRED/],
  [csv('Id,Name\n001,"closed"suffix'),/LEGACY_CSV_QUOTE_REQUIRED/],
  [csv('Id,Name\n001,wrong,extra'),/LEGACY_CSV_ROW_WIDTH_REQUIRED/],
  [csv('Id,Name,Name\n001,one,two'),/LEGACY_CSV_HEADER_REQUIRED/],
  [Buffer.from([109,255,126]),/LEGACY_CSV_UTF8_REQUIRED/],
  [csv('Id,Name\r001,wrong'),/LEGACY_CSV_LINE_ENDING_REQUIRED/],
 ] as const)await assert.rejects(()=>previewLegacyContacts(input,simple,business),error);
 const source=csv('Id,Name\n001,Fictional contact');
 await assert.rejects(()=>previewLegacyContacts(source,{...simple,phone:'Name'},business),/LEGACY_IMPORT_MAPPING_REQUIRED/);
 await assert.rejects(()=>previewLegacyContacts(source,{...simple,vehicleLabel:'Missing'},business),/LEGACY_IMPORT_MAPPING_REQUIRED/);
});

test('duplicate candidate totals remain exact even when the review shortlist is bounded',async()=>{
 const original=csv('Id,Name,Phone\n'+Array.from({length:10},(_,index)=>
  `id-${index},Fictional contact ${index},555 018-3333`).join('\n'));
 const review=await previewLegacyContacts(original,{customerSourceId:'Id',displayName:'Name',phone:'Phone'},business);
 assert.deepEqual(review.rows[0]?.duplicateReview.sourceContactPhone,
  related(['id-1','id-2','id-3','id-4','id-5'],Array.from({length:10},(_,index)=>`id-${index}`),9));
});

test('accepts the published CSV byte and row boundaries, with explicit overflow errors',()=>{
 const headers='Id,Name,Ignored\n';
 const atByteLimit=Buffer.alloc(maximumLegacyCsvBytes,0x61);
 atByteLimit.write(headers+'1,Fictional,');
 assert.equal(inspectLegacyContactFile(atByteLimit).sourceRowCount,1);
 assert.throws(()=>inspectLegacyContactFile(Buffer.alloc(maximumLegacyCsvBytes+1)),/LEGACY_CSV_SIZE_REQUIRED/);
 const atRowLimit=csv('Id,Name\n'+'1,Fictional\n'.repeat(maximumLegacyCsvRows));
 assert.equal(inspectLegacyContactFile(atRowLimit).sourceRowCount,100000);
 assert.throws(()=>inspectLegacyContactFile(Buffer.concat([atRowLimit,csv('2,Extra')])),/LEGACY_CSV_ROW_LIMIT/);
 const fields=Array.from({length:110},(_,index)=>'Column '+index);
 assert.equal(inspectLegacyContactFile(csv(fields.join(',')+'\n'+fields.join(','))).headers.length,110);
});
