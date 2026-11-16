-- ACCOUNTING sections 2, 3 and 4. Fictional expense classification configuration.
-- The existing retained purpose key uses underscores. category_fuel represents category:fuel.
-- The existing "other" expense input is unclassified and never supplies a mapping.

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.expense_category_mapping_purpose(purpose text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $purpose$
 SELECT coalesce(purpose IN (
  'category_supplies','category_equipment','category_vehicle','category_fuel',
  'category_insurance','category_marketing','category_software','category_fees',
  'category_rent','category_utilities','category_professional'
 ),false)
$purpose$;

ALTER FUNCTION crest_private.fixed_finance_mapping_matches(text,crest.accounts)
 RENAME TO canonical_fixed_finance_mapping_matches;

CREATE FUNCTION crest_private.fixed_finance_mapping_matches(purpose text,account crest.accounts)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $match$
 SELECT CASE WHEN crest_private.expense_category_mapping_purpose(purpose) THEN
  coalesce(account.currency='USD' AND account.normal_side='debit' AND (
   (account.account_type='expense' AND account.control_kind IS NULL)
   OR (account.account_type='asset' AND (
    (account.code='1150' AND account.control_kind='prepaid')
    OR (account.code='1500' AND account.control_kind='fixed_asset')
   ))
  ),false)
 ELSE crest_private.canonical_fixed_finance_mapping_matches(purpose,account) END
$match$;

REVOKE ALL ON FUNCTION crest_private.expense_category_mapping_purpose(text),
 crest_private.fixed_finance_mapping_matches(text,crest.accounts) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.expense_category_mapping_purpose(text),
 crest_private.fixed_finance_mapping_matches(text,crest.accounts)
 TO crest_finance_integrity_owner,crest_finance_account_owner;

CREATE FUNCTION crest_commands.list_expense_category_mapping_accounts(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 requested_purpose text, after_code text, page_limit integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $accounts$
DECLARE latest jsonb; items jsonb; more boolean;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT crest_private.expense_category_mapping_purpose(requested_purpose)
  OR (after_code IS NOT NULL AND (char_length(after_code) NOT BETWEEN 1 AND 64
   OR btrim(after_code)<>after_code OR after_code~'[[:cntrl:]]'))
  OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 25 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_MAPPING_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 WITH candidates AS (
  SELECT a.id,a.code,v.name
  FROM crest.accounts a
  JOIN LATERAL (
   SELECT r.name,r.active FROM crest.account_versions r
   WHERE (r.business_id,r.account_id)=(a.business_id,a.id) ORDER BY r.version DESC LIMIT 1
  ) v ON v.active
  WHERE a.business_id=requested_business AND crest_private.fixed_finance_mapping_matches(requested_purpose,a)
   AND (after_code IS NULL OR a.code COLLATE "C">after_code COLLATE "C")
  ORDER BY a.code COLLATE "C" LIMIT page_limit+1
 ), page AS (
  SELECT id,code,name FROM candidates ORDER BY code COLLATE "C" LIMIT page_limit
 )
 SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY code COLLATE "C"),'[]'::jsonb),
  (SELECT count(*)>page_limit FROM candidates),
  (SELECT jsonb_build_object('version',m.version::text,'accountId',m.account_id,'effectiveFrom',to_char(m.effective_from,'YYYY-MM-DD'),
    'accountCode',a.code)
   FROM crest.account_mapping_versions m LEFT JOIN crest.accounts a ON (a.business_id,a.id)=(m.business_id,m.account_id)
   WHERE m.business_id=requested_business AND m.purpose=requested_purpose
   ORDER BY m.version DESC LIMIT 1) INTO items,more,latest FROM page;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,
  'purpose',requested_purpose,'latest',latest,'rows',items,'hasMore',more);
END $accounts$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.list_expense_category_mapping_accounts(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,text,integer) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.list_expense_category_mapping_accounts(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.list_expense_category_mapping_accounts(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,text,integer) TO crest_finance_preview;
