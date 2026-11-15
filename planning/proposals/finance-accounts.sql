-- ACCOUNTING §§2–3 and DATABASE §7.1. Held over registered schema70.
-- Closed storage for account identity and audited name/availability history.
-- No accounts, balances, activation, or app privileges are seeded.
CREATE ROLE crest_finance_integrity_owner NOLOGIN NOINHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 code text NOT NULL CHECK (char_length(code)>=1 AND char_length(code)<=64 AND btrim(code)=code AND code !~ '[[:cntrl:]]'),
 account_type text NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','contra_revenue','expense')),
 normal_side text NOT NULL CHECK (normal_side IN ('debit','credit')),
 control_kind text CHECK (control_kind ~ '^[a-z][a-z0-9_]{0,63}$'),
 report_role text NOT NULL CHECK (report_role ~ '^[a-z][a-z0-9_]{0,63}$'),
 currency char(3) NOT NULL CHECK (currency='USD'),
 first_version bigint GENERATED ALWAYS AS (1::bigint) STORED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 origin text NOT NULL CHECK (origin='manual'),
 UNIQUE (business_id,id),
 UNIQUE (business_id,code),
 FOREIGN KEY (business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 CHECK (
  (report_role='contra_asset' AND account_type='asset' AND normal_side='credit')
  OR (report_role='contra_equity' AND account_type='equity' AND normal_side='debit')
  OR (report_role NOT IN ('contra_asset','contra_equity')
   AND normal_side=CASE WHEN account_type IN ('asset','contra_revenue','expense') THEN 'debit' ELSE 'credit' END)
 ),
 CHECK ((report_role='owner_custody') IS NOT DISTINCT FROM (control_kind IS NOT DISTINCT FROM 'owner_custody')),
 CHECK (report_role<>'owner_custody' OR account_type='asset')
);
CREATE INDEX account_operation ON crest.accounts(business_id,operation_id,created_by);
CREATE INDEX account_cursor ON crest.accounts(business_id,created_at,id);

CREATE TABLE crest.account_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 account_id uuid NOT NULL,
 version bigint NOT NULL CHECK (version>0),
 previous_version bigint GENERATED ALWAYS AS (nullif(version-1,0)) STORED,
 name text NOT NULL CHECK (char_length(name)>=1 AND char_length(name)<=200 AND btrim(name)=name AND name !~ '[[:cntrl:]]'),
 active boolean NOT NULL,
 reason text CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
 audit_event_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 origin text NOT NULL CHECK (origin='manual'),
 UNIQUE (business_id,id),
 UNIQUE (business_id,account_id,version),
 UNIQUE (business_id,audit_event_id),
 FOREIGN KEY (business_id,account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY (business_id,account_id,previous_version) REFERENCES crest.account_versions(business_id,account_id,version),
 FOREIGN KEY (business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 FOREIGN KEY (business_id,audit_event_id) REFERENCES crest_private.audit_events(business_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK (version=1 OR reason IS NOT NULL)
);
ALTER TABLE crest.accounts ADD CONSTRAINT finance_account_first_version
 FOREIGN KEY (business_id,id,first_version) REFERENCES crest.account_versions(business_id,account_id,version)
 DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX account_version_operation ON crest.account_versions(business_id,operation_id,created_by);
CREATE INDEX account_version_cursor ON crest.account_versions(business_id,created_at,id);

ALTER TABLE crest.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.account_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.account_versions FORCE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA crest,crest_private TO crest_finance_integrity_owner;
GRANT SELECT ON crest.accounts,crest.account_versions TO crest_finance_integrity_owner;
CREATE POLICY finance_account_integrity ON crest.accounts FOR SELECT TO crest_finance_integrity_owner USING (true);
CREATE POLICY finance_account_version_integrity ON crest.account_versions FOR SELECT TO crest_finance_integrity_owner USING (true);
GRANT SELECT(business_id,operation_id,actor_id,command_type,state,origin,import_row_id)
 ON crest_private.operations TO crest_finance_integrity_owner;
GRANT SELECT(id,business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,action,reason,delta,origin,import_row_id)
 ON crest_private.audit_events TO crest_finance_integrity_owner;
CREATE POLICY finance_account_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING (command_type='finance.account.save');
CREATE POLICY finance_account_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING (entity_kind='accounts');

CREATE FUNCTION crest_private.finance_account_snapshot(account crest.accounts, revision crest.account_versions)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $snapshot$
 SELECT jsonb_build_object(
  'schemaVersion',1,'id',account.id,'code',account.code,'accountType',account.account_type,
  'normalSide',account.normal_side,'controlKind',account.control_kind,'reportRole',account.report_role,
  'currency',account.currency,'version',revision.version::text,'name',revision.name,'active',revision.active
 );
$snapshot$;

CREATE FUNCTION crest_private.check_finance_account_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE account crest.accounts; previous crest.account_versions; before_snapshot jsonb; expected_delta jsonb;
BEGIN
 SELECT * INTO STRICT account FROM crest.accounts a WHERE (a.business_id,a.id)=(NEW.business_id,NEW.account_id);
 IF NEW.version=1 THEN
  IF (account.operation_id,account.created_by,account.origin) IS DISTINCT FROM (NEW.operation_id,NEW.created_by,NEW.origin) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_ACCOUNT_INITIAL_PROVENANCE_REQUIRED';
  END IF;
 ELSE
  SELECT * INTO STRICT previous FROM crest.account_versions v
   WHERE (v.business_id,v.account_id,v.version)=(NEW.business_id,NEW.account_id,NEW.previous_version);
  before_snapshot:=crest_private.finance_account_snapshot(account,previous);
 END IF;
 expected_delta:=jsonb_build_object('schemaVersion',1,'before',before_snapshot,
  'after',crest_private.finance_account_snapshot(account,NEW));
 IF NOT EXISTS (
  SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o
   ON (o.business_id,o.operation_id,o.actor_id)=(a.business_id,a.operation_id,a.actor_id)
  WHERE (a.business_id,a.id,a.operation_id,a.actor_id)=(NEW.business_id,NEW.audit_event_id,NEW.operation_id,NEW.created_by)
   AND a.entity_kind='accounts' AND a.entity_id=NEW.account_id AND a.entity_version=NEW.version
   AND a.action=CASE WHEN NEW.version=1 THEN 'create' ELSE 'revise' END
   AND a.reason IS NOT DISTINCT FROM NEW.reason AND a.delta=expected_delta
   AND a.origin=NEW.origin AND a.import_row_id IS NULL
   AND o.command_type='finance.account.save' AND o.state='committed' AND o.origin=NEW.origin AND o.import_row_id IS NULL
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_ACCOUNT_AUDIT_REQUIRED';
 END IF;
 RETURN NULL;
END
$check$;
REVOKE ALL ON FUNCTION crest_private.finance_account_snapshot(crest.accounts,crest.account_versions),
 crest_private.check_finance_account_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.finance_account_snapshot(crest.accounts,crest.account_versions)
 TO crest_finance_integrity_owner;

CREATE CONSTRAINT TRIGGER account_version_audited AFTER INSERT ON crest.account_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_finance_account_version();
CREATE TRIGGER account_identity_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.accounts
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER account_version_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.account_versions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.check_finance_account_version() OWNER TO crest_finance_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
