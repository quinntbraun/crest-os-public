-- P10 storage under construction. The posting transaction owns source eligibility,
-- exact journal verification and the authoritative operation receipt.
SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_private.original_tip_return_components(
 original_inclusive bigint, original_net bigint, first_cent bigint, last_cent bigint
) RETURNS TABLE(net_cents bigint,tax_cents bigint)
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $components$
 SELECT net,last_cent-first_cent+1-net FROM (
  SELECT (div(2*original_net::numeric*last_cent+original_inclusive,2*original_inclusive::numeric)
         -div(2*original_net::numeric*(first_cent-1)+original_inclusive,2*original_inclusive::numeric))::bigint AS net
  WHERE original_inclusive>0 AND original_net BETWEEN 0 AND original_inclusive
   AND first_cent>0 AND last_cent BETWEEN first_cent AND original_inclusive
 ) component;
$components$;
REVOKE ALL ON FUNCTION crest_private.original_tip_return_components(bigint,bigint,bigint,bigint) FROM PUBLIC;

CREATE TABLE crest.tip_returns (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 tip_realization_id uuid NOT NULL,
 channel_version_id uuid NOT NULL,
 account_id uuid NOT NULL,
 evidence_id uuid NOT NULL,
 actual_on date NOT NULL CHECK(actual_on BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'),
 cents bigint NOT NULL CHECK(cents>0),
 net_cents bigint NOT NULL CHECK(net_cents>=0),
 tax_cents bigint NOT NULL CHECK(tax_cents>=0),
 confirmation text NOT NULL CHECK(char_length(confirmation)>=1 AND char_length(confirmation)<=1000 AND confirmation=btrim(confirmation)
  AND confirmation!~'[[:cntrl:]]'),
 reason text NOT NULL CHECK(char_length(reason)>=1 AND char_length(reason)<=1000 AND reason=btrim(reason) AND reason!~'[[:cntrl:]]'),
 operation_id uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(business_id,id,tip_realization_id),
 UNIQUE(business_id,id),
 UNIQUE(business_id,operation_id),
 UNIQUE(business_id,evidence_id),
 FOREIGN KEY(business_id,tip_realization_id) REFERENCES crest.tip_realizations(business_id,id),
 FOREIGN KEY(business_id,channel_version_id) REFERENCES crest.money_channel_versions(business_id,id),
 FOREIGN KEY(business_id,account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,evidence_id) REFERENCES crest.external_money_evidence(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 CHECK(net_cents::numeric+tax_cents=cents)
);

-- These offsets are relative to the original realized tip. P06 already consumed
-- the parent held-funds lot, so that lot is never charged again by this return.
CREATE TABLE crest.tip_realization_range_consumptions (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 tip_realization_id uuid NOT NULL,
 tip_return_id uuid NOT NULL,
 first_cent bigint NOT NULL CHECK(first_cent>0),
 last_cent bigint NOT NULL CHECK(last_cent>=first_cent),
 PRIMARY KEY(business_id,tip_realization_id,first_cent),
 UNIQUE(business_id,id),
 FOREIGN KEY(business_id,tip_return_id,tip_realization_id) REFERENCES crest.tip_returns(business_id,id,tip_realization_id),
 EXCLUDE USING gist(business_id extensions.gist_uuid_ops WITH =,tip_realization_id extensions.gist_uuid_ops WITH =,
  numrange(first_cent::numeric,last_cent::numeric,'[]') WITH &&)
);
ALTER TABLE crest.tip_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.tip_returns FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.tip_realization_range_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.tip_realization_range_consumptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON crest.tip_returns,crest.tip_realization_range_consumptions FROM PUBLIC;
CREATE TRIGGER tip_return_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.tip_returns
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER tip_consumption_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.tip_realization_range_consumptions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
RESET ROLE;
