import {exactCustomerObject as exact,requireCustomer as check,parseCustomer} from './customer-contract.ts';
import {parseVehicle} from './vehicle-contract.ts';
import {parseCustomerAddress} from './customer-address-contract.ts';
import {prepareLeadConversion} from './lead-conversion-contract.ts';
import type {ConversionTarget} from './lead-conversion-contract.ts';

function existing<D>(values:readonly ConversionTarget<D>[]){
 return new Map(values.filter((v):v is Extract<ConversionTarget<D>,{kind:'existing'}>=>v.kind==='existing').map(v=>[v.id,v.expectedVersion]));
}

// Complete private selection review, never a transaction/authorization proof.
// Null/omitted new destinations mean "not selected as existing", not proven
// absence. The command must check collision, RLS, versions, ownership, authority
// and recovery under locks in its own database transaction immediately at save.
export function prepareLeadConversionReview(value:unknown,leadSource:unknown,vehicleSources:readonly unknown[],addressSources:readonly unknown[],destinations:unknown){
 const original=prepareLeadConversion(value,leadSource,vehicleSources,addressSources),command=original.command;
 check(exact(destinations,['customer','vehicles','addresses'])&&Array.isArray(destinations.vehicles)&&Array.isArray(destinations.addresses));
 const customer=command.customer.kind==='existing'?parseCustomer(destinations.customer,command.businessId):null;
 if(command.customer.kind==='existing')check(customer&&customer.id===command.customer.id&&customer.version===command.customer.expectedVersion&&customer.archived_at===null);
 else check(destinations.customer===null);
 const expectedVehicles=existing(command.vehicles.map(v=>v.target)),expectedAddresses=existing(command.addresses.map(a=>a.target));
 check(destinations.vehicles.length===expectedVehicles.size&&destinations.addresses.length===expectedAddresses.size);
 const vehicles=Object.freeze(Array.from(destinations.vehicles,row=>parseVehicle(row,command.businessId))),addresses=Object.freeze(Array.from(destinations.addresses,row=>parseCustomerAddress(row,command.businessId,command.customer.id)));
 check(new Set(vehicles.map(v=>v.id)).size===vehicles.length&&new Set(addresses.map(a=>a.id)).size===addresses.length);
 for(const row of vehicles)check(expectedVehicles.get(row.id)===row.version&&row.archived_at===null);
 for(const row of addresses)check(expectedAddresses.get(row.id)===row.version&&row.archived_at===null);
 return Object.freeze({...original,destinations:Object.freeze({customer,vehicles,addresses})});
}
