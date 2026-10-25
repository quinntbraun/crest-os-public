-- Recoverability correction for schema32: equivalent CHECK parentheses must
-- remain stable after PostgreSQL17 dump/reparse. No source records are changed.
DO $review$
DECLARE definition text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.customers'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
    THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTOMER_CHECK_REVIEW_REQUIRED'; END IF;
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='crest.customers'::regclass AND conname='customers_display_name_check' AND contype='c' AND convalidated AND NOT connoinherit;
  IF definition IS NULL OR definition NOT IN (E'CHECK ((((char_length(display_name) >= 1) AND (char_length(display_name) <= 200)) AND (btrim(display_name) <> ''''::text) AND (display_name !~ ''[[:cntrl:]]''::text)))',E'CHECK (((char_length(display_name) >= 1) AND (char_length(display_name) <= 200) AND (btrim(display_name) <> ''''::text) AND (display_name !~ ''[[:cntrl:]]''::text)))') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTOMER_CHECK_REVIEW_REQUIRED'; END IF;
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='crest.customers'::regclass AND conname='customers_archived_reason_check' AND contype='c' AND convalidated AND NOT connoinherit;
  IF definition IS NULL OR definition NOT IN (E'CHECK (((archived_reason IS NULL) OR (((char_length(archived_reason) >= 1) AND (char_length(archived_reason) <= 1000)) AND (btrim(archived_reason) <> ''''::text) AND (translate(archived_reason, ''\t\n\r''::text, ''''::text) !~ ''[[:cntrl:]]''::text))))',E'CHECK (((archived_reason IS NULL) OR ((char_length(archived_reason) >= 1) AND (char_length(archived_reason) <= 1000) AND (btrim(archived_reason) <> ''''::text) AND (translate(archived_reason, ''\t\n\r''::text, ''''::text) !~ ''[[:cntrl:]]''::text))))') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTOMER_CHECK_REVIEW_REQUIRED'; END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest.customers DROP CONSTRAINT customers_display_name_check,
  ADD CONSTRAINT customers_display_name_check CHECK(char_length(display_name)>=1 AND char_length(display_name)<=200 AND btrim(display_name)<>'' AND display_name!~'[[:cntrl:]]'),
  DROP CONSTRAINT customers_archived_reason_check,
  ADD CONSTRAINT customers_archived_reason_check CHECK(archived_reason IS NULL OR char_length(archived_reason)>=1 AND char_length(archived_reason)<=1000 AND btrim(archived_reason)<>'' AND translate(archived_reason,E'\t\n\r','')!~'[[:cntrl:]]');
RESET ROLE;
