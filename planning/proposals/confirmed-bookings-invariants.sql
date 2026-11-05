-- Unregistered aggregate booking construction. No app write grant or gate removal.
-- Existing commercial parent locks are the serialization point for scope plans.
DO $review$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_integrity_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_integrity_owner'::regrole OR member='crest_booking_integrity_owner'::regrole)
  OR to_regclass('crest.current_scope_allocation_parts') IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.stamp_booking_row()') AND proowner='crest_booking_integrity_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on'])
  OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='crest.allocation_plan_parts'::regclass AND attname='allocation_state' AND NOT attisdropped)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_AGGREGATE_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.quote_families,crest.quote_family_commercial_state,crest.agreements,crest.scope_allocations,crest.scope_entitlements,crest.entitlement_versions,crest.customers,crest.vehicles,crest.customer_vehicles,crest.memberships,crest.fulfillment_mode_versions TO crest_booking_integrity_owner;
CREATE POLICY booking_integrity_read ON crest.quote_families FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.quote_family_commercial_state FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.agreements FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.scope_allocations FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.scope_entitlements FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.entitlement_versions FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.customers FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.vehicles FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.customer_vehicles FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.memberships FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.fulfillment_mode_versions FOR SELECT TO crest_booking_integrity_owner USING(true);
-- PostgreSQL requires column UPDATE permission for SELECT FOR UPDATE. The
-- WITH CHECK(false) policies forbid actual updates by this closed lock role.
GRANT UPDATE(id) ON crest.quote_families,crest.operator_controls TO crest_booking_integrity_owner;
CREATE POLICY booking_family_lock ON crest.quote_families FOR UPDATE TO crest_booking_integrity_owner USING(true) WITH CHECK(false);
CREATE POLICY booking_operator_lock ON crest.operator_controls FOR UPDATE TO crest_booking_integrity_owner USING(true) WITH CHECK(false);
CREATE VIEW crest.current_scope_allocation_parts WITH(security_barrier=true,security_invoker=true) AS
 WITH latest AS(SELECT DISTINCT ON(business_id,source_allocation_id) business_id,source_allocation_id,id,sequence FROM crest.allocation_plan_versions ORDER BY business_id,source_allocation_id,sequence DESC)
 SELECT s.business_id,s.id AS source_allocation_id,s.entitlement_id,s.entitlement_version_id,s.agreement_id,
 l.id AS plan_id,coalesce(l.sequence,0::bigint) AS plan_sequence,
 CASE WHEN l.id IS NULL THEN s.stable_partition_id ELSE p.stable_partition_id END AS stable_partition_id,
 p.job_id,CASE WHEN l.id IS NULL THEN 'unassigned'::text ELSE p.allocation_state END AS allocation_state,
 CASE WHEN l.id IS NULL THEN s.gross_inclusive_cents ELSE p.gross_inclusive_cents END AS gross_inclusive_cents,
 CASE WHEN l.id IS NULL THEN s.discount_inclusive_cents ELSE p.discount_inclusive_cents END AS discount_inclusive_cents,
 CASE WHEN l.id IS NULL THEN s.amount_cents ELSE p.amount_cents END AS amount_cents,
 CASE WHEN l.id IS NULL THEN s.scope_description ELSE p.scope_description END AS scope_description
 FROM crest.scope_allocations s LEFT JOIN latest l ON l.business_id=s.business_id AND l.source_allocation_id=s.id
 LEFT JOIN crest.allocation_plan_parts p ON p.business_id=l.business_id AND p.plan_id=l.id
 WHERE l.id IS NULL OR p.id IS NOT NULL;
GRANT SELECT ON crest.current_scope_allocation_parts TO crest_booking_integrity_owner;
CREATE FUNCTION crest_private.lock_booking_family(business uuid,family uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lock$
BEGIN
 PERFORM 1 FROM crest.quote_families WHERE business_id=business AND id=family FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_BOOKING_FAMILY_REQUIRED';END IF;
END $lock$;
CREATE FUNCTION crest_private.lock_booking_operator(business uuid,operator_actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lock$
BEGIN
 PERFORM 1 FROM crest.operator_controls WHERE business_id=business AND operator_actor_id=operator_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_BOOKING_OPERATOR_REQUIRED';END IF;
END $lock$;
CREATE FUNCTION crest_private.validate_booking_plan_append() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $plan$
DECLARE family uuid;latest crest.allocation_plan_versions;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BOOKING_FRESH_READ_REQUIRED';END IF;
 SELECT e.agreement_family_id INTO family FROM crest.scope_allocations s JOIN crest.scope_entitlements e ON e.business_id=s.business_id AND e.id=s.entitlement_id WHERE s.business_id=NEW.business_id AND s.id=NEW.source_allocation_id;
 IF family IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_BOOKING_SCOPE_REQUIRED';END IF;
 PERFORM crest_private.lock_booking_family(NEW.business_id,family);
 SELECT * INTO latest FROM crest.allocation_plan_versions WHERE business_id=NEW.business_id AND source_allocation_id=NEW.source_allocation_id ORDER BY sequence DESC LIMIT 1;
 IF NEW.sequence<>coalesce(latest.sequence,0)+1 OR NEW.replaces_id IS DISTINCT FROM latest.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_PLAN_CONFLICT';END IF;
 RETURN NEW;
END $plan$;
CREATE FUNCTION crest_private.check_booking_plan() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $plan$
DECLARE p crest.allocation_plan_versions;s crest.scope_allocations;e crest.scope_entitlements;kind text;part_count bigint;gross numeric;discount numeric;amount numeric;
BEGIN
 IF TG_TABLE_NAME='allocation_plan_versions' THEN SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=NEW.business_id AND id=NEW.id;
 ELSE SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=NEW.business_id AND id=NEW.plan_id;END IF;
 SELECT * INTO s FROM crest.scope_allocations WHERE business_id=p.business_id AND id=p.source_allocation_id;
 SELECT * INTO e FROM crest.scope_entitlements WHERE business_id=p.business_id AND id=s.entitlement_id;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=p.business_id AND operation_id=p.operation_id AND actor_id=p.created_by;
 SELECT count(*),coalesce(sum(gross_inclusive_cents::numeric),0),coalesce(sum(discount_inclusive_cents::numeric),0),coalesce(sum(amount_cents::numeric),0) INTO part_count,gross,discount,amount FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.id;
 IF p.id IS NULL OR s.id IS NULL OR e.id IS NULL OR kind IS NULL OR kind NOT IN('operations.job.book','operations.job.cancel') OR part_count=0 OR gross<>s.gross_inclusive_cents OR discount<>s.discount_inclusive_cents OR amount<>s.amount_cents
  OR NOT EXISTS(SELECT 1 FROM crest.quote_family_commercial_state c WHERE c.business_id=p.business_id AND c.family_id=e.agreement_family_id AND c.current_agreement_id=s.agreement_id)
  OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(a.operation_id<>p.operation_id OR a.created_by<>p.created_by))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_TOTAL_REQUIRED';END IF;
 IF kind='operations.job.book' AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.allocation_state='assigned' AND j.operation_id=p.operation_id AND j.state='scheduled')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_NEW_SCOPE_REQUIRED';END IF;
 -- Cancellation changes state, not the previously explicit money or scope.
 IF kind='operations.job.cancel' AND(p.replaces_id IS NULL
  OR EXISTS(SELECT 1 FROM(SELECT * FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.replaces_id) prior_part FULL JOIN(SELECT * FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.id) next ON next.stable_partition_id=prior_part.stable_partition_id
    WHERE prior_part.id IS NULL OR next.id IS NULL OR ROW(next.job_id,next.gross_inclusive_cents,next.discount_inclusive_cents,next.amount_cents,next.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description)
       OR next.allocation_state IS DISTINCT FROM prior_part.allocation_state AND NOT(prior_part.allocation_state='assigned' AND next.allocation_state='cancelled' AND EXISTS(SELECT 1 FROM crest.jobs j WHERE j.business_id=prior_part.business_id AND j.id=prior_part.job_id AND j.state='cancelled' AND j.operation_id=p.operation_id)))
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CANCELLED_SCOPE_RETAINED';END IF;
 -- Stable partition identity cannot migrate into another entitlement's source.
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.allocation_plan_parts other ON other.business_id=a.business_id AND other.stable_partition_id=a.stable_partition_id JOIN crest.allocation_plan_versions previous ON previous.business_id=other.business_id AND previous.id=other.plan_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND previous.source_allocation_id<>p.source_allocation_id)
  OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.scope_allocations original ON original.business_id=a.business_id AND original.stable_partition_id=a.stable_partition_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND original.id<>p.source_allocation_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_PARTITION_IDENTITY_REQUIRED';END IF;
 -- A zero-dollar source/partition cannot disappear merely because the total
 -- remains zero. Preserve its original identity through explicit allocations.
 IF p.replaces_id IS NULL AND s.amount_cents=0 AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.stable_partition_id=s.stable_partition_id)
  OR p.replaces_id IS NOT NULL AND EXISTS(SELECT 1 FROM crest.allocation_plan_parts prior_part WHERE prior_part.business_id=p.business_id AND prior_part.plan_id=p.replaces_id AND prior_part.amount_cents=0 AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.stable_partition_id=prior_part.stable_partition_id))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ZERO_IDENTITY_REQUIRED';END IF;
 -- Every assigned partition has the accepted customer's actual job and vehicle.
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id JOIN crest.agreements agreement ON agreement.business_id=s.business_id AND agreement.id=s.agreement_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(j.customer_id<>agreement.customer_id OR NOT EXISTS(SELECT 1 FROM crest.job_encounters encounter WHERE encounter.business_id=j.business_id AND encounter.job_id=j.id AND encounter.family_id=e.agreement_family_id) OR NOT e.job_wide AND NOT EXISTS(SELECT 1 FROM crest.job_vehicles v WHERE v.business_id=j.business_id AND v.job_id=j.id AND v.vehicle_id=e.vehicle_id)))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_BINDING_REQUIRED';END IF;
 -- Existing assigned work stays intact when booking another visit; completed
 -- scope and active physical work cannot be moved by any booking command.
 IF p.replaces_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM crest.allocation_plan_parts prior_part JOIN crest.jobs j ON j.business_id=prior_part.business_id AND j.id=prior_part.job_id
  LEFT JOIN crest.allocation_plan_parts next ON next.business_id=prior_part.business_id AND next.plan_id=p.id AND next.stable_partition_id=prior_part.stable_partition_id
  WHERE prior_part.business_id=p.business_id AND prior_part.plan_id=p.replaces_id AND(
   prior_part.allocation_state='completed' OR j.state IN('en_route','in_progress','paused') OR prior_part.allocation_state='assigned' AND j.state='scheduled' AND kind='operations.job.book'
  ) AND ROW(next.job_id,next.allocation_state,next.gross_inclusive_cents,next.discount_inclusive_cents,next.amount_cents,next.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.allocation_state,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description)
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ASSIGNED_SCOPE_RETAINED';END IF;
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a LEFT JOIN crest.allocation_plan_parts prior_part ON prior_part.business_id=a.business_id AND prior_part.plan_id=p.replaces_id AND prior_part.stable_partition_id=a.stable_partition_id LEFT JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(
  a.allocation_state='completed' AND(prior_part.id IS NULL OR prior_part.allocation_state<>'completed' OR ROW(a.job_id,a.gross_inclusive_cents,a.discount_inclusive_cents,a.amount_cents,a.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description))
  OR a.allocation_state='assigned' AND(prior_part.id IS NULL OR prior_part.job_id IS DISTINCT FROM a.job_id OR prior_part.allocation_state IS DISTINCT FROM 'assigned') AND(kind<>'operations.job.book' OR j.operation_id<>p.operation_id OR j.state<>'scheduled')
  OR a.allocation_state='cancelled' AND(prior_part.id IS NULL OR prior_part.allocation_state IS DISTINCT FROM 'cancelled') AND(kind<>'operations.job.cancel' OR j.operation_id<>p.operation_id OR j.state<>'cancelled')
 )) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_STATE_REQUIRED';END IF;
 RETURN NULL;
END $plan$;
CREATE TRIGGER booking_validate_plan BEFORE INSERT ON crest.allocation_plan_versions FOR EACH ROW EXECUTE FUNCTION crest_private.validate_booking_plan_append();
CREATE CONSTRAINT TRIGGER booking_plan_total AFTER INSERT ON crest.allocation_plan_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_plan();
CREATE CONSTRAINT TRIGGER booking_plan_part_total AFTER INSERT ON crest.allocation_plan_parts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_plan();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.lock_booking_family(uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.lock_booking_operator(uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.validate_booking_plan_append() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_booking_plan() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.lock_booking_family(uuid,uuid),crest_private.lock_booking_operator(uuid,uuid),crest_private.validate_booking_plan_append(),crest_private.check_booking_plan() FROM PUBLIC;
