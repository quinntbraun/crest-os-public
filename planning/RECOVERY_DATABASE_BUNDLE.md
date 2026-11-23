# Snapshot-bound database recovery bundle

The recovery database bundle pairs the actual encrypted custom-format PostgreSQL
dump with private restore comparison metadata before releasing its exported
read-only snapshot. `createPinnedRecoveryDatabaseBundle` uses the existing pinned
Linux pg_dump/age factory; native fixtures use real processes through its test seam.

The metadata records safe Crest group role definitions in creation order,
membership references, installed extensions, table/column definitions, RLS flags,
owners, exact table row counts and multiset fingerprints. Login secrets are never
read. Membership references do not authorize recreation of old login credentials
or resumption of old sessions. Only the registered backup group may have BYPASSRLS;
the other captured Crest groups retain the closed role contract. Existing dedicated
reader preflight and release/migration compatibility checks remain required.

Every non-system ordinary, partitioned and materialized table is included, without
business/status/archive filtering. Partition parents use ONLY, preventing duplicate
inherited rows. Foreign tables are refused, rather than implying pg_dump copied
external data. Extension-owned relations are explicitly marked: provider/extension
restore compatibility remains an acceptance requirement. Missing read access fails
the capture. Sequence state is not MVCC transactional; the record explicitly does
not claim sequence values are from the exported snapshot.

On PostgreSQL 17, each row's UTF-8 JSONB text is hashed inside the database; numeric,
bigint and bytea values never pass through JavaScript numeric conversion. The table
fingerprint hashes the ordered fixed-width row hashes, retaining duplicates and
ignoring heap order. UTC/ISO date, hex bytea and explicit float/interval settings
make the encoding repeatable. Column types/order are compared separately. Cursors
fetch 512 hashes at a time, with the existing lease duration/query limits and a
10-million-row/4096-table guard. Exceeding a guard fails, never truncates.

The inventory is encrypted directly through age into a second exclusive private
file, with plaintext/ciphertext counts and hashes, without a plaintext disk copy.
Both outputs are removed if metadata encryption fails. Native restoration uses
the independently decrypted metadata for role creation and table comparisons.
The private wrapper refuses JSON serialization. Its explicit recovery-tool accessor
is intended for the encrypted point manifest, not UI output or logs. Row/table
fingerprints do not prove financial reconciliation, object coverage, archive
decryptability, a compatible application/key kit, scheduled delivery, locked vault
publication or a full recovery point. `completeBackup` remains false. The next
assembly work must include these metadata in the encrypted manifest together with
all retained originals and financial controls before publishing a complete marker.

The bundle now also captures the registered138 receipt, supplier-document and
condition-photo object inventory through that same live snapshot. Every published
receipt revision, supplier intent/publication and photo attempt/original is read
across all businesses. Voided expenses and unlinked photos are not filtered out.
Object identity includes its storage domain, business, immutable key, attachment,
source row, original/preview variant, validation version, byte count and hash.
Supplier revision identities remain text rather than JavaScript numbers.

The first encrypted metadata envelope is `crest.private-database-recovery-metadata.v1`,
containing `databaseInventory` and `originalInventory`. The new v2 additionally
binds `financialControls` to that same exported snapshot; v1 artifacts do not
acquire financial-control coverage by relabeling. Unpublished reservations
remain metadata with no invented hash or downloadable object. Staging reservations
for both pending and published attachments remain explicit: validation can leave
retained staging bytes or unpublished original/preview candidates after a failure.
This database inventory cannot prove their existence, exact provider version or
quarantine coverage. `stagingBytesInventoried` and
`retainedUnpublishedCandidatesInventoried` remain false. Independent primary-store
inventory, byte verification/encryption and locked version-pinned vault delivery
must close that gap before a complete point is allowed. Nothing is rendered or
deleted by the inventory collector. Existing ciphertext keys and earlier native
evidence are not relabeled as the new envelope.

`captureRecoveryOriginalArchive` copies those published originals and previews
one at a time through fixed trusted source-store ports. The port transfers
ownership of its returned private byte buffer. The archive rechecks exact source
length/hash, encrypts through pinned age without a plaintext disk file, and sends
each ciphertext through the existing recovery-attempt journal and version-pinned
vault readback. Verified local ciphertext is removed only after acknowledgement;
uncertain publication leaves ciphertext for reconciliation and aborts the batch,
without retrying. Transferred plaintext buffers are cleared on success or failure.
The returned private receipt records each source descriptor and locked ciphertext
version. It remains a published-object archive, not a complete recovery point:
staging/quarantine/unpublished candidates, the final encrypted point manifest,
financial controls, app/key kit and scheduling/monitoring remain separate gates.

The original-archive native SDK fixture uses an explicit publisher seam on Windows
and the actual durable journal on Linux. Local Windows success is not Linux
journal or actual-provider acceptance. The existing native Linux journal evidence
remains scoped to that journal's own lifecycle/refusal tests.

Local acceptance on `62729a10680ac3c1f799abb15496016188501e88` passed
13 native cases in the current reader/lease suites. The separate-cluster restore
uses independently decrypted metadata, compares all table fingerprints and roles,
preserves 513 duplicate typed rows across a cursor page boundary, excludes a later
source insert, and detects a numeric change without a count change. Real age
metadata-encryption failure removes the unfinished pair. Forged/expired snapshot
capabilities and the prior reader/lease refusals remain checked. Source hashes
were unchanged and owned cleanup was awaited. Proof is the ignored local
`.local/recovery-database-bundle138-encrypted/result.json`; this is synthetic local
acceptance, not actual provider/TLS, immutable vault or complete recovery acceptance.

The expanded original-byte run on
`f101b587ee7e3611a4ff748dcf99579f09aa2bff` passes 16 native cases with source
hashes unchanged and owned cleanup awaited. Real age encrypts all six published
original/preview files; primary and vault reads use actual SDK requests against
loopback endpoints. Every retrieved ciphertext is independently decrypted and
matched to the exact source bytes. Corrupted source bytes issue no vault PUT; a
committed PUT with a lost response stops after one dispatch and retains review
state. The same run preserves the full database/role restore comparison and
metadata-encryption failure cleanup. It includes the voided receipt, unlinked
photo, foreign-business pending reservation, and restored original inventory.
Proof is `.local/recovery-original-archive138/result.json`. These local Windows
cases use the explicit publisher seam; actual Linux journal composition and real
cloud retention/credential restrictions remain acceptance gates. The recovery
test command now selects `react-server` because the primary SDK fixture imports
the existing server-only private-object store; no case or assertion is removed.
