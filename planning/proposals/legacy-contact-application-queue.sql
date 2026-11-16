-- Held background admission for a specific approved contact batch. Store
-- identifiers only. The worker must never receive browser/provider credentials.
-- Recent interactive owner authority is consumed at admission. Closing the
-- browser or signing out after admission leaves the request intact. Account
-- disablement, security-epoch changes, lost business membership/capability,
-- and recovery-epoch changes prevent deferred execution.
-- One worker transaction locks one request. Any thrown error or interruption
-- rolls back the entire import and releases the same request for reconciliation.
CREATE ROLE crest_legacy_contact_dispatch NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE ALL ON SCHEMA crest,crest_private FROM crest_legacy_contact_dispatch;
GRANT USAGE ON SCHEMA crest_commands TO crest_legacy_contact_dispatch;

SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.legacy_contact_apply_requests (
 business_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 evidence_sha256 text COLLATE "C" NOT NULL,
 requested_by uuid NOT NULL,
 security_epoch uuid NOT NULL,
 recovery_epoch uuid NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(requested_at)),
 outcome text CHECK(outcome IN ('committed','already_applied','approval','applied','operation','authority')),
 completed_at timestamptz CHECK(isfinite(completed_at)),
 PRIMARY KEY(business_id,operation_id),
 FOREIGN KEY(business_id,batch_id,evidence_sha256) REFERENCES crest.legacy_contact_approvals(business_id,batch_id,evidence_sha256),
 FOREIGN KEY(business_id,requested_by) REFERENCES crest.memberships(business_id,actor_id),
 CHECK((outcome IS NULL)=(completed_at IS NULL)),
 CHECK(completed_at>=requested_at)
);
CREATE UNIQUE INDEX legacy_contact_apply_single_request ON crest_private.legacy_contact_apply_requests(business_id,batch_id)
 WHERE outcome IS NULL;
CREATE INDEX legacy_contact_apply_requests_batch ON crest_private.legacy_contact_apply_requests(business_id,batch_id,requested_at DESC,operation_id DESC);
CREATE INDEX legacy_contact_apply_requests_pending ON crest_private.legacy_contact_apply_requests(requested_at,business_id,operation_id)
 WHERE outcome IS NULL;
ALTER TABLE crest_private.legacy_contact_apply_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.legacy_contact_apply_requests FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE(outcome,completed_at) ON crest_private.legacy_contact_apply_requests TO crest_legacy_contact_apply_owner;
CREATE POLICY legacy_apply_request_tenant_read ON crest_private.legacy_contact_apply_requests
 FOR SELECT TO crest_legacy_contact_apply_owner
 USING(business_id=nullif(current_setting('crest.legacy_apply_request_business_id',true),'')::uuid
   OR current_setting('crest.legacy_apply_dispatch',true)='1');
CREATE POLICY legacy_apply_request_admission ON crest_private.legacy_contact_apply_requests
 FOR INSERT TO crest_legacy_contact_apply_owner
 WITH CHECK(business_id=nullif(current_setting('crest.legacy_apply_request_business_id',true),'')::uuid
   AND outcome IS NULL AND completed_at IS NULL);
CREATE POLICY legacy_apply_request_dispatch ON crest_private.legacy_contact_apply_requests
 FOR UPDATE TO crest_legacy_contact_apply_owner
 USING(current_setting('crest.legacy_apply_dispatch',true)='1' AND outcome IS NULL)
 WITH CHECK(current_setting('crest.legacy_apply_dispatch',true)='1' AND outcome IS NOT NULL);
CREATE TRIGGER legacy_apply_request_retained BEFORE DELETE OR TRUNCATE ON crest_private.legacy_contact_apply_requests
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

-- The session owner already owns the authority boundary and can read the same
-- business/security/recovery records. Allow it to lock, but not edit, membership.
GRANT UPDATE(id) ON crest.memberships TO crest_session_owner;
CREATE POLICY legacy_apply_authority_membership_lock ON crest.memberships FOR UPDATE TO crest_session_owner
 USING(business_id=nullif(current_setting('crest.legacy_apply_authority_business_id',true),'')::uuid
   AND actor_id=nullif(current_setting('crest.legacy_apply_authority_actor_id',true),'')::uuid)
 WITH CHECK(false);
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_session_owner;
SET LOCAL ROLE crest_session_owner;
CREATE FUNCTION crest_private.legacy_contact_request_security_epoch(requested_actor uuid) RETURNS uuid
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $security$
 SELECT a.current_security_epoch FROM crest_private.actors a WHERE a.id=requested_actor AND a.disabled_at IS NULL AND a.kind='owner'
$security$;
CREATE FUNCTION crest_private.lock_legacy_contact_worker_authority(
 requested_business uuid,requested_actor uuid,security_epoch uuid,recovery_epoch uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $authority$
DECLARE current_security uuid; business_status text; member_role text; can_write boolean; current_recovery uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_MUTATION_FRESH_READ_REQUIRED';
 END IF;
 SELECT a.current_security_epoch INTO current_security FROM crest_private.actors a
  WHERE a.id=requested_actor AND a.kind='owner' AND a.disabled_at IS NULL FOR SHARE;
 IF current_security IS DISTINCT FROM security_epoch THEN RETURN false; END IF;
 SELECT b.status INTO business_status FROM crest.businesses b WHERE b.id=requested_business FOR SHARE;
 IF business_status IS NULL OR business_status NOT IN ('setup','active') THEN RETURN false; END IF;
 PERFORM set_config('crest.legacy_apply_authority_business_id',requested_business::text,true),
  set_config('crest.legacy_apply_authority_actor_id',requested_actor::text,true);
 SELECT m.role INTO member_role FROM crest.memberships m
  WHERE (m.business_id,m.actor_id)=(requested_business,requested_actor) AND m.active FOR SHARE;
 IF member_role IS NULL OR NOT EXISTS(SELECT FROM crest_private.role_capabilities c WHERE c.role=member_role AND c.capability='crm.manage')
  THEN RETURN false; END IF;
 SELECT r.active_epoch,r.writes_enabled INTO current_recovery,can_write
  FROM crest_private.business_recovery_authorities r WHERE r.business_id=requested_business FOR SHARE;
 RETURN current_recovery IS NOT DISTINCT FROM recovery_epoch AND can_write IS TRUE;
END
$authority$;
REVOKE ALL ON FUNCTION crest_private.legacy_contact_request_security_epoch(uuid),
 crest_private.lock_legacy_contact_worker_authority(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.legacy_contact_request_security_epoch(uuid),
 crest_private.lock_legacy_contact_worker_authority(uuid,uuid,uuid,uuid) TO crest_legacy_contact_apply_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_session_owner;

GRANT CREATE ON SCHEMA crest_commands TO crest_legacy_contact_apply_owner;
SET LOCAL ROLE crest_legacy_contact_apply_owner;
CREATE FUNCTION crest_commands.request_legacy_contact_application(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,requested_batch uuid,expected_evidence text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $request$
DECLARE prior record; evidence jsonb; actor_epoch uuid;
BEGIN
 IF requested_batch IS NULL OR requested_operation IS NULL OR expected_evidence IS NULL OR expected_evidence!~'^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_APPLY_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',true);
 PERFORM set_config('crest.legacy_apply_request_business_id',requested_business::text,true),
  set_config('crest.legacy_apply_dispatch','0',true),
  set_config('crest.legacy_decision_business_id',requested_business::text,true);
 SELECT q.* INTO prior FROM crest_private.legacy_contact_apply_requests q
  WHERE (q.business_id,q.operation_id)=(requested_business,requested_operation);
 IF FOUND THEN
  IF (prior.batch_id,prior.evidence_sha256,prior.requested_by,prior.recovery_epoch)
    IS DISTINCT FROM (requested_batch,expected_evidence,expected_actor,expected_epoch)
   THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  RETURN jsonb_build_object('state',coalesce(prior.outcome,'queued'),'operationId',prior.operation_id);
 END IF;
 evidence:=crest_private.legacy_contact_approval_evidence(requested_business,requested_batch);
 IF evidence->>'state' IS DISTINCT FROM 'ready' OR evidence->>'evidenceSha256' IS DISTINCT FROM expected_evidence
   OR evidence->>'approval' IS NULL THEN RETURN jsonb_build_object('state','conflict','reason','approval'); END IF;
 actor_epoch:=crest_private.legacy_contact_request_security_epoch(expected_actor);
 INSERT INTO crest_private.legacy_contact_apply_requests(business_id,operation_id,batch_id,evidence_sha256,requested_by,security_epoch,recovery_epoch)
 VALUES(requested_business,requested_operation,requested_batch,expected_evidence,expected_actor,actor_epoch,expected_epoch)
 ON CONFLICT DO NOTHING;
 IF FOUND THEN RETURN jsonb_build_object('state','queued','operationId',requested_operation); END IF;
 -- An exact concurrent request is allowed to acknowledge the existing intent.
 -- A different pending approval must be executed or rejected before requeueing.
 SELECT q.* INTO prior FROM crest_private.legacy_contact_apply_requests q
  WHERE q.business_id=requested_business AND (q.operation_id=requested_operation OR (q.batch_id=requested_batch AND q.outcome IS NULL))
  ORDER BY (q.operation_id=requested_operation) DESC LIMIT 1;
 IF FOUND AND (prior.batch_id,prior.evidence_sha256,prior.requested_by,prior.recovery_epoch)
   IS NOT DISTINCT FROM (requested_batch,expected_evidence,expected_actor,expected_epoch) THEN
  RETURN jsonb_build_object('state',coalesce(prior.outcome,'queued'),'operationId',prior.operation_id);
 END IF;
 RETURN jsonb_build_object('state','conflict','reason','operation');
END
$request$;

CREATE FUNCTION crest_commands.read_legacy_contact_apply_request(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_batch uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $status$
DECLARE prior record;
BEGIN
 PERFORM crest_commands.authorize_customer_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.legacy_apply_request_business_id',requested_business::text,true),
  set_config('crest.legacy_apply_dispatch','0',true);
 SELECT q.operation_id,q.outcome INTO prior FROM crest_private.legacy_contact_apply_requests q
  WHERE (q.business_id,q.batch_id)=(requested_business,requested_batch)
  ORDER BY q.requested_at DESC,q.operation_id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 RETURN jsonb_build_object('state',coalesce(prior.outcome,'queued'),'operationId',prior.operation_id);
END
$status$;

CREATE FUNCTION crest_commands.run_next_legacy_contact_application() RETURNS boolean
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $dispatch$
DECLARE request crest_private.legacy_contact_apply_requests; result jsonb; final_outcome text;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_MUTATION_FRESH_READ_REQUIRED';
 END IF;
 PERFORM set_config('crest.legacy_apply_dispatch','1',true),set_config('crest.legacy_apply_request_business_id','',true);
 SELECT q.* INTO request FROM crest_private.legacy_contact_apply_requests q WHERE q.outcome IS NULL
  ORDER BY q.requested_at,q.business_id,q.operation_id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN false; END IF;
 IF crest_private.lock_legacy_contact_worker_authority(request.business_id,request.requested_by,request.security_epoch,request.recovery_epoch) THEN
  result:=crest_private.commit_legacy_contact_application(request.business_id,request.requested_by,request.recovery_epoch,
   request.operation_id,request.batch_id,request.evidence_sha256);
  final_outcome:=CASE WHEN result->>'state'='conflict' THEN result->>'reason' ELSE result->>'state' END;
 ELSE
  final_outcome:='authority';
 END IF;
 IF final_outcome IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_APPLY_OUTCOME_REQUIRED'; END IF;
 UPDATE crest_private.legacy_contact_apply_requests SET outcome=final_outcome,completed_at=clock_timestamp()
  WHERE (business_id,operation_id)=(request.business_id,request.operation_id);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_APPLY_REQUEST_REQUIRED'; END IF;
 RETURN true;
END
$dispatch$;
REVOKE ALL ON FUNCTION crest_commands.request_legacy_contact_application(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text),
 crest_commands.read_legacy_contact_apply_request(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.run_next_legacy_contact_application() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.request_legacy_contact_application(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text),
 crest_commands.read_legacy_contact_apply_request(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
GRANT EXECUTE ON FUNCTION crest_commands.run_next_legacy_contact_application() TO crest_legacy_contact_dispatch;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_legacy_contact_apply_owner;
