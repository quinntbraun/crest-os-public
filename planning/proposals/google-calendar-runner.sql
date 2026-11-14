-- P20/BR21. Bounded due work for the fictional application runner only.
-- Discovery has no write grant. Claim/admit/finish remain authoritative and
-- independently fence workers after a concurrent recovery or consent change.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.next_fictional_google_calendar_job(business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $due$
DECLARE due jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR NOT EXISTS(
  SELECT FROM crest_private.google_calendar_worker_principals p WHERE (p.business_id,p.principal)=(business,session_user)
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GOOGLE_CALENDAR_WORKER_DENIED'; END IF;

 SELECT jsonb_build_object('businessId',business,'destinationId',d.id,'jobId',j.id,'generation',c.generation::text,'recoveryEpoch',c.recovery_epoch)
 INTO due
 FROM crest_private.business_recovery_authorities b
 JOIN crest.google_calendar_destinations d ON d.business_id=b.business_id
 JOIN LATERAL (SELECT x.generation,x.state,x.recovery_epoch FROM crest.google_calendar_consents x
  WHERE (x.business_id,x.destination_id)=(business,d.id) ORDER BY x.generation DESC LIMIT 1) c ON true
 JOIN crest.google_calendar_mappings m ON (m.business_id,m.destination_id)=(business,d.id)
 JOIN crest.jobs j ON (j.business_id,j.id)=(business,m.job_id)
 JOIN LATERAL (
  -- Earliest admitted but unconfirmed write wins over current work. Keep
  -- terminal unresolved attempts in the ordering so later intents wait.
  SELECT o.id,o.created_at,o.connection_generation,o.recovery_epoch
  FROM crest.google_calendar_outbox o
  WHERE (o.business_id,o.mapping_id)=(business,m.id)
   AND (o.appointment_id=j.current_appointment_id OR EXISTS(
    SELECT FROM crest.google_calendar_dispatch_leases l
    JOIN crest.google_calendar_request_admissions a ON (a.business_id,a.lease_id)=(l.business_id,l.id)
     AND a.kind IN('insert','update','delete')
    LEFT JOIN crest.google_calendar_dispatch_results r ON (r.business_id,r.lease_id)=(l.business_id,l.id)
    WHERE (l.business_id,l.outbox_id)=(business,o.id) AND (r.id IS NULL OR r.outcome='uncertain')
     AND NOT EXISTS(SELECT FROM crest.google_calendar_dispatch_leases later
      JOIN crest.google_calendar_dispatch_results done ON (done.business_id,done.lease_id)=(later.business_id,later.id)
      WHERE (later.business_id,later.outbox_id)=(business,o.id) AND later.attempt_no>l.attempt_no
       AND done.outcome IN('published','removed','no_effect'))
   ))
  ORDER BY o.appointment_sequence LIMIT 1
 ) intent ON (intent.connection_generation,intent.recovery_epoch)=(c.generation,c.recovery_epoch)
 LEFT JOIN LATERAL (
  SELECT l.attempt_no,l.lease_until,r.outcome,r.retry_at FROM crest.google_calendar_dispatch_leases l
  LEFT JOIN crest.google_calendar_dispatch_results r ON (r.business_id,r.lease_id)=(l.business_id,l.id)
  WHERE (l.business_id,l.outbox_id)=(business,intent.id) ORDER BY l.attempt_no DESC LIMIT 1
 ) last ON true
 WHERE b.business_id=business AND b.writes_enabled AND c.state='active' AND c.recovery_epoch=b.active_epoch
  AND d.provider_calendar_id='crest-fictional-appointments@group.calendar.google.com'
  AND (last.attempt_no IS NULL OR (last.attempt_no<5 AND (
   (last.outcome IS NULL AND last.lease_until<=statement_timestamp())
   OR (last.outcome IN('delayed','uncertain') AND last.retry_at<=statement_timestamp()))))
  AND NOT EXISTS(
   SELECT FROM crest.google_calendar_dispatch_leases l JOIN crest.google_calendar_outbox o ON (o.business_id,o.id)=(l.business_id,l.outbox_id)
   WHERE (o.business_id,o.mapping_id)=(business,m.id) AND l.lease_until>statement_timestamp()
    AND NOT EXISTS(SELECT FROM crest.google_calendar_dispatch_results r WHERE (r.business_id,r.lease_id)=(l.business_id,l.id))
  )
 ORDER BY intent.created_at,intent.id LIMIT 1;
 RETURN due;
END $due$;
RESET ROLE;
ALTER FUNCTION crest_commands.next_fictional_google_calendar_job(uuid) OWNER TO crest_calendar_dispatch_owner;
REVOKE ALL ON FUNCTION crest_commands.next_fictional_google_calendar_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.next_fictional_google_calendar_job(uuid) TO crest_calendar_dispatch;
