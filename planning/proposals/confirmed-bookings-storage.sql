-- Unregistered confirmed-booking construction over49 + mode storage.
-- Source49 commercial rows remain unchanged. No runtime grants or activation.
DO $review$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>49 OR to_regclass('crest.fulfillment_mode_versions') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.fulfillment_mode_versions'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_integrity_owner')
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='crest' AND c.relname=ANY(ARRAY['jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events']))
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_schema_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid='crest_schema_owner'::regrole OR m.member='crest_schema_owner'::regrole)
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole='crest_schema_owner'::regrole AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f','crest_schema_owner'::regrole))) a WHERE a.grantee<>'crest_schema_owner'::regrole)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole='crest_schema_owner'::regrole AND a.grantee<>d.defaclrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_REVIEW_REQUIRED';END IF;
 CREATE ROLE crest_booking_integrity_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 ALTER DEFAULT PRIVILEGES FOR ROLE crest_booking_integrity_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
END $review$;
SET LOCAL ROLE crest_schema_owner;
-- Required composite target for the job/accepted-agreement/customer binding;
-- existing agreement rows, original migration bytes and semantics stay intact.
ALTER TABLE crest.agreements ADD CONSTRAINT agreement_booking_customer UNIQUE(business_id,id,family_id,customer_id);
CREATE TABLE crest.jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 customer_id uuid NOT NULL, operator_actor_id uuid NOT NULL, fulfillment_mode text NOT NULL CHECK(fulfillment_mode IN('mobile','dropoff','pickup_return')),mode_version_id uuid NOT NULL,work_address_id uuid,work_location_snapshot jsonb NOT NULL CHECK(jsonb_typeof(work_location_snapshot)='object'),state text NOT NULL CHECK(state IN('scheduled','en_route','in_progress','paused','completed','cancelled')),current_appointment_id uuid NOT NULL,first_work_at timestamptz,completed_at timestamptz,completion_outcome text CHECK(completion_outcome IN('full','partial')),version bigint NOT NULL DEFAULT 1 CHECK(version>0),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_by uuid NOT NULL,
 FOREIGN KEY(business_id,work_address_id) REFERENCES crest.addresses(business_id,id),
 FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id),FOREIGN KEY(business_id,operator_actor_id) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,mode_version_id) REFERENCES crest.fulfillment_mode_versions(business_id,id),FOREIGN KEY(business_id,updated_by) REFERENCES crest.memberships(business_id,actor_id),CHECK(isfinite(updated_at) AND updated_at>=created_at),CHECK((state='completed')=(completed_at IS NOT NULL AND completion_outcome IS NOT NULL)),CHECK(state='completed' OR completed_at IS NULL AND completion_outcome IS NULL),CHECK(first_work_at IS NULL OR isfinite(first_work_at)),CHECK(completed_at IS NULL OR isfinite(completed_at) AND first_work_at IS NOT NULL AND completed_at>=first_work_at),UNIQUE(business_id,id,customer_id),UNIQUE(business_id,id,operator_actor_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,updated_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.jobs FORCE ROW LEVEL SECURITY;
CREATE INDEX jobs_actor_operation ON crest.jobs(business_id,operation_id,created_by);
CREATE TABLE crest.job_vehicles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 job_id uuid NOT NULL,vehicle_id uuid NOT NULL,customer_vehicle_id uuid,vehicle_snapshot jsonb NOT NULL CHECK(jsonb_typeof(vehicle_snapshot)='object'),customer_snapshot jsonb NOT NULL CHECK(jsonb_typeof(customer_snapshot)='object'),pickup_address_id uuid,return_address_id uuid,pickup_location_snapshot jsonb,return_location_snapshot jsonb,
 FOREIGN KEY(business_id,pickup_address_id) REFERENCES crest.addresses(business_id,id),FOREIGN KEY(business_id,return_address_id) REFERENCES crest.addresses(business_id,id),
 FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),FOREIGN KEY(business_id,vehicle_id) REFERENCES crest.vehicles(business_id,id),FOREIGN KEY(business_id,customer_vehicle_id) REFERENCES crest.customer_vehicles(business_id,id),UNIQUE(business_id,job_id,vehicle_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.job_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.job_vehicles FORCE ROW LEVEL SECURITY;
CREATE INDEX job_vehicles_actor_operation ON crest.job_vehicles(business_id,operation_id,created_by);
CREATE TABLE crest.job_encounters(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 job_id uuid NOT NULL,customer_id uuid NOT NULL,family_id uuid NOT NULL,agreement_id uuid NOT NULL,encounter_id uuid NOT NULL,
 FOREIGN KEY(business_id,job_id,customer_id) REFERENCES crest.jobs(business_id,id,customer_id),FOREIGN KEY(business_id,agreement_id,family_id,customer_id) REFERENCES crest.agreements(business_id,id,family_id,customer_id),UNIQUE(business_id,job_id,family_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.job_encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.job_encounters FORCE ROW LEVEL SECURITY;
CREATE INDEX job_encounters_actor_operation ON crest.job_encounters(business_id,operation_id,created_by);
CREATE TABLE crest.appointments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 job_id uuid NOT NULL,sequence bigint NOT NULL CHECK(sequence>0),replaces_id uuid,start_at timestamptz NOT NULL,end_at timestamptz NOT NULL,timezone text NOT NULL,local_start timestamp NOT NULL,local_end timestamp NOT NULL,start_offset_minutes integer NOT NULL,end_offset_minutes integer NOT NULL,travel_before_seconds integer CHECK(travel_before_seconds>=0),travel_after_seconds integer CHECK(travel_after_seconds>=0),confirmation_state text NOT NULL CHECK(confirmation_state IN('proposed','confirmed','withdrawn','cancelled')),customer_confirmation jsonb,contact_snapshot jsonb NOT NULL,unknown_travel_reviewed boolean NOT NULL,reason text,
 FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),UNIQUE(business_id,job_id,sequence),UNIQUE(business_id,id,job_id),UNIQUE(business_id,id,job_id,sequence),FOREIGN KEY(business_id,replaces_id,job_id) REFERENCES crest.appointments(business_id,id,job_id),CHECK(isfinite(start_at) AND isfinite(end_at) AND end_at>start_at),CHECK(sequence=1 AND replaces_id IS NULL OR sequence>1 AND replaces_id IS NOT NULL),CHECK(confirmation_state<>'confirmed' OR jsonb_typeof(customer_confirmation) IS NOT DISTINCT FROM 'object'),CHECK(jsonb_typeof(contact_snapshot)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.appointments FORCE ROW LEVEL SECURITY;
CREATE INDEX appointments_actor_operation ON crest.appointments(business_id,operation_id,created_by);
CREATE TABLE crest.operator_controls(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 operator_actor_id uuid NOT NULL,
 FOREIGN KEY(business_id,operator_actor_id) REFERENCES crest.memberships(business_id,actor_id),UNIQUE(business_id,operator_actor_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.operator_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.operator_controls FORCE ROW LEVEL SECURITY;
CREATE INDEX operator_controls_actor_operation ON crest.operator_controls(business_id,operation_id,created_by);
CREATE TABLE crest.schedule_reservations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 job_id uuid NOT NULL,appointment_id uuid NOT NULL,operator_actor_id uuid NOT NULL,blocked_interval tstzrange NOT NULL,unknown_travel boolean NOT NULL,override_id uuid,
 FOREIGN KEY(business_id,job_id,operator_actor_id) REFERENCES crest.jobs(business_id,id,operator_actor_id),FOREIGN KEY(business_id,appointment_id,job_id) REFERENCES crest.appointments(business_id,id,job_id),CHECK(NOT isempty(blocked_interval) AND NOT lower_inf(blocked_interval) AND NOT upper_inf(blocked_interval) AND lower_inc(blocked_interval) AND NOT upper_inc(blocked_interval)),UNIQUE(business_id,job_id),UNIQUE(business_id,appointment_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.schedule_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.schedule_reservations FORCE ROW LEVEL SECURITY;
CREATE INDEX schedule_reservations_actor_operation ON crest.schedule_reservations(business_id,operation_id,created_by);
CREATE TABLE crest.schedule_overrides(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 job_id uuid NOT NULL,appointment_id uuid NOT NULL,reason text NOT NULL CHECK(char_length(reason)>0 AND char_length(reason)<=1000 AND btrim(reason,E' \t\n\r')<>''),
 FOREIGN KEY(business_id,appointment_id,job_id) REFERENCES crest.appointments(business_id,id,job_id),UNIQUE(business_id,appointment_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.schedule_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.schedule_overrides FORCE ROW LEVEL SECURITY;
CREATE INDEX schedule_overrides_actor_operation ON crest.schedule_overrides(business_id,operation_id,created_by);
CREATE TABLE crest.schedule_override_conflicts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 override_id uuid NOT NULL,conflicting_appointment_id uuid NOT NULL,
 FOREIGN KEY(business_id,override_id) REFERENCES crest.schedule_overrides(business_id,id),FOREIGN KEY(business_id,conflicting_appointment_id) REFERENCES crest.appointments(business_id,id),UNIQUE(business_id,override_id,conflicting_appointment_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.schedule_override_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.schedule_override_conflicts FORCE ROW LEVEL SECURITY;
CREATE INDEX schedule_override_conflicts_actor_operation ON crest.schedule_override_conflicts(business_id,operation_id,created_by);
CREATE TABLE crest.allocation_plan_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 source_allocation_id uuid NOT NULL,sequence bigint NOT NULL CHECK(sequence>0),replaces_id uuid,reason text,
 FOREIGN KEY(business_id,source_allocation_id) REFERENCES crest.scope_allocations(business_id,id),UNIQUE(business_id,source_allocation_id,sequence),UNIQUE(business_id,id,source_allocation_id),FOREIGN KEY(business_id,replaces_id,source_allocation_id) REFERENCES crest.allocation_plan_versions(business_id,id,source_allocation_id),CHECK(sequence=1 AND replaces_id IS NULL OR sequence>1 AND replaces_id IS NOT NULL),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.allocation_plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.allocation_plan_versions FORCE ROW LEVEL SECURITY;
CREATE INDEX allocation_plan_versions_actor_operation ON crest.allocation_plan_versions(business_id,operation_id,created_by);
CREATE TABLE crest.allocation_plan_parts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 plan_id uuid NOT NULL,stable_partition_id uuid NOT NULL,job_id uuid,allocation_state text NOT NULL CHECK(allocation_state IN('unassigned','assigned','completed','cancelled')),gross_inclusive_cents bigint NOT NULL CHECK(gross_inclusive_cents>=0),discount_inclusive_cents bigint NOT NULL CHECK(discount_inclusive_cents>=0),amount_cents bigint NOT NULL CHECK(amount_cents>=0),scope_description text NOT NULL CHECK(char_length(scope_description)>0 AND char_length(scope_description)<=2000 AND btrim(scope_description,E' \t\n\r')<>''),CHECK((job_id IS NULL)=(allocation_state='unassigned')),
 FOREIGN KEY(business_id,plan_id) REFERENCES crest.allocation_plan_versions(business_id,id),FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),UNIQUE(business_id,plan_id,stable_partition_id),CHECK(gross_inclusive_cents::numeric-discount_inclusive_cents::numeric=amount_cents::numeric),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.allocation_plan_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.allocation_plan_parts FORCE ROW LEVEL SECURITY;
CREATE INDEX allocation_plan_parts_actor_operation ON crest.allocation_plan_parts(business_id,operation_id,created_by);
CREATE TABLE crest.job_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 job_id uuid NOT NULL,sequence bigint NOT NULL CHECK(sequence>0),from_state text,to_state text NOT NULL,effective_at timestamptz NOT NULL CHECK(isfinite(effective_at)),reason text,evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
 FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),UNIQUE(business_id,job_id,sequence),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.job_events FORCE ROW LEVEL SECURITY;
CREATE INDEX job_events_actor_operation ON crest.job_events(business_id,operation_id,created_by);
ALTER TABLE crest.jobs ADD CONSTRAINT job_current_appointment FOREIGN KEY(business_id,current_appointment_id,id) REFERENCES crest.appointments(business_id,id,job_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE crest.appointments ADD CONSTRAINT appointment_operation_once UNIQUE(business_id,job_id,operation_id);
ALTER TABLE crest.job_events ADD CONSTRAINT job_event_operation_once UNIQUE(business_id,job_id,operation_id);
ALTER TABLE crest.schedule_reservations ADD CONSTRAINT reservation_override FOREIGN KEY(business_id,override_id) REFERENCES crest.schedule_overrides(business_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX reservation_operator_interval ON crest.schedule_reservations USING gist(blocked_interval);
CREATE INDEX reservation_operator ON crest.schedule_reservations(business_id,operator_actor_id);
-- Construction is deliberately closed until the complete typed transaction,
-- deferred aggregate/audit guards and current-allocation projection are installed.
CREATE FUNCTION crest_private.booking_construction_closed() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $closed$
BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_BOOKING_IMPLEMENTATION_REQUIRED';END $closed$;
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.jobs FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.job_vehicles FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.job_encounters FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.appointments FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.operator_controls FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.schedule_reservations FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.schedule_overrides FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.schedule_override_conflicts FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.allocation_plan_versions FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.allocation_plan_parts FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.job_events FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
REVOKE ALL ON FUNCTION crest_private.booking_construction_closed() FROM PUBLIC;
RESET ROLE;
