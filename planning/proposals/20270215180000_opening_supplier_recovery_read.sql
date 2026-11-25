-- HELD: preserve the closed, non-login recovery reader's existing contract.
-- No write, function-execute, membership, login or runtime privilege is added.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.opening_payables_origins,crest.opening_payables_schedule_revisions,
 crest.opening_allocations_origins,crest.opening_allocations_schedule_revisions TO crest_backup_reader;
RESET ROLE;
