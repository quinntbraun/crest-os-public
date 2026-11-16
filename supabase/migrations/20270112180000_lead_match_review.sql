-- Advisory match evidence for lead intake. Shared contact details remain
-- valid. A match neither updates source records nor proves customer identity.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(display_name,phone_normalized,email_normalized,archived_at)
 ON crest.customers TO crest_lead_owner;

CREATE FUNCTION crest_commands.read_lead_contact_review(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 current_lead uuid,selected_customer uuid,phone_hint text,email_hint text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on
AS $review$
DECLARE context jsonb; phone_value text; email_value text; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF (phone_hint IS NOT NULL AND (char_length(phone_hint) NOT BETWEEN 1 AND 512 OR phone_hint~'[[:cntrl:]]'))
  OR (email_hint IS NOT NULL AND (char_length(email_hint) NOT BETWEEN 1 AND 512 OR email_hint~'[[:cntrl:]]'))
 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED';
 END IF;
 context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,
  expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 phone_value:=nullif(regexp_replace(phone_hint,'[^0-9]','','g'),'');
 email_value:=nullif(lower(btrim(email_hint)),'');
 WITH customer_matches AS MATERIALIZED (
  SELECT c.id,c.display_name,c.archived_at IS NOT NULL AS archived,
   coalesce(c.phone_normalized=phone_value,false) AS phone,coalesce(c.email_normalized=email_value,false) AS email
  FROM crest.customers c
  WHERE c.business_id=requested_business AND c.id IS DISTINCT FROM selected_customer
   AND (c.phone_normalized=phone_value OR c.email_normalized=email_value)
  ORDER BY c.id LIMIT 6
 ), lead_matches AS MATERIALIZED (
  SELECT l.id,l.label,l.state,coalesce(l.phone_normalized=phone_value,false) AS phone,coalesce(l.email_normalized=email_value,false) AS email
  FROM crest.leads l
  WHERE l.business_id=requested_business AND l.id IS DISTINCT FROM current_lead
   AND (l.phone_normalized=phone_value OR l.email_normalized=email_value)
  ORDER BY l.id LIMIT 6
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,
  'customers',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'label',display_name,'archived',archived,'phone',phone,'email',email)
   ORDER BY id) FROM (SELECT * FROM customer_matches ORDER BY id LIMIT 5) page),'[]'::jsonb),
  'leads',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'label',label,'state',state,'phone',phone,'email',email)
   ORDER BY id) FROM (SELECT * FROM lead_matches ORDER BY id LIMIT 5) page),'[]'::jsonb),
  'moreCustomers',(SELECT count(*)>5 FROM customer_matches),'moreLeads',(SELECT count(*)>5 FROM lead_matches))
 INTO result;
 RETURN result;
END
$review$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_lead_owner;
ALTER FUNCTION crest_commands.read_lead_contact_review(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,text) OWNER TO crest_lead_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_lead_owner;
REVOKE ALL ON FUNCTION crest_commands.read_lead_contact_review(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_lead_contact_review(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,text) TO crest_web;

-- Possible matches for a reported lead vehicle. Same year/make/model
-- provides a description clue only. Plate text has no recorded jurisdiction.
SET LOCAL ROLE crest_schema_owner;
CREATE INDEX vehicles_intake_plate_review ON crest.vehicles(business_id,lower(btrim(plate)),id)
 WHERE kind='customer_vehicle' AND plate IS NOT NULL;
CREATE INDEX vehicles_intake_description_review ON crest.vehicles(business_id,year,lower(btrim(make)),lower(btrim(model)),id)
 WHERE kind='customer_vehicle' AND year IS NOT NULL AND make IS NOT NULL AND model IS NOT NULL;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_vehicle_owner;
SET LOCAL ROLE crest_vehicle_owner;
CREATE FUNCTION crest_commands.read_lead_vehicle_match_review(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 selected_vehicle uuid,vin_hint text,plate_hint text,year_hint integer,make_hint text,model_hint text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on
AS $review$
DECLARE context jsonb; vin_value text; plate_value text; make_value text; model_value text; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF EXISTS(SELECT 1 FROM unnest(ARRAY[vin_hint,plate_hint]) h(value)
  WHERE value IS NOT NULL AND (char_length(value) NOT BETWEEN 1 AND 128 OR value~'[[:cntrl:]]'))
  OR EXISTS(SELECT 1 FROM unnest(ARRAY[make_hint,model_hint]) h(value)
  WHERE value IS NOT NULL AND (char_length(value) NOT BETWEEN 1 AND 200 OR value~'[[:cntrl:]]'))
 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_VEHICLE_INPUT_REQUIRED';
 END IF;
 context:=crest_commands.authorize_vehicle_read(credential_hash,expected_session,expected_actor,expected_issuer,
  expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 vin_value:=nullif(translate(regexp_replace(vin_hint,'[^A-Za-z0-9]','','g'),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'');
 plate_value:=nullif(lower(btrim(plate_hint)),'');
 make_value:=nullif(lower(btrim(make_hint)),'');
 model_value:=nullif(lower(btrim(model_hint)),'');

 WITH vin_matches AS (
  SELECT v.id FROM crest.vehicles v
  WHERE v.business_id=requested_business AND v.kind='customer_vehicle'
   AND v.id IS DISTINCT FROM selected_vehicle AND v.vin_normalized=vin_value
  ORDER BY v.id LIMIT 6
 ), plate_matches AS (
  SELECT v.id FROM crest.vehicles v
  WHERE v.business_id=requested_business AND v.kind='customer_vehicle' AND v.plate IS NOT NULL
   AND v.id IS DISTINCT FROM selected_vehicle AND lower(btrim(v.plate))=plate_value
  ORDER BY v.id LIMIT 6
 ), description_matches AS (
  SELECT v.id FROM crest.vehicles v
  WHERE v.business_id=requested_business AND v.kind='customer_vehicle' AND v.year IS NOT NULL
   AND v.make IS NOT NULL AND v.model IS NOT NULL AND v.id IS DISTINCT FROM selected_vehicle
   AND (v.year,lower(btrim(v.make)),lower(btrim(v.model)))=(year_hint,make_value,model_value)
  ORDER BY v.id LIMIT 6
 ), matches AS MATERIALIZED (
  SELECT id FROM (SELECT id FROM vin_matches UNION SELECT id FROM plate_matches UNION SELECT id FROM description_matches) candidates
  ORDER BY id LIMIT 6
 ), page AS (
  SELECT v.id,v.label,v.archived_at,
   coalesce(v.vin_normalized=vin_value,false) AS vin,coalesce(lower(btrim(v.plate))=plate_value,false) AS plate,
   coalesce((v.year,lower(btrim(v.make)),lower(btrim(v.model)))=(year_hint,make_value,model_value),false) AS description
  FROM (SELECT id FROM matches ORDER BY id LIMIT 5) picked
  JOIN crest.vehicles v ON v.business_id=requested_business AND v.id=picked.id
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,
  'vehicles',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'label',label,'archived',archived_at IS NOT NULL,
   'vin',vin,'plate',plate,'description',description) ORDER BY id) FROM page),'[]'::jsonb),
  'hasMore',(SELECT count(*)>5 FROM matches)) INTO result;
 RETURN result;
END
$review$;
REVOKE ALL ON FUNCTION crest_commands.read_lead_vehicle_match_review(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_lead_vehicle_match_review(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,integer,text,text) TO crest_web;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_vehicle_owner;
