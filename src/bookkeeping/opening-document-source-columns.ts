// Held source142 metadata. No credentials are stored in these retained rows.
const intents=Object.freeze(['id','business_id','reference','expected_sha256','recovery_epoch','media_type','byte_size','dispatch_id','operation_id','audit_event_id','created_by','recorded_at']);
const originals=Object.freeze(['id','business_id','candidate','operation_id','audit_event_id','created_by','recorded_at']);
export const openingDocumentSourceColumns=Object.freeze({intents,originals});
export const openingDocumentSourceCoverage=Object.freeze([
 Object.freeze({table:'crest.opening_document_intents',scope:'business',required:intents,excluded:Object.freeze([] as string[]),partialEvidenceGroup:null}),
 Object.freeze({table:'crest.opening_document_originals',scope:'business',required:originals,excluded:Object.freeze([] as string[]),partialEvidenceGroup:null}),
]);
