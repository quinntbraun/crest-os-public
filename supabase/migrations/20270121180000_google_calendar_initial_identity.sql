-- The application verifies Google's signed ID token before supplying this
-- server-only identity to the restricted initial-promotion command.
-- Existing grants are not assigned a guessed provider identity.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.google_calendar_account_bindings (
 business_id uuid NOT NULL,
 destination_id uuid NOT NULL,
 client_id text NOT NULL CHECK(char_length(client_id)<=200 AND client_id COLLATE "C" ~ '^[A-Za-z0-9_-]+[.]apps[.]googleusercontent[.]com$'),
 provider_issuer text NOT NULL CHECK(provider_issuer='https://accounts.google.com'),
 provider_subject text NOT NULL CHECK(provider_subject COLLATE "C" ~ '^[!-~]{1,255}$'),
 credential_id uuid NOT NULL,
 source_attempt uuid NOT NULL,
 recovery_epoch uuid NOT NULL,
 actor_id uuid NOT NULL,
 bound_at timestamptz NOT NULL CHECK(isfinite(bound_at)),
 PRIMARY KEY(business_id,destination_id),
 UNIQUE(business_id,source_attempt),
 FOREIGN KEY(business_id,destination_id) REFERENCES crest.google_calendar_destinations(business_id,id),
 FOREIGN KEY(business_id,credential_id) REFERENCES crest_private.google_calendar_credentials(business_id,id),
 FOREIGN KEY(business_id,source_attempt) REFERENCES crest_private.google_calendar_creation_intents(business_id,attempt_id),
 FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id)
);
ALTER TABLE crest_private.google_calendar_account_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.google_calendar_account_bindings FORCE ROW LEVEL SECURITY;
CREATE TRIGGER calendar_account_binding_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.google_calendar_account_bindings
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest_private.google_calendar_account_bindings TO crest_calendar_oauth_owner;
CREATE POLICY calendar_account_binding_read ON crest_private.google_calendar_account_bindings FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_account_binding_append ON crest_private.google_calendar_account_bindings FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid);
GRANT CREATE ON SCHEMA crest_commands TO crest_calendar_oauth_owner;
RESET ROLE;
SET LOCAL ROLE crest_calendar_oauth_owner;
CREATE FUNCTION crest_commands.promote_google_calendar_verified_initial_destination(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,google_issuer text,google_client text,callback text,attempt uuid,
 destination uuid,new_credential uuid,key text,envelope jsonb,identity_issuer text,identity_subject text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verified$
DECLARE result jsonb;
BEGIN
 IF identity_issuer IS DISTINCT FROM 'https://accounts.google.com' OR identity_subject IS NULL
  OR identity_subject COLLATE "C" !~ '^[!-~]{1,255}$' THEN RETURN NULL; END IF;
 result:=crest_commands.promote_google_calendar_initial_destination(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,google_issuer,google_client,callback,attempt,destination,new_credential,key,envelope);
 IF result IS NULL THEN RETURN NULL; END IF;
 INSERT INTO crest_private.google_calendar_account_bindings(business_id,destination_id,client_id,provider_issuer,provider_subject,
  credential_id,source_attempt,recovery_epoch,actor_id,bound_at)
 VALUES(business,destination,google_client,identity_issuer,identity_subject,new_credential,attempt,epoch,actor,clock_timestamp());
 RETURN result;
END $verified$;
REVOKE ALL ON FUNCTION crest_commands.promote_google_calendar_verified_initial_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,uuid,uuid,text,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.promote_google_calendar_verified_initial_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,uuid,uuid,text,jsonb,text,text) TO crest_calendar_oauth;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_calendar_oauth_owner;
RESET ROLE;
