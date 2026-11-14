-- P20/BR21. Read the retained appointment, exact previous evidence, sealed
-- grant and only the individually consented display fields.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(local_start,local_end,start_offset_minutes,end_offset_minutes) ON crest.appointments TO crest_calendar_dispatch_owner;

CREATE FUNCTION crest_commands.read_google_calendar_worker_material(
 business uuid,destination uuid,job uuid,generation bigint,epoch uuid,requested_lease uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $material$
DECLARE boundary record; source record; prior record; prior_body text; prior_digest text; credential record;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_dispatch(business,destination,job,generation,epoch);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT o.id,o.action,o.appointment_sequence,l.mode,a.start_at,a.end_at,a.timezone,a.local_start,a.local_end,
  a.start_offset_minutes,a.end_offset_minutes INTO source
 FROM crest.google_calendar_dispatch_leases l
 JOIN crest.google_calendar_outbox o ON (o.business_id,o.id)=(l.business_id,l.outbox_id)
 JOIN crest.appointments a ON (a.business_id,a.job_id,a.id)=(o.business_id,o.job_id,o.appointment_id)
 WHERE (l.business_id,l.id,l.worker_principal)=(business,requested_lease,session_user)
  AND (o.mapping_id,o.connection_generation,o.recovery_epoch)=(boundary.mapping_id,generation,epoch)
  AND l.lease_until>clock_timestamp()+interval '15 seconds'
  AND (l.mode='reconcile' OR o.appointment_id=boundary.appointment_id)
  AND NOT EXISTS(SELECT FROM crest.google_calendar_dispatch_results r WHERE (r.business_id,r.lease_id)=(l.business_id,l.id));
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT o.id,r.outcome,r.provider_etag INTO prior
 FROM crest.google_calendar_outbox o
 JOIN crest.google_calendar_dispatch_leases l ON (l.business_id,l.outbox_id)=(o.business_id,o.id)
 JOIN crest.google_calendar_dispatch_results r ON (r.business_id,r.lease_id)=(l.business_id,l.id)
 WHERE (o.business_id,o.mapping_id,o.connection_generation,o.recovery_epoch)=(business,boundary.mapping_id,generation,epoch)
  AND o.appointment_sequence<source.appointment_sequence AND r.outcome IN ('published','removed','no_effect')
 ORDER BY o.appointment_sequence DESC,l.attempt_no DESC LIMIT 1;
 IF prior.outcome='published' THEN
  SELECT s.request_body,s.request_sha256 INTO prior_body,prior_digest FROM crest.google_calendar_dispatch_leases l
  JOIN crest.google_calendar_dispatch_sends s ON (s.business_id,s.lease_id)=(l.business_id,l.id)
  JOIN crest.google_calendar_request_admissions a ON (a.business_id,a.lease_id,a.kind)=(s.business_id,s.lease_id,s.action)
  WHERE (l.business_id,l.outbox_id)=(business,prior.id) ORDER BY l.attempt_no DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','review'); END IF;
 END IF;
 -- The same generation and the exact dedicated worker are pinned by the
 -- dispatch boundary above. RLS admits only the worker's business here.
 PERFORM set_config('crest.calendar_credential_business',business::text,true);
 SELECT c.id,c.client_id,c.key_id,c.version,c.envelope INTO credential FROM crest_private.google_calendar_credentials c
 JOIN crest_private.google_calendar_oauth_client o ON o.singleton AND o.client_id=c.client_id
 JOIN crest_private.google_calendar_credential_key k ON k.singleton AND k.key_id=c.key_id AND k.key_id<>o.verifier_key_id
 WHERE (c.business_id,c.destination_id,c.connection_generation,c.recovery_epoch)=(business,destination,generation,epoch);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','reconnect'); END IF;
 RETURN jsonb_build_object('state','ready','outboxId',source.id,
  'disclosure',jsonb_build_object('clientName',boundary.share_client,'serviceLabel',boundary.share_service,'workAddress',boundary.share_address),
  'fields',CASE WHEN source.action='publish' AND source.mode='dispatch' THEN
   crest_private.google_calendar_disclosed_fields(business,job,boundary.share_client,boundary.share_service,boundary.share_address)
   ELSE jsonb_build_object('clientName',null,'serviceLabel',null,'workAddress',null) END,
  'time',CASE WHEN source.action='publish' THEN jsonb_build_object(
    'start_at',to_char(source.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'end_at',to_char(source.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timezone',source.timezone,
    'local_start',to_char(source.local_start,'YYYY-MM-DD"T"HH24:MI:SS.US'),
    'local_end',to_char(source.local_end,'YYYY-MM-DD"T"HH24:MI:SS.US'),
    'start_offset_minutes',source.start_offset_minutes,'end_offset_minutes',source.end_offset_minutes) END,
  'previous',CASE WHEN prior.outcome='published' THEN jsonb_build_object(
    'etag',prior.provider_etag,'body',prior_body,'sha256',prior_digest) END,
  'credential',jsonb_build_object('credentialId',credential.id,'clientId',credential.client_id,'keyId',credential.key_id,
    'version',credential.version::text,'envelope',credential.envelope));
END $material$;
RESET ROLE;
ALTER FUNCTION crest_commands.read_google_calendar_worker_material(uuid,uuid,uuid,bigint,uuid,uuid) OWNER TO crest_calendar_dispatch_owner;
REVOKE ALL ON FUNCTION crest_commands.read_google_calendar_worker_material(uuid,uuid,uuid,bigint,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_google_calendar_worker_material(uuid,uuid,uuid,bigint,uuid,uuid) TO crest_calendar_dispatch;
