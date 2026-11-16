-- Review a saved contact import against one live database snapshot.
-- This read-only command supplies evidence for a later import approval.
CREATE ROLE crest_legacy_contact_review_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_legacy_contact_review_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_commands TO crest_legacy_contact_review_owner;
GRANT EXECUTE ON FUNCTION crest_commands.authorize_customer_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)
 TO crest_legacy_contact_review_owner;

SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(business_id,id,row_count,rows_sha256) ON crest.legacy_contact_batches TO crest_legacy_contact_review_owner;
GRANT SELECT(business_id,batch_id,source_row,candidate) ON crest.legacy_contact_batch_rows TO crest_legacy_contact_review_owner;
GRANT SELECT(business_id,phone_normalized,email_normalized) ON crest.customers TO crest_legacy_contact_review_owner;
GRANT SELECT(business_id,vin_normalized) ON crest.vehicles TO crest_legacy_contact_review_owner;
CREATE POLICY legacy_review_batch ON crest.legacy_contact_batches FOR SELECT TO crest_legacy_contact_review_owner
 USING(business_id=nullif(current_setting('crest.legacy_review_business_id',true),'')::uuid);
CREATE POLICY legacy_review_rows ON crest.legacy_contact_batch_rows FOR SELECT TO crest_legacy_contact_review_owner
 USING(business_id=nullif(current_setting('crest.legacy_review_business_id',true),'')::uuid);
CREATE POLICY legacy_review_customers ON crest.customers FOR SELECT TO crest_legacy_contact_review_owner
 USING(business_id=nullif(current_setting('crest.legacy_review_business_id',true),'')::uuid);
CREATE POLICY legacy_review_vehicles ON crest.vehicles FOR SELECT TO crest_legacy_contact_review_owner
 USING(business_id=nullif(current_setting('crest.legacy_review_business_id',true),'')::uuid);
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_legacy_contact_review_owner;
SET LOCAL ROLE crest_legacy_contact_review_owner;
CREATE FUNCTION crest_commands.review_legacy_contact_effects(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid,
 expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid, requested_batch uuid, after_row integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on
 -- Fresh large batches can be underestimated until analyze. Keep the five
 -- equality joins eligible for hash or merge plans without quadratic rescans.
 SET enable_nestloop=off AS $review$
DECLARE authority jsonb; expected_rows integer; draft_digest text; result jsonb;
BEGIN
 PERFORM set_config('crest.legacy_review_business_id','',true);
 IF requested_batch IS NULL OR after_row IS NULL OR after_row NOT BETWEEN 1 AND 100001 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_REVIEW_BATCH_REQUIRED';
 END IF;
 authority:=crest_commands.authorize_customer_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.legacy_review_business_id',authority->>'businessId',true);
 SELECT row_count,rows_sha256 INTO expected_rows,draft_digest FROM crest.legacy_contact_batches
  WHERE business_id=requested_business AND id=requested_batch;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;

 WITH mapped AS MATERIALIZED (
  SELECT source_row,candidate->'issues' AS issues,candidate->'customer' AS customer,candidate->'vehicle' AS vehicle,
   candidate->'customer'->>'sourceId' AS customer_source, candidate->'vehicle'->>'sourceId' AS vehicle_source,
   nullif(regexp_replace(candidate->'customer'->>'phone','[^0-9]','','g'),'') AS phone,
   nullif(lower(btrim(candidate->'customer'->>'email')),'') AS email,
   nullif(translate(regexp_replace(candidate->'vehicle'->>'vin','[^A-Za-z0-9]','','g'),
    'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'') AS vin
  FROM crest.legacy_contact_batch_rows WHERE business_id=requested_business AND batch_id=requested_batch
 ), customer_groups AS (
  SELECT customer_source,count(DISTINCT customer)>1 AS varied FROM mapped
   WHERE customer_source IS NOT NULL GROUP BY customer_source
 ), vehicle_groups AS (
  SELECT vehicle_source,count(DISTINCT vehicle)>1 OR count(DISTINCT customer_source)>1 AS varied
   FROM mapped WHERE vehicle_source IS NOT NULL GROUP BY vehicle_source
 ), phone_groups AS (
  SELECT mapped.phone,count(DISTINCT customer_source)>1 AS shared,
   EXISTS(SELECT 1 FROM crest.customers c WHERE c.business_id=requested_business AND c.phone_normalized=mapped.phone) AS saved
  FROM mapped WHERE mapped.phone IS NOT NULL GROUP BY mapped.phone
 ), email_groups AS (
  SELECT mapped.email,count(DISTINCT customer_source)>1 AS shared,
   EXISTS(SELECT 1 FROM crest.customers c WHERE c.business_id=requested_business AND c.email_normalized=mapped.email) AS saved
  FROM mapped WHERE mapped.email IS NOT NULL GROUP BY mapped.email
 ), vin_groups AS (
  SELECT mapped.vin,count(DISTINCT vehicle_source)>1 AS shared,
   EXISTS(SELECT 1 FROM crest.vehicles v WHERE v.business_id=requested_business AND v.vin_normalized=mapped.vin) AS saved
  FROM mapped WHERE mapped.vin IS NOT NULL GROUP BY mapped.vin
 ), flags AS (
  SELECT source_row,issues,customer_source,vehicle_source,customer->>'displayName' AS customer_name,
   vehicle->>'label' AS vehicle_name,
   coalesce(customer_groups.varied,false) AS customer_conflict,coalesce(vehicle_groups.varied,false) AS vehicle_conflict,
   coalesce(phone_groups.shared,false) AS shared_phone,coalesce(email_groups.shared,false) AS shared_email,
   coalesce(vin_groups.shared,false) AS shared_vin,coalesce(phone_groups.saved,false) AS saved_phone,
   coalesce(email_groups.saved,false) AS saved_email,coalesce(vin_groups.saved,false) AS saved_vehicle
  FROM mapped LEFT JOIN customer_groups USING(customer_source) LEFT JOIN vehicle_groups USING(vehicle_source)
   LEFT JOIN phone_groups USING(phone) LEFT JOIN email_groups USING(email) LEFT JOIN vin_groups USING(vin)
 ), evidence AS MATERIALIZED (
  SELECT *,customer_conflict OR vehicle_conflict AS source_conflict,shared_phone OR shared_email OR shared_vin AS shared_hint,
   saved_phone OR saved_email AS saved_contact FROM flags
 ), page AS MATERIALIZED (
  SELECT source_row,customer_name,vehicle_name,
   CASE WHEN customer_source IS NULL THEN issues ELSE '[]'::jsonb END AS issues,
   array_remove(ARRAY[
    CASE WHEN customer_conflict THEN 'customer_source_conflict' END,
    CASE WHEN vehicle_conflict THEN 'vehicle_source_conflict' END,
    CASE WHEN shared_phone THEN 'shared_phone' END,CASE WHEN shared_email THEN 'shared_email' END,
    CASE WHEN shared_vin THEN 'shared_vin' END,CASE WHEN saved_phone THEN 'saved_phone' END,
    CASE WHEN saved_email THEN 'saved_email' END,CASE WHEN saved_vehicle THEN 'saved_vin' END
   ],NULL) AS reasons
  FROM evidence WHERE source_row>after_row AND (customer_source IS NULL OR source_conflict OR shared_hint OR saved_contact OR saved_vehicle)
  ORDER BY source_row LIMIT 26
 )
 SELECT jsonb_build_object(
  'state','present','schemaVersion',1,'businessId',requested_business,'batchId',requested_batch,'rowsSha256',draft_digest,
  'totalRows',count(*),'rejectedRows',count(*) FILTER (WHERE customer_source IS NULL),
  'reviewRows',count(*) FILTER (WHERE customer_source IS NOT NULL AND (source_conflict OR shared_hint OR saved_contact OR saved_vehicle)),
  'candidateCustomers',count(DISTINCT customer_source),'candidateVehicles',count(DISTINCT vehicle_source),
  'candidateLinks',count(DISTINCT (customer_source,vehicle_source)) FILTER (WHERE vehicle_source IS NOT NULL),
  'sourceConflictRows',count(*) FILTER (WHERE source_conflict),'sharedHintRows',count(*) FILTER (WHERE shared_hint),
  'savedContactRows',count(*) FILTER (WHERE saved_contact),'savedVehicleRows',count(*) FILTER (WHERE saved_vehicle),
  'findings',coalesce((SELECT jsonb_agg(jsonb_build_object('row',source_row,'customer',customer_name,'vehicle',vehicle_name,
   'issues',issues,'reasons',reasons) ORDER BY source_row) FROM (SELECT * FROM page ORDER BY source_row LIMIT 25) visible),'[]'::jsonb),
  'hasMoreFindings',(SELECT count(*)>25 FROM page)
 ) INTO result FROM evidence;
 IF (result->>'totalRows')::integer<>expected_rows THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_REVIEW_DRAFT_INCOMPLETE';
 END IF;
 RETURN result;
END
$review$;
REVOKE ALL ON FUNCTION crest_commands.review_legacy_contact_effects(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.review_legacy_contact_effects(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer) TO crest_web;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_legacy_contact_review_owner;
