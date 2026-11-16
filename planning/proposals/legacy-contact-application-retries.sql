-- Held worker restart and retry behavior. A persisted lease starts in a short
-- committed transaction. The application and its terminal outcome still share
-- one transaction, so a lost response cannot repeat a committed import.
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest_private.legacy_contact_apply_requests
 DROP CONSTRAINT legacy_contact_apply_requests_outcome_check,
 ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
 ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(next_attempt_at)),
 ADD COLUMN lease_id uuid,
 ADD COLUMN lease_expires_at timestamptz CHECK(isfinite(lease_expires_at)),
 ADD CONSTRAINT legacy_apply_request_lease_pair CHECK((lease_id IS NULL)=(lease_expires_at IS NULL)),
 ADD CONSTRAINT legacy_apply_request_lease_open CHECK(lease_id IS NULL OR (outcome IS NULL AND attempt_count>0)),
 ADD CONSTRAINT legacy_contact_apply_requests_outcome_check
  CHECK(outcome IN ('committed','already_applied','approval','applied','operation','authority','review'));
CREATE UNIQUE INDEX legacy_apply_request_lease ON crest_private.legacy_contact_apply_requests(lease_id) WHERE lease_id IS NOT NULL;
DROP INDEX crest_private.legacy_contact_apply_requests_pending;
CREATE INDEX legacy_contact_apply_requests_pending ON crest_private.legacy_contact_apply_requests(next_attempt_at,requested_at,business_id,operation_id)
 WHERE outcome IS NULL;
GRANT UPDATE(attempt_count,next_attempt_at,lease_id,lease_expires_at)
 ON crest_private.legacy_contact_apply_requests TO crest_legacy_contact_apply_owner;
ALTER POLICY legacy_apply_request_admission ON crest_private.legacy_contact_apply_requests
 WITH CHECK(business_id=nullif(current_setting('crest.legacy_apply_request_business_id',true),'')::uuid
  AND outcome IS NULL AND completed_at IS NULL AND attempt_count=0 AND lease_id IS NULL AND lease_expires_at IS NULL);
ALTER POLICY legacy_apply_request_dispatch ON crest_private.legacy_contact_apply_requests
 WITH CHECK(current_setting('crest.legacy_apply_dispatch',true)='1');
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_legacy_contact_apply_owner;
SET LOCAL ROLE crest_legacy_contact_apply_owner;
-- The worker supplies a random attempt identifier before contacting PostgreSQL.
-- It can release an uncertain claim using that same identifier.
CREATE FUNCTION crest_commands.claim_legacy_contact_application(requested_lease uuid) RETURNS text
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $claim$
DECLARE request crest_private.legacy_contact_apply_requests; stamp timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR requested_lease IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_APPLY_LEASE_REQUIRED';
 END IF;
 PERFORM set_config('crest.legacy_apply_dispatch','1',true),set_config('crest.legacy_apply_request_business_id','',true);
 stamp:=clock_timestamp();
 SELECT q.* INTO request FROM crest_private.legacy_contact_apply_requests q
  WHERE q.outcome IS NULL AND q.next_attempt_at<=stamp AND (q.lease_expires_at IS NULL OR q.lease_expires_at<=stamp)
  ORDER BY q.next_attempt_at,q.requested_at,q.business_id,q.operation_id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN 'idle'; END IF;
 IF request.attempt_count=3 THEN
  UPDATE crest_private.legacy_contact_apply_requests SET outcome='review',completed_at=greatest(clock_timestamp(),requested_at),
   lease_id=NULL,lease_expires_at=NULL WHERE (business_id,operation_id)=(request.business_id,request.operation_id);
  RETURN 'retired';
 END IF;
 UPDATE crest_private.legacy_contact_apply_requests SET attempt_count=attempt_count+1,lease_id=requested_lease,
  lease_expires_at=clock_timestamp()+interval '6 minutes'
  WHERE (business_id,operation_id)=(request.business_id,request.operation_id);
 RETURN 'claimed';
END
$claim$;

CREATE FUNCTION crest_commands.run_claimed_legacy_contact_application(requested_lease uuid) RETURNS boolean
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $run$
DECLARE request crest_private.legacy_contact_apply_requests; result jsonb; final_outcome text;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR requested_lease IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_APPLY_LEASE_REQUIRED';
 END IF;
 PERFORM set_config('crest.legacy_apply_dispatch','1',true),set_config('crest.legacy_apply_request_business_id','',true);
 SELECT q.* INTO request FROM crest_private.legacy_contact_apply_requests q
  WHERE q.lease_id=requested_lease AND q.outcome IS NULL FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR request.lease_expires_at<=clock_timestamp() THEN RETURN false; END IF;
 IF crest_private.lock_legacy_contact_worker_authority(request.business_id,request.requested_by,request.security_epoch,request.recovery_epoch) THEN
  result:=crest_private.commit_legacy_contact_application(request.business_id,request.requested_by,request.recovery_epoch,
   request.operation_id,request.batch_id,request.evidence_sha256);
  final_outcome:=CASE WHEN result->>'state'='conflict' THEN result->>'reason' ELSE result->>'state' END;
 ELSE
  final_outcome:='authority';
 END IF;
 IF final_outcome IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_APPLY_OUTCOME_REQUIRED'; END IF;
 UPDATE crest_private.legacy_contact_apply_requests SET outcome=final_outcome,completed_at=greatest(clock_timestamp(),requested_at),
  lease_id=NULL,lease_expires_at=NULL WHERE (business_id,operation_id)=(request.business_id,request.operation_id);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_APPLY_REQUEST_REQUIRED'; END IF;
 RETURN true;
END
$run$;

CREATE FUNCTION crest_commands.release_legacy_contact_application(requested_lease uuid) RETURNS boolean
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $release$
DECLARE stamp timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR requested_lease IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_APPLY_LEASE_REQUIRED';
 END IF;
 PERFORM set_config('crest.legacy_apply_dispatch','1',true),set_config('crest.legacy_apply_request_business_id','',true);
 stamp:=clock_timestamp();
 UPDATE crest_private.legacy_contact_apply_requests SET lease_id=NULL,lease_expires_at=NULL,
  outcome=CASE WHEN attempt_count=3 THEN 'review' END,
  completed_at=CASE WHEN attempt_count=3 THEN greatest(stamp,requested_at) END,
  next_attempt_at=stamp+CASE attempt_count WHEN 1 THEN interval '30 seconds' ELSE interval '2 minutes' END
  WHERE lease_id=requested_lease AND outcome IS NULL;
 RETURN FOUND;
END
$release$;

REVOKE EXECUTE ON FUNCTION crest_commands.run_next_legacy_contact_application() FROM crest_legacy_contact_dispatch;
REVOKE ALL ON FUNCTION crest_commands.claim_legacy_contact_application(uuid),
 crest_commands.run_claimed_legacy_contact_application(uuid),crest_commands.release_legacy_contact_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.claim_legacy_contact_application(uuid),
 crest_commands.run_claimed_legacy_contact_application(uuid),crest_commands.release_legacy_contact_application(uuid) TO crest_legacy_contact_dispatch;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_legacy_contact_apply_owner;
