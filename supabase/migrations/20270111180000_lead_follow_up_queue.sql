-- Held dashboard reader. It uses the registered follow-up index and the
-- existing CRM read authorization, including company and session scope.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_lead_follow_ups(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 after_at timestamptz, after_id uuid, page_limit integer
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on
AS $follow_ups$
DECLARE context jsonb; observed_at timestamptz; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50
  OR (after_at IS NULL) <> (after_id IS NULL)
  OR (after_at IS NOT NULL AND (after_at<TIMESTAMPTZ '0001-01-01T00:00:00Z' OR after_at>=TIMESTAMPTZ '10000-01-01T00:00:00Z'))
 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED';
 END IF;
 context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,
  expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 observed_at:=clock_timestamp();

 WITH matches AS MATERIALIZED (
  SELECT c.id,c.label,c.state,c.follow_up_at
  FROM crest.leads c
  WHERE c.business_id=requested_business AND c.follow_up_at IS NOT NULL
   AND (c.follow_up_at,c.id)>(COALESCE(after_at,'-infinity'::timestamptz),
     COALESCE(after_id,'00000000-0000-0000-0000-000000000000'::uuid))
  ORDER BY c.follow_up_at,c.id LIMIT page_limit+1
 ), page AS (
  SELECT * FROM matches ORDER BY follow_up_at,id LIMIT page_limit
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,
  'observedAt',to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'followUps',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'label',label,'state',state,
   'followUpAt',to_char(follow_up_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY follow_up_at,id)
   FROM page),'[]'::jsonb),
  'hasMore',(SELECT count(*)>page_limit FROM matches)) INTO result;
 RETURN result;
END
$follow_ups$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_lead_owner;
ALTER FUNCTION crest_commands.read_lead_follow_ups(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid,integer) OWNER TO crest_lead_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_lead_owner;
REVOKE ALL ON FUNCTION crest_commands.read_lead_follow_ups(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_lead_follow_ups(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid,integer) TO crest_web;
