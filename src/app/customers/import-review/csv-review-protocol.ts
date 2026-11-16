import type {inspectLegacyContactFile,LegacyContactColumnMap,previewLegacyContacts} from '../../../customer/legacy-contact-import-preview';

type ParsedReview=Awaited<ReturnType<typeof previewLegacyContacts>>;
const warningFields=[
 ['sourceContactPhone','Shared phone'],['sourceContactEmail','Shared email'],['sourceVehicleVin','Shared VIN'],
 ['otherSourceContactsForVehicle','Vehicle linked to multiple customer IDs'],
] as const;

export function browserCsvReview(review:ParsedReview){
 return {
  previewSha256:review.previewSha256,sourceSha256:review.sourceSha256,sourceRowCount:review.sourceRowCount,unmappedHeaders:review.unmappedHeaders,issues:review.issues,
  rows:review.rows.map(record=>({
   row:record.row,customer:record.customer.displayName,vehicle:record.vehicle?.draft.label??null,
   phone:record.customer.phone,email:record.customer.email,vin:record.vehicle?.draft.vin??null,
   warnings:warningFields.filter(([key])=>record.duplicateReview[key].candidateCount>0).map<string>(([,label])=>label),
  })),
 };
}
export type LegacyCsvSource=ReturnType<typeof inspectLegacyContactFile>;
export type LegacyCsvReview=ReturnType<typeof browserCsvReview>;
export type LegacyCsvRequest={kind:'open';file:File}|{kind:'review';mapping:LegacyContactColumnMap;businessId:string};
export type LegacyCsvResponse={kind:'open';source:LegacyCsvSource}|{kind:'review';review:LegacyCsvReview}|{kind:'error';message:string};
