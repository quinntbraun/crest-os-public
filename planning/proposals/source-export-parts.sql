-- UNREGISTERED forward43 continuation. Apply after jobs and snapshots.
-- These are immutable metadata/verification attestations, not Ready/download.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.export_part_intents(
 business_id uuid NOT NULL,generation_id uuid NOT NULL,part_id uuid NOT NULL,
 export_job_id uuid NOT NULL,lease_id uuid NOT NULL,actor_id uuid NOT NULL,recovery_epoch uuid NOT NULL,
 plan_sha256 text NOT NULL CHECK(plan_sha256~'^[a-f0-9]{64}$'),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 1024),
 file_name text NOT NULL,content_type text NOT NULL,object_key text NOT NULL UNIQUE,
 key_id text NOT NULL CHECK(key_id~'^[A-Za-z0-9_-]{1,100}$'),
 plaintext_bytes integer NOT NULL CHECK(plaintext_bytes BETWEEN 1 AND 8388608),
 plaintext_sha256 text NOT NULL CHECK(plaintext_sha256~'^[a-f0-9]{64}$'),
 ciphertext_bytes integer NOT NULL CHECK(ciphertext_bytes BETWEEN 1 AND 16777216),
 ciphertext_sha256 text NOT NULL CHECK(ciphertext_sha256~'^[a-f0-9]{64}$'),
 request_sha256 text NOT NULL CHECK(request_sha256~'^[a-f0-9]{64}$'),
 request_text text NOT NULL CHECK(octet_length(request_text) BETWEEN 1 AND 8192),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,
 origin text NOT NULL CHECK(origin='manual'),operation_id uuid NOT NULL,import_row_id uuid CHECK(import_row_id IS NULL),
 PRIMARY KEY(business_id,generation_id,part_id),UNIQUE(business_id,generation_id,ordinal),
 UNIQUE(business_id,generation_id,part_id,request_sha256),
 FOREIGN KEY(business_id,generation_id) REFERENCES crest_private.export_job_snapshots(business_id,generation_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,export_job_id,lease_id) REFERENCES crest_private.export_job_attempts(business_id,export_job_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK(created_by=actor_id AND isfinite(created_at)),
 CHECK(request_sha256=encode(sha256(convert_to(request_text,'UTF8')),'hex'))
);
CREATE INDEX export_intents_operation ON crest_private.export_part_intents(business_id,operation_id,created_by);
CREATE INDEX export_intents_lease ON crest_private.export_part_intents(business_id,export_job_id,lease_id);
CREATE INDEX export_intents_cursor ON crest_private.export_part_intents(business_id,created_at,generation_id,part_id);
CREATE TABLE crest_private.export_part_verifications(
 business_id uuid NOT NULL,generation_id uuid NOT NULL,part_id uuid NOT NULL,
 export_job_id uuid NOT NULL,lease_id uuid NOT NULL,actor_id uuid NOT NULL,recovery_epoch uuid NOT NULL,
 plan_sha256 text NOT NULL CHECK(plan_sha256~'^[a-f0-9]{64}$'),
 request_sha256 text NOT NULL CHECK(request_sha256~'^[a-f0-9]{64}$'),
 request_text text NOT NULL CHECK(octet_length(request_text) BETWEEN 1 AND 8192),
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,
 origin text NOT NULL CHECK(origin='manual'),operation_id uuid NOT NULL,import_row_id uuid CHECK(import_row_id IS NULL),
 PRIMARY KEY(business_id,generation_id,part_id),
 FOREIGN KEY(business_id,generation_id,part_id,request_sha256) REFERENCES crest_private.export_part_intents(business_id,generation_id,part_id,request_sha256) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK(created_by=actor_id AND isfinite(verified_at) AND verified_at=created_at),
 CHECK(request_sha256=encode(sha256(convert_to(request_text,'UTF8')),'hex'))
);
CREATE INDEX export_verifications_operation ON crest_private.export_part_verifications(business_id,operation_id,created_by);
CREATE INDEX export_verifications_cursor ON crest_private.export_part_verifications(business_id,created_at,generation_id,part_id);
ALTER TABLE crest_private.export_part_intents ENABLE ROW LEVEL SECURITY;ALTER TABLE crest_private.export_part_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE crest_private.export_part_verifications ENABLE ROW LEVEL SECURITY;ALTER TABLE crest_private.export_part_verifications FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest_private.export_part_intents,crest_private.export_part_verifications TO crest_command_owner;
CREATE POLICY export_intent_read ON crest_private.export_part_intents FOR SELECT TO crest_command_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY export_intent_insert ON crest_private.export_part_intents FOR INSERT TO crest_command_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id);
CREATE POLICY export_verification_read ON crest_private.export_part_verifications FOR SELECT TO crest_command_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY export_verification_insert ON crest_private.export_part_verifications FOR INSERT TO crest_command_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id);
CREATE TRIGGER export_intent_retained BEFORE UPDATE OR DELETE ON crest_private.export_part_intents FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER export_intent_truncate BEFORE TRUNCATE ON crest_private.export_part_intents FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER export_verification_retained BEFORE UPDATE OR DELETE ON crest_private.export_part_verifications FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER export_verification_truncate BEFORE TRUNCATE ON crest_private.export_part_verifications FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

CREATE FUNCTION crest_private.source_export_part_source(original text,j crest_private.export_jobs) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE r jsonb;i jsonb;s crest_private.export_job_snapshots;f jsonb;n integer;
BEGIN
 IF original IS NULL OR octet_length(original) NOT BETWEEN 1 AND 8192 OR NOT(original IS JSON OBJECT WITH UNIQUE KEYS) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_PART_INPUT_REQUIRED';END IF;
 r:=original::jsonb;i:=r->'intent';
 IF NOT crest_private.export_json_object(r,ARRAY['claim','generationId','planSha256','partId','intent']) OR NOT crest_private.source_export_claim_matches(r->'claim',j)
 OR NOT crest_private.export_json_uuid(r->'generationId') OR NOT crest_private.export_json_uuid(r->'partId') OR jsonb_typeof(r->'planSha256') IS DISTINCT FROM 'string' OR coalesce(r->>'planSha256','')!~'^[a-f0-9]{64}$'
 OR NOT crest_private.export_json_object(i,ARRAY['formatVersion','objectKey','keyId','plaintextBytes','plaintextSha256','ciphertextBytes','ciphertextSha256']) OR i->'formatVersion' IS DISTINCT FROM '1'::jsonb
 OR i->'objectKey' IS DISTINCT FROM to_jsonb('exports/'||j.business_id::text||'/'||j.id::text||'/'||(r->>'generationId')||'/'||(r->>'partId')||'.jwe')
 OR jsonb_typeof(i->'keyId') IS DISTINCT FROM 'string' OR coalesce(i->>'keyId','')!~'^[A-Za-z0-9_-]{1,100}$'
 OR jsonb_typeof(i->'plaintextBytes') IS DISTINCT FROM 'number' OR coalesce(i->>'plaintextBytes','')!~'^[1-9][0-9]{0,6}$' OR (i->>'plaintextBytes')::bigint>8388608
 OR jsonb_typeof(i->'ciphertextBytes') IS DISTINCT FROM 'number' OR coalesce(i->>'ciphertextBytes','')!~'^[1-9][0-9]{0,7}$' OR (i->>'ciphertextBytes')::bigint>16777216
 OR jsonb_typeof(i->'plaintextSha256') IS DISTINCT FROM 'string' OR coalesce(i->>'plaintextSha256','')!~'^[a-f0-9]{64}$'
 OR jsonb_typeof(i->'ciphertextSha256') IS DISTINCT FROM 'string' OR coalesce(i->>'ciphertextSha256','')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_PART_INPUT_REQUIRED';END IF;
 SELECT * INTO s FROM crest_private.export_job_snapshots WHERE business_id=j.business_id AND generation_id=(r->>'generationId')::uuid AND export_job_id=j.id AND lease_id=j.lease_id AND actor_id=j.actor_id AND recovery_epoch=j.recovery_epoch AND plan_sha256=r->>'planSha256';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_PART_SNAPSHOT_REQUIRED';END IF;
 SELECT value,ordinality::integer INTO f,n FROM jsonb_array_elements(s.request_text::jsonb->'plan'->'parts') WITH ORDINALITY WHERE value->'partId'=r->'partId';
 IF NOT FOUND OR i->'plaintextBytes' IS DISTINCT FROM f->'bytes' OR i->'plaintextSha256' IS DISTINCT FROM f->'sha256' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_PART_INPUT_REQUIRED';END IF;
 RETURN jsonb_build_object('request',r,'file',f,'ordinal',n);
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_PART_INPUT_REQUIRED';
END $$;
CREATE FUNCTION crest_private.guard_source_export_part() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE j crest_private.export_jobs;v jsonb;r jsonb;i jsonb;f jsonb;recorded crest_private.export_part_intents;stamp timestamptz:=clock_timestamp();n integer;
BEGIN
 SELECT * INTO j FROM crest_private.export_jobs WHERE business_id=NEW.business_id AND id=NEW.export_job_id FOR UPDATE;
 IF NOT FOUND OR j.state<>'Running' OR j.lease_id IS DISTINCT FROM NEW.lease_id OR j.actor_id IS DISTINCT FROM NEW.actor_id OR j.recovery_epoch IS DISTINCT FROM NEW.recovery_epoch OR j.lease_until<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_SOURCE_REQUIRED';END IF;
 v:=crest_private.source_export_part_source(NEW.request_text,j);r:=v->'request';i:=r->'intent';f:=v->'file';n:=(v->>'ordinal')::integer;
 IF NEW.generation_id IS DISTINCT FROM (r->>'generationId')::uuid OR NEW.part_id IS DISTINCT FROM (r->>'partId')::uuid OR NEW.plan_sha256 IS DISTINCT FROM r->>'planSha256' OR NEW.operation_id IS DISTINCT FROM j.operation_id OR NEW.created_by IS DISTINCT FROM j.actor_id OR NEW.origin IS DISTINCT FROM 'manual' OR NEW.import_row_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_SOURCE_REQUIRED';END IF;
 IF TG_TABLE_NAME='export_part_intents' THEN
  IF ROW(NEW.ordinal,NEW.file_name,NEW.content_type,NEW.object_key,NEW.key_id,NEW.plaintext_bytes,NEW.plaintext_sha256,NEW.ciphertext_bytes,NEW.ciphertext_sha256) IS DISTINCT FROM ROW(n,f->>'fileName',f->>'contentType',i->>'objectKey',i->>'keyId',(i->>'plaintextBytes')::integer,i->>'plaintextSha256',(i->>'ciphertextBytes')::integer,i->>'ciphertextSha256') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_SOURCE_REQUIRED';END IF;
  IF n<>(SELECT count(*)+1 FROM crest_private.export_part_verifications WHERE business_id=j.business_id AND generation_id=NEW.generation_id) OR EXISTS(SELECT 1 FROM crest_private.export_part_intents x WHERE x.business_id=j.business_id AND x.generation_id=NEW.generation_id AND NOT EXISTS(SELECT 1 FROM crest_private.export_part_verifications y WHERE y.business_id=x.business_id AND y.generation_id=x.generation_id AND y.part_id=x.part_id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_PREVIOUS_UNVERIFIED';END IF;
 ELSE
  SELECT * INTO recorded FROM crest_private.export_part_intents WHERE business_id=j.business_id AND generation_id=NEW.generation_id AND part_id=NEW.part_id;
  IF NOT FOUND OR recorded.request_text IS DISTINCT FROM NEW.request_text OR recorded.request_sha256 IS DISTINCT FROM NEW.request_sha256 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_ORIGINAL_REQUIRED';END IF;
  IF n<>(SELECT count(*)+1 FROM crest_private.export_part_verifications WHERE business_id=j.business_id AND generation_id=NEW.generation_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_PREVIOUS_UNVERIFIED';END IF;
 END IF;
 stamp:=clock_timestamp();IF TG_TABLE_NAME='export_part_verifications' THEN NEW.verified_at:=stamp;END IF;NEW.created_at:=stamp;RETURN NEW;
END $$;
CREATE TRIGGER export_intent_guard BEFORE INSERT ON crest_private.export_part_intents FOR EACH ROW EXECUTE FUNCTION crest_private.guard_source_export_part();
CREATE TRIGGER export_verification_guard BEFORE INSERT ON crest_private.export_part_verifications FOR EACH ROW EXECUTE FUNCTION crest_private.guard_source_export_part();

CREATE FUNCTION crest_commands.record_source_export_part(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,original text,stage text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE r jsonb;i jsonb;v jsonb;f jsonb;j crest_private.export_jobs;recorded record;digest text;n integer;
BEGIN
 IF stage IS NULL OR stage NOT IN('intent','verified') OR original IS NULL OR octet_length(original) NOT BETWEEN 1 AND 8192 OR NOT(original IS JSON OBJECT WITH UNIQUE KEYS) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_PART_INPUT_REQUIRED';END IF;
 r:=original::jsonb;
 IF NOT crest_private.export_json_uuid(r->'claim'->'exportJobId') OR NOT crest_private.export_json_uuid(r->'claim'->'leaseId') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_PART_INPUT_REQUIRED';END IF;
 j:=crest_private.lock_source_export_live_job(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,(r->'claim'->>'exportJobId')::uuid,(r->'claim'->>'leaseId')::uuid);
 v:=crest_private.source_export_part_source(original,j);r:=v->'request';i:=r->'intent';f:=v->'file';n:=(v->>'ordinal')::integer;digest:=encode(sha256(convert_to(original,'UTF8')),'hex');
 IF stage='intent' THEN
  SELECT request_text,request_sha256 INTO recorded FROM crest_private.export_part_intents WHERE business_id=j.business_id AND generation_id=(r->>'generationId')::uuid AND part_id=(r->>'partId')::uuid;
  IF FOUND THEN
   IF recorded.request_text IS DISTINCT FROM original OR recorded.request_sha256 IS DISTINCT FROM digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_ALREADY_FROZEN';END IF;
  ELSE
   INSERT INTO crest_private.export_part_intents(business_id,generation_id,part_id,export_job_id,lease_id,actor_id,recovery_epoch,plan_sha256,ordinal,file_name,content_type,object_key,key_id,plaintext_bytes,plaintext_sha256,ciphertext_bytes,ciphertext_sha256,request_sha256,request_text,created_by,origin,operation_id) VALUES(j.business_id,(r->>'generationId')::uuid,(r->>'partId')::uuid,j.id,j.lease_id,j.actor_id,j.recovery_epoch,r->>'planSha256',n,f->>'fileName',f->>'contentType',i->>'objectKey',i->>'keyId',(i->>'plaintextBytes')::integer,i->>'plaintextSha256',(i->>'ciphertextBytes')::integer,i->>'ciphertextSha256',digest,original,j.actor_id,'manual',j.operation_id);
  END IF;
 ELSE
  SELECT request_text,request_sha256 INTO recorded FROM crest_private.export_part_intents WHERE business_id=j.business_id AND generation_id=(r->>'generationId')::uuid AND part_id=(r->>'partId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_INTENT_REQUIRED';END IF;
  IF recorded.request_text IS DISTINCT FROM original OR recorded.request_sha256 IS DISTINCT FROM digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_ORIGINAL_REQUIRED';END IF;
  SELECT request_text,request_sha256 INTO recorded FROM crest_private.export_part_verifications WHERE business_id=j.business_id AND generation_id=(r->>'generationId')::uuid AND part_id=(r->>'partId')::uuid;
  IF FOUND THEN
   IF recorded.request_text IS DISTINCT FROM original OR recorded.request_sha256 IS DISTINCT FROM digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_ORIGINAL_REQUIRED';END IF;
  ELSE
   INSERT INTO crest_private.export_part_verifications(business_id,generation_id,part_id,export_job_id,lease_id,actor_id,recovery_epoch,plan_sha256,request_sha256,request_text,created_by,origin,operation_id) VALUES(j.business_id,(r->>'generationId')::uuid,(r->>'partId')::uuid,j.id,j.lease_id,j.actor_id,j.recovery_epoch,r->>'planSha256',digest,original,j.actor_id,'manual',j.operation_id);
  END IF;
 END IF;
 PERFORM crest_commands.lock_source_export_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
 IF j.lease_until<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_LIVE_LEASE_REQUIRED';END IF;
 RETURN jsonb_build_object('formatVersion',1,'stage',stage,'requestSha256',digest);
END $$;
CREATE FUNCTION crest_commands.record_source_export_part_intent(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,original text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$ SELECT crest_commands.record_source_export_part($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'intent') $$;
CREATE FUNCTION crest_commands.record_source_export_part_verified(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,original text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$ SELECT crest_commands.record_source_export_part($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'verified') $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.record_source_export_part_intent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text) OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.record_source_export_part_verified(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
REVOKE ALL ON FUNCTION crest_private.source_export_part_source(text,crest_private.export_jobs),crest_private.guard_source_export_part(),crest_commands.record_source_export_part(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text),crest_commands.record_source_export_part_intent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text),crest_commands.record_source_export_part_verified(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.source_export_part_source(text,crest_private.export_jobs),crest_private.guard_source_export_part(),crest_commands.record_source_export_part(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text) TO crest_command_owner;
GRANT EXECUTE ON FUNCTION crest_commands.record_source_export_part_intent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text),crest_commands.record_source_export_part_verified(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text) TO crest_web;
