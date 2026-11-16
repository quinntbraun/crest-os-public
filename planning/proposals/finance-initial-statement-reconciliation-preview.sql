-- Held review for the first complete dedicated statement from a verified zero
-- opening. This reads an exact balance and timing snapshot without clearance.
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.review_fictional_initial_statement_reconciliation(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_statement uuid,
 requested_revision bigint,timing_evidence jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET datestyle='ISO, YMD' AS $review$
DECLARE authority jsonb; statement crest.statement_imports; draft crest.statement_match_draft_revisions;
 channel crest.money_channel_versions; review jsonb; bridge boolean;
BEGIN
 IF requested_statement IS NULL OR requested_revision IS NULL OR requested_revision<1
  OR jsonb_typeof(timing_evidence) IS DISTINCT FROM 'array' OR octet_length(timing_evidence::text)>30000
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_RECONCILIATION_INPUT_REQUIRED'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(timing_evidence) note WHERE jsonb_typeof(note) IS DISTINCT FROM 'object'
  OR NOT note ?& ARRAY['movementId','expectedClearOn','reason'] OR note-ARRAY['movementId','expectedClearOn','reason']<>'{}'::jsonb
  OR jsonb_typeof(note->'movementId') IS DISTINCT FROM 'string' OR note->>'movementId'!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  OR jsonb_typeof(note->'expectedClearOn') IS DISTINCT FROM 'string' OR note->>'expectedClearOn'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR jsonb_typeof(note->'reason') IS DISTINCT FROM 'string' OR char_length(note->>'reason') NOT BETWEEN 1 AND 1000
  OR note->>'reason'<>btrim(note->>'reason') OR note->>'reason'~'[[:cntrl:]]')
  OR EXISTS(SELECT FROM jsonb_array_elements(timing_evidence) note GROUP BY note->>'movementId' HAVING count(*)<>1)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_RECONCILIATION_TIMING_EVIDENCE_REQUIRED'; END IF;

 authority:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 PERFORM FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 SELECT * INTO statement FROM crest.statement_imports s WHERE (s.business_id,s.id)=(requested_business,requested_statement);
 SELECT * INTO draft FROM crest.statement_match_draft_revisions d WHERE (d.business_id,d.statement_id)=(requested_business,requested_statement)
  ORDER BY d.revision DESC LIMIT 1;
 IF statement.id IS NULL OR draft.revision IS DISTINCT FROM requested_revision
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='STATEMENT_RECONCILIATION_CURRENT_DRAFT_REQUIRED'; END IF;
 IF statement.ends_on>(statement_timestamp() AT TIME ZONE (authority->>'timezone'))::date
  OR EXISTS(SELECT FROM jsonb_array_elements(timing_evidence) note WHERE (note->>'expectedClearOn')::date<=statement.ends_on)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_RECONCILIATION_TIMING_DATE_REQUIRED'; END IF;
 SELECT * INTO STRICT channel FROM crest.money_channel_versions c
  WHERE (c.business_id,c.id)=(requested_business,statement.channel_version_id);
 bridge:=channel.ownership_scope='dedicated_business' AND channel.opening_state='verified_zero' AND channel.opening_cents=0
  AND channel.opening_on=statement.starts_on AND statement.opening_cents=0
  AND NOT EXISTS(SELECT FROM crest.journal_lines l JOIN crest.journal_entries j ON (j.business_id,j.id)=(l.business_id,l.entry_id)
   JOIN crest.financial_events f ON (f.business_id,f.id)=(j.business_id,j.event_id)
   WHERE l.business_id=requested_business AND l.account_id=statement.account_id AND f.effective_on<statement.starts_on);

 WITH allocations AS MATERIALIZED (
  SELECT (item->>'statementRowId')::uuid AS statement_row,(item->>'movementId')::uuid AS movement,
   (item->>'signedCents')::numeric AS cents FROM jsonb_array_elements(draft.allocations) item
 ), statement_rows AS MATERIALIZED (
  SELECT r.id,r.signed_cents FROM crest.statement_import_rows r WHERE (r.business_id,r.statement_id)=(requested_business,requested_statement)
 ), movements AS MATERIALIZED (
  SELECT m.id,f.id AS event,f.effective_on,m.signed_cents FROM crest.money_movements m
  JOIN crest.financial_events f ON (f.business_id,f.id)=(m.business_id,m.event_id)
  WHERE m.business_id=requested_business AND m.account_id=statement.account_id AND f.effective_on<=statement.ends_on
 ), row_matches AS MATERIALIZED (
  SELECT a.statement_row AS id,sum(a.cents) AS cents FROM allocations a GROUP BY a.statement_row
 ), movement_matches AS MATERIALIZED (
  SELECT a.movement AS id,sum(a.cents) AS cents FROM allocations a GROUP BY a.movement
 ), remainder AS MATERIALIZED (
  SELECT m.*,m.signed_cents-coalesce(a.cents,0) AS left_cents FROM movements m LEFT JOIN movement_matches a USING(id)
 ), notes AS MATERIALIZED (
  SELECT (note->>'movementId')::uuid AS id,(note->>'expectedClearOn')::date AS clear_on,note->>'reason' AS reason
  FROM jsonb_array_elements(timing_evidence) note
 ), gaps AS (
  SELECT count(*) AS unmatched_rows FROM statement_rows r LEFT JOIN row_matches a USING(id)
  WHERE r.signed_cents<>coalesce(a.cents,0)
 ), evidence AS (
  SELECT coalesce(sum(r.left_cents) FILTER(WHERE n.id IS NOT NULL),0) AS supported,
   count(*) FILTER(WHERE n.id IS NULL AND r.left_cents<>0) AS missing,
   coalesce(jsonb_agg(jsonb_build_object('movementId',r.id,'eventId',r.event,'effectiveOn',r.effective_on,
    'signedCents',r.left_cents::text,'expectedClearOn',n.clear_on,'reason',n.reason)
    ORDER BY r.effective_on,r.id) FILTER(WHERE r.left_cents<>0),'[]'::jsonb) AS timing
  FROM remainder r LEFT JOIN notes n USING(id)
 ), book AS (
  SELECT coalesce(sum(l.debit_cents-l.credit_cents),0) AS balance FROM crest.journal_lines l
  JOIN crest.journal_entries j ON (j.business_id,j.id)=(l.business_id,l.entry_id)
  JOIN crest.financial_events f ON (f.business_id,f.id)=(j.business_id,j.event_id)
  WHERE l.business_id=requested_business AND l.account_id=statement.account_id AND f.effective_on<=statement.ends_on
 ), checks AS (
  SELECT bridge AS opening_ties,statement.statement_difference_cents=0 AS statement_ties,gaps.unmatched_rows=0 AS rows_matched,
   evidence.missing=0 AS timing_supported,book.balance=statement.closing_cents+evidence.supported AS book_ties,
   book.balance=coalesce((SELECT sum(signed_cents) FROM movements),0) AS book_sources_tie,
   NOT EXISTS(SELECT FROM allocations a LEFT JOIN statement_rows r ON a.statement_row=r.id
    LEFT JOIN movements m ON a.movement=m.id WHERE r.id IS NULL OR m.id IS NULL OR sign(a.cents)<>sign(r.signed_cents)
     OR sign(a.cents)<>sign(m.signed_cents)) AND NOT EXISTS(SELECT FROM remainder r WHERE abs(r.left_cents)>abs(r.signed_cents)
      OR r.left_cents<>0 AND sign(r.left_cents)<>sign(r.signed_cents)) AS allocations_valid,
   NOT EXISTS(SELECT FROM notes n LEFT JOIN remainder r USING(id) WHERE r.id IS NULL OR r.left_cents=0) AS notes_valid
  FROM evidence CROSS JOIN book CROSS JOIN gaps
 )
 SELECT jsonb_build_object('schemaVersion',1,'scope','initial_dedicated_statement_review','businessId',requested_business,
  'statementId',statement.id,'accountId',statement.account_id,'channelVersionId',statement.channel_version_id,
  'startsOn',statement.starts_on,'endsOn',statement.ends_on,'draftRevision',draft.revision::text,'draftOperationId',draft.operation_id,
  'fileSha256',statement.file_sha256,'rowsSha256',statement.rows_sha256,'openingCents',statement.opening_cents::text,
  'closingCents',statement.closing_cents::text,'statementDifferenceCents',statement.statement_difference_cents::text,
  'bookCents',book.balance::text,'supportedOutstandingCents',evidence.supported::text,
  'bookDifferenceCents',(book.balance-statement.closing_cents-evidence.supported)::text,'unmatchedRows',gaps.unmatched_rows,
  'timingItems',evidence.timing,'allocations',draft.allocations,'checks',to_jsonb(checks),'readyForApprovalReview',
  opening_ties AND statement_ties AND rows_matched AND timing_supported AND book_ties AND book_sources_tie AND allocations_valid AND notes_valid)
 INTO review FROM checks CROSS JOIN evidence CROSS JOIN book CROSS JOIN gaps;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN review||jsonb_build_object('planSha256',encode(sha256(convert_to(review::text,'UTF8')),'hex'));
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_RECONCILIATION_TIMING_DATE_REQUIRED';
END $review$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.review_fictional_initial_statement_reconciliation(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.review_fictional_initial_statement_reconciliation(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,jsonb) TO crest_finance_preview;
