-- P01/P02 issuance prerequisites. No automatic series or open period.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.accounting_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 starts_on date NOT NULL CHECK (starts_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 month_start date GENERATED ALWAYS AS (date_trunc('month',starts_on::timestamp)::date) STORED,
 through_on date NOT NULL,
 time_zone text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 128),
 opening_boundary boolean NOT NULL,
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,month_start),
 FOREIGN KEY(business_id,operation_id,created_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK (through_on=(date_trunc('month',starts_on::timestamp)+interval '1 month - 1 day')::date),
 CHECK (opening_boundary OR extract(day FROM starts_on)=1)
);
CREATE UNIQUE INDEX one_opening_accounting_period ON crest.accounting_periods(business_id) WHERE opening_boundary;
ALTER TABLE crest.accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.accounting_periods FORCE ROW LEVEL SECURITY;

CREATE FUNCTION crest_private.validate_accounting_period_start() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $period$
BEGIN
 -- Period mutations share the finance lock in the future command layer.
 IF NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=NEW.time_zone) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ACCOUNTING_PERIOD_TIMEZONE_REQUIRED';
 END IF;
 IF EXISTS(SELECT FROM crest.accounting_periods p WHERE p.business_id=NEW.business_id
  AND p.id<>NEW.id AND (NEW.opening_boundary AND p.starts_on<NEW.starts_on
    OR p.opening_boundary AND NEW.starts_on<p.starts_on)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ACCOUNTING_PERIOD_OPENING_ORDER_REQUIRED';
 END IF;
 RETURN NULL;
END $period$;

CREATE CONSTRAINT TRIGGER accounting_period_valid AFTER INSERT ON crest.accounting_periods
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.validate_accounting_period_start();
CREATE TRIGGER accounting_period_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.accounting_periods
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT ON crest.accounting_periods TO crest_finance_integrity_owner;
CREATE POLICY accounting_period_integrity ON crest.accounting_periods FOR SELECT TO crest_finance_integrity_owner USING(true);

CREATE TABLE crest.invoice_series (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 label text NOT NULL CHECK (label ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,79}$'),
 recovery_epoch uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('original','recovery')),
 incident_id uuid,
 approval_reason text NOT NULL CHECK (char_length(btrim(approval_reason)) BETWEEN 1 AND 1000),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,label),
 UNIQUE(business_id,recovery_epoch),
 UNIQUE(business_id,id,recovery_epoch),
 FOREIGN KEY(business_id,operation_id,created_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK ((kind='original' AND incident_id IS NULL)
  OR (kind='recovery' AND incident_id IS NOT NULL AND right(label,36)=recovery_epoch::text))
);
CREATE UNIQUE INDEX one_original_invoice_series ON crest.invoice_series(business_id) WHERE kind='original';
ALTER TABLE crest.invoice_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.invoice_series FORCE ROW LEVEL SECURITY;

CREATE TABLE crest.invoice_number_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 full_number text NOT NULL CHECK (char_length(full_number)>=1 AND char_length(full_number)<=120 AND full_number=btrim(full_number)
  AND full_number !~ '[[:cntrl:]]'),
 series_id uuid,
 number_sequence bigint CHECK (number_sequence>0),
 issued_source_id uuid,
 incident_id uuid,
 external_evidence text CHECK (char_length(btrim(external_evidence)) BETWEEN 1 AND 2000),
 recovery_epoch uuid NOT NULL,
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,full_number),
 UNIQUE(business_id,series_id,number_sequence),
 UNIQUE(business_id,issued_source_id),
 FOREIGN KEY(business_id,series_id,recovery_epoch) REFERENCES crest.invoice_series(business_id,id,recovery_epoch) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,created_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK ((series_id IS NULL)=(number_sequence IS NULL)),
 CHECK ((incident_id IS NULL AND external_evidence IS NULL AND issued_source_id IS NOT NULL AND series_id IS NOT NULL)
  OR (incident_id IS NOT NULL AND external_evidence IS NOT NULL))
);
ALTER TABLE crest.invoice_number_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.invoice_number_reservations FORCE ROW LEVEL SECURITY;
GRANT SELECT ON crest.invoice_series TO crest_finance_integrity_owner;
CREATE POLICY invoice_series_integrity ON crest.invoice_series FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE FUNCTION crest_private.verify_invoice_number_reservation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $number$
BEGIN
 IF NEW.incident_id IS NULL AND NOT EXISTS(
  SELECT FROM crest.invoice_series s
  WHERE (s.business_id,s.id,s.recovery_epoch)=(NEW.business_id,NEW.series_id,NEW.recovery_epoch)
   AND NEW.full_number=s.label||'-'||NEW.number_sequence::text
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_NUMBER_SERIES_REQUIRED';
 END IF;
 RETURN NULL;
END $number$;
CREATE CONSTRAINT TRIGGER invoice_number_verified AFTER INSERT ON crest.invoice_number_reservations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_invoice_number_reservation();
CREATE TRIGGER invoice_series_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.invoice_series
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER invoice_numbers_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.invoice_number_reservations
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

-- The issue command owns the operation, lock order and posting transaction.
-- Reserving a number is an internal step within that same transaction.
CREATE UNIQUE INDEX ordinary_invoice_number_operation ON crest.invoice_number_reservations(business_id,operation_id)
 WHERE incident_id IS NULL;
GRANT SELECT ON crest.invoice_series,crest.invoice_number_reservations TO crest_finance_account_owner;
GRANT INSERT(business_id,full_number,series_id,number_sequence,issued_source_id,recovery_epoch,created_by,operation_id)
 ON crest.invoice_number_reservations TO crest_finance_account_owner;
CREATE POLICY invoice_series_issue_read ON crest.invoice_series FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY invoice_number_issue_read ON crest.invoice_number_reservations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY invoice_number_issue_append ON crest.invoice_number_reservations FOR INSERT TO crest_finance_account_owner
 WITH CHECK (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND incident_id IS NULL AND external_evidence IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o
   WHERE o.business_id=invoice_number_reservations.business_id
    AND o.operation_id=invoice_number_reservations.operation_id
    AND o.actor_id=invoice_number_reservations.created_by
    AND o.recovery_epoch=invoice_number_reservations.recovery_epoch
    AND o.command_type='finance.invoice.issue' AND o.state='pending'));
CREATE POLICY invoice_number_issue_operation ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.invoice.issue');
GRANT SELECT(id,business_id,active_epoch,writes_enabled) ON crest_private.business_recovery_authorities TO crest_finance_account_owner;
CREATE POLICY invoice_number_issue_authority ON crest_private.business_recovery_authorities FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);

CREATE FUNCTION crest_private.reserve_issued_invoice_number(requested_invoice uuid, expected_epoch uuid)
 RETURNS TABLE(reservation_id uuid, invoice_number text) LANGUAGE plpgsql VOLATILE
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $reserve$
DECLARE
 business uuid:=nullif(current_setting('crest.business_id',true),'')::uuid;
 actor uuid:=nullif(current_setting('crest.actor_id',true),'')::uuid;
 operation uuid:=nullif(current_setting('crest.operation_id',true),'')::uuid;
 series crest.invoice_series;
 last_sequence bigint;
 next_number text;
BEGIN
 IF requested_invoice IS NULL OR expected_epoch IS NULL OR NOT EXISTS(
  SELECT FROM crest_private.operations o WHERE (o.business_id,o.operation_id,o.actor_id,o.recovery_epoch)=
   (business,operation,actor,expected_epoch) AND o.command_type='finance.invoice.issue' AND o.state='pending'
 ) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='INVOICE_NUMBER_ISSUE_CONTEXT_REQUIRED';
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT FROM crest_private.finance_controls f JOIN crest_private.business_recovery_authorities a
  ON (a.business_id,a.id)=(f.business_id,f.recovery_authority_id)
  WHERE f.business_id=business AND a.active_epoch=expected_epoch AND a.writes_enabled) THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RECOVERY_REVIEW_REQUIRED';
 END IF;
 SELECT s.* INTO series FROM crest.invoice_series s WHERE (s.business_id,s.recovery_epoch)=(business,expected_epoch);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='APPROVED_INVOICE_SERIES_REQUIRED'; END IF;
 SELECT coalesce(max(n.number_sequence),0) INTO last_sequence FROM crest.invoice_number_reservations n
 WHERE (n.business_id,n.series_id)=(business,series.id);
 LOOP
  IF last_sequence=9223372036854775807 THEN
   RAISE EXCEPTION USING ERRCODE='22003',MESSAGE='INVOICE_SERIES_EXHAUSTED';
  END IF;
  last_sequence:=last_sequence+1;
  next_number:=series.label||'-'||last_sequence::text;
  EXIT WHEN NOT EXISTS(SELECT FROM crest.invoice_number_reservations n WHERE (n.business_id,n.full_number)=(business,next_number));
 END LOOP;
 RETURN QUERY INSERT INTO crest.invoice_number_reservations
  (business_id,full_number,series_id,number_sequence,issued_source_id,recovery_epoch,created_by,operation_id)
  VALUES(business,next_number,series.id,last_sequence,requested_invoice,expected_epoch,actor,operation)
  RETURNING id,full_number;
END $reserve$;
REVOKE ALL ON FUNCTION crest_private.reserve_issued_invoice_number(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.reserve_issued_invoice_number(uuid,uuid) TO crest_finance_account_owner;

RESET ROLE;
ALTER FUNCTION crest_private.validate_accounting_period_start() OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.verify_invoice_number_reservation() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.validate_accounting_period_start(),crest_private.verify_invoice_number_reservation() FROM PUBLIC;
