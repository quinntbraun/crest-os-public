-- Unregistered quote Draft original-save review over registered44.
-- Extend only the closed IDs/versions validator. Generic retirement, claim
-- serialization, classification, authorization and grants remain unchanged.
DO $review$
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner','crest_quote_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>5
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner','crest_quote_owner'))
  OR EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('crest_private.original_operation_reference_valid(jsonb)') AND a.grantee NOT IN('crest_schema_owner'::regrole,'crest_command_owner'::regrole))
  OR to_regprocedure('crest_commands.save_quote_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,bigint,jsonb)') IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.original_operation_uuid(jsonb)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ec8d31108ca4387c2217d4d29e5d016938825802365afbda2e2667ea2a7557ee') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.original_operation_version(jsonb,boolean)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='efe0ebe382ffed396dab47c3935c5389b15bc025c7d7b647bee8ee85213df741') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.original_operation_reference_valid(jsonb)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e45d3e0aa06e3bc83c513b409567ae579970113311abba752058f4f2acf3bdd4') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.operation_retirement_digest(uuid,uuid,jsonb,text)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5359d819c2d454b3378d67fb3ff84d009b2d88f8a68675836666fd29ef66fbf5') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.authorize_operation_resolution_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)') AND p.proowner='crest_session_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='bfde61feafbca626187eb4a50f52cecc8a902a0550bdaff3cf1050ebeaf7aea4') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.lock_operation_retirement_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)') AND p.proowner='crest_session_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a2201e2c378a47d11053dfef8297f70652eddf060fc8728c173730157fe19a1d') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.finish_operation_retirement_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)') AND p.proowner='crest_session_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3b796c52c8e7ae4261e75ede6c06c41b36e997a53d5a1199829b8aa7c77fb0ab') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 -- Registered42 creates this invoker helper as schema owner; registered43
 -- explicitly pins that ownership. Command ownership does not transfer it.
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.operation_retirement_result(uuid,uuid,jsonb)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='v' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='da9672544c00bc815b105aae6e37b051dd5ab29594fb18ce31650de5c8f580fc') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.retire_original_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,jsonb,text)') AND p.proowner='crest_command_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7cebfed84d50d2f4fb5a61fbc83062e04bee58ea39528171abd5425287a88d60') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.lookup_original_operation_resolution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)') AND p.proowner='crest_command_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='52995ea9ef5188a6340f6ac90456dde6cac25a93662fbbddbe8d73e6e18959db') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.original_operation_reference_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE kind text;r jsonb;keys text[];key text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR NOT(v?&ARRAY['schemaVersion','businessId','commandType','reference']) OR v-ARRAY['schemaVersion','businessId','commandType','reference']<>'{}'::jsonb OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR NOT crest_private.original_operation_uuid(v->'businessId') OR jsonb_typeof(v->'commandType') IS DISTINCT FROM 'string' THEN RETURN false;END IF;
 kind:=v->>'commandType';r:=v->'reference';
 keys:=CASE kind
  WHEN 'business.rename' THEN ARRAY['expectedVersion']
  WHEN 'crm.customer.save' THEN ARRAY['customerId','expectedVersion']
  WHEN 'crm.address.save' THEN ARRAY['customerId','addressId','expectedVersion']
  WHEN 'crm.vehicle.save' THEN ARRAY['vehicleId','expectedVersion']
  WHEN 'crm.vehicle.association' THEN ARRAY['action','associationId','vehicleId','expectedVersion','nextAssociationId']
  WHEN 'crm.lead.source.save' THEN ARRAY['leadSourceId','expectedVersion']
  WHEN 'crm.lead.save' THEN ARRAY['leadId','expectedVersion']
  WHEN 'crm.lead.state' THEN ARRAY['leadId','expectedVersion']
  WHEN 'crm.lead.vehicle.save' THEN ARRAY['leadId','leadVehicleId','expectedVersion']
  WHEN 'crm.lead.address.save' THEN ARRAY['leadId','leadAddressId','expectedVersion']
  WHEN 'crm.lead.convert' THEN ARRAY['conversionId','leadId','expectedLeadVersion','customerId']
  WHEN 'catalog.service.save' THEN ARRAY['serviceId','expectedRevision']
  WHEN 'quote.draft.save' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion'] ELSE NULL END;
 IF keys IS NULL OR jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 keys:=ARRAY['operationId','recoveryEpoch']||keys;
 IF NOT(r?&keys) OR r-keys<>'{}'::jsonb THEN RETURN false;END IF;
 FOREACH key IN ARRAY keys LOOP
  IF key IN ('expectedVersion','expectedRevision','expectedFamilyVersion','expectedRevisionVersion') THEN IF NOT crest_private.original_operation_version(r->key,kind NOT IN ('business.rename','crm.lead.state')) THEN RETURN false;END IF;
  ELSIF key='expectedLeadVersion' THEN IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
  ELSIF key NOT IN ('action','nextAssociationId') THEN IF NOT crest_private.original_operation_uuid(r->key) THEN RETURN false;END IF;END IF;
 END LOOP;
 IF kind='crm.vehicle.association' THEN RETURN coalesce(jsonb_typeof(r->'action')='string' AND r->>'action' IN ('open','close','transfer') AND r->>'expectedVersion'=CASE WHEN r->>'action'='open' THEN '0' ELSE '1' END AND CASE WHEN r->>'action'='transfer' THEN crest_private.original_operation_uuid(r->'nextAssociationId') AND r->>'nextAssociationId'<>r->>'associationId' ELSE r->'nextAssociationId'='null'::jsonb END,false);END IF;
 IF kind='quote.draft.save' AND ((r->>'expectedFamilyVersion'='0')<>(r->>'expectedRevisionVersion'='0')) THEN RETURN false;END IF;
 RETURN true;
END $$;
RESET ROLE;
