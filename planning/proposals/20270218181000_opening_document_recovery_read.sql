-- HELD: metadata reads for the existing closed, non-login backup reader.
-- No write, function execution, membership or runtime activation is granted.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.opening_document_intents,crest.opening_document_originals TO crest_backup_reader;
RESET ROLE;
