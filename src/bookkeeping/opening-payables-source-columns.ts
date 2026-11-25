// Data-only retained-source columns. Safe for tooling and browser-fixture metadata.
const columns={
 origins:['id','business_id','source_namespace','external_id','vendor','operation_id','recorded_by','recorded_at'],
 revisions:['id','business_id','worksheet_revision_id','revision','prior_revision','operation_id','audit_event_id','recorded_by','recorded_at','evidence','evidence_sha256'],
 operations:['id','business_id','operation_id','actor_id','command_type','schema_version','recovery_epoch','payload_hash','state','result_schema_version','result','committed_at','created_at','created_by','origin','import_row_id'],
 audits:['id','business_id','operation_id','actor_id','entity_kind','entity_id','entity_version','action','reason','effective_at','delta','created_at','recorded_at','created_by','origin','import_row_id','database_principal','payload','hash_input','event_hash'],
} as const;
for(const fields of Object.values(columns))Object.freeze(fields);
export const openingPayablesSourceColumns=Object.freeze(columns);
export const openingPayablesSourceCoverage=Object.freeze([
 {table:'crest.opening_payables_origins',scope:'business',required:columns.origins,excluded:[],partialEvidenceGroup:null},
 {table:'crest.opening_payables_schedule_revisions',scope:'business',required:columns.revisions,excluded:[],partialEvidenceGroup:null},
]);
