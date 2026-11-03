import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {bookingContextFixture} from '../fixtures/booking-context';
import {parseBookingAgreement} from '../../src/operations/booking-context-contract';
import {combineBookingWork,mergeBookingWorkDraft} from '../../src/client/booking-work';
import {initialBookingPayload} from '../../src/client/booking-form';
function fixture(){const raw=bookingContextFixture().agreement,first=parseBookingAgreement(raw,raw.businessId,raw.familyId);if('state'in first)throw Error();const agreementId=randomUUID(),vehicleId=randomUUID(),familyId=randomUUID(),second=parseBookingAgreement({...first,familyId,agreementId,vehicles:[{...first.vehicles[0]!,id:vehicleId,label:'Second fictional vehicle'}],sources:first.sources.map(source=>{const partitionId=randomUUID();return {...source,agreementId,sourceAllocationId:randomUUID(),entitlementId:randomUUID(),entitlementVersionId:randomUUID(),sourcePartitionId:partitionId,vehicleId:source.vehicleId?vehicleId:null,parts:source.parts.map(part=>({...part,partitionId}))};})},first.businessId,familyId);if('state'in second)throw Error();return {first,second,jobId:randomUUID(),operatorId:randomUUID()};}
it('combines accepted sources without changing their price, scope or agreement attribution',()=>{
 const {first,second}=fixture(),before=JSON.stringify([first,second]),work=combineBookingWork([first,second]);expect(work.agreements).toEqual([first,second]);expect(work.sources).toEqual([...first.sources,...second.sources]);expect(work.vehicles).toHaveLength(2);expect(JSON.stringify([first,second])).toBe(before);expect(Object.isFrozen(work.sources)).toBe(true);
});
it('refuses cross-business, wrong-customer, stale-customer, archived and duplicate agreements',()=>{
 const {first,second}=fixture();for(const invalid of [{...second,businessId:randomUUID()},{...second,customer:{...second.customer,id:randomUUID()}},{...second,customer:{...second.customer,version:'2'}},{...second,customer:{...second.customer,archived_at:'2026-11-01T12:00:00.000000Z'}},first])expect(()=>combineBookingWork([first,invalid])).toThrow('BOOKING_WORK_REVIEW_REQUIRED');
});
it('refuses duplicate source/entitlement identities and conflicting vehicle snapshots',()=>{
 const {first,second}=fixture();expect(()=>combineBookingWork([first,{...second,sources:[{...first.sources[0]!,agreementId:second.agreementId}]}])).toThrow();expect(()=>combineBookingWork([first],first.vehicles.map(row=>({...row,version:'2'})))).toThrow('BOOKING_VEHICLE_CHANGED');expect(()=>combineBookingWork([first],[{id:randomUUID(),label:'Archived',version:'1',archivedAt:'2026-11-01T12:00:00.000000Z'}])).toThrow();
});
it('preserves deliberate exclusions, scope divisions and visit details when adding work',()=>{
 const {first,second,jobId,operatorId}=fixture(),previous=combineBookingWork([first]),next=combineBookingWork([first,second]),initial=initialBookingPayload(previous,operatorId,jobId,'UTC'),draft={...initial,vehicles:[],workLocation:{schemaVersion:1 as const,kind:'manual' as const,locationText:'Fictional bay 2',instructions:'Side entrance'},allocationPlans:initial.allocationPlans.map(plan=>({...plan,reason:'Retain explicit allocation'}))},merged=mergeBookingWorkDraft(draft,previous,next,jobId);
 expect(merged.workLocation).toEqual(draft.workLocation);expect(merged.appointment).toEqual(draft.appointment);expect(merged.allocationPlans.slice(0,draft.allocationPlans.length)).toEqual(draft.allocationPlans);expect(merged.vehicles.map(row=>row.vehicleId)).toEqual([second.vehicles[0]!.id]);expect(merged.allocationPlans.filter(plan=>second.sources.some(source=>source.sourceAllocationId===plan.sourceAllocationId))).toHaveLength(second.sources.length);expect(initialBookingPayload(next,operatorId,jobId,'UTC').allocationPlans).toHaveLength(next.sources.length);
});
it('adds blank per-vehicle pickup/return fields without inventing locations or ownership links',()=>{
 const {first,jobId,operatorId}=fixture(),previous=combineBookingWork([first]),extra={id:randomUUID(),version:'1',label:'Fictional extra',archivedAt:null},next=combineBookingWork([first],[extra]),draft={...initialBookingPayload(previous,operatorId,jobId,'UTC'),fulfillmentMode:'pickup_return' as const},merged=mergeBookingWorkDraft(draft,previous,next,jobId),vehicle=merged.vehicles.at(-1)!;
 expect(vehicle).toMatchObject({vehicleId:extra.id,customerVehicleId:null,pickupLocation:{kind:'manual',locationText:'',instructions:null},returnLocation:{kind:'manual',locationText:'',instructions:null}});expect(merged.allocationPlans).toEqual(draft.allocationPlans);
});
it('removes only the departed agreement’s draft selections and preserves extra vehicles',()=>{
 const {first,second,jobId,operatorId}=fixture(),extra={id:randomUUID(),version:'1',label:'Fictional extra',archivedAt:null},previous=combineBookingWork([first,second],[extra]),next=combineBookingWork([first],[extra]),draft=initialBookingPayload(previous,operatorId,jobId,'UTC'),merged=mergeBookingWorkDraft(draft,previous,next,jobId);
 expect(merged.allocationPlans).toEqual(draft.allocationPlans.filter(plan=>first.sources.some(source=>source.sourceAllocationId===plan.sourceAllocationId)));expect(merged.vehicles.map(row=>row.vehicleId)).toEqual([first.vehicles[0]!.id,extra.id]);expect(()=>mergeBookingWorkDraft(draft,previous,{...next,customer:{...next.customer,id:randomUUID()}},jobId)).toThrow();
});
