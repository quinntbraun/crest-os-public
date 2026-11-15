-- A posted event must cite an open month and generation observed while
-- holding the shared finance-control row lock.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.accounting_period_locks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 period_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>0),
 previous_generation bigint GENERATED ALWAYS AS (nullif(generation-1,0)) STORED,
 state text NOT NULL CHECK(state IN ('locked','reopened')),
 evidence_ref text NOT NULL CHECK(char_length(evidence_ref)>=1 AND char_length(evidence_ref)<=500
  AND btrim(evidence_ref)=evidence_ref AND evidence_ref !~ '[[:cntrl:]]'),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,period_id,generation),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,period_id) REFERENCES crest.accounting_periods(business_id,id),
 FOREIGN KEY(business_id,period_id,previous_generation) REFERENCES crest.accounting_period_locks(business_id,period_id,generation),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 CHECK((state='locked')=(generation%2=1))
);
ALTER TABLE crest.accounting_period_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.accounting_period_locks FORCE ROW LEVEL SECURITY;
CREATE TRIGGER accounting_period_lock_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.accounting_period_locks
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT ON crest.accounting_periods,crest.accounting_period_locks TO crest_finance_account_owner;
CREATE POLICY finance_accounting_period_read ON crest.accounting_periods FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY finance_accounting_period_lock_read ON crest.accounting_period_locks FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);

CREATE FUNCTION crest_private.require_open_accounting_period(requested_business uuid, effective_on date, requested_zone text)
 RETURNS TABLE(period_id uuid, generation bigint) LANGUAGE plpgsql VOLATILE
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $period$
BEGIN
 IF requested_business IS NULL OR effective_on IS NULL OR NOT isfinite(effective_on)
  OR requested_zone IS NULL OR requested_business IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACCOUNTING_PERIOD_CONTEXT_REQUIRED';
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED';
 END IF;
 RETURN QUERY SELECT p.id,coalesce(l.generation,0) FROM crest.accounting_periods p
 LEFT JOIN LATERAL (
  SELECT h.generation,h.state FROM crest.accounting_period_locks h
  WHERE (h.business_id,h.period_id)=(p.business_id,p.id) ORDER BY h.generation DESC LIMIT 1
 ) l ON true
 WHERE p.business_id=requested_business AND p.time_zone=requested_zone
  AND effective_on BETWEEN p.starts_on AND p.through_on AND l.state IS DISTINCT FROM 'locked';
 IF NOT FOUND THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ACCOUNTING_OPEN_PERIOD_REQUIRED';
 END IF;
END $period$;
REVOKE ALL ON FUNCTION crest_private.require_open_accounting_period(uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.require_open_accounting_period(uuid,date,text) TO crest_finance_account_owner;
RESET ROLE;
