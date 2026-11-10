-- BR10 scoped review-message history. Exact reviewed reader and private web grant.

-- BEGIN REVIEWED planning/proposals/review-message-history.sql
-- P10/BR10 review history over registered schema 64. Read only.
-- Historical message text and recipients remain in their existing scoped readers.
DO $predecessor$
BEGIN
 IF to_regprocedure('crest_commands.read_review_message_outcome(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)') IS NULL
  OR to_regclass('crest.message_events') IS NULL
  OR to_regclass('crest.review_requests') IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='CREST_REVIEW_HISTORY_SOURCE_REQUIRED';
 END IF;
END $predecessor$;

CREATE FUNCTION crest_commands.read_review_message_history(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 scope_kind text,scope_id uuid,cursor_source text,cursor_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE authority jsonb; page jsonb; cursor_exists boolean;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF scope_kind IS NULL OR scope_kind NOT IN ('job','customer') OR scope_id IS NULL
  OR (cursor_id IS NULL)<>(cursor_source IS NULL)
  OR cursor_source IS NOT NULL AND cursor_source NOT IN ('event','request') THEN
  RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_REVIEW_HISTORY_INPUT_REQUIRED';
 END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),
  set_config('crest.actor_id',authority->>'actorId',true);

 WITH requests AS MATERIALIZED (
  SELECT r.id,r.business_id,r.job_id,r.customer_id,r.message_id,r.state,r.suppression_reason,r.reason,r.created_at,r.created_by
  FROM crest.review_requests r
  WHERE r.business_id=requested_business
   AND (scope_kind='job' AND r.job_id=scope_id OR scope_kind='customer' AND r.customer_id=scope_id)
 ), entries AS MATERIALIZED (
  SELECT 'event'::text AS source,e.id,r.job_id,r.customer_id,r.id AS request_id,m.id AS message_id,e.kind,m.channel,
   NULL::text AS suppression,e.reason,e.effective_at,e.created_at,e.created_by
  FROM requests r
  JOIN crest.messages m ON m.business_id=r.business_id AND m.id=r.message_id AND m.request_id=r.id AND m.job_id=r.job_id
  JOIN crest.message_events e ON e.business_id=m.business_id AND e.message_id=m.id AND e.job_id=m.job_id
  UNION ALL
  SELECT 'request',r.id,r.job_id,r.customer_id,r.id,NULL,r.state,NULL,
   r.suppression_reason,r.reason,r.created_at,r.created_at,r.created_by
  FROM requests r WHERE r.message_id IS NULL
 ), anchor AS (
  SELECT e.created_at,e.source,e.id FROM entries e WHERE e.source=cursor_source AND e.id=cursor_id
 ), bounded AS (
  SELECT e.* FROM entries e
  WHERE cursor_id IS NULL OR (e.created_at,e.source,e.id)<(SELECT a.created_at,a.source,a.id FROM anchor a)
  ORDER BY e.created_at DESC,e.source DESC,e.id DESC LIMIT 21
 ), numbered AS (
  SELECT b.*,row_number() OVER (ORDER BY b.created_at DESC,b.source DESC,b.id DESC) AS position FROM bounded b
 )
 SELECT cursor_id IS NULL OR EXISTS(SELECT 1 FROM anchor),jsonb_build_object(
  'schemaVersion',1,'businessId',requested_business,'scope',jsonb_build_object('kind',scope_kind,'id',scope_id),
  'entries',coalesce(jsonb_agg(jsonb_build_object(
   'source',n.source,'id',n.id,'jobId',n.job_id,'customerId',n.customer_id,'requestId',n.request_id,
   'messageId',n.message_id,'kind',n.kind,'channel',n.channel,'suppression',n.suppression,'reason',n.reason,
   'effectiveAt',to_char(n.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'recordedAt',to_char(n.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'actorId',n.created_by
  ) ORDER BY n.position) FILTER (WHERE n.position<=20),'[]'::jsonb),
  'next',CASE WHEN count(*)=21 THEN (
   SELECT jsonb_build_object('source',n2.source,'id',n2.id) FROM numbered n2 WHERE n2.position=20
  ) END
 ) INTO cursor_exists,page FROM numbered n;

 IF NOT cursor_exists THEN
  RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_REVIEW_HISTORY_CURSOR_UNAVAILABLE';
 END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN page;
END $history$;
ALTER FUNCTION crest_commands.read_review_message_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,text,uuid)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_review_message_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,text,uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION crest_commands.read_review_message_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,text,uuid) TO crest_web;
