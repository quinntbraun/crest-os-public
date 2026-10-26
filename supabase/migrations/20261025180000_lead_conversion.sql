-- UNREGISTERED proposal41 revision2 (original retained): P03/BR02 atomic explicit lead conversion.
-- Synthetic proof only. All40 registered migrations/checksums are unchanged.
DO $review$
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('crest_schema_owner','crest_lead_owner','crest_lead_integrity_owner','crest_customer_owner','crest_vehicle_owner','crest_address_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>6
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN ('crest_schema_owner','crest_lead_owner','crest_lead_integrity_owner','crest_customer_owner','crest_vehicle_owner','crest_address_owner'))
 OR EXISTS(SELECT 1 FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole,LATERAL aclexplode(d.defaclacl) a WHERE r.rolname IN ('crest_schema_owner','crest_lead_owner','crest_lead_integrity_owner','crest_customer_owner','crest_vehicle_owner','crest_address_owner') AND a.grantee<>d.defaclrole)
 OR (SELECT count(*) FROM pg_class WHERE oid IN ('crest.leads'::regclass,'crest.lead_vehicles'::regclass,'crest.lead_addresses'::regclass,'crest.customers'::regclass,'crest.vehicles'::regclass,'crest.addresses'::regclass,'crest_private.operations'::regclass,'crest_private.audit_events'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>8 THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LEAD_CONVERSION_SOURCE_REVIEW_REQUIRED';
 END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.conversion_uuid(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT coalesce(jsonb_typeof(v)='string' AND v#>>'{}'~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',false) $$;
CREATE FUNCTION crest_private.conversion_version(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ BEGIN RETURN coalesce(jsonb_typeof(v)='string' AND v#>>'{}'~'^[1-9][0-9]{0,18}$' AND (v#>>'{}')::numeric<=9223372036854775807,false);EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;END $$;
CREATE FUNCTION crest_private.conversion_target_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR NOT crest_private.conversion_uuid(v->'id') THEN RETURN false;END IF;
 IF v->>'kind'='existing' THEN RETURN v-ARRAY['kind','id','expectedVersion']='{}'::jsonb AND v ?& ARRAY['kind','id','expectedVersion'] AND crest_private.conversion_version(v->'expectedVersion');END IF;
 RETURN coalesce(v->>'kind'='new' AND v-ARRAY['kind','id','draft']='{}'::jsonb AND v ?& ARRAY['kind','id','draft'] AND jsonb_typeof(v->'draft')='object' AND v->'draft'->'archived'='false'::jsonb AND v->'draft'->'archiveReason'='null'::jsonb,false);
END $$;
CREATE FUNCTION crest_private.conversion_body_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE item jsonb;role text;source_key text;version_key text;link_ids text[]:=ARRAY[]::text[];sources text[];targets jsonb;prior jsonb;target_id text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR v-ARRAY['customer','vehicles','addresses']<>'{}'::jsonb OR NOT v ?& ARRAY['customer','vehicles','addresses'] OR NOT crest_private.conversion_target_valid(v->'customer') OR jsonb_typeof(v->'vehicles')<>'array' OR jsonb_typeof(v->'addresses')<>'array' OR octet_length(v::text)>131072 THEN RETURN false;END IF;
 IF jsonb_array_length(v->'vehicles')+jsonb_array_length(v->'addresses')>1000 THEN RETURN false;END IF;
 FOREACH role IN ARRAY ARRAY['vehicles','addresses'] LOOP
  source_key:=CASE role WHEN 'vehicles' THEN 'leadVehicleId' ELSE 'leadAddressId' END;version_key:=CASE role WHEN 'vehicles' THEN 'expectedLeadVehicleVersion' ELSE 'expectedLeadAddressVersion' END;sources:=ARRAY[]::text[];targets:='{}'::jsonb;
  FOR item IN SELECT value FROM jsonb_array_elements(v->role) LOOP
   IF jsonb_typeof(item)<>'object' OR item-ARRAY['linkId',source_key,version_key,'target']<>'{}'::jsonb OR NOT item ?& ARRAY['linkId',source_key,version_key,'target'] OR NOT crest_private.conversion_uuid(item->'linkId') OR NOT crest_private.conversion_uuid(item->source_key) OR NOT crest_private.conversion_version(item->version_key) OR NOT crest_private.conversion_target_valid(item->'target') THEN RETURN false;END IF;
   IF item->>'linkId'=ANY(link_ids) OR item->>source_key=ANY(sources) THEN RETURN false;END IF;link_ids:=array_append(link_ids,item->>'linkId');sources:=array_append(sources,item->>source_key);
   IF role='addresses' AND v->'customer'->>'kind'='new' AND item->'target'->>'kind'='existing' THEN RETURN false;END IF;
   target_id:=item->'target'->>'id';prior:=targets->target_id;
   IF prior IS NOT NULL AND (prior->>'kind'<>'existing' OR item->'target'->>'kind'<>'existing' OR prior->>'expectedVersion'<>item->'target'->>'expectedVersion') THEN RETURN false;END IF;
   targets:=targets||jsonb_build_object(target_id,item->'target');
  END LOOP;
 END LOOP;RETURN true;
END $$;
CREATE FUNCTION crest_private.conversion_normalize(v jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE item jsonb;result jsonb:='[]'::jsonb;key text;
BEGIN
 FOR item IN SELECT value FROM jsonb_array_elements(v->'addresses') LOOP
  IF item->'target'->>'kind'='new' THEN FOREACH key IN ARRAY ARRAY['latitude','longitude'] LOOP IF jsonb_typeof(item->'target'->'draft'->key)='string' AND item->'target'->'draft'->>key~'^-0(\.0+)?$' THEN item:=jsonb_set(item,ARRAY['target','draft',key],to_jsonb(substr(item->'target'->'draft'->>key,2)));END IF;END LOOP;END IF;result:=result||jsonb_build_array(item);
 END LOOP;RETURN v||jsonb_build_object('addresses',result);
END $$;
CREATE FUNCTION crest_private.conversion_child_operation(business uuid,operation uuid,conversion uuid,role text,entity uuid) RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE bytes bytea;hex text;
BEGIN
 IF business IS NULL OR operation IS NULL OR conversion IS NULL OR entity IS NULL OR role IS NULL OR role NOT IN ('customer','vehicle','address','lead') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_CONVERSION_INPUT_REQUIRED';END IF;
 bytes:=substring(sha256(convert_to(concat_ws(chr(31),'crest:lead-conversion:child:1',role,business::text,operation::text,conversion::text,entity::text),'UTF8')) FROM 1 FOR 16);bytes:=set_byte(bytes,6,(get_byte(bytes,6)&15)|128);bytes:=set_byte(bytes,8,(get_byte(bytes,8)&63)|128);hex:=encode(bytes,'hex');RETURN hex::uuid;
END $$;
REVOKE ALL ON FUNCTION crest_private.conversion_uuid(jsonb),crest_private.conversion_version(jsonb),crest_private.conversion_target_valid(jsonb),crest_private.conversion_body_valid(jsonb),crest_private.conversion_normalize(jsonb),crest_private.conversion_child_operation(uuid,uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.conversion_uuid(jsonb),crest_private.conversion_version(jsonb),crest_private.conversion_target_valid(jsonb),crest_private.conversion_body_valid(jsonb),crest_private.conversion_normalize(jsonb),crest_private.conversion_child_operation(uuid,uuid,uuid,text,uuid) TO crest_lead_owner,crest_lead_integrity_owner;

CREATE TABLE crest.lead_conversions(
 id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,lead_id uuid NOT NULL,customer_id uuid NOT NULL,
 expected_lead_version bigint NOT NULL CHECK(expected_lead_version>0),lead_version bigint NOT NULL CHECK(lead_version=expected_lead_version+1),customer_version bigint NOT NULL CHECK(customer_version>0),
 lead_before_audit_id uuid NOT NULL,lead_audit_id uuid NOT NULL,customer_audit_id uuid NOT NULL,lead_child_operation_id uuid NOT NULL,customer_child_operation_id uuid,
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object' AND octet_length(request::text)<=131072),converted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 version bigint NOT NULL DEFAULT 1 CHECK(version=1),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,updated_by uuid NOT NULL CHECK(updated_by=created_by),origin text NOT NULL CHECK(origin='manual'),operation_id uuid NOT NULL,import_row_id uuid CHECK(import_row_id IS NULL),
 UNIQUE(business_id,id),UNIQUE(business_id,id,lead_id),UNIQUE(business_id,lead_id),UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,lead_id) REFERENCES crest.leads(business_id,id) ON DELETE RESTRICT,FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,lead_before_audit_id) REFERENCES crest_private.audit_events(business_id,id) ON DELETE RESTRICT,FOREIGN KEY(business_id,lead_audit_id) REFERENCES crest_private.audit_events(business_id,id) ON DELETE RESTRICT,FOREIGN KEY(business_id,customer_audit_id) REFERENCES crest_private.audit_events(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,lead_child_operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,FOREIGN KEY(business_id,customer_child_operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK(isfinite(converted_at) AND converted_at=created_at AND created_at=updated_at)
);
CREATE TABLE crest.conversion_links(
 id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,conversion_id uuid NOT NULL,lead_id uuid NOT NULL,
 lead_vehicle_id uuid,vehicle_id uuid,lead_address_id uuid,address_id uuid,source_version bigint NOT NULL CHECK(source_version>0),target_version bigint NOT NULL CHECK(target_version>0),source_audit_id uuid NOT NULL,target_audit_id uuid NOT NULL,target_child_operation_id uuid,
 version bigint NOT NULL DEFAULT 1 CHECK(version=1),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,updated_by uuid NOT NULL CHECK(updated_by=created_by),origin text NOT NULL CHECK(origin='manual'),operation_id uuid NOT NULL,import_row_id uuid CHECK(import_row_id IS NULL),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,conversion_id,lead_id) REFERENCES crest.lead_conversions(business_id,id,lead_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,lead_vehicle_id) REFERENCES crest.lead_vehicles(business_id,id) ON DELETE RESTRICT,FOREIGN KEY(business_id,vehicle_id) REFERENCES crest.vehicles(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,lead_address_id) REFERENCES crest.lead_addresses(business_id,id) ON DELETE RESTRICT,FOREIGN KEY(business_id,address_id) REFERENCES crest.addresses(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,source_audit_id) REFERENCES crest_private.audit_events(business_id,id) ON DELETE RESTRICT,FOREIGN KEY(business_id,target_audit_id) REFERENCES crest_private.audit_events(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,FOREIGN KEY(business_id,target_child_operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK((lead_vehicle_id IS NOT NULL AND vehicle_id IS NOT NULL AND lead_address_id IS NULL AND address_id IS NULL) OR (lead_vehicle_id IS NULL AND vehicle_id IS NULL AND lead_address_id IS NOT NULL AND address_id IS NOT NULL)),CHECK(isfinite(created_at) AND created_at=updated_at)
);
CREATE UNIQUE INDEX conversion_vehicle_source ON crest.conversion_links(business_id,conversion_id,lead_vehicle_id) WHERE lead_vehicle_id IS NOT NULL;
CREATE UNIQUE INDEX conversion_address_source ON crest.conversion_links(business_id,conversion_id,lead_address_id) WHERE lead_address_id IS NOT NULL;
CREATE INDEX conversion_customer ON crest.lead_conversions(business_id,customer_id,id);
CREATE INDEX conversion_links_parent ON crest.conversion_links(business_id,conversion_id,id);
ALTER TABLE crest.lead_conversions ENABLE ROW LEVEL SECURITY;ALTER TABLE crest.lead_conversions FORCE ROW LEVEL SECURITY;ALTER TABLE crest.conversion_links ENABLE ROW LEVEL SECURITY;ALTER TABLE crest.conversion_links FORCE ROW LEVEL SECURITY;
GRANT USAGE ON TYPE crest.lead_conversions,crest.conversion_links TO crest_lead_owner,crest_lead_integrity_owner;
CREATE FUNCTION crest_private.lead_conversion_projection(c crest.lead_conversions) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT to_jsonb(c)||jsonb_build_object('expected_lead_version',(c).expected_lead_version::text,'lead_version',(c).lead_version::text,'customer_version',(c).customer_version::text,'version',(c).version::text,'converted_at',to_char((c).converted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_at',to_char((c).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((c).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $$;
CREATE FUNCTION crest_private.conversion_link_projection(c crest.conversion_links) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT to_jsonb(c)||jsonb_build_object('source_version',(c).source_version::text,'target_version',(c).target_version::text,'version',(c).version::text,'created_at',to_char((c).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((c).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $$;
REVOKE ALL ON FUNCTION crest_private.lead_conversion_projection(crest.lead_conversions),crest_private.conversion_link_projection(crest.conversion_links) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.lead_conversion_projection(crest.lead_conversions),crest_private.conversion_link_projection(crest.conversion_links) TO crest_lead_owner,crest_lead_integrity_owner;
CREATE FUNCTION crest_private.prepare_conversion_row() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ DECLARE stamp timestamptz:=clock_timestamp();BEGIN NEW.created_at:=stamp;NEW.updated_at:=stamp;IF TG_TABLE_NAME='lead_conversions' THEN NEW.converted_at:=stamp;END IF;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION crest_private.prepare_conversion_row() FROM PUBLIC;
CREATE TRIGGER conversion_prepare BEFORE INSERT ON crest.lead_conversions FOR EACH ROW EXECUTE FUNCTION crest_private.prepare_conversion_row();CREATE TRIGGER conversion_link_prepare BEFORE INSERT ON crest.conversion_links FOR EACH ROW EXECUTE FUNCTION crest_private.prepare_conversion_row();
CREATE TRIGGER retained_update BEFORE UPDATE ON crest.lead_conversions FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();CREATE TRIGGER retained_delete BEFORE DELETE ON crest.lead_conversions FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();CREATE TRIGGER retained_truncate BEFORE TRUNCATE ON crest.lead_conversions FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER retained_update BEFORE UPDATE ON crest.conversion_links FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();CREATE TRIGGER retained_delete BEFORE DELETE ON crest.conversion_links FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();CREATE TRIGGER retained_truncate BEFORE TRUNCATE ON crest.conversion_links FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest.lead_conversions,crest.conversion_links TO crest_lead_owner;
CREATE POLICY conversion_read ON crest.lead_conversions FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);CREATE POLICY conversion_create ON crest.lead_conversions FOR INSERT TO crest_lead_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY conversion_link_read ON crest.conversion_links FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);CREATE POLICY conversion_link_create ON crest.conversion_links FOR INSERT TO crest_lead_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
GRANT SELECT ON crest.lead_conversions,crest.conversion_links TO crest_lead_integrity_owner;
CREATE POLICY conversion_integrity ON crest.lead_conversions FOR SELECT TO crest_lead_integrity_owner USING(true);CREATE POLICY conversion_link_integrity ON crest.conversion_links FOR SELECT TO crest_lead_integrity_owner USING(true);
CREATE POLICY conversion_operations_read ON crest_private.operations FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.convert');
CREATE POLICY conversion_operations_create ON crest_private.operations FOR INSERT TO crest_lead_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='crm.lead.convert' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY conversion_operations_finish ON crest_private.operations FOR UPDATE TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.convert') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.convert');
CREATE POLICY conversion_audits_read ON crest_private.audit_events FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind IN ('lead_conversions','conversion_links','customers','vehicles','addresses'));
CREATE POLICY conversion_audits_create ON crest_private.audit_events FOR INSERT TO crest_lead_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind IN ('lead_conversions','conversion_links') AND origin='manual' AND import_row_id IS NULL);
GRANT SELECT(business_id,id,operation_id,actor_id,entity_kind,entity_id,entity_version,delta) ON crest_private.audit_events TO crest_lead_integrity_owner;
GRANT SELECT(business_id,operation_id,actor_id,command_type,state,schema_version,recovery_epoch,payload_hash) ON crest_private.operations TO crest_lead_integrity_owner;
CREATE POLICY conversion_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_lead_integrity_owner USING(entity_kind IN ('lead_conversions','conversion_links','leads','lead_vehicles','lead_addresses','customers','vehicles','addresses') OR EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=audit_events.business_id AND o.operation_id=audit_events.operation_id AND o.command_type='crm.lead.convert'));
CREATE POLICY conversion_integrity_operations ON crest_private.operations FOR SELECT TO crest_lead_integrity_owner USING(command_type='crm.lead.convert');
CREATE POLICY conversion_child_claims ON crest_private.operations FOR SELECT TO crest_lead_integrity_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND command_type IN ('crm.customer.save','crm.vehicle.save','crm.address.save','crm.lead.save'));
CREATE UNIQUE INDEX conversion_audit_version ON crest_private.audit_events(business_id,entity_kind,entity_id,entity_version) WHERE entity_kind IN ('lead_conversions','conversion_links');

-- Fresh parent claims may only create fresh children. A separately committed
-- child operation must not turn a requested new record into historical replay.
CREATE FUNCTION crest_private.require_unused_conversion_child(business uuid,operation uuid) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$ BEGIN IF business IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR nullif(current_setting('crest.actor_id',true),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CONVERSION_CONTEXT_REQUIRED';END IF;IF EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=business AND operation_id=operation) THEN RAISE EXCEPTION USING ERRCODE='P1014',MESSAGE='CREST_CONVERSION_CHILD_CONFLICT';END IF;END $$;

CREATE FUNCTION crest_private.assert_conversion_link(c crest.conversion_links) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE p crest.lead_conversions;mapping jsonb;s jsonb;t jsonb;role text;source_kind text;target_kind text;source_id uuid;target_id uuid;draft jsonb;
BEGIN
 SELECT * INTO p FROM crest.lead_conversions WHERE business_id=c.business_id AND id=c.conversion_id AND lead_id=c.lead_id;
 IF NOT FOUND OR p.operation_id<>c.operation_id OR p.created_by<>c.created_by THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CONVERSION_LINK_REVIEW_REQUIRED';END IF;
 role:=CASE WHEN c.lead_vehicle_id IS NOT NULL THEN 'vehicle' ELSE 'address' END;source_kind:=CASE role WHEN 'vehicle' THEN 'lead_vehicles' ELSE 'lead_addresses' END;target_kind:=CASE role WHEN 'vehicle' THEN 'vehicles' ELSE 'addresses' END;source_id:=coalesce(c.lead_vehicle_id,c.lead_address_id);target_id:=coalesce(c.vehicle_id,c.address_id);
 SELECT value INTO mapping FROM jsonb_array_elements(p.request->CASE role WHEN 'vehicle' THEN 'vehicles' ELSE 'addresses' END) WHERE value->>'linkId'=c.id::text;
 IF mapping IS NULL OR mapping->>(CASE role WHEN 'vehicle' THEN 'leadVehicleId' ELSE 'leadAddressId' END) IS DISTINCT FROM source_id::text OR mapping->>(CASE role WHEN 'vehicle' THEN 'expectedLeadVehicleVersion' ELSE 'expectedLeadAddressVersion' END) IS DISTINCT FROM c.source_version::text OR mapping->'target'->>'id' IS DISTINCT FROM target_id::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CONVERSION_LINK_REVIEW_REQUIRED';END IF;
 SELECT delta->'after' INTO s FROM crest_private.audit_events WHERE business_id=c.business_id AND id=c.source_audit_id AND entity_kind=source_kind AND entity_id=source_id AND entity_version=c.source_version;
 SELECT delta->'after' INTO t FROM crest_private.audit_events WHERE business_id=c.business_id AND id=c.target_audit_id AND entity_kind=target_kind AND entity_id=target_id AND entity_version=c.target_version;
 IF s IS NULL OR t IS NULL OR s->>'business_id' IS DISTINCT FROM c.business_id::text OR s->>'id' IS DISTINCT FROM source_id::text OR s->>'lead_id' IS DISTINCT FROM c.lead_id::text OR s->>'version' IS DISTINCT FROM c.source_version::text OR s->'archived_at' IS DISTINCT FROM 'null'::jsonb OR t->>'business_id' IS DISTINCT FROM c.business_id::text OR t->>'id' IS DISTINCT FROM target_id::text OR t->>'version' IS DISTINCT FROM c.target_version::text OR t->'archived_at' IS DISTINCT FROM 'null'::jsonb OR role='address' AND t->>'customer_id' IS DISTINCT FROM p.customer_id::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CONVERSION_LINK_REVIEW_REQUIRED';END IF;
 IF mapping->'target'->>'kind'='new' THEN
  IF c.target_version<>1 OR c.target_child_operation_id IS DISTINCT FROM crest_private.conversion_child_operation(c.business_id,c.operation_id,p.id,role,target_id) OR t->>'operation_id' IS DISTINCT FROM c.target_child_operation_id::text OR t->>'created_by' IS DISTINCT FROM c.created_by::text OR t->>'updated_by' IS DISTINCT FROM c.created_by::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CONVERSION_LINK_REVIEW_REQUIRED';END IF;
  IF role='vehicle' THEN draft:=jsonb_build_object('label',t->'label','year',t->'year','make',t->'make','model',t->'model','color',t->'color','vin',t->'vin_raw','plate',t->'plate','kind',t->'kind','notes',t->'notes','archived',false,'archiveReason',NULL);
  ELSE draft:=jsonb_build_object('line1',t->'line1','line2',t->'line2','city',t->'city','region',t->'region','postalCode',t->'postal_code','country',t->'country','exactLocationText',t->'exact_location_text','instructions',t->'instructions','latitude',t->'latitude','longitude',t->'longitude','geocodeSource',t->'geocode_source','geocodeAccuracy',t->'geocode_accuracy','verifiedAt',t->'verified_at','archived',false,'archiveReason',NULL);END IF;
  IF draft IS DISTINCT FROM mapping->'target'->'draft' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CONVERSION_LINK_REVIEW_REQUIRED';END IF;
 ELSE IF c.target_child_operation_id IS NOT NULL OR c.target_version::text IS DISTINCT FROM mapping->'target'->>'expectedVersion' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CONVERSION_LINK_REVIEW_REQUIRED';END IF;END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=c.business_id AND a.operation_id=c.operation_id AND a.actor_id=c.created_by AND a.entity_kind='conversion_links' AND a.entity_id=c.id AND a.entity_version=1 AND a.delta->'before'='null'::jsonb AND a.delta->'after'=crest_private.conversion_link_projection(c)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CONVERSION_LINK_AUDIT_REQUIRED';END IF;
END $$;
CREATE FUNCTION crest_private.assert_lead_conversion(c crest.lead_conversions) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE before_row jsonb;after_row jsonb;customer jsonb;draft jsonb;o record;expected_count integer;
BEGIN
 IF c.request-ARRAY['schemaVersion','businessId','operationId','recoveryEpoch','conversionId','leadId','expectedLeadVersion','customer','vehicles','addresses']<>'{}'::jsonb OR NOT c.request ?& ARRAY['schemaVersion','businessId','operationId','recoveryEpoch','conversionId','leadId','expectedLeadVersion','customer','vehicles','addresses'] OR c.request->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR c.request->>'businessId' IS DISTINCT FROM c.business_id::text OR c.request->>'operationId' IS DISTINCT FROM c.operation_id::text OR c.request->>'conversionId' IS DISTINCT FROM c.id::text OR c.request->>'leadId' IS DISTINCT FROM c.lead_id::text OR c.request->>'expectedLeadVersion' IS DISTINCT FROM c.expected_lead_version::text OR c.request->'customer'->>'id' IS DISTINCT FROM c.customer_id::text OR NOT crest_private.conversion_body_valid(c.request-ARRAY['schemaVersion','businessId','operationId','recoveryEpoch','conversionId','leadId','expectedLeadVersion']) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_CONVERSION_REVIEW_REQUIRED';END IF;
 SELECT state,schema_version,recovery_epoch,payload_hash INTO o FROM crest_private.operations WHERE business_id=c.business_id AND operation_id=c.operation_id AND actor_id=c.created_by AND command_type='crm.lead.convert';
 IF NOT FOUND OR o.state<>'committed' OR o.schema_version<>1 OR c.request->>'recoveryEpoch' IS DISTINCT FROM o.recovery_epoch::text OR o.payload_hash<>encode(sha256(convert_to(jsonb_build_object('commandType','crm.lead.convert','schemaVersion',1,'businessId',c.business_id,'actorId',c.created_by,'recoveryEpoch',o.recovery_epoch,'request',c.request)::text,'UTF8')),'hex') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_CONVERSION_REVIEW_REQUIRED';END IF;
 SELECT delta->'after' INTO before_row FROM crest_private.audit_events WHERE business_id=c.business_id AND id=c.lead_before_audit_id AND entity_kind='leads' AND entity_id=c.lead_id AND entity_version=c.expected_lead_version;
 SELECT delta->'after' INTO after_row FROM crest_private.audit_events WHERE business_id=c.business_id AND id=c.lead_audit_id AND entity_kind='leads' AND entity_id=c.lead_id AND entity_version=c.lead_version AND operation_id=c.lead_child_operation_id AND actor_id=c.created_by AND delta->'before'=before_row;
 IF before_row IS NULL OR after_row IS NULL OR before_row->>'customer_id' IS NOT NULL AND (before_row->>'customer_id' IS DISTINCT FROM c.customer_id::text OR c.request->'customer'->>'kind'<>'existing') OR after_row->>'customer_id' IS DISTINCT FROM c.customer_id::text OR after_row->>'operation_id' IS DISTINCT FROM c.lead_child_operation_id::text OR after_row->>'updated_by' IS DISTINCT FROM c.created_by::text OR c.lead_child_operation_id<>crest_private.conversion_child_operation(c.business_id,c.operation_id,c.id,'lead',c.lead_id) OR before_row-ARRAY['customer_id','version','updated_at','updated_by','operation_id'] IS DISTINCT FROM after_row-ARRAY['customer_id','version','updated_at','updated_by','operation_id'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_CONVERSION_REVIEW_REQUIRED';END IF;
 SELECT delta->'after' INTO customer FROM crest_private.audit_events WHERE business_id=c.business_id AND id=c.customer_audit_id AND entity_kind='customers' AND entity_id=c.customer_id AND entity_version=c.customer_version;
 IF customer IS NULL OR customer->>'id' IS DISTINCT FROM c.customer_id::text OR customer->>'business_id' IS DISTINCT FROM c.business_id::text OR customer->>'version' IS DISTINCT FROM c.customer_version::text OR customer->'archived_at' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_CONVERSION_REVIEW_REQUIRED';END IF;
 IF c.request->'customer'->>'kind'='new' THEN
  draft:=jsonb_build_object('displayName',customer->'display_name','phone',customer->'phone_raw','email',customer->'email_raw','contactPreference',customer->'contact_preference','outreachOptOut',customer->'outreach_opt_out','notes',customer->'notes','customerSince',customer->'customer_since','archived',false,'archiveReason',NULL);
  IF c.customer_version<>1 OR c.customer_child_operation_id IS DISTINCT FROM crest_private.conversion_child_operation(c.business_id,c.operation_id,c.id,'customer',c.customer_id) OR customer->>'operation_id' IS DISTINCT FROM c.customer_child_operation_id::text OR customer->>'created_by' IS DISTINCT FROM c.created_by::text OR draft IS DISTINCT FROM c.request->'customer'->'draft' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_CONVERSION_REVIEW_REQUIRED';END IF;
 ELSE IF c.customer_child_operation_id IS NOT NULL OR c.customer_version::text IS DISTINCT FROM c.request->'customer'->>'expectedVersion' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_CONVERSION_REVIEW_REQUIRED';END IF;END IF;
 expected_count:=jsonb_array_length(c.request->'vehicles')+jsonb_array_length(c.request->'addresses');
 IF (SELECT count(*) FROM crest.conversion_links WHERE business_id=c.business_id AND conversion_id=c.id)<>expected_count OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=c.business_id AND operation_id=c.operation_id)<>expected_count+1 OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=c.business_id AND a.operation_id=c.operation_id AND a.actor_id=c.created_by AND a.entity_kind='lead_conversions' AND a.entity_id=c.id AND a.entity_version=1 AND a.delta->'before'='null'::jsonb AND a.delta->'after'=crest_private.lead_conversion_projection(c)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_CONVERSION_AUDIT_REQUIRED';END IF;
END $$;
CREATE FUNCTION crest_private.check_conversion_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$ BEGIN IF TG_TABLE_NAME='lead_conversions' THEN PERFORM crest_private.assert_lead_conversion(NEW::crest.lead_conversions);ELSE PERFORM crest_private.assert_conversion_link(NEW::crest.conversion_links);END IF;RETURN NULL;END $$;
CREATE FUNCTION crest_private.retain_converted_customer() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$ BEGIN IF NEW.customer_id IS DISTINCT FROM OLD.customer_id AND EXISTS(SELECT 1 FROM crest.lead_conversions WHERE business_id=NEW.business_id AND lead_id=NEW.id AND customer_id IS DISTINCT FROM NEW.customer_id) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_CONVERTED_CUSTOMER_IMMUTABLE';END IF;RETURN NEW;END $$;
CREATE CONSTRAINT TRIGGER conversion_audit AFTER INSERT ON crest.lead_conversions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_conversion_audit();CREATE CONSTRAINT TRIGGER conversion_link_audit AFTER INSERT ON crest.conversion_links DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_conversion_audit();
CREATE TRIGGER converted_customer BEFORE UPDATE ON crest.leads FOR EACH ROW EXECUTE FUNCTION crest_private.retain_converted_customer();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_lead_integrity_owner;
ALTER FUNCTION crest_private.require_unused_conversion_child(uuid,uuid) OWNER TO crest_lead_integrity_owner;
ALTER FUNCTION crest_private.assert_lead_conversion(crest.lead_conversions) OWNER TO crest_lead_integrity_owner;ALTER FUNCTION crest_private.assert_conversion_link(crest.conversion_links) OWNER TO crest_lead_integrity_owner;ALTER FUNCTION crest_private.check_conversion_audit() OWNER TO crest_lead_integrity_owner;ALTER FUNCTION crest_private.retain_converted_customer() OWNER TO crest_lead_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_lead_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.assert_lead_conversion(crest.lead_conversions),crest_private.assert_conversion_link(crest.conversion_links),crest_private.check_conversion_audit(),crest_private.retain_converted_customer() FROM PUBLIC;
REVOKE ALL ON FUNCTION crest_private.require_unused_conversion_child(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.require_unused_conversion_child(uuid,uuid) TO crest_lead_owner;
GRANT EXECUTE ON FUNCTION crest_private.assert_lead_conversion(crest.lead_conversions),crest_private.assert_conversion_link(crest.conversion_links) TO crest_lead_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.lock_conversion_customer(business uuid,target uuid,expected bigint) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE r crest.customers;
BEGIN
 IF business IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR nullif(current_setting('crest.actor_id',true),'') IS NULL OR nullif(current_setting('crest.operation_id',true),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CONVERSION_CONTEXT_REQUIRED';END IF;
 SELECT * INTO r FROM crest.customers WHERE business_id=business AND id=target FOR UPDATE;
 IF NOT FOUND OR expected IS NULL OR r.version<>expected OR r.archived_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P1011',MESSAGE='CREST_CONVERSION_DESTINATION_CONFLICT';END IF;RETURN crest_private.customer_projection(r);
END $$;
CREATE FUNCTION crest_private.lock_conversion_vehicle(business uuid,target uuid,expected bigint) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE r crest.vehicles;
BEGIN
 IF business IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR nullif(current_setting('crest.actor_id',true),'') IS NULL OR nullif(current_setting('crest.operation_id',true),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CONVERSION_CONTEXT_REQUIRED';END IF;
 SELECT * INTO r FROM crest.vehicles WHERE business_id=business AND id=target FOR UPDATE;
 IF NOT FOUND OR expected IS NULL OR r.version<>expected OR r.archived_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P1011',MESSAGE='CREST_CONVERSION_DESTINATION_CONFLICT';END IF;RETURN crest_private.vehicle_projection(r);
END $$;
CREATE FUNCTION crest_private.lock_conversion_address(business uuid,target uuid,expected bigint,parent uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE r crest.addresses;
BEGIN
 IF business IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR nullif(current_setting('crest.actor_id',true),'') IS NULL OR nullif(current_setting('crest.operation_id',true),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CONVERSION_CONTEXT_REQUIRED';END IF;
 SELECT * INTO r FROM crest.addresses WHERE business_id=business AND id=target FOR UPDATE;
 IF NOT FOUND OR expected IS NULL OR r.version<>expected OR r.customer_id IS DISTINCT FROM parent OR r.archived_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P1011',MESSAGE='CREST_CONVERSION_DESTINATION_CONFLICT';END IF;RETURN crest_private.address_projection(r);
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_customer_owner,crest_vehicle_owner,crest_address_owner;
ALTER FUNCTION crest_private.lock_conversion_customer(uuid,uuid,bigint) OWNER TO crest_customer_owner;ALTER FUNCTION crest_private.lock_conversion_vehicle(uuid,uuid,bigint) OWNER TO crest_vehicle_owner;ALTER FUNCTION crest_private.lock_conversion_address(uuid,uuid,bigint,uuid) OWNER TO crest_address_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_customer_owner,crest_vehicle_owner,crest_address_owner;
REVOKE ALL ON FUNCTION crest_private.lock_conversion_customer(uuid,uuid,bigint),crest_private.lock_conversion_vehicle(uuid,uuid,bigint),crest_private.lock_conversion_address(uuid,uuid,bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.lock_conversion_customer(uuid,uuid,bigint),crest_private.lock_conversion_vehicle(uuid,uuid,bigint),crest_private.lock_conversion_address(uuid,uuid,bigint,uuid),crest_private.customer_operation_result(uuid,uuid,uuid),crest_private.vehicle_operation_result(uuid,uuid,uuid),crest_private.address_operation_result(uuid,uuid,uuid) TO crest_lead_owner;
GRANT EXECUTE ON FUNCTION crest_commands.save_customer(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.save_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.save_address(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb) TO crest_lead_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.lead_conversion_operation_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE o record;c crest.lead_conversions;l crest.conversion_links;receipt jsonb;event uuid;child jsonb;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='crm.lead.convert';IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 SELECT * INTO c FROM crest.lead_conversions WHERE business_id=business AND operation_id=operation AND created_by=actor;
 IF NOT FOUND OR o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_CONVERSION_RESULT_REVIEW_REQUIRED';END IF;
 PERFORM crest_private.assert_lead_conversion(c);
 child:=crest_private.lead_operation_result(business,actor,c.lead_child_operation_id);IF child->>'state' IS DISTINCT FROM 'committed' OR child->'receipt'->>'auditEventId' IS DISTINCT FROM c.lead_audit_id::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_CONVERSION_RESULT_REVIEW_REQUIRED';END IF;
 IF c.customer_child_operation_id IS NOT NULL THEN child:=crest_private.customer_operation_result(business,actor,c.customer_child_operation_id);IF child->>'state' IS DISTINCT FROM 'committed' OR child->'receipt'->>'auditEventId' IS DISTINCT FROM c.customer_audit_id::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_CONVERSION_RESULT_REVIEW_REQUIRED';END IF;END IF;
 FOR l IN SELECT * FROM crest.conversion_links WHERE business_id=business AND conversion_id=c.id ORDER BY id LOOP
  PERFORM crest_private.assert_conversion_link(l);
  IF l.target_child_operation_id IS NOT NULL THEN IF l.vehicle_id IS NOT NULL THEN child:=crest_private.vehicle_operation_result(business,actor,l.target_child_operation_id);ELSE child:=crest_private.address_operation_result(business,actor,l.target_child_operation_id);END IF;IF child->>'state' IS DISTINCT FROM 'committed' OR child->'receipt'->>'auditEventId' IS DISTINCT FROM l.target_audit_id::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_CONVERSION_RESULT_REVIEW_REQUIRED';END IF;END IF;
 END LOOP;
 SELECT id INTO event FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind='lead_conversions' AND entity_id=c.id AND entity_version=1;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',business,'conversionId',c.id,'leadId',c.lead_id,'leadVersion',c.lead_version::text,'customerId',c.customer_id,'auditEventId',event);
 IF o.result IS DISTINCT FROM receipt THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_CONVERSION_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',receipt);
END $$;

CREATE FUNCTION crest_commands.convert_lead(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_conversion uuid,requested_lead uuid,expected_version bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;request jsonb;digest text;claimed uuid;existing record;old_lead crest.leads;c crest.lead_conversions;l crest.conversion_links;item jsonb;role text;source_id uuid;target_id uuid;source_version bigint;target_version bigint;source_json jsonb;target_json jsonb;source_audit uuid;target_audit uuid;customer_audit uuid;lead_before_audit uuid;lead_audit uuid;customer_version bigint;customer_id uuid;customer_child uuid;lead_child uuid;child uuid;child_ids uuid[];result jsonb;draft jsonb;links jsonb:='[]'::jsonb;vehicles jsonb:='{}'::jsonb;addresses jsonb:='{}'::jsonb;event uuid;violated text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_conversion IS NULL OR requested_lead IS NULL OR request_schema IS DISTINCT FROM 1 OR expected_version IS NULL OR expected_version<1 OR NOT crest_private.conversion_body_valid(body) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_CONVERSION_INPUT_REQUIRED';END IF;
 body:=crest_private.conversion_normalize(body);request:=body||jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'conversionId',requested_conversion,'leadId',requested_lead,'expectedLeadVersion',expected_version::text);
 IF octet_length(request::text)>131072 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_CONVERSION_INPUT_REQUIRED';END IF;
 BEGIN context:=crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'crm.manage',false);PERFORM crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM IN ('CREST_MUTATION_AUTHORIZATION_DENIED','CREST_TENANT_READ_DENIED','CREST_LEAD_READ_DENIED') THEN RETURN jsonb_build_object('state','denied');END IF;RAISE;END;
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.lead.convert','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'request',request)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'crm.lead.convert',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'crm.lead.convert' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   result:=crest_private.lead_conversion_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   SELECT * INTO old_lead FROM crest.leads WHERE business_id=requested_business AND id=requested_lead FOR UPDATE;
   IF NOT FOUND OR old_lead.version<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1010',MESSAGE='CREST_CONVERSION_LEAD_CONFLICT';END IF;
   IF EXISTS(SELECT 1 FROM crest.lead_conversions WHERE business_id=requested_business AND lead_id=requested_lead) THEN RAISE EXCEPTION USING ERRCODE='P1012',MESSAGE='CREST_CONVERSION_ALREADY_RECORDED';END IF;
   customer_id:=(body->'customer'->>'id')::uuid;
   IF old_lead.customer_id IS NOT NULL AND (old_lead.customer_id<>customer_id OR body->'customer'->>'kind'<>'existing') THEN RAISE EXCEPTION USING ERRCODE='P1011',MESSAGE='CREST_CONVERSION_DESTINATION_CONFLICT';END IF;
   SELECT id INTO lead_before_audit FROM crest_private.audit_events WHERE business_id=requested_business AND entity_kind='leads' AND entity_id=requested_lead AND entity_version=old_lead.version AND delta->'after'=crest_private.lead_projection(old_lead);IF lead_before_audit IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CONVERSION_SOURCE_AUDIT_REQUIRED';END IF;
   -- Parent lead lock serializes every source report/location writer. Existing
   -- directory targets are additionally pinned in deterministic type/ID order.
   IF body->'customer'->>'kind'='existing' THEN target_json:=crest_private.lock_conversion_customer(requested_business,customer_id,(body->'customer'->>'expectedVersion')::bigint);customer_version:=(target_json->>'version')::bigint;SELECT id INTO customer_audit FROM crest_private.audit_events WHERE business_id=requested_business AND entity_kind='customers' AND entity_id=customer_id AND entity_version=customer_version AND delta->'after'=target_json;IF customer_audit IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CONVERSION_DESTINATION_AUDIT_REQUIRED';END IF;END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(body->'vehicles') WHERE value->'target'->>'kind'='existing' ORDER BY value->'target'->>'id' LOOP target_json:=crest_private.lock_conversion_vehicle(requested_business,(item->'target'->>'id')::uuid,(item->'target'->>'expectedVersion')::bigint);vehicles:=vehicles||jsonb_build_object(item->'target'->>'id',target_json);END LOOP;
   FOR item IN SELECT value FROM jsonb_array_elements(body->'addresses') WHERE value->'target'->>'kind'='existing' ORDER BY value->'target'->>'id' LOOP target_json:=crest_private.lock_conversion_address(requested_business,(item->'target'->>'id')::uuid,(item->'target'->>'expectedVersion')::bigint,customer_id);addresses:=addresses||jsonb_build_object(item->'target'->>'id',target_json);END LOOP;
   FOREACH role IN ARRAY ARRAY['vehicle','address'] LOOP
    FOR item IN SELECT value FROM jsonb_array_elements(body->CASE role WHEN 'vehicle' THEN 'vehicles' ELSE 'addresses' END) LOOP
     source_id:=(item->>CASE role WHEN 'vehicle' THEN 'leadVehicleId' ELSE 'leadAddressId' END)::uuid;source_version:=(item->>CASE role WHEN 'vehicle' THEN 'expectedLeadVehicleVersion' ELSE 'expectedLeadAddressVersion' END)::bigint;
     IF role='vehicle' THEN SELECT crest_private.lead_vehicle_projection(v) INTO source_json FROM crest.lead_vehicles v WHERE business_id=requested_business AND id=source_id AND lead_id=requested_lead AND version=source_version AND archived_at IS NULL FOR UPDATE;
     ELSE SELECT crest_private.lead_address_projection(a) INTO source_json FROM crest.lead_addresses a WHERE business_id=requested_business AND id=source_id AND lead_id=requested_lead AND version=source_version AND archived_at IS NULL FOR UPDATE;END IF;
     IF source_json IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1013',MESSAGE='CREST_CONVERSION_SOURCE_CONFLICT';END IF;
     SELECT id INTO source_audit FROM crest_private.audit_events WHERE business_id=requested_business AND entity_kind=CASE role WHEN 'vehicle' THEN 'lead_vehicles' ELSE 'lead_addresses' END AND entity_id=source_id AND entity_version=source_version AND delta->'after'=source_json;IF source_audit IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CONVERSION_SOURCE_AUDIT_REQUIRED';END IF;
     links:=links||jsonb_build_array(jsonb_build_object('id',item->'linkId','role',role,'sourceId',source_id,'sourceVersion',source_version::text,'sourceAuditId',source_audit,'target',item->'target'));
    END LOOP;
   END LOOP;
   lead_child:=crest_private.conversion_child_operation(requested_business,requested_operation,requested_conversion,'lead',requested_lead);child_ids:=ARRAY[requested_operation,lead_child];IF requested_operation=lead_child THEN RAISE EXCEPTION USING ERRCODE='P1014',MESSAGE='CREST_CONVERSION_CHILD_CONFLICT';END IF;
   IF body->'customer'->>'kind'='new' THEN
    customer_child:=crest_private.conversion_child_operation(requested_business,requested_operation,requested_conversion,'customer',customer_id);IF customer_child=ANY(child_ids) THEN RAISE EXCEPTION USING ERRCODE='P1014',MESSAGE='CREST_CONVERSION_CHILD_CONFLICT';END IF;child_ids:=array_append(child_ids,customer_child);
    PERFORM crest_private.require_unused_conversion_child(requested_business,customer_child);result:=crest_commands.save_customer(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,customer_child,1,customer_id,0,body->'customer'->'draft');
    IF result->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='P1011',MESSAGE='CREST_CONVERSION_CHILD_CONFLICT';END IF;customer_version:=(result->'receipt'->>'customerVersion')::bigint;customer_audit:=(result->'receipt'->>'auditEventId')::uuid;
   END IF;
   -- Materialize each new directory record, preserving caller selection order.
   FOR item IN SELECT value FROM jsonb_array_elements(links) LOOP
    role:=item->>'role';target_id:=(item->'target'->>'id')::uuid;child:=NULL;
    IF item->'target'->>'kind'='new' THEN
     child:=crest_private.conversion_child_operation(requested_business,requested_operation,requested_conversion,role,target_id);IF child=ANY(child_ids) THEN RAISE EXCEPTION USING ERRCODE='P1014',MESSAGE='CREST_CONVERSION_CHILD_CONFLICT';END IF;child_ids:=array_append(child_ids,child);
     PERFORM crest_private.require_unused_conversion_child(requested_business,child);
     IF role='vehicle' THEN result:=crest_commands.save_vehicle(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,child,1,target_id,0,item->'target'->'draft');ELSE result:=crest_commands.save_address(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,child,1,target_id,customer_id,0,item->'target'->'draft');END IF;
     IF result->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='P1011',MESSAGE='CREST_CONVERSION_CHILD_CONFLICT';END IF;target_version:=1;target_audit:=(result->'receipt'->>'auditEventId')::uuid;
    ELSE target_json:=CASE role WHEN 'vehicle' THEN vehicles->target_id::text ELSE addresses->target_id::text END;target_version:=(target_json->>'version')::bigint;SELECT id INTO target_audit FROM crest_private.audit_events WHERE business_id=requested_business AND entity_kind=CASE role WHEN 'vehicle' THEN 'vehicles' ELSE 'addresses' END AND entity_id=target_id AND entity_version=target_version AND delta->'after'=target_json;IF target_audit IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CONVERSION_DESTINATION_AUDIT_REQUIRED';END IF;END IF;
    item:=item||jsonb_build_object('targetVersion',target_version::text,'targetAuditId',target_audit,'childOperationId',child);draft:=coalesce(draft,'[]'::jsonb)||jsonb_build_array(item);
   END LOOP;
   links:=coalesce(draft,'[]'::jsonb);draft:=jsonb_build_object('label',old_lead.label,'customerId',customer_id,'sourceId',old_lead.source_id,'referralText',old_lead.referral_text,'phone',old_lead.phone_raw,'email',old_lead.email_raw,'requestedScope',old_lead.requested_scope,'availability',old_lead.availability,'estimatedCents',old_lead.estimated_cents::text,'followUpAt',to_char(old_lead.follow_up_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'notes',old_lead.notes);
   PERFORM crest_private.require_unused_conversion_child(requested_business,lead_child);result:=crest_commands.save_lead(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,lead_child,1,requested_lead,expected_version,draft);IF result->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='P1010',MESSAGE='CREST_CONVERSION_LEAD_CONFLICT';END IF;lead_audit:=(result->'receipt'->>'auditEventId')::uuid;
   PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),set_config('crest.operation_id',requested_operation::text,true);
   INSERT INTO crest.lead_conversions(id,business_id,lead_id,customer_id,expected_lead_version,lead_version,customer_version,lead_before_audit_id,lead_audit_id,customer_audit_id,lead_child_operation_id,customer_child_operation_id,request,created_by,updated_by,origin,operation_id) VALUES(requested_conversion,requested_business,requested_lead,customer_id,expected_version,expected_version+1,customer_version,lead_before_audit,lead_audit,customer_audit,lead_child,customer_child,request,expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO c;
   FOR item IN SELECT value FROM jsonb_array_elements(links) LOOP
    INSERT INTO crest.conversion_links(id,business_id,conversion_id,lead_id,lead_vehicle_id,vehicle_id,lead_address_id,address_id,source_version,target_version,source_audit_id,target_audit_id,target_child_operation_id,created_by,updated_by,origin,operation_id) VALUES((item->>'id')::uuid,requested_business,requested_conversion,requested_lead,CASE WHEN item->>'role'='vehicle' THEN (item->>'sourceId')::uuid END,CASE WHEN item->>'role'='vehicle' THEN (item->'target'->>'id')::uuid END,CASE WHEN item->>'role'='address' THEN (item->>'sourceId')::uuid END,CASE WHEN item->>'role'='address' THEN (item->'target'->>'id')::uuid END,(item->>'sourceVersion')::bigint,(item->>'targetVersion')::bigint,(item->>'sourceAuditId')::uuid,(item->>'targetAuditId')::uuid,(item->>'childOperationId')::uuid,expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO l;
    INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'conversion_links',l.id,1,'create',jsonb_build_object('schemaVersion',1,'before',NULL,'after',crest_private.conversion_link_projection(l)),'manual');
   END LOOP;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'lead_conversions',c.id,1,'convert',jsonb_build_object('schemaVersion',1,'before',NULL,'after',crest_private.lead_conversion_projection(c)),'manual') RETURNING id INTO event;
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'conversionId',c.id,'leadId',c.lead_id,'leadVersion',c.lead_version::text,'customerId',c.customer_id,'auditEventId',event) WHERE business_id=requested_business AND operation_id=requested_operation;
   result:=crest_private.lead_conversion_operation_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_lead_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,requested_operation);RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1010' THEN RETURN jsonb_build_object('state','conflict','reason','lead');WHEN SQLSTATE 'P1011' THEN RETURN jsonb_build_object('state','conflict','reason','destination');WHEN SQLSTATE 'P1012' THEN RETURN jsonb_build_object('state','conflict','reason','conversion');WHEN SQLSTATE 'P1013' THEN RETURN jsonb_build_object('state','conflict','reason','source');WHEN SQLSTATE 'P1014' THEN RETURN jsonb_build_object('state','conflict','reason','operation');WHEN unique_violation THEN GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;IF violated IN ('lead_conversions_pkey','lead_conversions_business_id_lead_id_key','lead_conversions_business_id_operation_id_key','conversion_links_pkey') THEN RETURN jsonb_build_object('state','conflict','reason','conversion');END IF;RAISE;
 END;
END $$;
CREATE FUNCTION crest_commands.lookup_lead_conversion_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;
BEGIN PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_CONVERSION_INPUT_REQUIRED';END IF;context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);RETURN crest_private.lead_conversion_operation_result(requested_business,expected_actor,requested_operation);END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_lead_owner;
ALTER FUNCTION crest_private.lead_conversion_operation_result(uuid,uuid,uuid) OWNER TO crest_lead_owner;ALTER FUNCTION crest_commands.convert_lead(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb) OWNER TO crest_lead_owner;ALTER FUNCTION crest_commands.lookup_lead_conversion_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_lead_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_lead_owner;
REVOKE ALL ON FUNCTION crest_private.lead_conversion_operation_result(uuid,uuid,uuid),crest_commands.convert_lead(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb),crest_commands.lookup_lead_conversion_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.convert_lead(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb),crest_commands.lookup_lead_conversion_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;

-- UNREGISTERED additive read/export body for proposal41 revision2.
-- The synthetic helper concatenates exact core bytes, one LF, then these bytes.
-- No published core or registered40 checksum is changed. Fresh proof required.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_lead_conversion(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_lead uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;c crest.lead_conversions;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_lead IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_CONVERSION_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT * INTO c FROM crest.lead_conversions WHERE business_id=requested_business AND lead_id=requested_lead;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 PERFORM crest_private.assert_lead_conversion(c);
 result:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'conversion',crest_private.lead_conversion_projection(c));
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_CONVERSION_PAGE_LIMIT';END IF;RETURN result;
END $$;
CREATE FUNCTION crest_commands.read_lead_conversion_links(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_lead uuid,requested_conversion uuid,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;c crest.lead_conversions;l crest.conversion_links;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_lead IS NULL OR requested_conversion IS NULL OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_CONVERSION_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT * INTO c FROM crest.lead_conversions WHERE business_id=requested_business AND lead_id=requested_lead AND id=requested_conversion;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;PERFORM crest_private.assert_lead_conversion(c);
 FOR l IN SELECT * FROM crest.conversion_links WHERE business_id=requested_business AND conversion_id=c.id AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit LOOP PERFORM crest_private.assert_conversion_link(l);END LOOP;
 WITH matches AS MATERIALIZED(SELECT * FROM crest.conversion_links WHERE business_id=requested_business AND conversion_id=c.id AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit+1),page AS(SELECT * FROM matches ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'conversion',crest_private.lead_conversion_projection(c),'links',coalesce((SELECT jsonb_agg(crest_private.conversion_link_projection(p::crest.conversion_links) ORDER BY p.id) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM matches)) INTO result;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_CONVERSION_PAGE_LIMIT';END IF;RETURN result;
END $$;
CREATE FUNCTION crest_commands.lead_conversion_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE parents bigint;children bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LEAD_CONVERSION_SNAPSHOT_REQUIRED';END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_CONVERSION_INPUT_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_CONVERSION_SCOPE_REQUIRED';END IF;
 SELECT count(*) INTO parents FROM crest.lead_conversions WHERE business_id=requested_business;SELECT count(*) INTO children FROM crest.conversion_links WHERE business_id=requested_business;
 IF parents>1000 OR children>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_CONVERSION_SNAPSHOT_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'scope','lead_conversion','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.lead.conversion.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'conversionCount',parents::text,'linkCount',children::text);
END $$;
CREATE FUNCTION crest_commands.lead_conversion_snapshot_page(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;c crest.lead_conversions;result jsonb;
BEGIN
 context:=crest_commands.lead_conversion_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_CONVERSION_SNAPSHOT_REQUIRED';END IF;
 FOR c IN SELECT * FROM crest.lead_conversions WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit LOOP PERFORM crest_private.assert_lead_conversion(c);END LOOP;
 WITH page AS(SELECT * FROM crest.lead_conversions WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'conversions',coalesce(jsonb_agg(crest_private.lead_conversion_projection(p::crest.lead_conversions) ORDER BY p.id),'[]'::jsonb)) INTO result FROM page p;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_CONVERSION_PAGE_LIMIT';END IF;RETURN result;
END $$;
CREATE FUNCTION crest_commands.conversion_link_snapshot_page(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;l crest.conversion_links;result jsonb;
BEGIN
 context:=crest_commands.lead_conversion_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_CONVERSION_SNAPSHOT_REQUIRED';END IF;
 FOR l IN SELECT * FROM crest.conversion_links WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit LOOP PERFORM crest_private.assert_conversion_link(l);END LOOP;
 WITH page AS(SELECT * FROM crest.conversion_links WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'links',coalesce(jsonb_agg(crest_private.conversion_link_projection(p::crest.conversion_links) ORDER BY p.id),'[]'::jsonb)) INTO result FROM page p;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_CONVERSION_PAGE_LIMIT';END IF;RETURN result;
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_lead_owner;
ALTER FUNCTION crest_commands.read_lead_conversion(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.read_lead_conversion_links(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,integer) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.lead_conversion_snapshot_context(uuid) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.lead_conversion_snapshot_page(uuid,text,uuid,integer) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.conversion_link_snapshot_page(uuid,text,uuid,integer) OWNER TO crest_lead_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_lead_owner;
REVOKE ALL ON FUNCTION crest_commands.read_lead_conversion(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_lead_conversion_links(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,integer),crest_commands.lead_conversion_snapshot_context(uuid),crest_commands.lead_conversion_snapshot_page(uuid,text,uuid,integer),crest_commands.conversion_link_snapshot_page(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_lead_conversion(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_lead_conversion_links(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,integer) TO crest_web;
GRANT EXECUTE ON FUNCTION crest_commands.lead_conversion_snapshot_context(uuid),crest_commands.lead_conversion_snapshot_page(uuid,text,uuid,integer),crest_commands.conversion_link_snapshot_page(uuid,text,uuid,integer) TO crest_export;
