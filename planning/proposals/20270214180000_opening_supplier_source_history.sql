-- HELD; authenticated, paginated access to retained sources. No copy/write or approval.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_fictional_opening_payables_history(credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,business uuid,epoch uuid,before_at timestamptz,before_id uuid,page_size integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE selected record; entries jsonb:='[]'; cursor jsonb:=NULL; count integer:=0; more boolean:=false;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true);
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 20 OR (before_at IS NULL)<>(before_id IS NULL) OR (before_at IS NOT NULL AND NOT isfinite(before_at)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_SOURCE_HISTORY_INPUT_REQUIRED'; END IF;
 FOR selected IN SELECT r.id,r.revision,r.recorded_at,w.revision AS worksheet_revision,w.cutover_on,
  jsonb_array_length(r.evidence->'bills') AS item_count
  FROM crest.opening_payables_schedule_revisions r JOIN crest.opening_worksheet_revisions w ON w.business_id=r.business_id AND w.id=r.worksheet_revision_id
  WHERE r.business_id=business AND (before_at IS NULL OR (r.recorded_at,r.id)<(before_at,before_id))
  ORDER BY r.recorded_at DESC,r.id DESC LIMIT page_size+1 LOOP
  IF count=page_size THEN more:=true;EXIT;END IF;count:=count+1;
  entries:=entries||jsonb_build_array(jsonb_build_object('revisionId',selected.id,'worksheetRevision',selected.worksheet_revision::text,
   'revision',selected.revision::text,'cutoverOn',selected.cutover_on::text,'recordedAt',to_char(selected.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'itemCount',selected.item_count));
  cursor:=jsonb_build_object('recordedAt',to_char(selected.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',selected.id);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'kind','payables','entries',entries,'nextCursor',CASE WHEN more THEN cursor END);
END $history$;
CREATE FUNCTION crest_commands.read_fictional_opening_payables_revision(credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,business uuid,epoch uuid,revision_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $revision$
DECLARE saved crest.opening_payables_schedule_revisions; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true);
 IF revision_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_SOURCE_HISTORY_INPUT_REQUIRED';END IF;
 SELECT * INTO saved FROM crest.opening_payables_schedule_revisions r WHERE r.business_id=business AND r.id=revision_id;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'schedule',CASE WHEN saved.id IS NOT NULL THEN crest_private.opening_payables_receipt(saved) END);
END $revision$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_opening_payables_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_opening_payables_revision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_opening_payables_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer),crest_commands.read_fictional_opening_payables_revision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_opening_payables_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer),crest_commands.read_fictional_opening_payables_revision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_finance_preview;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_fictional_opening_allocations_history(credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,business uuid,epoch uuid,before_at timestamptz,before_id uuid,page_size integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE selected record; entries jsonb:='[]'; cursor jsonb:=NULL; count integer:=0; more boolean:=false;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true);
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 20 OR (before_at IS NULL)<>(before_id IS NULL) OR (before_at IS NOT NULL AND NOT isfinite(before_at)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_SOURCE_HISTORY_INPUT_REQUIRED'; END IF;
 FOR selected IN SELECT r.id,r.revision,r.recorded_at,w.revision AS worksheet_revision,w.cutover_on,
  jsonb_array_length(r.evidence->'roots') AS item_count
  FROM crest.opening_allocations_schedule_revisions r JOIN crest.opening_worksheet_revisions w ON w.business_id=r.business_id AND w.id=r.worksheet_revision_id
  WHERE r.business_id=business AND (before_at IS NULL OR (r.recorded_at,r.id)<(before_at,before_id))
  ORDER BY r.recorded_at DESC,r.id DESC LIMIT page_size+1 LOOP
  IF count=page_size THEN more:=true;EXIT;END IF;count:=count+1;
  entries:=entries||jsonb_build_array(jsonb_build_object('revisionId',selected.id,'worksheetRevision',selected.worksheet_revision::text,
   'revision',selected.revision::text,'cutoverOn',selected.cutover_on::text,'recordedAt',to_char(selected.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'itemCount',selected.item_count));
  cursor:=jsonb_build_object('recordedAt',to_char(selected.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',selected.id);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'kind','allocations','entries',entries,'nextCursor',CASE WHEN more THEN cursor END);
END $history$;
CREATE FUNCTION crest_commands.read_fictional_opening_allocations_revision(credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,business uuid,epoch uuid,revision_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $revision$
DECLARE saved crest.opening_allocations_schedule_revisions; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true);
 IF revision_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_SOURCE_HISTORY_INPUT_REQUIRED';END IF;
 SELECT * INTO saved FROM crest.opening_allocations_schedule_revisions r WHERE r.business_id=business AND r.id=revision_id;
 IF saved.id IS NULL THEN RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'schedule',NULL,'supplierSchedule',NULL);END IF;
 result:=crest_private.opening_allocations_private_response(jsonb_build_object('state','committed','receipt',crest_private.opening_allocations_receipt(saved)));
 RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'schedule',result->'receipt','supplierSchedule',result->'supplierSchedule');
END $revision$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_opening_allocations_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_opening_allocations_revision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_opening_allocations_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer),crest_commands.read_fictional_opening_allocations_revision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_opening_allocations_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer),crest_commands.read_fictional_opening_allocations_revision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_finance_preview;
SET LOCAL ROLE crest_schema_owner;
RESET ROLE;
