-- P20/BR21. Owner-only status for one saved job. No provider requests or
-- event identifiers, request bodies, credentials or customer fields leave SQL.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(business_id,id,current_appointment_id) ON crest.jobs TO crest_calendar_oauth_owner;
CREATE POLICY calendar_status_job ON crest.jobs FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
GRANT SELECT(business_id,id,job_id,sequence) ON crest.appointments TO crest_calendar_oauth_owner;
CREATE POLICY calendar_status_appointment ON crest.appointments FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);

CREATE FUNCTION crest_commands.read_google_calendar_job_status(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,job uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $status$
DECLARE result jsonb;
BEGIN
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,'identity.manage',false);
 PERFORM set_config('crest.calendar_oauth_business',business::text,true);

 -- One snapshot binds the current Crest appointment to the latest consent,
 -- lease and acknowledged result. A proposal does not change current_appointment_id.
 WITH source AS (
  SELECT a.id,a.sequence FROM crest.jobs j JOIN crest.appointments a
   ON (a.business_id,a.job_id,a.id)=(j.business_id,j.id,j.current_appointment_id)
  WHERE (j.business_id,j.id)=(business,job)
 ), consent AS (
  SELECT d.id,c.generation,c.recovery_epoch,c.state FROM crest.google_calendar_destinations d
  JOIN crest.google_calendar_consents c ON (c.business_id,c.destination_id)=(d.business_id,d.id)
  WHERE d.business_id=business ORDER BY c.generation DESC LIMIT 1
 ), current_intent AS (
  SELECT o.id,o.action,o.connection_generation,o.recovery_epoch FROM crest.google_calendar_outbox o
  JOIN source a ON o.appointment_id=a.id JOIN consent c ON o.destination_id=c.id
  WHERE (o.business_id,o.job_id)=(business,job)
 ), last_attempt AS (
  SELECT l.lease_until,l.attempt_no,r.outcome FROM current_intent o
  JOIN crest.google_calendar_dispatch_leases l ON (l.business_id,l.outbox_id)=(business,o.id)
  LEFT JOIN crest.google_calendar_dispatch_results r ON (r.business_id,r.lease_id)=(l.business_id,l.id)
  ORDER BY l.attempt_no DESC LIMIT 1
 ), last_confirmation AS (
  SELECT o.appointment_sequence,r.recorded_at FROM crest.google_calendar_outbox o
  JOIN consent c ON (o.destination_id,o.connection_generation,o.recovery_epoch)=(c.id,c.generation,c.recovery_epoch)
  JOIN crest.google_calendar_dispatch_leases l ON (l.business_id,l.outbox_id)=(o.business_id,o.id)
  JOIN crest.google_calendar_dispatch_results r ON (r.business_id,r.lease_id)=(l.business_id,l.id)
  WHERE (o.business_id,o.job_id)=(business,job) AND c.state='active' AND c.recovery_epoch=epoch
   AND r.outcome IN('published','removed','no_effect')
  ORDER BY o.appointment_sequence DESC,l.attempt_no DESC LIMIT 1
 )
 SELECT jsonb_build_object('schemaVersion',1,'jobId',job,'appointmentVersion',a.sequence::text,
  'state',CASE
   WHEN c.id IS NULL THEN 'disconnected'
   WHEN c.recovery_epoch<>epoch OR c.state='paused' THEN 'review'
   WHEN c.state='disconnected' THEN 'disconnected'
   WHEN o.id IS NULL THEN 'not_queued'
   WHEN (o.connection_generation,o.recovery_epoch) IS DISTINCT FROM (c.generation,c.recovery_epoch) THEN 'review'
   WHEN last_attempt.outcome='published' AND o.action='publish' THEN 'synced'
   WHEN last_attempt.outcome IN('removed','no_effect') AND o.action='remove' THEN 'removed'
   WHEN last_attempt.outcome='reconnect' THEN 'reconnect'
   WHEN last_attempt.outcome='review' OR last_attempt.attempt_no>=5 THEN 'review'
   WHEN last_attempt.outcome IN('delayed','uncertain') THEN 'delayed'
   WHEN last_attempt.lease_until>statement_timestamp() THEN 'in_progress'
   ELSE 'pending' END,
  'lastConfirmedVersion',last_confirmation.appointment_sequence::text,
  'lastConfirmedAt',to_char(last_confirmation.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
 INTO result FROM source a LEFT JOIN consent c ON true LEFT JOIN current_intent o ON true
 LEFT JOIN last_attempt ON true LEFT JOIN last_confirmation ON true;
 RETURN result;
END $status$;
RESET ROLE;
ALTER FUNCTION crest_commands.read_google_calendar_job_status(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 OWNER TO crest_calendar_oauth_owner;
REVOKE ALL ON FUNCTION crest_commands.read_google_calendar_job_status(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_google_calendar_job_status(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 TO crest_calendar_oauth;
