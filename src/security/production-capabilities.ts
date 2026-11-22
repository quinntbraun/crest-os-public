import 'server-only';

export const productionPickupCapabilities=['pickupTrips','pickupCollection','pickupPolicy','pickupPhotos','pickupWork','pickupRelease','pickupReturnFailure'] as const;
export const productionFieldCapabilities=['fieldSessions','jobCompletion','jobMileage','supportTrips','unfulfilledCancellation','workTime','workBoundary','workStart','workEnd','mobileDeparture','reviewOutcome','reviewHistory','maintenanceFollowUp','dropoffCustody','dropoffPolicyRevision','dropoffPhotos',...productionPickupCapabilities] as const;
export const productionPhotoWorkerBaseCapabilities=['customers','vehicles','associations','operationResolution','quotes','quoteReview','quoteCommercial','scheduling','quoteAmendments','quoteAmendmentAcceptance','fieldSessions','dropoffCustody'] as const;
export const productionCalendarWorkerBaseCapabilities=['customers','vehicles','associations','operationResolution','quotes','quoteReview','quoteCommercial','scheduling'] as const;
export const productionOperationCapabilities=['catalog','quotes','quoteReview','quoteCommercial','appointmentHolds','quoteAmendments','quoteAmendmentAcceptance','scheduling','recordJobHistory','customerProfiles','expenses','expenseReceipts','finance','financeExports','businessExports','supplierOriginals','googleCalendar',...productionFieldCapabilities] as const;
export const productionCapabilityNames=['customers','vehicles','associations','leads','leadFollowUps','leadMatchReview','leadConversions','operationResolution',...productionOperationCapabilities] as const;
export type ProductionCapability=typeof productionCapabilityNames[number];
export type ProductionOperationCapability=typeof productionOperationCapabilities[number];
const dependencies:Partial<Record<ProductionCapability,readonly ProductionCapability[]>>={
 associations:['customers','vehicles'],leadFollowUps:['leads'],leadMatchReview:['leads'],leadConversions:['leads','customers','vehicles','associations','operationResolution'],
 quoteReview:['quotes'],quoteCommercial:['quotes','quoteReview','operationResolution'],appointmentHolds:['customers','operationResolution'],
 scheduling:['customers','vehicles','associations','operationResolution','quoteCommercial'],quoteAmendments:['customers','vehicles','operationResolution','quoteCommercial'],
 quoteAmendmentAcceptance:['quoteAmendments','scheduling'],recordJobHistory:['scheduling'],customerProfiles:['customers','associations','catalog','recordJobHistory'],
 fieldSessions:['scheduling','quoteAmendmentAcceptance'],jobCompletion:['fieldSessions'],jobMileage:['fieldSessions'],supportTrips:['fieldSessions'],unfulfilledCancellation:['fieldSessions'],workTime:['fieldSessions'],
 workBoundary:['workTime','operationResolution'],workStart:['workBoundary'],workEnd:['workStart','jobCompletion'],mobileDeparture:['workEnd','jobMileage'],
 reviewOutcome:['jobCompletion'],reviewHistory:['reviewOutcome'],maintenanceFollowUp:['jobCompletion'],dropoffCustody:['fieldSessions'],dropoffPolicyRevision:['dropoffCustody'],dropoffPhotos:['dropoffCustody'],
 pickupTrips:['fieldSessions'],pickupCollection:['pickupTrips'],pickupPolicy:['pickupCollection'],pickupPhotos:['pickupPolicy','dropoffPhotos'],
 pickupWork:['pickupCollection','jobCompletion','unfulfilledCancellation'],pickupRelease:['pickupWork','pickupPhotos','operationResolution'],pickupReturnFailure:['pickupRelease'],
 expenses:['customers','operationResolution'],expenseReceipts:['expenses'],finance:['operationResolution'],financeExports:['finance'],businessExports:['operationResolution'],supplierOriginals:['finance'],
 googleCalendar:['scheduling'],
};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function require(value:unknown):asserts value{if(!value)throw new Error('PRODUCTION_CAPABILITIES_REQUIRED');}
export function productionReleaseAccepted(release:unknown):boolean{
 return release!==null&&typeof release==='object'&&!Array.isArray(release)&&Object.hasOwn(release,'productionActivation')&&
  (release as Record<string,unknown>).productionActivation==='ready';
}
export function validateProductionCapabilities(value:unknown):readonly ProductionCapability[]{
 require(Array.isArray(value)&&value.length>0&&new Set(value).size===value.length&&value.every(item=>productionCapabilityNames.includes(item)));
 const enabled=new Set<ProductionCapability>(value);
 for(const capability of enabled)for(const dependency of dependencies[capability]??[])require(enabled.has(dependency));
 return Object.freeze([...enabled]);
}
class GrantedProductionCapabilities{
 #businessId:string;#enabled:ReadonlySet<ProductionCapability>;
 constructor(businessId:string,enabled:readonly ProductionCapability[]){this.#businessId=businessId;this.#enabled=new Set(enabled);Object.freeze(this);}
 allows(businessId:string,capability:ProductionCapability){return businessId===this.#businessId&&this.#enabled.has(capability);}
 belongsTo(businessId:string){return businessId===this.#businessId;}
 toJSON():never{throw new Error('PRODUCTION_CAPABILITIES_PRIVATE');}
}
export type ProductionCapabilities=GrantedProductionCapabilities;
// Trusted startup supplies the bundled release metadata, never profile/browser
// assertions about acceptance. This is composition authority, not user/session,
// financial approval, database provisioning or recovery evidence.
export function createProductionCapabilities(release:unknown,businessId:string,requested:unknown):ProductionCapabilities{
 require(productionReleaseAccepted(release)&&typeof businessId==='string'&&uuid.test(businessId));
 return new GrantedProductionCapabilities(businessId,validateProductionCapabilities(requested));
}
export function productionCapabilitiesBelongTo(value:unknown,businessId:string){
 return value instanceof GrantedProductionCapabilities&&value.belongsTo(businessId);
}
export type ProductionCapabilityConfiguration=Readonly<{environment:'production'|'test';businessId?:string;productionCapabilities?:ProductionCapabilities}>;
export function productionCapability(config:ProductionCapabilityConfiguration,capability:ProductionCapability):boolean{
 return config.environment==='production'&&typeof config.businessId==='string'&&config.productionCapabilities instanceof GrantedProductionCapabilities&&config.productionCapabilities.allows(config.businessId,capability);
}
