-- Held over registered75. BR11.1 allows nonposting drafts before completion.
-- A draft selection is review evidence. Only the future issue command may consume it.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.invoice_draft_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 draft_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),
 previous_revision bigint GENERATED ALWAYS AS (nullif(revision-1,0)) STORED,
 job_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 due_on date CHECK(due_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 selected_outcomes uuid[] NOT NULL CHECK(cardinality(selected_outcomes)<=180 AND array_position(selected_outcomes,NULL) IS NULL),
 retained_lines jsonb NOT NULL CHECK(jsonb_typeof(retained_lines)='array' AND jsonb_array_length(retained_lines)=cardinality(selected_outcomes)
  AND octet_length(retained_lines::text)<=800000),
 state text NOT NULL CHECK(state IN('draft','cancelled')),
 reason text CHECK(reason=btrim(reason) AND char_length(reason) BETWEEN 1 AND 1000 AND reason !~ '[[:cntrl:]]'),
 CHECK((state='cancelled')=(reason IS NOT NULL)),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 audit_event_id uuid NOT NULL,
 origin text NOT NULL CHECK(origin='manual'),
 UNIQUE(business_id,id),
 UNIQUE(business_id,draft_id,revision),
 UNIQUE(business_id,operation_id),
 UNIQUE(business_id,audit_event_id),
 FOREIGN KEY(business_id,draft_id,previous_revision) REFERENCES crest.invoice_draft_revisions(business_id,draft_id,revision),
 FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),
 FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 FOREIGN KEY(business_id,audit_event_id) REFERENCES crest_private.audit_events(business_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX invoice_draft_job ON crest.invoice_draft_revisions(business_id,job_id,draft_id,revision DESC);
CREATE INDEX invoice_draft_customer ON crest.invoice_draft_revisions(business_id,customer_id);
ALTER TABLE crest.invoice_draft_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.invoice_draft_revisions FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest.invoice_draft_revisions TO crest_finance_account_owner;
GRANT SELECT ON crest.invoice_draft_revisions TO crest_finance_integrity_owner;
GRANT SELECT(business_id,id,customer_id) ON crest.jobs TO crest_finance_integrity_owner;
CREATE POLICY invoice_draft_job_integrity ON crest.jobs FOR SELECT TO crest_finance_integrity_owner USING(true);
GRANT SELECT(business_id,id,job_id,outcome,completion_part_id,partition_id,completed_cents,scope_description) ON crest.work_scope_outcomes TO crest_finance_integrity_owner;
CREATE POLICY invoice_draft_outcome_integrity ON crest.work_scope_outcomes FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY invoice_draft_scoped_read ON crest.invoice_draft_revisions FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY invoice_draft_scoped_append ON crest.invoice_draft_revisions FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY invoice_draft_integrity ON crest.invoice_draft_revisions FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY invoice_draft_op_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.invoice_draft.save');
CREATE POLICY invoice_draft_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='invoice_draft_revisions');
CREATE POLICY invoice_draft_op_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('finance.invoice_draft.save','finance.invoice_draft.retire'));
CREATE POLICY invoice_draft_op_insert ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('finance.invoice_draft.save','finance.invoice_draft.retire')
  AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY invoice_draft_op_commit ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('finance.invoice_draft.save','finance.invoice_draft.retire') AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('finance.invoice_draft.save','finance.invoice_draft.retire') AND state='committed');
CREATE POLICY invoice_draft_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='invoice_draft_revisions' AND action IN('create','revise','cancel') AND origin='manual' AND import_row_id IS NULL);

CREATE POLICY invoice_draft_retirement_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND entity_version=1 AND action='retire' AND reason IS NOT NULL AND origin='manual'
  AND import_row_id IS NULL
  AND EXISTS(SELECT 1 FROM crest_private.operations o WHERE (o.business_id,o.operation_id,o.actor_id,o.id,o.command_type,o.state)=
   (audit_events.business_id,audit_events.operation_id,audit_events.actor_id,audit_events.entity_id,'finance.invoice_draft.retire','pending')));

CREATE FUNCTION crest_private.invoice_draft_summary(draft crest.invoice_draft_revisions)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $summary$
 SELECT jsonb_build_object('schemaVersion',1,'draftId',draft.draft_id,'jobId',draft.job_id,
  'customerId',draft.customer_id,'revision',draft.revision::text,'dueOn',to_char(draft.due_on,'YYYY-MM-DD'),
  'state',draft.state,'reason',draft.reason,'auditEventId',draft.audit_event_id,
  'lineCount',cardinality(draft.selected_outcomes),'linesSha256',encode(sha256(convert_to(draft.retained_lines::text,'UTF8')),'hex'))
$summary$;

CREATE FUNCTION crest_private.verify_invoice_draft_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE prior crest.invoice_draft_revisions; expected_action text:='create';
BEGIN
 IF NEW.revision>1 THEN
  SELECT * INTO STRICT prior FROM crest.invoice_draft_revisions d
   WHERE (d.business_id,d.draft_id,d.revision)=(NEW.business_id,NEW.draft_id,NEW.previous_revision);
  IF prior.state<>'draft' OR (NEW.job_id,NEW.customer_id) IS DISTINCT FROM (prior.job_id,prior.customer_id) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_DRAFT_LINEAGE_REQUIRED';
  END IF;
  expected_action:=CASE NEW.state WHEN 'cancelled' THEN 'cancel' ELSE 'revise' END;
 ELSIF NEW.state<>'draft' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_DRAFT_LINEAGE_REQUIRED';
 END IF;
 IF NEW.state='cancelled' AND (NEW.due_on,NEW.selected_outcomes,NEW.retained_lines)
   IS DISTINCT FROM (prior.due_on,prior.selected_outcomes,prior.retained_lines) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_DRAFT_CANCEL_PRESERVES_REVIEW';
 END IF;
 IF (SELECT coalesce(array_agg((line->>'outcomeId')::uuid ORDER BY ord),'{}'::uuid[])
      FROM jsonb_array_elements(NEW.retained_lines) WITH ORDINALITY e(line,ord)) IS DISTINCT FROM NEW.selected_outcomes
  OR NOT EXISTS (SELECT 1 FROM crest.jobs j WHERE (j.business_id,j.id,j.customer_id)=(NEW.business_id,NEW.job_id,NEW.customer_id))
  OR cardinality(NEW.selected_outcomes)<>(SELECT count(DISTINCT outcome) FROM unnest(NEW.selected_outcomes) e(outcome))
  OR EXISTS (
   SELECT 1 FROM jsonb_array_elements(NEW.retained_lines) e(line)
   WHERE NOT EXISTS (SELECT 1 FROM crest.work_scope_outcomes o
    WHERE (o.business_id,o.id,o.job_id,o.outcome)=(NEW.business_id,(line->>'outcomeId')::uuid,NEW.job_id,'completed')
     AND (o.completion_part_id::text,o.partition_id::text,o.completed_cents::text,o.scope_description) IS NOT DISTINCT FROM
      (line->>'completionPartId',line->>'partitionId',line->>'inclusiveCents',line->>'description'))
  )
  OR NOT EXISTS (
   SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o USING(business_id,operation_id,actor_id)
   WHERE (a.business_id,a.id,a.operation_id,a.actor_id)=(NEW.business_id,NEW.audit_event_id,NEW.operation_id,NEW.created_by)
    AND a.entity_kind='invoice_draft_revisions' AND a.entity_id=NEW.draft_id AND a.entity_version=NEW.revision
    AND a.action=expected_action AND a.reason IS NOT DISTINCT FROM NEW.reason
    AND a.delta=jsonb_build_object('schemaVersion',1,'before',CASE WHEN NEW.revision>1 THEN crest_private.invoice_draft_summary(prior) END,
     'after',crest_private.invoice_draft_summary(NEW))
    AND o.command_type='finance.invoice_draft.save' AND o.state='committed'
    AND o.result=crest_private.invoice_draft_summary(NEW)
  ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_DRAFT_AUDIT_REQUIRED';
 END IF;
 RETURN NULL;
END $verify$;
CREATE CONSTRAINT TRIGGER invoice_draft_audited AFTER INSERT ON crest.invoice_draft_revisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_invoice_draft_revision();
CREATE TRIGGER invoice_draft_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.invoice_draft_revisions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

CREATE FUNCTION crest_commands.save_invoice_draft(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,requested_draft uuid,expected_revision bigint,requested_job uuid,
 requested_due_on date,requested_outcomes uuid[],cancel_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE digest text; claimed uuid; saved record; prior crest.invoice_draft_revisions; fresh crest.invoice_draft_revisions;
 source jsonb; selection uuid[]; lines jsonb; customer uuid; audit uuid:=gen_random_uuid(); receipt jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_draft IS NULL OR requested_job IS NULL OR expected_revision IS NULL
  OR expected_revision NOT BETWEEN 0 AND 9223372036854775806
  OR (requested_due_on IS NOT NULL AND requested_due_on NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
  OR requested_outcomes IS NULL OR coalesce(array_ndims(requested_outcomes),1)<>1 OR cardinality(requested_outcomes)>180 OR array_position(requested_outcomes,NULL) IS NOT NULL
  OR cardinality(requested_outcomes)<>(SELECT count(DISTINCT outcome) FROM unnest(requested_outcomes) e(outcome))
  OR (cancel_reason IS NOT NULL AND (expected_revision=0 OR requested_due_on IS NOT NULL OR cardinality(requested_outcomes)>0
   OR cancel_reason<>btrim(cancel_reason) OR char_length(cancel_reason) NOT BETWEEN 1 AND 1000 OR cancel_reason ~ '[[:cntrl:]]')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_DRAFT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','finance.invoice_draft.save','schemaVersion',1,
  'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'draftId',requested_draft,
  'expectedRevision',expected_revision::text,'jobId',requested_job,'dueOn',to_char(requested_due_on,'YYYY-MM-DD'),
  'outcomes',requested_outcomes,'cancelReason',cancel_reason)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  VALUES(requested_business,requested_operation,expected_actor,'finance.invoice_draft.save',1,expected_epoch,digest,expected_actor,'manual')
  ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN
   SELECT o.recovery_epoch,o.payload_hash,o.result INTO saved FROM crest_private.operations o
    WHERE (o.business_id,o.operation_id,o.command_type)=(requested_business,requested_operation,'finance.invoice_draft.save');
   IF NOT FOUND OR saved.recovery_epoch<>expected_epoch OR saved.payload_hash<>digest THEN
    RETURN jsonb_build_object('state','conflict','reason','operation');
   END IF;
   PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
   RETURN jsonb_build_object('state','committed','receipt',saved.result);
  END IF;

  PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  SELECT * INTO prior FROM crest.invoice_draft_revisions d WHERE (d.business_id,d.draft_id)=(requested_business,requested_draft)
   ORDER BY revision DESC LIMIT 1;
  IF coalesce(prior.revision,0)<>expected_revision OR prior.state='cancelled' OR prior.job_id<>requested_job THEN
   RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='INVOICE_DRAFT_REVISION_CONFLICT';
  END IF;
  SELECT customer_id INTO customer FROM crest.jobs WHERE (business_id,id)=(requested_business,requested_job) AND state<>'cancelled';
  IF cancel_reason IS NOT NULL THEN
   customer:=prior.customer_id; selection:=prior.selected_outcomes; lines:=prior.retained_lines; requested_due_on:=prior.due_on;
  ELSE
   IF customer IS NULL OR (prior.revision IS NOT NULL AND customer<>prior.customer_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_DRAFT_JOB_REQUIRED';
   END IF;
   selection:='{}'::uuid[]; lines:='[]'::jsonb;
   IF cardinality(requested_outcomes)>0 THEN
    source:=crest_commands.read_invoice_preparation($1,$2,$3,$4,$5,$6,$7,$8,requested_job);
    IF source->>'state'<>'ready' OR source->>'customerId'<>customer::text THEN
     RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_DRAFT_COMPLETED_SCOPE_REQUIRED';
    END IF;
    SELECT coalesce(array_agg((line->>'outcomeId')::uuid ORDER BY ord),'{}'::uuid[]),
      coalesce(jsonb_agg(line ORDER BY ord),'[]'::jsonb) INTO selection,lines
     FROM jsonb_array_elements(source->'lines') WITH ORDINALITY e(line,ord)
     WHERE (line->>'outcomeId')::uuid=ANY(requested_outcomes);
    IF cardinality(selection)<>cardinality(requested_outcomes) THEN
     RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_DRAFT_COMPLETED_SCOPE_REQUIRED';
    END IF;
   END IF;
  END IF;
  PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
   set_config('crest.operation_id',requested_operation::text,true);
  INSERT INTO crest.invoice_draft_revisions(business_id,draft_id,revision,job_id,customer_id,due_on,selected_outcomes,retained_lines,
   state,reason,created_by,operation_id,audit_event_id,origin)
  VALUES(requested_business,requested_draft,expected_revision+1,requested_job,customer,requested_due_on,selection,lines,
   CASE WHEN cancel_reason IS NULL THEN 'draft' ELSE 'cancelled' END,cancel_reason,expected_actor,requested_operation,audit,'manual')
  RETURNING * INTO fresh;
  receipt:=crest_private.invoice_draft_summary(fresh);
  INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
  VALUES(audit,requested_business,requested_operation,expected_actor,expected_actor,'invoice_draft_revisions',requested_draft,fresh.revision,
   CASE WHEN cancel_reason IS NOT NULL THEN 'cancel' WHEN expected_revision=0 THEN 'create' ELSE 'revise' END,cancel_reason,
   jsonb_build_object('schemaVersion',1,'before',CASE WHEN expected_revision>0 THEN crest_private.invoice_draft_summary(prior) END,'after',receipt),'manual');
  UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
   WHERE business_id=requested_business AND operation_id=requested_operation;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_DRAFT_AUDIT_REQUIRED'; END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',receipt);
 EXCEPTION WHEN SQLSTATE 'P1001' THEN
  RETURN jsonb_build_object('state','conflict','reason','revision','currentRevision',coalesce(prior.revision,0)::text);
 END;
END $save$;

CREATE FUNCTION crest_commands.read_invoice_draft(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_draft uuid,requested_revision bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE saved crest.invoice_draft_revisions;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_draft IS NULL OR (requested_revision IS NOT NULL AND requested_revision<=0) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_DRAFT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT * INTO saved FROM crest.invoice_draft_revisions d WHERE (d.business_id,d.draft_id)=(requested_business,requested_draft)
  AND (requested_revision IS NULL OR d.revision=requested_revision) ORDER BY d.revision DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 RETURN jsonb_build_object('state','found','receipt',crest_private.invoice_draft_summary(saved),'lines',saved.retained_lines);
END $read$;

CREATE FUNCTION crest_commands.list_invoice_drafts(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_job uuid,after_draft uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $list$
DECLARE drafts jsonb; more boolean;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_DRAFT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 WITH candidate AS (
  SELECT DISTINCT ON (d.draft_id) d AS version_row,d.draft_id FROM crest.invoice_draft_revisions d
  WHERE (d.business_id,d.job_id)=(requested_business,requested_job) AND (after_draft IS NULL OR d.draft_id>after_draft)
  ORDER BY d.draft_id,d.revision DESC LIMIT 26
 ), page AS (SELECT version_row,draft_id FROM candidate ORDER BY draft_id LIMIT 25)
 SELECT coalesce(jsonb_agg(crest_private.invoice_draft_summary(version_row) ORDER BY draft_id),'[]'::jsonb),
  (SELECT count(*)>25 FROM candidate) INTO drafts,more FROM page;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jobId',requested_job,'hasMore',more,'rows',drafts);
END $list$;

CREATE FUNCTION crest_commands.lookup_invoice_draft_operation(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_operation uuid,original_epoch uuid,requested_draft uuid,expected_revision bigint,requested_job uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE saved record; draft crest.invoice_draft_revisions; evidence record;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR original_epoch IS NULL OR requested_draft IS NULL OR requested_job IS NULL
  OR expected_revision IS NULL OR expected_revision NOT BETWEEN 0 AND 9223372036854775806 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_DRAFT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 SELECT o.id,o.command_type,o.recovery_epoch,o.result,o.payload_hash INTO saved FROM crest_private.operations o
 WHERE (o.business_id,o.operation_id,o.actor_id,o.state)=(requested_business,requested_operation,expected_actor,'committed');
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF saved.command_type='finance.invoice_draft.retire' THEN
  IF (saved.result->>'recoveryEpoch',saved.result->'receipt'->>'draftId',saved.result->'receipt'->>'jobId',saved.result->'receipt'->>'expectedRevision')
   IS DISTINCT FROM (original_epoch::text,requested_draft::text,requested_job::text,expected_revision::text) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  SELECT a.reason,a.delta INTO STRICT evidence FROM crest_private.audit_events a
  WHERE (a.business_id,a.operation_id,a.actor_id,a.entity_kind,a.entity_id,a.action)=
   (requested_business,requested_operation,expected_actor,'operations',saved.id,'retire')
   AND a.id::text=saved.result->'receipt'->>'auditEventId';
  IF saved.result->'receipt'->>'reviewEpoch' IS DISTINCT FROM saved.recovery_epoch::text
   OR evidence.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',saved.result)
   OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to((saved.result||jsonb_build_object('actorId',expected_actor,'reason',evidence.reason))::text,'UTF8')),'hex') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_DRAFT_AUDIT_REQUIRED';
  END IF;
  RETURN saved.result;
 END IF;
 SELECT * INTO STRICT draft FROM crest.invoice_draft_revisions d
 WHERE (d.business_id,d.operation_id,d.created_by)=(requested_business,requested_operation,expected_actor);
 IF (saved.recovery_epoch,draft.draft_id,draft.job_id,draft.revision) IS DISTINCT FROM
  (original_epoch,requested_draft,requested_job,expected_revision+1) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 IF saved.result IS DISTINCT FROM crest_private.invoice_draft_summary(draft) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_DRAFT_AUDIT_REQUIRED';
 END IF;
 RETURN jsonb_build_object('state','committed','receipt',saved.result);
END $lookup$;

CREATE FUNCTION crest_commands.retire_invoice_draft_operation(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,review_epoch uuid,
 requested_operation uuid,original_epoch uuid,requested_draft uuid,expected_revision bigint,requested_job uuid,requested_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE claim uuid; audit uuid:=gen_random_uuid(); decision jsonb; digest text; existing jsonb;
BEGIN
 IF requested_reason IS NULL OR char_length(requested_reason) NOT BETWEEN 1 AND 1000
  OR requested_reason<>btrim(requested_reason) OR requested_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_DRAFT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 existing:=crest_commands.lookup_invoice_draft_operation($1,$2,$3,$4,$5,$6,$7,$8,$10,$11,$12,$13,$14);
 IF existing->>'state'='committed' OR existing->>'state'='retired' THEN RETURN existing; END IF;
 IF existing->>'state'='conflict' THEN RETURN existing; END IF;
 decision:=jsonb_build_object('schemaVersion',1,'state','retired','operationId',requested_operation,'recoveryEpoch',original_epoch,
  'receipt',jsonb_build_object('schemaVersion',1,'draftId',requested_draft,'jobId',requested_job,
   'expectedRevision',expected_revision::text,'auditEventId',audit,'reviewEpoch',review_epoch));
 digest:=encode(sha256(convert_to((decision||jsonb_build_object('actorId',expected_actor,'reason',requested_reason))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.invoice_draft.retire',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_commands.lookup_invoice_draft_operation($1,$2,$3,$4,$5,$6,$7,$8,$10,$11,$12,$13,$14);
  IF existing->>'state' IN('committed','retired') THEN RETURN existing; END IF;
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(audit,requested_business,requested_operation,expected_actor,expected_actor,'operations',claim,1,'retire',requested_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',decision),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=decision
  WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.finish_financial_retirement_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,requested_operation);
 RETURN decision;
END $retire$;

REVOKE ALL ON FUNCTION crest_private.invoice_draft_summary(crest.invoice_draft_revisions),crest_private.verify_invoice_draft_revision(),
 crest_commands.save_invoice_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,uuid,date,uuid[],text),
 crest_commands.read_invoice_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint),
 crest_commands.list_invoice_drafts(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),
 crest_commands.lookup_invoice_draft_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,uuid),
 crest_commands.retire_invoice_draft_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.invoice_draft_summary(crest.invoice_draft_revisions) TO crest_finance_integrity_owner,crest_finance_account_owner;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.verify_invoice_draft_revision() OWNER TO crest_finance_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.save_invoice_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,uuid,date,uuid[],text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_invoice_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.list_invoice_drafts(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_invoice_draft_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,uuid) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_invoice_draft_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
GRANT EXECUTE ON FUNCTION crest_commands.read_invoice_preparation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 TO crest_finance_account_owner;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_invoice_draft_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,uuid) TO crest_finance_account_owner;
GRANT EXECUTE ON FUNCTION
 crest_commands.save_invoice_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,uuid,date,uuid[],text),
 crest_commands.read_invoice_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint),
 crest_commands.list_invoice_drafts(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),
 crest_commands.lookup_invoice_draft_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,uuid),
 crest_commands.retire_invoice_draft_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text) TO crest_finance_preview;
