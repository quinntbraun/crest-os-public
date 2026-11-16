-- Read-only legacy contact/vehicle duplicate review. Uses the same exact
-- normalization as the existing indexed directory fields, including archived
-- records. Returns count and at most five ordered record IDs per input position.
-- This match does not identify ownership or authorize import, linking or merge.

GRANT CREATE ON SCHEMA crest_commands TO crest_customer_owner;
SET LOCAL ROLE crest_customer_owner;
CREATE FUNCTION crest_commands.find_legacy_contact_matches(
  credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid,
  expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid, phone_hints text[], email_hints text[]
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $matches$
DECLARE authority jsonb; result jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true), set_config('crest.actor_id','',true), set_config('crest.operation_id','',true);
  IF phone_hints IS NULL OR cardinality(phone_hints)>10000
    OR coalesce(array_ndims(phone_hints),1)<>1
    OR EXISTS(SELECT 1 FROM unnest(phone_hints) AS input(value)
       WHERE value IS NULL OR char_length(value) NOT BETWEEN 1 AND 512 OR value~'[[:cntrl:]]')
    OR email_hints IS NULL OR cardinality(email_hints)>10000
    OR coalesce(array_ndims(email_hints),1)<>1
    OR EXISTS(SELECT 1 FROM unnest(email_hints) AS input(value)
       WHERE value IS NULL OR char_length(value) NOT BETWEEN 1 AND 512 OR value~'[[:cntrl:]]')
  THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_LEGACY_MATCH_INPUT_REQUIRED';
  END IF;
  authority:=crest_commands.authorize_customer_read(
    credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,
    expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',authority->>'businessId',true),
    set_config('crest.actor_id',authority->>'actorId',true);

  WITH
  phone_input AS MATERIALIZED (
    SELECT ordinal, nullif(regexp_replace(value,'[^0-9]','','g'),'') AS hint FROM unnest(phone_hints) WITH ORDINALITY AS input(value, ordinal)
  ),
  phone_matches AS MATERIALIZED (
    SELECT distinct_hint.hint, coalesce((SELECT jsonb_build_object(
      'count', max(candidate_count), 'firstIds', jsonb_agg(id ORDER BY id))
      FROM (
        SELECT id, count(*) OVER () AS candidate_count FROM crest.customers
        WHERE business_id=requested_business AND phone_normalized=distinct_hint.hint
        ORDER BY id LIMIT 5
      ) candidate HAVING count(*)>0), '{"count":0,"firstIds":[]}'::jsonb) AS evidence
    FROM (SELECT DISTINCT hint FROM phone_input WHERE hint IS NOT NULL) distinct_hint
  ),
  email_input AS MATERIALIZED (
    SELECT ordinal, nullif(lower(btrim(value)),'') AS hint FROM unnest(email_hints) WITH ORDINALITY AS input(value, ordinal)
  ),
  email_matches AS MATERIALIZED (
    SELECT distinct_hint.hint, coalesce((SELECT jsonb_build_object(
      'count', max(candidate_count), 'firstIds', jsonb_agg(id ORDER BY id))
      FROM (
        SELECT id, count(*) OVER () AS candidate_count FROM crest.customers
        WHERE business_id=requested_business AND email_normalized=distinct_hint.hint
        ORDER BY id LIMIT 5
      ) candidate HAVING count(*)>0), '{"count":0,"firstIds":[]}'::jsonb) AS evidence
    FROM (SELECT DISTINCT hint FROM email_input WHERE hint IS NOT NULL) distinct_hint
  )
  SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,
    'phone', coalesce((SELECT jsonb_agg(coalesce(m.evidence, '{"count":0,"firstIds":[]}'::jsonb) ORDER BY i.ordinal)
      FROM phone_input i LEFT JOIN phone_matches m USING (hint)), '[]'::jsonb),
    'email', coalesce((SELECT jsonb_agg(coalesce(m.evidence, '{"count":0,"firstIds":[]}'::jsonb) ORDER BY i.ordinal)
      FROM email_input i LEFT JOIN email_matches m USING (hint)), '[]'::jsonb))
  INTO result;
  RETURN result;
END
$matches$;
REVOKE ALL ON FUNCTION crest_commands.find_legacy_contact_matches(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text[],text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.find_legacy_contact_matches(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text[],text[]) TO crest_web;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_customer_owner;

GRANT CREATE ON SCHEMA crest_commands TO crest_vehicle_owner;
SET LOCAL ROLE crest_vehicle_owner;
CREATE FUNCTION crest_commands.find_legacy_vehicle_matches(
  credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid,
  expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid, vin_hints text[]
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $matches$
DECLARE authority jsonb; result jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true), set_config('crest.actor_id','',true), set_config('crest.operation_id','',true);
  IF vin_hints IS NULL OR cardinality(vin_hints)>10000
    OR coalesce(array_ndims(vin_hints),1)<>1
    OR EXISTS(SELECT 1 FROM unnest(vin_hints) AS input(value)
       WHERE value IS NULL OR char_length(value) NOT BETWEEN 1 AND 128 OR value~'[[:cntrl:]]')
  THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_LEGACY_MATCH_INPUT_REQUIRED';
  END IF;
  authority:=crest_commands.authorize_vehicle_read(
    credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,
    expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',authority->>'businessId',true),
    set_config('crest.actor_id',authority->>'actorId',true);

  WITH
  vin_input AS MATERIALIZED (
    SELECT ordinal, nullif(translate(regexp_replace(value,'[^A-Za-z0-9]','','g'),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'') AS hint FROM unnest(vin_hints) WITH ORDINALITY AS input(value, ordinal)
  ),
  vin_matches AS MATERIALIZED (
    SELECT distinct_hint.hint, coalesce((SELECT jsonb_build_object(
      'count', max(candidate_count), 'firstIds', jsonb_agg(id ORDER BY id))
      FROM (
        SELECT id, count(*) OVER () AS candidate_count FROM crest.vehicles
        WHERE business_id=requested_business AND vin_normalized=distinct_hint.hint
        ORDER BY id LIMIT 5
      ) candidate HAVING count(*)>0), '{"count":0,"firstIds":[]}'::jsonb) AS evidence
    FROM (SELECT DISTINCT hint FROM vin_input WHERE hint IS NOT NULL) distinct_hint
  )
  SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,
    'vin', coalesce((SELECT jsonb_agg(coalesce(m.evidence, '{"count":0,"firstIds":[]}'::jsonb) ORDER BY i.ordinal)
      FROM vin_input i LEFT JOIN vin_matches m USING (hint)), '[]'::jsonb))
  INTO result;
  RETURN result;
END
$matches$;
REVOKE ALL ON FUNCTION crest_commands.find_legacy_vehicle_matches(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.find_legacy_vehicle_matches(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text[]) TO crest_web;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_vehicle_owner;
