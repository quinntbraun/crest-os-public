-- Owner reviews the dated authority before recording a direct tip.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(archived_at) ON crest.customers TO crest_finance_account_owner;
CREATE FUNCTION crest_commands.read_direct_fictional_receipt_tip_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,actual_on date,requested_jurisdiction text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE auth jsonb; zone text; open_period boolean; funds_mapping uuid; funds_account uuid; jurisdictions jsonb; selected jsonb;
BEGIN
 IF requested_customer IS NULL OR actual_on IS NULL OR actual_on NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'
  OR requested_jurisdiction IS NOT NULL AND (char_length(requested_jurisdiction) NOT BETWEEN 1 AND 200
   OR requested_jurisdiction<>btrim(requested_jurisdiction) OR requested_jurisdiction~'[[:cntrl:]]')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DIRECT_RECEIPT_TIP_INPUT_REQUIRED';END IF;
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 IF actual_on>(statement_timestamp() AT TIME ZONE zone)::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_DATE_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 IF NOT EXISTS(SELECT FROM crest.customers c WHERE (c.business_id,c.id)=(requested_business,requested_customer) AND c.archived_at IS NULL)
 THEN RETURN jsonb_build_object('state','absent');END IF;
 SELECT EXISTS(SELECT FROM crest.accounting_periods period
  LEFT JOIN LATERAL(SELECT h.state FROM crest.accounting_period_locks h WHERE (h.business_id,h.period_id)=(period.business_id,period.id)
   ORDER BY h.generation DESC LIMIT 1) latest ON true
  WHERE period.business_id=requested_business AND period.time_zone=zone
   AND actual_on BETWEEN period.starts_on AND period.through_on AND latest.state IS DISTINCT FROM 'locked') INTO open_period;
 funds_mapping:=crest_private.unapplication_funds_mapping(requested_business,actual_on);
 SELECT m.account_id INTO funds_account FROM crest.account_mapping_versions m WHERE (m.business_id,m.id)=(requested_business,funds_mapping);
 SELECT coalesce(jsonb_agg(x.jurisdiction ORDER BY x.jurisdiction COLLATE "C"),'[]'::jsonb) INTO jurisdictions
 FROM (SELECT scope.jurisdiction FROM (
  SELECT DISTINCT p.jurisdiction FROM crest.tax_profiles p WHERE p.business_id=requested_business AND p.applicability='tip'
   AND p.service_id IS NULL AND p.effective_from<=actual_on
 ) scope WHERE EXISTS(SELECT FROM crest_private.fictional_tip_posting_basis(requested_business,funds_account,funds_mapping,scope.jurisdiction,actual_on))
 ORDER BY scope.jurisdiction COLLATE "C" LIMIT 181) x;
 IF jsonb_array_length(jurisdictions)>180 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='DIRECT_RECEIPT_TIP_OPTIONS_LIMIT';END IF;
 IF requested_jurisdiction IS NOT NULL THEN
  SELECT jsonb_build_object('jurisdiction',requested_jurisdiction,'treatment',basis.treatment,'rate',basis.rate::text,
   'taxProfileId',basis.profile_id,'revenueMappingId',basis.revenue_mapping_id,'taxMappingId',basis.tax_mapping_id)
  INTO selected FROM crest_private.fictional_tip_posting_basis(requested_business,funds_account,funds_mapping,requested_jurisdiction,actual_on) basis;
 END IF;
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'actualOn',to_char(actual_on,'YYYY-MM-DD'),'openPeriod',open_period,'fundsMappingId',funds_mapping,
  'jurisdictions',jurisdictions,'selected',selected);
END $options$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_direct_fictional_receipt_tip_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date,text)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_direct_fictional_receipt_tip_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_direct_fictional_receipt_tip_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date,text)
 TO crest_finance_preview;
