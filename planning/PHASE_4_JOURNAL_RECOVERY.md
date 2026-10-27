# Proposed journal encrypted database recovery

Test construction, 2026-10-26. Neutral source 6ce523fd, candidate 2d9334ba,
run 40439241935 independently passed 1,192 database and authentication cases:
652 foundation, 423 provider and 117 genuine authentication. All 209 proposal
cases passed, including independent reconstruction of 114 journal fields and
30 damage probes. This does not accept the following encrypted recovery test.

The new test-only journal-recovery-drill.mjs is separate from the existing
registered recovery helper. Its fixed inventory budget is 64 MiB of original
row JSON, at most 10,000 rows per table. The existing 8 MiB fixture inventory
and legacy backup/restore APIs are unchanged. A negative assertion proves the
large journal fixture is refused by that old limit. The larger fixed profile
accommodates the several genuine maximum-size journal originals in this test
suite; it is not a production backup capacity promise. Existing subprocess
buffers remain bounded at 32 MiB and fail the whole operation when exhausted.

Use one exported READ ONLY REPEATABLE READ snapshot for every table's exact
row count/hash, schema dump and custom PostgreSQL dump. Include all database
tables, not selected journal projections. While the snapshot remains open,
another source connection commits a later request and lease. These later facts
must be visible in the live source and absent from the restored point.

The manifest explicitly declares synthetic_forward43_journal_drill, registered
migration count 42, unregistered proposed migration 43, and exact SHA256 of all
five proposal SQL files. Bind the registered checksum registry, pinned database
image, closed migration-role definitions, all row hashes and normalized schema
hash. Do not relabel the source as registered schema 43. Encrypt the custom dump
and manifest with the existing pinned age tool and a public recipient only.
Only ciphertext and a checksum receipt are written to the private point.

After deleting the original recovery key, a fresh Node process gets only the
encrypted point, independent emergency-key copy and freshly owned destination.
Use an OS/Docker environment allowlist: no source database URL, provider token
or original process credential is passed. Restore into a separate pinned
loopback PostgreSQL container. The restore first checks an empty destination,
profile/fingerprints and complete authenticated dump, then creates only closed
migration roles and runs single-transaction pg_restore. Finally compare every
table count/hash and normalized schema/grants with the captured point.

A wrong key must leave an empty target. A damaged ciphertext with a recomputed
outer checksum must fail authenticated decryption before executable SQL. The
legacy restore must refuse this proposal profile at its manifest gate and
leave its target empty. These tests distinguish authentication from a matching
self-reported checksum and prevent silent profile/version compatibility claims.

An explicit target-only incident fixture pauses every restored business,
rotates recovery epochs and human actor security epochs, revokes application
sessions (clearing retained provider ciphertext) and removes old provider
sessions. This is an administrative drill, not a production recovery endpoint.
Fresh restricted export credentials must capture all 114 original journal
fields, including the complete 12 MiB original and its unchanged expiry.
Direct source-table reads and definer-role assumption remain denied.

Old restored browser credentials must fail. A freshly seeded synthetic SQL
session may read the original historical Ready receipt while paused, but may
not request another export. The later source job remains absent. All six
restored journal tables must still reject history deletion. Original source
rows, recovery authority and actor epoch must be unchanged by target recovery.
Genuine HTTP authentication remains the separate retained 117-case suite.

The fixture's session/lookup helpers accept an explicit test connection while
retaining their old defaults. Runtime probe role names contain a forced digit
so they cannot accidentally match the closed migration-role inventory regex.
No application code, business schema, dependency, timeout or authorization
rule changes. The new case has an explicit four-minute test allowance.

One case extends the proposal suite to 210 and expected database/authentication
total to 1,193 (653/423/117). Syntax/lint/types can be checked locally, but the
new dump, age, restore and access assertions require fresh exact-source Linux
CI. The 5,267-case/152-file unit sources remain unchanged from the CSV baseline.

This tests database/schema/journal compatibility and incident read/write
fences. It excludes external encrypted export objects, application image,
independent vault, production configuration and recovery authority. It proves
neither hosted-provider conformance nor complete operational disaster recovery.
completeBackup stays false. Schema 43 is not adopted, worker42 is not connected,
and no production activation or owner download authority is introduced.
