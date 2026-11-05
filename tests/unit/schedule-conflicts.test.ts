import {describe,it,expect} from 'vitest';
import {compareScheduleReservations} from '../../src/operations/schedule-conflicts.ts';
const business='11111111-1111-4111-8111-111111111111',operator='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333',appointment='44444444-4444-4444-8444-444444444444',other='55555555-5555-4555-8555-555555555555';
const context={businessId:business,operatorId:operator,rescheduledJobId:null};
const proposed=()=>({startAt:'2026-10-30T11:00:00.000000Z',endAt:'2026-10-30T12:00:00.000000Z',travelBeforeSeconds:0,travelAfterSeconds:0});
const current=()=>({...proposed(),startAt:'2026-10-30T10:00:00.000000Z',endAt:'2026-10-30T11:00:00.000000Z',businessId:business,operatorId:operator,appointmentId:appointment,jobId:job});
describe('operator calendar interval and travel comparison',()=>{
 it('uses half-open intervals so an exact shared boundary is not a work conflict',()=>{expect(compareScheduleReservations(context,proposed(),[current()])).toEqual({conflictingAppointmentIds:[],unknownTravel:false});});
 it('includes known travel on either appointment instead of considering only labor time',()=>{
  expect(compareScheduleReservations(context,{...proposed(),travelBeforeSeconds:1},[current()]).conflictingAppointmentIds).toEqual([appointment]);
  expect(compareScheduleReservations(context,proposed(),[{...current(),travelAfterSeconds:1}]).conflictingAppointmentIds).toEqual([appointment]);
 });
 it('detects a one-microsecond overlap that disappears if timestamps round to milliseconds',()=>{expect(compareScheduleReservations(context,{...proposed(),startAt:'2026-10-30T10:59:59.999999Z'},[current()]).conflictingAppointmentIds).toEqual([appointment]);});
 it('keeps unknown travel visible without inventing a known estimate',()=>{expect(compareScheduleReservations(context,{...proposed(),travelBeforeSeconds:null},[current()])).toEqual({conflictingAppointmentIds:[],unknownTravel:true});expect(compareScheduleReservations(context,proposed(),[{...current(),travelAfterSeconds:null}]).unknownTravel).toBe(true);});
 it('excludes the same job only for an explicit reschedule, preserving other current reservations',()=>{
  const self={...current(),startAt:proposed().startAt,endAt:proposed().endAt,travelAfterSeconds:null},another={...self,appointmentId:other,jobId:other};
  expect(compareScheduleReservations({...context,rescheduledJobId:job},proposed(),[self])).toEqual({conflictingAppointmentIds:[],unknownTravel:false});
  expect(compareScheduleReservations({...context,rescheduledJobId:job},proposed(),[self,another]).conflictingAppointmentIds).toEqual([other]);
 });
 it('rejects mixed business/operator scope, duplicated reservation identities and invalid intervals',()=>{
  for(const patch of [{businessId:other},{operatorId:other},{appointmentId:'missing'},{travelBeforeSeconds:-1},{travelAfterSeconds:'0'},{travelBeforeSeconds:2147483648},{endAt:current().startAt},{extra:true}])expect(()=>compareScheduleReservations(context,proposed(),[{...current(),...patch}])).toThrow();
  expect(()=>compareScheduleReservations(context,proposed(),[current(),current()])).toThrow();expect(()=>compareScheduleReservations(context,{...proposed(),travelAfterSeconds:0.5},[])).toThrow();
 });
 it('returns stable sorted conflict identities and never changes supplied reservations',()=>{
  const a={...current(),endAt:'2026-10-30T11:30:00.000000Z'},b={...a,appointmentId:other,jobId:other},before=structuredClone([a,b]);
  const result=compareScheduleReservations(context,proposed(),[b,a]);expect(result.conflictingAppointmentIds).toEqual([appointment,other]);expect([a,b]).toEqual(before);expect(Object.isFrozen(result.conflictingAppointmentIds)).toBe(true);
 });
});
