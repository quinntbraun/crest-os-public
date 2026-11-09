import {describe,it,expect} from 'vitest';import {mileageShareFraction,mileageSharePercent,prepareMileageBody} from '../../src/operations/mileage.ts';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const base=()=>({source:'manual_actual',movementKind:'business_rig',actualMiles:'26',estimateMiles:'',estimateSource:'',odometerStart:'',odometerEnd:'',notes:'',reason:'',allocationState:'unallocated',allocations:[] as unknown[]});
describe('exact mileage evidence',()=>{
 it('round-trips the smallest positive and other exact job shares without rounding',()=>{
  for(const [percent,fraction]of [['0.000001','0.00000001'],['33.333333','0.33333333'],['100','1.00000000']]){
   expect(mileageShareFraction(percent!)).toBe(fraction);
   expect(mileageSharePercent(fraction!)).toBe(percent);
  }
  for(const invalid of ['','0','0.0000001','100.000001','-1','1e-6','12,5'])expect(()=>mileageShareFraction(invalid)).toThrow();
 });
 it('retains physical actual miles once and blank optional fields as absent',()=>{const r=prepareMileageBody(base());expect(r.actualMiles).toBe('26.0000');expect(r.estimateMiles).toBeNull();expect(r.notes).toBeNull();expect(r.allocations).toEqual([]);expect(Object.isFrozen(r)).toBe(true);expect(Object.keys(r).some(k=>/tax|deduct|expense|post/i.test(k))).toBe(false);});
 it('derives odometer mileage without floating point',()=>expect(prepareMileageBody({...base(),source:'odometer',actualMiles:'',odometerStart:'9999999999.9998',odometerEnd:'9999999999.9999'}).actualMiles).toBe('0.0001'));
 it('keeps zero actual mileage distinct from unresolved distance',()=>expect(prepareMileageBody({...base(),actualMiles:'0'}).actualMiles).toBe('0.0000'));
 it('never turns a route estimate into actual or odometer evidence',()=>{const r=prepareMileageBody({...base(),source:'route_estimate',actualMiles:'',estimateMiles:'26.5',estimateSource:'Owner-entered route estimate'});expect(r.actualMiles).toBeNull();expect(r.estimateMiles).toBe('26.5000');expect(()=>prepareMileageBody({...base(),source:'route_estimate',estimateMiles:'26',estimateSource:'Estimate'})).toThrow();});
 it('preserves actual and separately sourced estimate together',()=>{const r=prepareMileageBody({...base(),estimateMiles:'25.25',estimateSource:'Reviewed route estimate'});expect(r.actualMiles).toBe('26.0000');expect(r.estimateMiles).toBe('25.2500');});
 it('refuses negative, exponent, floating number, overprecision and oversized miles',()=>{for(const actualMiles of ['-1','1e2',1,'0.00001','10000000000','01','NaN'])expect(()=>prepareMileageBody({...base(),actualMiles})).toThrow();});
 it('refuses reversed/partial odometers and contradictory actual distance',()=>{for(const patch of [{odometerStart:'10'},{source:'odometer',odometerStart:'10',odometerEnd:'9'},{source:'odometer',odometerStart:'10',odometerEnd:'12',actualMiles:'1'}])expect(()=>prepareMileageBody({...base(),...patch})).toThrow();});
 it('requires provenance for an estimate and explicit actual source',()=>{expect(()=>prepareMileageBody({...base(),estimateMiles:'5'})).toThrow();expect(()=>prepareMileageBody({...base(),source:'gps_derived'})).toThrow();});
 it('conserves exact attribution fractions and sorts job identities',()=>{const r=prepareMileageBody({...base(),allocationState:'allocated',allocations:[{jobId:id(2),fraction:'0.66666667'},{jobId:id(1),fraction:'0.33333333'}]});expect(r.allocations.map(a=>a.fraction)).toEqual(['0.33333333','0.66666667']);expect(r.actualMiles).toBe('26.0000');});
 it('allows partial draft attribution but never falsely declares it fully allocated',()=>{expect(prepareMileageBody({...base(),allocationState:'draft',allocations:[{jobId:id(1),fraction:'0.5'}]}).allocationState).toBe('draft');for(const allocations of [[{jobId:id(1),fraction:'0.5'}],[{jobId:id(1),fraction:'0.6'},{jobId:id(2),fraction:'0.6'}],[]])expect(()=>prepareMileageBody({...base(),allocationState:'allocated',allocations})).toThrow();});
 it('refuses duplicate jobs, attribution on unallocated evidence and unsafe object properties',()=>{expect(()=>prepareMileageBody({...base(),allocationState:'draft',allocations:[{jobId:id(1),fraction:'0.5'},{jobId:id(1),fraction:'0.5'}]})).toThrow();expect(()=>prepareMileageBody({...base(),allocations:[{jobId:id(1),fraction:'1'}]})).toThrow();let called=false;const input={...base()};Object.defineProperty(input,'actualMiles',{get(){called=true;return '26';},enumerable:true});expect(()=>prepareMileageBody(input)).toThrow();expect(called).toBe(false);});
 it('keeps unknown movement unclassified and rejects invented automatic classification',()=>{expect(prepareMileageBody({...base(),movementKind:''}).movementKind).toBe('unclassified');expect(()=>prepareMileageBody({...base(),movementKind:'deductible'})).toThrow();});
});
