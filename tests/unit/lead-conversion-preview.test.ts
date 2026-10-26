import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {prepareLeadConversionReview} from '../../src/customer/lead-conversion-preview';
import {newConversionCustomer,newConversionVehicle,newConversionAddress} from '../../src/customer/lead-conversion-contract';
import {CustomerDataError} from '../../src/customer/customer-contract';
import {customerFixture} from '../support/customer-fixture';
import {vehicleFixture} from '../support/vehicle-fixture';
import {addressFixture} from '../support/customer-address-fixture';
import {leadFixture} from '../support/lead-fixture';
import {leadVehicleFixture} from '../support/lead-vehicle-fixture';
import {leadAddressFixture} from '../support/lead-address-fixture';

function fixture(){
 const customer=customerFixture({id:randomUUID(),version:'9007199254740993',notes:'Existing customer notes retained'}),businessId=customer.business_id,lead=leadFixture({customer_id:customer.id}),leadId=lead.id;
 const vehicles=[0,1].map(()=>leadVehicleFixture({id:randomUUID(),business_id:businessId,lead_id:leadId})),addresses=[0,1].map(()=>leadAddressFixture({id:randomUUID(),business_id:businessId,lead_id:leadId}));
 const directoryVehicles=[0,1].map(()=>vehicleFixture({id:randomUUID(),version:'9007199254740993',notes:'Existing vehicle notes retained'})),directoryAddresses=[0,1].map(()=>addressFixture({id:randomUUID(),customer_id:customer.id,version:'9007199254740993',instructions:'Existing address retained'}));
 const command={schemaVersion:1 as const,businessId,operationId:randomUUID(),recoveryEpoch:randomUUID(),conversionId:randomUUID(),leadId,expectedLeadVersion:lead.version,customer:{kind:'existing' as const,id:customer.id,expectedVersion:customer.version},vehicles:vehicles.map((v,i)=>({linkId:randomUUID(),leadVehicleId:v.id,expectedLeadVehicleVersion:v.version,target:{kind:'existing' as const,id:directoryVehicles[i]!.id,expectedVersion:directoryVehicles[i]!.version}})),addresses:addresses.map((a,i)=>({linkId:randomUUID(),leadAddressId:a.id,expectedLeadAddressVersion:a.version,target:{kind:'existing' as const,id:directoryAddresses[i]!.id,expectedVersion:directoryAddresses[i]!.version}}))};
 return {command,lead,vehicles,addresses,destinations:{customer,vehicles:directoryVehicles,addresses:directoryAddresses}};
}
function review(f:ReturnType<typeof fixture>,destinations:unknown=f.destinations){return prepareLeadConversionReview(f.command,f.lead,f.vehicles,f.addresses,destinations);}
it('reviews explicit existing customer/two-vehicle/two-address choices without overwriting or merging original evidence',()=>{
 const f=fixture(),before=structuredClone(f),result=review(f);expect(result.command).toEqual(f.command);expect(result.destinations).toEqual(f.destinations);expect(f).toEqual(before);expect(result.lead.state).toBe('new');expect(result.destinations.customer!.notes).toBe('Existing customer notes retained');
});
it.each(['missing','otherBusiness','otherId','version','archived','extraField'] as const)('rejects %s customer selection',mode=>{
 const f=fixture(),destinations={...f.destinations};if(mode==='missing')Reflect.set(destinations,'customer',null);if(mode==='otherBusiness')destinations.customer={...destinations.customer,business_id:randomUUID()};if(mode==='otherId')destinations.customer={...destinations.customer,id:randomUUID()};if(mode==='version')destinations.customer={...destinations.customer,version:'2'};if(mode==='archived')destinations.customer={...destinations.customer,archived_at:destinations.customer.updated_at,archived_reason:'Explicit reactivation required'};if(mode==='extraField')Reflect.set(destinations,'authority','owner');expect(()=>review(f,destinations)).toThrow(CustomerDataError);
});
it.each(['missing','extra','duplicate','otherBusiness','otherId','version','archived'] as const)('rejects %s existing vehicle evidence',mode=>{
 const f=fixture(),rows=[...f.destinations.vehicles];if(mode==='missing')rows.pop();if(mode==='extra')rows.push({...rows[0]!,id:randomUUID()});if(mode==='duplicate')rows[1]=rows[0]!;if(mode==='otherBusiness')rows[0]={...rows[0]!,business_id:randomUUID()};if(mode==='otherId')rows[0]={...rows[0]!,id:randomUUID()};if(mode==='version')rows[0]={...rows[0]!,version:'2'};if(mode==='archived')rows[0]={...rows[0]!,archived_at:rows[0]!.updated_at,archived_reason:'Needs review'};expect(()=>review(f,{...f.destinations,vehicles:rows})).toThrow(CustomerDataError);
});
it.each(['missing','extra','duplicate','otherBusiness','otherCustomer','otherId','version','archived'] as const)('rejects %s existing address evidence without moving another customer’s location',mode=>{
 const f=fixture(),rows=[...f.destinations.addresses];if(mode==='missing')rows.pop();if(mode==='extra')rows.push({...rows[0]!,id:randomUUID()});if(mode==='duplicate')rows[1]=rows[0]!;if(mode==='otherBusiness')rows[0]={...rows[0]!,business_id:randomUUID()};if(mode==='otherCustomer')rows[0]={...rows[0]!,customer_id:randomUUID()};if(mode==='otherId')rows[0]={...rows[0]!,id:randomUUID()};if(mode==='version')rows[0]={...rows[0]!,version:'2'};if(mode==='archived')rows[0]={...rows[0]!,archived_at:rows[0]!.updated_at,archived_reason:'Needs review'};expect(()=>review(f,{...f.destinations,addresses:rows})).toThrow(CustomerDataError);
});
it('explicit many-to-one selections use one unchanged existing destination image per identity',()=>{
 const f=fixture(),command={...f.command,vehicles:f.command.vehicles.map(v=>({...v,target:f.command.vehicles[0]!.target})),addresses:f.command.addresses.map(a=>({...a,target:f.command.addresses[0]!.target}))},destinations={...f.destinations,vehicles:[f.destinations.vehicles[0]!],addresses:[f.destinations.addresses[0]!]};const result=prepareLeadConversionReview(command,f.lead,f.vehicles,f.addresses,destinations);expect(result.command.vehicles).toHaveLength(2);expect(result.command.addresses).toHaveLength(2);expect(result.destinations.vehicles).toHaveLength(1);expect(result.destinations.addresses).toHaveLength(1);
});
it('no existing destination image is invented for explicit new records, and absence remains unproven',()=>{
 const f=fixture(),lead={...f.lead,customer_id:null},command={...f.command,customer:{kind:'new' as const,id:randomUUID(),draft:newConversionCustomer(lead,f.command.businessId,{contactPreference:null,outreachOptOut:true,notes:null,customerSince:null})},vehicles:f.vehicles.map(v=>newConversionVehicle(v,f.command.businessId,f.lead.id,randomUUID(),randomUUID(),'other')),addresses:f.addresses.map(a=>newConversionAddress(a,f.command.businessId,f.lead.id,randomUUID(),randomUUID()))},none={customer:null,vehicles:[],addresses:[]};const result=prepareLeadConversionReview(command,lead,f.vehicles,f.addresses,none);expect(result.destinations).toEqual(none);expect(result.command).toEqual(command);expect(()=>prepareLeadConversionReview(command,lead,f.vehicles,f.addresses,f.destinations)).toThrow(CustomerDataError);
});
it('an existing vehicle needs no invented owner/keeper/billing link to be explicitly reviewed as a destination',()=>{
 const f=fixture(),result=review(f);expect(result.destinations.vehicles[0]).toEqual(f.destinations.vehicles[0]);expect(Object.keys(result.destinations)).toEqual(['customer','vehicles','addresses']);expect(Object.keys(result.command)).not.toContain('ownership');expect(Object.keys(result.command)).not.toContain('billingCustomerId');
});
it('copies every retained destination and freezes the review before caller-side selections can change',()=>{
 const f=fixture(),result=review(f);Object.assign(f.destinations.customer,{notes:'Changed outside'});Object.assign(f.destinations.vehicles[0]!,{notes:'Changed outside'});Object.assign(f.destinations.addresses[0]!,{instructions:'Changed outside'});expect(result.destinations.customer!.notes).toBe('Existing customer notes retained');expect(result.destinations.vehicles[0]!.notes).toBe('Existing vehicle notes retained');expect(result.destinations.addresses[0]!.instructions).toBe('Existing address retained');for(const v of [result,result.destinations,result.destinations.customer,result.destinations.vehicles,result.destinations.addresses,...result.destinations.vehicles,...result.destinations.addresses])expect(Object.isFrozen(v)).toBe(true);
});
it('requires exact destination collection keys and complete arrays',()=>{const f=fixture();for(const value of [null,{}, {...f.destinations,vehicles:null},{...f.destinations,addresses:{length:2}}, {...f.destinations,permission:'crm.manage'}])expect(()=>review(f,value)).toThrow(CustomerDataError);});
