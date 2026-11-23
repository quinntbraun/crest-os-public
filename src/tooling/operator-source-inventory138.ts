// Fixed operator-only projection from reviewed SECURITY_EXPORT_COVERAGE138.
// Never appended to the business owner's browser export.
export const operatorSourceInventory138=Object.freeze([
 {source:'crest_private.login_attempts',columns:['id','admitted_at'],excluded:['identifier_hash','ip_hash']},
 {source:'crest_private.login_contexts',columns:['id','created_at','expires_at','consumed_at'],excluded:['credential_hash','ip_hash','csrf_hash']},
 {source:'crest_private.login_limit_state',columns:['singleton'],excluded:['key_fingerprint']},
 {source:'crest_private.session_csrf_tokens',columns:['id','session_id','created_at'],excluded:['token_hash']},
 {source:'crest_private.session_request_admissions',columns:['id','session_id','bucket','admitted_at'],excluded:[]},
 {source:'crest_private.google_calendar_credential_key',columns:['singleton'],excluded:['key_id']},
 {source:'crest_private.google_calendar_oauth_attempts',columns:['id','business_id','actor_id','session_id','recovery_epoch','destination_id','connection_generation','issuer','client_id','callback_uri','created_at','expires_at','retired_at','consumed_at'],excluded:['state_digest','verifier_key_id','verifier_envelope']},
 {source:'crest_private.google_calendar_oauth_client',columns:['singleton','issuer','client_id','callback_uri'],excluded:['verifier_key_id']},
 {source:'crest_private.google_calendar_request_budget',columns:['singleton'],excluded:[]},
 {source:'crest_private.google_calendar_worker_principals',columns:['business_id'],excluded:['principal']}
].map(value=>Object.freeze({...value,columns:Object.freeze(value.columns),excluded:Object.freeze(value.excluded)})));
