# Recovery attempt and snapshot coordination

These implement the existing isolated scheduler/lease/snapshot requirements in
EXPORTS_AND_BACKUPS4–5. They are not the complete production backup service. No
migration, role/grant, business record, credentials, provider resource or
production activation is changed. The existing synthetic recovery drill stays
synthetic-only and receives no production escape flag.

## Private attempt journal

`src/tooling/recovery-attempt.ts` creates a UUID-named journal and exclusive lock
in an existing private0700 directory owned by the process user. File contents
and directory entries are fsynced. This path is Linux-only, matching the isolated
recovery host; Windows directory durability is not assumed. Files are0600,
created exclusively without following final-component symlinks. The caller
must provision a protected parent directory and persistent spool.

Before upload, the journal durably records artifact UUID/purpose, expected
ciphertext size/hash and required retention. It omits source paths, customer
filenames, credentials and raw provider errors. Acknowledgement requires an exact
matching version-pinned vault receipt. Lost acknowledgements, inconsistent
receipts and cancellation after dispatch become uncertain and block further
dispatch. Process death leaves the reservation/lock for inspection. Existing
locks/journals are never stolen, truncated, reset or automatically retried.
Operator reconciliation still needs deliberate implementation.

Canonical sequence/hash links and explicit byte/event limits reject torn lines,
reordering and corruption. They do not authenticate authorship or detect a
removed complete suffix without a trusted external head. Every summary says
`completeBackup:false`, even with every listed artifact verified. The spool lock
is single-host coordination, separate from the database-wide lease below.

On a8ca79b,12 native Linux cases pass in the cached digest-pinned Node image,
without network, with read-only source and private ephemeral/tmp. They cover
fsync-before-dispatch observation, verified receipts, uncertainty, changed
tuple/version refusal, concurrency/replay, directory privacy, corruption and
actual child-process termination. Source stays unchanged. Synthetic vault
acknowledgements isolate journal behavior; no physical power-loss/filesystem,
provider or complete-backup acceptance is claimed.

## Business backup lease and held snapshot

`src/tooling/recovery-backup-lease.ts` owns an already connected dedicated
direct/session PostgreSQL client and closes it on exit. The future composition
must validate production connection/TLS/role scope; this helper does not grant
full backup reads to ordinary web/export roles. Transaction pooling is
incompatible and must be refused by configured deployment acceptance.

A signed64-bit SHA256-derived business key in PostgreSQL's single-bigint advisory
namespace gives one backup lease per business/database across scheduler hosts.
A collision only serializes unrelated businesses. The existing two-integer
migration lock stays separate. No financial/table mutation locks are acquired.
Competing acquisition fails immediately, without stale takeover or new recovery
authority. Exactly one capture per lease acquires the shared migration lock and
opens READ ONLY REPEATABLE READ. It exports the actual PostgreSQL snapshot and
provides the same held connection to trusted fixed inventory/control readers.
The future pg_dump must use that exported snapshot before capture returns.

The transaction/shared migration lock close after capture; the business lease
stays held through encryption/upload/publication. Expired query capabilities
are refused and a second capture cannot mix a newer snapshot into that attempt.
Queries have five-second bounds, capture fifteen minutes and the enclosing
lease one hour. Ports/child processes must honor abort and be awaited. The final
orchestrator must check the lease before publication/heartbeat and preserve
uncertain writes. Session errors, termination, cancellation or failed capture
prevent wrapper success. This is coordination, not complete durable fencing,
incident/restore authority or configured capacity acceptance.

On b8d1157, all6 native PostgreSQL cases pass with frozen source and awaited
owned cleanup: same-business competition, another business proceeding, lease
retention after capture, migration lock separation, concurrent committed writes
excluded from both exporter and snapshot-importing connection, write refusal,
expired/second capture refusal, cancellation and actual backend termination.
Administrative connections/records are disposable, not production role/TLS
acceptance. Both files join mandatory `test:recovery-db` without removing checks.

## Remaining composition

Still implement/prove age/pg_dump and complete retained-object capture, the
restricted full-backup role, registry/role/control/reference completeness,
durable scheduling/reconciliation, point retention, encrypted manifest/final
marker, backup_runs/independent heartbeat, app/image/configuration/key kit and
fresh-host restore. Actual B2 permissions, version/lock/deletion checks,
missed-backup alerts and owner acceptance remain required. Journal counts and
partial business exports cannot replace them.

Primary references checked2026-11-22:
- [PostgreSQL17 snapshot synchronization and advisory locks](https://www.postgresql.org/docs/17/functions-admin.html)
- [PostgreSQL17 advisory key representation](https://www.postgresql.org/docs/17/view-pg-locks.html)
