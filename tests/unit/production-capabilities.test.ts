import {randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import compatibility from '../../release/compatibility.json';
import {productionCapabilityNames,validateProductionCapabilities,createProductionCapabilities,productionCapability,productionCapabilitiesBelongTo} from '../../src/security/production-capabilities';

// Prospective metadata exercises composition only. The actual bundled release
// stays blocked; none of these fixtures authenticates a user or opens a runtime.
const prospective={productionActivation:'ready'};
it('refuses composition authority from the actual unaccepted release',()=>{
 expect(()=>createProductionCapabilities(compatibility,randomUUID(),productionCapabilityNames)).toThrow('PRODUCTION_CAPABILITIES_REQUIRED');
});
it('binds explicit capabilities to one business, production mode and a private instance',()=>{
 const businessId=randomUUID(),grant=createProductionCapabilities(prospective,businessId,productionCapabilityNames);
 expect(productionCapabilitiesBelongTo(grant,businessId)).toBe(true);
 expect(productionCapabilitiesBelongTo(grant,randomUUID())).toBe(false);
 for(const capability of productionCapabilityNames)expect(productionCapability({environment:'production',businessId,productionCapabilities:grant},capability)).toBe(true);
 expect(productionCapability({environment:'test',businessId,productionCapabilities:grant},'scheduling')).toBe(false);
 expect(productionCapability({environment:'production',businessId:randomUUID(),productionCapabilities:grant},'scheduling')).toBe(false);
 expect(productionCapabilitiesBelongTo({allows:()=>true,belongsTo:()=>true},businessId)).toBe(false);
 expect(()=>JSON.stringify(grant)).toThrow('PRODUCTION_CAPABILITIES_PRIVATE');expect(Object.keys(grant)).toEqual([]);
});
it('does not confer undeclared capabilities',()=>{
 const businessId=randomUUID(),grant=createProductionCapabilities(prospective,businessId,['customers','catalog']);
 expect(productionCapability({environment:'production',businessId,productionCapabilities:grant},'catalog')).toBe(true);
 expect(productionCapability({environment:'production',businessId,productionCapabilities:grant},'quotes')).toBe(false);
});
it('requires the complete dependency graph and rejects unknown, duplicate and construction flags',()=>{
 expect(validateProductionCapabilities(productionCapabilityNames)).toEqual(productionCapabilityNames);
 for(const missing of ['customers','vehicles','associations','leads','operationResolution','quotes','quoteReview','quoteCommercial','quoteAmendments','scheduling','quoteAmendmentAcceptance','fieldSessions','jobCompletion','jobMileage','workTime','workBoundary','workStart','workEnd','reviewOutcome','dropoffCustody','dropoffPhotos','pickupTrips','pickupCollection','pickupPolicy','pickupPhotos','pickupWork','pickupRelease']){
  expect(()=>validateProductionCapabilities(productionCapabilityNames.filter(value=>value!==missing))).toThrow('PRODUCTION_CAPABILITIES_REQUIRED');
 }
 for(const value of [[],['catalog','catalog'],['syntheticQuotes'],['finance'],['scheduling'],['quoteAmendmentAcceptance']])expect(()=>validateProductionCapabilities(value)).toThrow('PRODUCTION_CAPABILITIES_REQUIRED');
});
it('requires catalog, associations and job history for production customer profiles',()=>{
 for(const missing of ['catalog','associations','recordJobHistory'])expect(()=>validateProductionCapabilities(productionCapabilityNames.filter(value=>value!==missing))).toThrow('PRODUCTION_CAPABILITIES_REQUIRED');
 expect(()=>validateProductionCapabilities(['customers','customerProfiles'])).toThrow('PRODUCTION_CAPABILITIES_REQUIRED');
});
