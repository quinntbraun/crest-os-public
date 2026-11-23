# Dedicated full-backup reader

This implements/reviews the read-only backup identity required by
EXPORTS_AND_BACKUPS4–5. SQL is an unregistered proposal over137, not a production
migration. Registration, current-schema adoption and live-provider acceptance
remain required. No ordinary application/export role or old migration changes.

## Deliberate privilege boundary

The offline whole-database reader is separate from tenant browser exports. It
must preserve cross-business, archived, operational, financial, runtime and
controlled Auth records. These private bytes are encrypted for the independent
recovery recipient, never made CSV/public/log output. The private recovery key
is not provided to the scheduler.

The chosen group crest_backup_reader is NOLOGIN, NOINHERIT, NOSUPERUSER,
NOCREATEDB, NOCREATEROLE, NOREPLICATION, BYPASSRLS. This deliberate offline-backup
exception supports standard pg_dump with row_security=off. Enabling row security
to disguise a filtered dump is forbidden. BYPASSRLS alone grants no table access
or writes. Explicit grants are only schema USAGE, table SELECT and sequence
SELECT in fixed Crest/Auth/migration/public schemas: no function EXECUTE, schema
CREATE, DML, grant option, membership or future-object default privilege.

A separately provisioned login has no superuser/BYPASSRLS/creation/replication/
inheritance attribute and exactly one membership with SET but no INHERIT/ADMIN.
Web/finance/export identities never receive this membership. No login/password
is in the proposal. Only an administrator already allowed to create BYPASSRLS
roles can register it; missing provider permissions must fail without substituting
an administrator capture account or widening application grants.

The proposal refuses existing-role adoption, a source other than registered137
and its2471 app-column fingerprint, PUBLIC table writes or reviewed-schema
PUBLIC SECURITY DEFINER execution. Owners, forced RLS, policies, functions, data
and financial semantics stay unchanged. Unknown managed schemas/future objects
can make pg_dump fail until reviewed; no hidden filter or default grant fixes it.

verifyRecoveryBackupReader checks actual session/group flags, membership options,
other inbound members, no group ownership/parent roles, exact schema/table/
sequence privileges, no Crest definer execution and trusted expected migration
versions/names. It creates no connection, credentials, privileges, owner session
or release authority. Final composition must verify accepted compiled registry/
checksum receipt, direct/session endpoint/TLS/CA, source scope, snapshot, vault
and recovery kit. Migration names alone do not prove checksum acceptance.

## Evidence and remaining registration

On f765afb,5 counted cases (parent plus4 children) pass against actual registered137
and provider DDL, two fictional businesses and protected customer/job/expense/
supplier/photo metadata. A restricted NOBYPASSRLS login switches only to the
backup group; actual snapshot-bound pg_dump/age and fresh-cluster restoration
preserve every source table's row census/hash without administrator fallback.
Original forced-RLS/policy definitions stay identical. A fresh limited restored
login passes preflight, reads the same inventory and cannot delete business data.
Other native refusals cover DML/truncation/schema creation, command-role switch,
pg_authid, web-to-backup switching/raw reads and mismatched migration identity.
Tracked source is frozen and owned cleanup awaited. These are disposable
operator/provider fixtures, not actual hosting or original-object/full-backup
acceptance. The file joins mandatory test:recovery-db without removing checks.

Next append a migration and preserve frozen137 SQL/registry/coverage/profile
bytes. Current-only closed-role restoration must admit only this explicit backup
exception; historical profiles keep their previous restrictions. Adopt the new
current export/request identity and document unchanged financial vocabulary
rather than aliasing unknown schemas. Prove registered upgrade, isolation,
current export and restore before release. Complete role/original/control/app/
config/key recovery, scheduling/reconciliation, locked manifest/complete marker,
backup_runs/heartbeat and actual host/owner/phone acceptance remain required.

References checked2026-11-22:
- [PostgreSQL17 role privileges](https://www.postgresql.org/docs/17/sql-createrole.html)
- [PostgreSQL17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)
