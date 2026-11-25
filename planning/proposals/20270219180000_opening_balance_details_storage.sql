-- HELD storage part of the remaining opening-source workspace.
-- No application writer, source registration, journal or production activation.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.opening_balance_details_origins (
 id uuid PRIMARY KEY,business_id uuid NOT NULL,
 source_namespace text NOT NULL CHECK(source_namespace~'^[a-z][a-z0-9_.-]{0,99}$'),
 external_id text NOT NULL CHECK(char_length(external_id)>=1 AND char_length(external_id)<=200
  AND btrim(external_id)=external_id AND external_id!~'[[:cntrl:]]'),
 operation_id uuid NOT NULL,recorded_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(business_id,id),UNIQUE(business_id,source_namespace,external_id),
 FOREIGN KEY(business_id,operation_id,recorded_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);

CREATE TABLE crest.opening_balance_details_items (
 id uuid PRIMARY KEY,business_id uuid NOT NULL,origin_id uuid NOT NULL,
 source_kind text NOT NULL CHECK(source_kind IN('wallet','cash','checks','transfer_transit',
  'owner_custody','tax_liability','debt','due_owner','equipment_cost',
  'accumulated_depreciation','prepaid','other_asset','other_liability')),
 asset_id uuid,owner_id uuid,channel_id uuid,cost_item_id uuid,
 operation_id uuid NOT NULL,recorded_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(business_id,id),UNIQUE(business_id,id,origin_id,source_kind),
 FOREIGN KEY(business_id,origin_id) REFERENCES crest.opening_balance_details_origins(business_id,id),
 FOREIGN KEY(business_id,owner_id) REFERENCES crest.memberships(business_id,actor_id),
 FOREIGN KEY(business_id,cost_item_id) REFERENCES crest.opening_balance_details_items(business_id,id)
  DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(business_id,operation_id,recorded_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 CHECK((asset_id IS NOT NULL)=(source_kind IN('equipment_cost','accumulated_depreciation'))),
 CHECK((owner_id IS NOT NULL)=(source_kind IN('owner_custody','due_owner'))),
 CHECK((channel_id IS NOT NULL)=(source_kind IN('wallet','owner_custody'))),
 CHECK((cost_item_id IS NOT NULL)=(source_kind='accumulated_depreciation')),
 CHECK(cost_item_id IS NULL OR cost_item_id<>id)
);

CREATE TABLE crest.opening_balance_details_schedule_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL,
 worksheet_revision_id uuid NOT NULL,revision bigint NOT NULL CHECK(revision>0),
 prior_revision bigint GENERATED ALWAYS AS(nullif(revision-1,0)) STORED,
 operation_id uuid NOT NULL,audit_event_id uuid NOT NULL,recorded_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 evidence jsonb NOT NULL,
 evidence_sha256 text NOT NULL CHECK(evidence_sha256=encode(sha256(convert_to(evidence::text,'UTF8')),'hex')),
 UNIQUE(business_id,id),UNIQUE(business_id,worksheet_revision_id,revision),
 UNIQUE(business_id,operation_id),UNIQUE(business_id,audit_event_id),
 FOREIGN KEY(business_id,worksheet_revision_id) REFERENCES crest.opening_worksheet_revisions(business_id,id),
 FOREIGN KEY(business_id,worksheet_revision_id,prior_revision)
  REFERENCES crest.opening_balance_details_schedule_revisions(business_id,worksheet_revision_id,revision),
 FOREIGN KEY(business_id,operation_id,recorded_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 FOREIGN KEY(business_id,audit_event_id)
  REFERENCES crest_private.audit_events(business_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=4194304
  AND evidence?&ARRAY['schemaVersion','profile','cutoverOn','cutoverAt','currency','state','reason',
   'items','reviews','totals','warnings','unresolvedKinds','posted','postingAuthorized',
   'fullSourceClosureVerified','completeOpening']
  AND evidence-ARRAY['schemaVersion','profile','cutoverOn','cutoverAt','currency','state','reason',
   'items','reviews','totals','warnings','unresolvedKinds','posted','postingAuthorized',
   'fullSourceClosureVerified','completeOpening']='{}'
  AND evidence->'schemaVersion'='1' AND evidence->>'profile'='crest.opening-balance-details-candidate.v1'
  AND evidence->>'currency'='USD' AND evidence->>'state'='evidence_prepared'
  AND evidence->'posted'='false' AND evidence->'postingAuthorized'='false'
  AND evidence->'fullSourceClosureVerified'='false' AND evidence->'completeOpening'='false'
  AND jsonb_typeof(evidence->'items')='array' AND jsonb_array_length(evidence->'items')<=1000
  AND jsonb_typeof(evidence->'reviews')='array' AND jsonb_array_length(evidence->'reviews')=13
  AND jsonb_typeof(evidence->'totals')='object' AND jsonb_typeof(evidence->'warnings')='array'
  AND jsonb_typeof(evidence->'unresolvedKinds')='array')
);

CREATE TABLE crest.opening_balance_details_item_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL,
 schedule_revision_id uuid NOT NULL,item_id uuid NOT NULL,origin_id uuid NOT NULL,
 source_kind text NOT NULL,sequence integer NOT NULL CHECK(sequence>=1 AND sequence<=1000),
 account_id uuid NOT NULL,account_version bigint NOT NULL CHECK(account_version>0),
 amount_cents bigint NOT NULL CHECK(amount_cents<>0 AND amount_cents>= -9223372036854775807
  AND (source_kind='wallet' OR amount_cents>0)),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=4096),
 detail jsonb NOT NULL CHECK(jsonb_typeof(detail)='object' AND octet_length(detail::text)<=262144),
 operation_id uuid NOT NULL,recorded_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(business_id,id),UNIQUE(business_id,schedule_revision_id,item_id),
 UNIQUE(business_id,schedule_revision_id,sequence),
 FOREIGN KEY(business_id,schedule_revision_id)
  REFERENCES crest.opening_balance_details_schedule_revisions(business_id,id),
 FOREIGN KEY(business_id,item_id,origin_id,source_kind)
  REFERENCES crest.opening_balance_details_items(business_id,id,origin_id,source_kind),
 FOREIGN KEY(business_id,account_id,account_version)
  REFERENCES crest.account_versions(business_id,account_id,version),
 FOREIGN KEY(business_id,operation_id,recorded_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);

-- Closed until the separately checked command, audit and identity-history part
-- provides scoped writes. Table ownership alone receives no RLS bypass.
DO $retention$
DECLARE relation_name text;
BEGIN
 FOREACH relation_name IN ARRAY ARRAY['opening_balance_details_origins','opening_balance_details_items',
  'opening_balance_details_schedule_revisions','opening_balance_details_item_revisions'] LOOP
  EXECUTE format('ALTER TABLE crest.%I ENABLE ROW LEVEL SECURITY',relation_name);
  EXECUTE format('ALTER TABLE crest.%I FORCE ROW LEVEL SECURITY',relation_name);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.%I FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal()',relation_name||'_retained',relation_name);
  EXECUTE format('GRANT SELECT ON crest.%I TO crest_finance_integrity_owner',relation_name);
  EXECUTE format('CREATE POLICY %I ON crest.%I FOR SELECT TO crest_finance_integrity_owner USING(true)',relation_name||'_integrity',relation_name);
 END LOOP;
END $retention$;
RESET ROLE;
