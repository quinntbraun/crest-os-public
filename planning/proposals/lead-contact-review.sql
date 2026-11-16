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
