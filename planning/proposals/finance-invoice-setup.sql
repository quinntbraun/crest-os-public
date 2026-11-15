-- Held fictional setup. No production activation, balance, posting or period unlock.
SET LOCAL ROLE crest_schema_owner;

CREATE POLICY invoice_setup_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.invoice_setup.configure');
CREATE POLICY invoice_setup_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind IN('invoice_series','accounting_periods') AND action='configure');
GRANT SELECT(recovery_epoch) ON crest_private.operations TO crest_finance_integrity_owner;
CREATE POLICY invoice_setup_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='finance.invoice_setup.configure');
CREATE POLICY invoice_setup_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.invoice_setup.configure' AND schema_version=1 AND state='pending'
  AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY invoice_setup_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.invoice_setup.configure' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.invoice_setup.configure' AND state='committed');
CREATE POLICY invoice_setup_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind IN('invoice_series','accounting_periods') AND action='configure' AND origin='manual' AND import_row_id IS NULL);

GRANT INSERT(business_id,label,recovery_epoch,kind,approval_reason,created_by,operation_id) ON crest.invoice_series TO crest_finance_account_owner;
GRANT INSERT(business_id,starts_on,through_on,time_zone,opening_boundary,created_by,operation_id) ON crest.accounting_periods TO crest_finance_account_owner;
CREATE POLICY invoice_setup_series_insert ON crest.invoice_series FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND kind='original' AND incident_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o
   WHERE o.business_id=invoice_series.business_id AND o.operation_id=invoice_series.operation_id
    AND o.actor_id=invoice_series.created_by AND o.recovery_epoch=invoice_series.recovery_epoch
    AND o.command_type='finance.invoice_setup.configure' AND o.state='pending'));
CREATE POLICY invoice_setup_period_insert ON crest.accounting_periods FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND EXISTS(SELECT FROM crest_private.operations o
   WHERE o.business_id=accounting_periods.business_id AND o.operation_id=accounting_periods.operation_id
    AND o.actor_id=accounting_periods.created_by
    AND o.command_type='finance.invoice_setup.configure' AND o.state='pending'));

CREATE FUNCTION crest_private.fictional_invoice_series_snapshot(series crest.invoice_series)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $snapshot$
 SELECT jsonb_build_object('id',series.id,'label',series.label,'recoveryEpoch',series.recovery_epoch,'kind',series.kind)
$snapshot$;
CREATE FUNCTION crest_private.fictional_accounting_period_snapshot(period crest.accounting_periods)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $snapshot$
 SELECT jsonb_build_object('id',period.id,'startsOn',to_char(period.starts_on,'YYYY-MM-DD'),
  'throughOn',to_char(period.through_on,'YYYY-MM-DD'),'timeZone',period.time_zone,'openingBoundary',period.opening_boundary)
$snapshot$;

CREATE FUNCTION crest_private.verify_fictional_invoice_setup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE o record; snapshot jsonb; setup_kind text;
BEGIN
 SELECT p.state,p.recovery_epoch,p.result INTO o FROM crest_private.operations p WHERE (p.business_id,p.operation_id,p.actor_id)=
  (NEW.business_id,NEW.operation_id,NEW.created_by) AND p.command_type='finance.invoice_setup.configure';
 -- Historic source and special incident recovery use their own provenance.
 -- Ordinary inserts through the finance policy can only reach this branch.
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='invoice_series' THEN
  setup_kind:='invoice_series';
  snapshot:=crest_private.fictional_invoice_series_snapshot(NEW);
  IF NEW.kind<>'original' OR NEW.recovery_epoch<>o.recovery_epoch OR NEW.approval_reason IS DISTINCT FROM o.result->>'reason' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_SETUP_APPROVAL_REQUIRED';
  END IF;
 ELSE
  setup_kind:='accounting_period';
  snapshot:=crest_private.fictional_accounting_period_snapshot(NEW);
 END IF;
 IF o.state<>'committed' OR o.result IS DISTINCT FROM jsonb_build_object(
  'schemaVersion',1,'businessId',NEW.business_id,'operationId',NEW.operation_id,'kind',setup_kind,'record',snapshot,
  'auditEventId',o.result->'auditEventId','reason',o.result->'reason'
 ) OR NOT EXISTS(SELECT FROM crest_private.audit_events a
  WHERE (a.business_id,a.operation_id,a.actor_id,a.entity_kind,a.entity_id,a.entity_version,a.action)=
   (NEW.business_id,NEW.operation_id,NEW.created_by,TG_TABLE_NAME,NEW.id,1,'configure')
   AND a.id::text=o.result->>'auditEventId' AND a.reason=o.result->>'reason'
   AND a.origin='manual' AND a.import_row_id IS NULL
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',o.result)
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_SETUP_APPROVAL_REQUIRED';
 END IF;
 RETURN NULL;
END $verify$;
CREATE CONSTRAINT TRIGGER invoice_series_setup_audited AFTER INSERT ON crest.invoice_series
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_fictional_invoice_setup();
CREATE CONSTRAINT TRIGGER accounting_period_setup_audited AFTER INSERT ON crest.accounting_periods
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_fictional_invoice_setup();

CREATE FUNCTION crest_commands.configure_fictional_invoice_setup(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 expected_epoch uuid, requested_operation uuid, request jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $configure$
DECLARE setup_kind text; reason text; label text; requested_start date; month_boundary date; opening_start date;
 series crest.invoice_series; period crest.accounting_periods; saved record; context jsonb; zone text; today date;
 digest text; claim uuid; record_id uuid; entity_kind text; snapshot jsonb; receipt jsonb; event_id uuid:=gen_random_uuid();
BEGIN
 IF requested_operation IS NULL OR jsonb_typeof(request) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_SETUP_INPUT_REQUIRED';
 END IF;
 setup_kind:=request->>'kind'; reason:=request->>'reason';
 IF jsonb_typeof(request->'reason') IS DISTINCT FROM 'string'
  OR char_length(reason) NOT BETWEEN 1 AND 1000 OR reason<>btrim(reason) OR reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_SETUP_INPUT_REQUIRED';
 END IF;
 CASE setup_kind
 WHEN 'invoice_series' THEN
  label:=request->>'label';
  IF request-ARRAY['kind','label','reason']<>'{}'::jsonb OR jsonb_typeof(request->'label') IS DISTINCT FROM 'string'
   OR label!~'^[A-Za-z0-9][A-Za-z0-9-]{0,79}$' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_SETUP_INPUT_REQUIRED';
  END IF;
 WHEN 'accounting_period' THEN
  IF request-ARRAY['kind','startsOn','reason']<>'{}'::jsonb OR jsonb_typeof(request->'startsOn') IS DISTINCT FROM 'string'
   OR request->>'startsOn'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_SETUP_INPUT_REQUIRED';
  END IF;
  BEGIN
   requested_start:=(request->>'startsOn')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_SETUP_INPUT_REQUIRED';
  END;
 ELSE
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_SETUP_INPUT_REQUIRED';
 END CASE;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.invoice_setup.configure',1,requested_business,expected_actor,
  expected_epoch,request)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.invoice_setup.configure',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
  WHERE (o.business_id,o.operation_id,o.actor_id)=(requested_business,requested_operation,expected_actor)
   AND o.command_type='finance.invoice_setup.configure' AND o.state='committed';
  IF NOT FOUND OR (saved.payload_hash,saved.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;

 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 context:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=context->>'timezone';
 today:=(clock_timestamp() AT TIME ZONE zone)::date;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 IF setup_kind='invoice_series' THEN
  -- The ordinary command never creates a recovery namespace or guesses prior numbers.
  IF EXISTS(SELECT FROM crest.invoice_series s WHERE s.business_id=requested_business)
   OR EXISTS(SELECT FROM crest.invoice_number_reservations n WHERE n.business_id=requested_business) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_ORIGINAL_SERIES_ALREADY_CONFIGURED';
  END IF;
  INSERT INTO crest.invoice_series(business_id,label,recovery_epoch,kind,approval_reason,created_by,operation_id)
  VALUES(requested_business,label,expected_epoch,'original',reason,expected_actor,requested_operation) RETURNING * INTO series;
  record_id:=series.id;
  entity_kind:='invoice_series';
  snapshot:=crest_private.fictional_invoice_series_snapshot(series);
 ELSE
  month_boundary:=date_trunc('month',requested_start::timestamp)::date;
  SELECT p.starts_on INTO opening_start FROM crest.accounting_periods p WHERE p.business_id=requested_business AND p.opening_boundary;
  IF requested_start>today OR (opening_start IS NOT NULL AND (requested_start<=opening_start OR requested_start<>month_boundary))
   OR (opening_start IS NULL AND EXISTS(SELECT FROM crest.accounting_periods p WHERE p.business_id=requested_business)) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ACCOUNTING_PERIOD_OPENING_ORDER_REQUIRED';
  END IF;
  IF EXISTS(SELECT FROM crest.accounting_periods p WHERE (p.business_id,p.month_start)=(requested_business,month_boundary)) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ACCOUNTING_PERIOD_ALREADY_CONFIGURED';
  END IF;
  INSERT INTO crest.accounting_periods(business_id,starts_on,through_on,time_zone,opening_boundary,created_by,operation_id)
  VALUES(requested_business,requested_start,(month_boundary+interval '1 month - 1 day')::date,zone,opening_start IS NULL,
   expected_actor,requested_operation) RETURNING * INTO period;
  record_id:=period.id;
  entity_kind:='accounting_periods';
  snapshot:=crest_private.fictional_accounting_period_snapshot(period);
 END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',requested_operation,'kind',setup_kind,
  'record',snapshot,'auditEventId',event_id,'reason',reason);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(event_id,requested_business,requested_operation,expected_actor,expected_actor,entity_kind,record_id,1,'configure',reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $configure$;

CREATE FUNCTION crest_commands.read_fictional_invoice_setup(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid, requested_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE context jsonb; zone text; today date; selected date; series jsonb; opening_period jsonb; selected_period jsonb;
BEGIN
 IF requested_on IS NOT NULL AND requested_on NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_SETUP_INPUT_REQUIRED';
 END IF;
 context:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=context->>'timezone';
 today:=(clock_timestamp() AT TIME ZONE zone)::date;
 selected:=coalesce(requested_on,today);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT crest_private.fictional_invoice_series_snapshot(s)||jsonb_build_object('operationId',s.operation_id)
 INTO series FROM crest.invoice_series s JOIN crest_private.finance_controls f ON f.business_id=s.business_id
 JOIN crest_private.business_recovery_authorities a ON (a.business_id,a.id)=(f.business_id,f.recovery_authority_id)
 WHERE s.business_id=requested_business AND s.recovery_epoch=a.active_epoch;
 SELECT crest_private.fictional_accounting_period_snapshot(p)||jsonb_build_object('operationId',p.operation_id)
 INTO opening_period FROM crest.accounting_periods p WHERE p.business_id=requested_business AND p.opening_boundary;
 SELECT crest_private.fictional_accounting_period_snapshot(p)||jsonb_build_object('operationId',p.operation_id,
  'state',CASE WHEN l.state='locked' THEN 'locked' ELSE 'open' END,'generation',coalesce(l.generation,0)::text)
 INTO selected_period FROM crest.accounting_periods p LEFT JOIN LATERAL (
  SELECT h.state,h.generation FROM crest.accounting_period_locks h
  WHERE (h.business_id,h.period_id)=(p.business_id,p.id) ORDER BY h.generation DESC LIMIT 1
 ) l ON true WHERE p.business_id=requested_business AND p.time_zone=zone AND selected BETWEEN p.starts_on AND p.through_on;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'today',to_char(today,'YYYY-MM-DD'),
  'requestedOn',to_char(selected,'YYYY-MM-DD'),'timeZone',zone,'series',series,'openingPeriod',opening_period,'period',selected_period);
END $read$;

RESET ROLE;
ALTER FUNCTION crest_private.verify_fictional_invoice_setup() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.verify_fictional_invoice_setup(),crest_private.fictional_invoice_series_snapshot(crest.invoice_series),
 crest_private.fictional_accounting_period_snapshot(crest.accounting_periods) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_invoice_series_snapshot(crest.invoice_series),
 crest_private.fictional_accounting_period_snapshot(crest.accounting_periods) TO crest_finance_integrity_owner,crest_finance_account_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.configure_fictional_invoice_setup(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_invoice_setup(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.configure_fictional_invoice_setup(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb),
 crest_commands.read_fictional_invoice_setup(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.configure_fictional_invoice_setup(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb),
 crest_commands.read_fictional_invoice_setup(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date) TO crest_finance_preview;
