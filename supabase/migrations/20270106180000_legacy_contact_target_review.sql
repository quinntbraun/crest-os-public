-- Candidate evidence for one saved CSV record. All hints come from its retained
-- mapping. Inspecting a candidate neither links the source nor approves it.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(id,display_name,version,archived_at) ON crest.customers TO crest_legacy_contact_review_owner;
GRANT SELECT(id,label,version,archived_at,year,make,model,plate,kind) ON crest.vehicles TO crest_legacy_contact_review_owner;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_legacy_contact_review_owner;
SET LOCAL ROLE crest_legacy_contact_review_owner;
CREATE FUNCTION crest_commands.find_legacy_import_targets(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid,
 expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid, requested_batch uuid,
 requested_row integer, target_kind text, after_target uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $targets$
DECLARE authority jsonb; mapped jsonb; draft_digest text; phone text; email text; vin text; result jsonb;
BEGIN
 PERFORM set_config('crest.legacy_review_business_id','',true);
 IF requested_batch IS NULL OR requested_row IS NULL OR requested_row NOT BETWEEN 2 AND 100001
  OR target_kind IS NULL OR target_kind NOT IN ('customer','vehicle') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_TARGET_REVIEW_REQUIRED';
 END IF;
 authority:=crest_commands.authorize_customer_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.legacy_review_business_id',authority->>'businessId',true);

 SELECT r.candidate,b.rows_sha256 INTO mapped,draft_digest
 FROM crest.legacy_contact_batch_rows r JOIN crest.legacy_contact_batches b
  ON b.business_id=r.business_id AND b.id=r.batch_id
 WHERE r.business_id=requested_business AND r.batch_id=requested_batch AND r.source_row=requested_row;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 phone:=nullif(regexp_replace(mapped->'customer'->>'phone','[^0-9]','','g'),'');
 email:=nullif(lower(btrim(mapped->'customer'->>'email')),'');
 vin:=nullif(translate(regexp_replace(mapped->'vehicle'->>'vin','[^A-Za-z0-9]','','g'),
  'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'');

 -- Separate indexed lookups avoid a broad ID scan for sparse hints. UNION
 -- merges candidates with the same ID while preserving both match reasons.
 WITH matches AS MATERIALIZED (
  SELECT c.id,c.display_name AS label,c.version,c.archived_at IS NOT NULL AS archived,
   right(c.phone_normalized,4) AS suffix,split_part(c.email_normalized,'@',2) AS descriptor,
   phone IS NOT NULL AND c.phone_normalized IS NOT DISTINCT FROM phone AS phone_match,
   email IS NOT NULL AND c.email_normalized IS NOT DISTINCT FROM email AS email_match
  FROM (
   (SELECT id,display_name,version,archived_at,phone_normalized,email_normalized FROM crest.customers
    WHERE target_kind='customer' AND business_id=requested_business AND phone_normalized=phone
     AND (after_target IS NULL OR id>after_target) ORDER BY id LIMIT 11)
   UNION
   (SELECT id,display_name,version,archived_at,phone_normalized,email_normalized FROM crest.customers
    WHERE target_kind='customer' AND business_id=requested_business AND email_normalized=email
     AND (after_target IS NULL OR id>after_target) ORDER BY id LIMIT 11)
  ) c
 ), page AS MATERIALIZED (
  SELECT id,label,version,archived,'customer'::text AS record_type,suffix,nullif(descriptor,'') AS descriptor,
   array_remove(ARRAY[CASE WHEN phone_match THEN 'phone' END,CASE WHEN email_match THEN 'email' END],NULL) AS matched
  FROM matches
  UNION ALL
  (SELECT v.id,v.label,v.version,v.archived_at IS NOT NULL,v.kind,right(v.plate,4),
   nullif(concat_ws(' ',v.year,v.make,v.model),''),ARRAY['vin']
   FROM crest.vehicles v WHERE target_kind='vehicle' AND v.business_id=requested_business AND v.vin_normalized=vin
    AND (after_target IS NULL OR v.id>after_target) ORDER BY v.id LIMIT 11)
 ), visible AS (
  SELECT * FROM page ORDER BY id LIMIT 10
 )
 SELECT jsonb_build_object('state','present','schemaVersion',1,'businessId',requested_business,'batchId',requested_batch,
  'row',requested_row,'rowsSha256',draft_digest,'kind',target_kind,'hasMore',(SELECT count(*)>10 FROM page),
  'items',coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'version',version::text,'archived',archived,
   'recordType',record_type,'suffix',suffix,'descriptor',descriptor,'matched',matched) ORDER BY id),'[]'::jsonb))
 INTO result FROM visible;
 RETURN result;
END
$targets$;
REVOKE ALL ON FUNCTION crest_commands.find_legacy_import_targets(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.find_legacy_import_targets(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer,text,uuid) TO crest_web;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_legacy_contact_review_owner;
