-- HELD with the customer-funds candidate. Extend only existing read-only
-- backup visibility; no login, membership, write, sequence or routine grant.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.opening_funds_origins,crest.opening_funds_items,
 crest.opening_funds_schedule_revisions TO crest_backup_reader;
RESET ROLE;
