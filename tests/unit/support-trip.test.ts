import {expect,it} from 'vitest';
import {parseSupportTripHistory,parseSupportTripList,parseSupportTripSave,supportTripOriginal} from '../../src/operations/support-trip';

const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const place={schemaVersion:1,kind:'manual',locationText:'Synthetic base',instructions:null};
const route={drivenVehicleId:id(5),jobId:null,purpose:'return_to_base',origin:place,destination:place,notes:null};
const departure='2026-01-10T10:10:00.123456Z',arrival='2026-01-10T10:30:00.123457Z';
const reference={schemaVersion:1,businessId:id(1),operationId:id(2),recoveryEpoch:id(3),legId:id(4)};

it('binds each support action to a private original with exact version and no location fields',()=>{
 const depart=parseSupportTripSave({...reference,expectedLegVersionId:null,body:{action:'depart',reason:null,trip:route}});
 expect(supportTripOriginal(depart)).toEqual({schemaVersion:1,businessId:id(1),commandType:'operations.support_trip.record',
  reference:{operationId:id(2),recoveryEpoch:id(3),legId:id(4),expectedLegVersionId:null,action:'depart'}});
 const correct=parseSupportTripSave({...reference,expectedLegVersionId:id(6),body:{action:'correct',reason:'Reviewed route',
  trip:{...route,departedAt:departure,arrivedAt:arrival,state:'closed'}}});
 expect(correct.body.trip).toMatchObject({departedAt:departure,arrivedAt:arrival});
 expect(supportTripOriginal(correct).commandType).toBe('operations.support_trip.correct');
 expect(()=>parseSupportTripSave({...reference,expectedLegVersionId:null,body:{action:'arrive',reason:null,trip:null}})).toThrow();
 expect(()=>parseSupportTripSave({...reference,expectedLegVersionId:null,body:{action:'depart',reason:null,trip:{...route,purpose:'pickup'}}})).toThrow();
 expect(()=>parseSupportTripSave({...reference,expectedLegVersionId:id(6),body:{action:'correct',reason:'Reviewed',
  trip:{...route,departedAt:arrival,arrivedAt:departure,state:'closed'}}})).toThrow();
 const accessor={...route};
 Object.defineProperty(accessor,'notes',{get(){throw Error('accessor ran');},enumerable:true});
 expect(()=>parseSupportTripSave({...reference,expectedLegVersionId:null,body:{action:'depart',reason:null,trip:accessor}})).toThrow('SUPPORT_TRIP_REVIEW_REQUIRED');
});

it('preserves exact saved travel and refuses mismatched scope, sequence or cursors',()=>{
 const row={...route,legId:id(4),legVersionId:id(6),sequence:'1',departedAt:departure,arrivedAt:arrival,
  state:'closed',reason:'Recorded later',recordedAt:arrival};
 const page={schemaVersion:1,businessId:id(1),active:null,trips:[row],hasMore:false};
 const query={businessId:id(1),after:null,pageSize:10};
 expect(parseSupportTripList(page,query).trips[0]?.departedAt).toBe(departure);
 expect(()=>parseSupportTripList(page,{...query,businessId:id(7)})).toThrow();
 expect(()=>parseSupportTripList(page,{...query,after:{departedAt:departure,legId:id(4)}})).toThrow();
 const history={schemaVersion:1,businessId:id(1),legId:id(4),throughVersion:'1',trips:[row],hasMore:false};
 const request={...query,legId:id(4),afterVersion:'0',throughVersion:'1'};
 expect(parseSupportTripHistory(history,request).trips[0]?.arrivedAt).toBe(arrival);
 expect(()=>parseSupportTripHistory({...history,trips:[{...row,sequence:'2'}]},request)).toThrow();
});
