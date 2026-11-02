import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {bookingContextFixture} from '../fixtures/booking-context.ts';
import {parseBookingWorkspace,parseBookingAgreement,parsePendingChangesPage} from '../../src/operations/booking-context-contract.ts';
it('keeps uninitialized mode settings unpersisted and preserves the configured business timezone',()=>{
 const businessId=randomUUID(),workspace={schemaVersion:1,businessId,operatorId:randomUUID(),timezone:'America/Indiana/Indianapolis',modeVersion:null};expect(parseBookingWorkspace(workspace,businessId)).toEqual(workspace);expect(()=>parseBookingWorkspace({...workspace,timezone:'not/a/timezone'},businessId)).toThrow();expect(()=>parseBookingWorkspace(workspace,randomUUID())).toThrow();
});
it('returns current balanced assignment plans without replacing historical source money and seals nested values',()=>{
 const {q,agreement}=bookingContextFixture(),before=structuredClone(agreement),parsed=parseBookingAgreement(agreement,q.businessId,agreement.familyId);if('state' in parsed)throw Error();expect(parsed.sources[0]!.planSequence).toBe('0');expect(parsed.sources[0]!.parts[0]!.state).toBe('unassigned');expect(parsed.sources[0]!.amountCents).toBe(agreement.sources[0]!.amountCents);agreement.sources[0]!.parts[0]!.scopeDescription='Changed locally';expect(parsed.sources[0]!.parts[0]!.scopeDescription).toBe(before.sources[0]!.parts[0]!.scopeDescription);expect(Object.isFrozen(parsed.sources[0]!.parts)).toBe(true);
});
it.each(['wrong-money','duplicate-source','missing-vehicle','foreign-business','invented-unassigned-plan'] as const)('rejects '+ '%s'+' current assignment context',kind=>{
 const {q,agreement}=bookingContextFixture();if(kind==='wrong-money')agreement.sources[0]!.parts[0]!.amountCents='1';if(kind==='duplicate-source')agreement.sources.push(agreement.sources[0]!);if(kind==='missing-vehicle')agreement.vehicles=[];if(kind==='foreign-business')agreement.businessId=randomUUID();if(kind==='invented-unassigned-plan')Object.assign(agreement.sources[0]!.parts[0]!,{jobId:randomUUID()});expect(()=>parseBookingAgreement(agreement,q.businessId,agreement.familyId)).toThrow();
});
it('keeps a proposal visible outside the confirmed calendar window and fences its exact pending cursor',()=>{
 const {q,pending,head,proposedAt}=bookingContextFixture(),request={businessId:q.businessId,afterCreatedAt:null,afterAppointmentId:null,pageSize:20};const result=parsePendingChangesPage(pending,request);expect(result.items[0]!.head.appointment.start_at).not.toBe(result.items[0]!.head.latestAppointment.start_at);expect(result.items[0]!.head.latestAppointment.start_at.startsWith('2027-02-12')).toBe(true);expect(()=>parsePendingChangesPage(pending,{...request,afterCreatedAt:proposedAt,afterAppointmentId:head.latestAppointment.id})).toThrow();expect(()=>parsePendingChangesPage({...pending,items:[pending.items[0],pending.items[0]]},request)).toThrow();expect(()=>parsePendingChangesPage({...pending,items:[{...pending.items[0],proposedAt:'2026-01-01T00:00:00.000000Z'}]},request)).toThrow();
});
