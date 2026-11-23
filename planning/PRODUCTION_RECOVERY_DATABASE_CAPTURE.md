# Encrypted database snapshot capture

The reader is registered in138. Its proposal, upgrade and independent restore
evidence are in PRODUCTION_RECOVERY_READER.md; complete recovery assembly and
actual-provider acceptance remain required.

`src/tooling/recovery-database-capture.ts` implements the standard pg_dump/age
mechanics required by EXPORTS_AND_BACKUPS5. It is isolated recovery tooling, not
a web capability, scheduler, role grant, complete backup or production release.
No SQL migration or existing business/financial rule changes.

The caller must hold an actual live snapshot from withRecoveryBackupLease. A
private WeakMap binding ties that snapshot to its owning connection's host,
port, database, login, credential and TLS-verification mode. Copies/lookalikes,
changed connections and expired capabilities are refused before any process
starts. Only the snapshot's actually observed database role is passed to
pg_dump. Connection fingerprints/credentials are absent from snapshot metadata.
The future production composition must still validate the dedicated full-backup
reader, actual direct/session endpoint, TLS trust, business and current registry.

The production factory accepts only two absolute regular executable paths in
the trusted pinned Linux recovery image, not arbitrary command prefixes or a
runtime-profile launcher. Executables must not be group/world writable. It
checks pg_dump17.11 and age1.3.2 versions. The separate native test launcher seam
uses the actual digest-pinned PostgreSQL container and installed standard age;
it is not a production escape flag or accepted by an application profile.

pg_dump uses custom format, the held exported snapshot and observed database
role. There are no schema/table filters, owner/ACL exclusions, row-security
enablement or partial-table fallback. Default row_security=off must refuse a
reader that cannot dump the whole database. This does not create the required
restricted operator role or imply that an ordinary export login is sufficient.
Global role definitions, object originals and external configuration are not
contained in an ordinary single-database dump and remain separate obligations.

Connection values are passed through a closed child environment; the password
and connection URI never enter argv. Production requires explicit CA material
and libpq verify-full. A new private empty child HOME prevents use of ambient
pgpass/service/client-key files. Test mode accepts only loopback random
crest_migrate databases without TLS. No ambient AWS/provider credential is
forwarded. No password or private age identity is accepted by the encryption
command; it receives only the independently held recovery recipient public key.

The database archive streams directly into age, then into an exclusive0600
ciphertext file. Plaintext is hashed/counted in the pipe, not written as a disk
dump or retained as an unbounded buffer. Both streams have1GiB bounds, with
backpressure and a fifteen-minute deadline. Encryption overhead may cause a
near-limit plaintext archive to fail the ciphertext bound; overflow is refused,
never truncated or relabeled successful. Production capacity must be measured.

Both child exits, complete PGDMP/age prefixes, byte counts and hashes must verify
before fsyncing the ciphertext and parent directory. Any stderr warning/error
requires review rather than silent acceptance. Cancellation/failure terminates
and awaits owned processes/pipelines, removes this attempt's partial ciphertext
and cleans only its generated private child HOME. The returned private tool
capability refuses JSON serialization and explicitly says completeBackup:false.
Its plaintext digest belongs in the encrypted final manifest, not ordinary logs.

On fa57319, all10 combined native lease/capture cases pass with frozen source
and awaited owned cleanup. The new positive case uses actual pg_dump17.11 and
age1.3.2, authenticates/decrypts the entire archive in bounded fixture memory,
then restores it with pg_restore into a separate fresh PostgreSQL cluster.
It compares exact bigint/numeric/microsecond/binary/Unicode values, a function,
sequence and enforced check constraint. A committed post-snapshot row remains
absent in the restored copy while present in the live source. Negative cases
reject forged/foreign/expired references before tool launch and an invalid
recipient without retaining partial ciphertext. The initial fixture used a
hardcoded21-byte age prefix comparison; it now checks the full22-byte prefix
without changing capture behavior. The initial failure is retained locally.

These are generic fictional database/tool fixtures, not current Crest-wide
role/schema/original/control completeness, real provider/TLS acceptance, a
production restore command, configured capacity, independent key custody or
off-laptop recovery. The native file is added to mandatory test:recovery-db
without removing previous cases. Still compose the full operator read profile,
same-snapshot inventories/control totals, standard retained-object encryption,
roles/app/image/config/key kit, durable point journal/scheduler, locked manifest/
complete marker, backup_runs/independent heartbeat and rehearsed fresh-host
restore. Do not substitute this component archive for a complete recovery point.

Primary references checked2026-11-22:
- [PostgreSQL17 pg_dump, snapshot and archive options](https://www.postgresql.org/docs/17/app-pgdump.html)
- [PostgreSQL17 verify-full certificate checks](https://www.postgresql.org/docs/17/libpq-ssl.html)
