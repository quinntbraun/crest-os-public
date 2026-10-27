import {configurationFixture} from './business-configuration-fixture.ts';
import {customerFixture} from './customer-fixture.ts';
import {addressFixture} from './customer-address-fixture.ts';
import {vehicleFixture} from './vehicle-fixture.ts';
import {associationFixture} from './vehicle-association-fixture.ts';
import {leadFixture,leadSourceFixture} from './lead-fixture.ts';
import {leadStateEventFixture} from './lead-state-fixture.ts';
import {leadVehicleFixture} from './lead-vehicle-fixture.ts';
import {leadAddressFixture} from './lead-address-fixture.ts';
import {conversionRecordFixture,conversionLinkFixture} from './lead-conversion-record-fixture.ts';
import type {BusinessSourceCapture} from '../../src/security/business-foundation-collector.ts';

// Synthetic complete implemented-source fixture, with independent raw JSON
// page/context construction. This does not attest a database capture.
export const sourceFixtureInventory=[['customers','customer_directory','customers','customers'],['addresses','address_directory','addresses','addresses'],['vehicles','vehicle_directory','vehicles','vehicles'],['associations','vehicle_associations','associations','customer_vehicles'],['leadSources','lead_source_directory','lead_sources','lead_sources'],['leads','lead_directory','leads','leads'],['leadEvents','lead_state_events','events','lead_events'],['leadVehicles','lead_vehicle_intake','leadVehicles','lead_vehicles'],['leadAddresses','lead_address_intake','leadAddresses','lead_addresses'],['conversions','lead_conversion','conversions','lead_conversions'],['links','lead_conversion','links','conversion_links']] as const;
export function businessSourceFixture(){
 const foundation=configurationFixture(),businessId=foundation.expected.businessId,base=conversionRecordFixture(),parent={...base,business_id:businessId,request:{...base.request,businessId}},link=conversionLinkFixture(),addressLink=conversionLinkFixture('address');
 const source=leadSourceFixture({business_id:businessId,referral_customer_id:parent.customer_id});
 const rows:Record<string,Record<string,unknown>[]>={
  customers:[customerFixture({business_id:businessId,id:parent.customer_id,notes:'=Private É 😀\\N\ntext',version:'9007199254740993'})],
  addresses:[addressFixture({business_id:businessId,id:addressLink.address_id!,customer_id:parent.customer_id,latitude:'-89.00000000000000000001',longitude:'180.00000000000000000000'})],
  vehicles:[vehicleFixture({business_id:businessId,id:link.vehicle_id!})],associations:[associationFixture({business_id:businessId,customer_id:parent.customer_id,vehicle_id:link.vehicle_id!})],
  leadSources:[source],leads:[leadFixture({business_id:businessId,id:parent.lead_id,customer_id:parent.customer_id,source_id:source.id,source_snapshot:source,estimated_cents:'9007199254740993'})],
  leadEvents:[leadStateEventFixture({business_id:businessId,lead_id:parent.lead_id})],leadVehicles:[leadVehicleFixture({business_id:businessId,id:link.lead_vehicle_id!,lead_id:parent.lead_id,vehicle_id:link.vehicle_id!})],
  leadAddresses:[leadAddressFixture({business_id:businessId,id:addressLink.lead_address_id!,lead_id:parent.lead_id})],conversions:[parent],links:[{...link,business_id:businessId},{...addressLink,business_id:businessId}]
 };
 const contexts:Record<string,string>={},pages:Record<string,string[]>={};
 function refresh(){
  for(const [i,[name,scope,field]]of sourceFixtureInventory.entries()){
   const snapshotToken=(name==='links'?9:i).toString(16).repeat(64);
   if(name!=='links')contexts[name]=JSON.stringify({schemaVersion:1,scope,businessId,snapshotToken,...(name==='conversions'?{conversionCount:String(rows.conversions!.length),linkCount:String(rows.links!.length)}:{rowCount:String(rows[name]!.length)})});
   const ordered=rows[name]!.slice().sort((a,b)=>(a.id as string)<(b.id as string)?-1:1);pages[name]=[];
   for(let offset=0;offset<=ordered.length;offset+=20){const items=ordered.slice(offset,offset+20);pages[name]!.push(JSON.stringify({schemaVersion:1,businessId,snapshotToken,[field]:items}));if(items.length<20)break;}
  }
 }
 function value(){
  const parts={configuration:foundation.encode(),identity:foundation.identity.encode(),history:foundation.history.encode()};
  const evidenceBytes=[...Object.values(contexts),...Object.values(pages).flat()].reduce((n,text)=>n+Buffer.byteLength(text),0),recordCount=sourceFixtureInventory.reduce((n,[name,,field])=>n+pages[name]!.reduce((total,text)=>total+JSON.parse(text)[field].length,0),0);
  const crm=JSON.stringify({formatVersion:1,generationId:foundation.collection.generationId,businessId,observedAt:foundation.identity.stamp,contexts,pages,evidenceBytes,recordCount,completePortableExport:false,completeBackup:false});
  return Object.freeze({formatVersion:1 as const,generationId:foundation.collection.generationId,businessId,observedAt:foundation.identity.stamp,capture:'single_connection_repeatable_read' as const,...parts,crm,evidenceBytes:evidenceBytes+Object.values(parts).reduce((n,text)=>n+JSON.parse(text).evidenceBytes,0),recordCount:recordCount+Object.values(parts).reduce((n,text)=>n+JSON.parse(text).records.length,0),completePortableExport:false as const,completeBackup:false as const});
 }
 function seal():BusinessSourceCapture{const current=value();return Object.freeze({forServer:()=>current,toJSON:()=>{throw Error('PRIVATE SYNTHETIC CAPTURE');}});}
 refresh();return {foundation,businessId,rows,contexts,pages,refresh,value,seal,expected:{businessId,appReleaseId:'a'.repeat(40),sourceSchemaVersion:42 as const}};
}
