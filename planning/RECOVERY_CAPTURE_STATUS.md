# Read-only capture diagnostics

scripts/recovery-capture-status.mjs takes exactly one absolute private capture
profile path. It reads the existing owner-only local capture records; it makes
no database, object-store, vault, mail or monitor connection. It never starts a
capture, opens a writable journal, reserves an operation, removes a lock or
changes any recovery record. It runs only in the pinned Linux/Node24.22 tools.

The result distinguishes failed captures, candidates requiring review and starts
without a matching terminal record. The latter are unfinished_or_uncertain,
never asserted to be currently running or safe to retry. Counts cover every
observed command record; only20 recent attempts are returned. Their retained
artifact journals, when present, are parsed with the existing hash-chain/event
validator and expose verified/reserved/uncertain counts and lock presence.
This checks local journal consistency, not authorship or an externally complete
manifest; removed suffixes and unknown cloud acknowledgments still require
independent reconciliation. No artifact key, credential or raw source content
is emitted. This is a private host operator tool, not a tenant-authorized route.

The profile/state directory and individual records must be private and owned by
the process user. Symlinks, oversized/torn records, unmatched finish records,
changed profile/command filename inventory, identity/time/state mismatch and
unknown fields refuse the entire read. Bounds:32768 directory entries,
10000 attempts,32MiB command metadata,4MiB per inspected artifact journal and a
30-second operation deadline. No truncation is called full coverage. Concurrent
capture can make the read unavailable; the result explicitly is not an atomic
cross-file or database snapshot and cannot authorize any operation or retry.

Protection remains unknown and completePointCatalogLoaded:false. Local start,
finish, candidate or journal-verified artifact counts never provide the last
verified complete snapshot or reset the8/12/24-hour protection clock. The command
exits2 for this diagnostic/review-required result; closed input/read failure
exits1. Neither means a healthy backup or sends a success heartbeat. Ordinary
financial writes are not blocked by these diagnostics.

The recovery image includes the command and verifies its module import at build.
The inactive rootless host launcher supports a status argument: it uses network
none, read-only config/state mounts and no work/release mount or staging switch.
Capture remains the default action and still requires explicit staging
authorization. See [host package](../deploy/recovery/README.md). Actual selected
host/Podman execution and full backup/dashboard/catalog integration remain open.

Ten focused private Linux record cases and the original six controlled capture
cases pass16/16 on64fa7a9, with actual command->status composition assertions,
unchanged tracked source and owned cleanup awaited:
.local/recovery-capture-status/result.json. Producer/PG/SDK/HTTP ports remain
controlled; no actual provider/TLS/full-backup acceptance is inferred.

Rebuilt image on00c6b47 passes module/tool/registry verification and the existing
actual native database dump/age/restore rehearsal plus packaged status CLI
missing-profile refusal. Image sha256:c77f6c03a7662d146db2239aae1376976a3515fd90dddfe48213013cb5a19569;
proofs .local/recovery-tool-image-build-status/result.json and
.local/recovery-tool-image-native-status/result.json. Source stable/cleanup.
Updated host launcher sh -n passes in that actual pinned Linux image. These are
local scoped checks, not actual selected-host Podman/systemd activation or a
fresh whole-release result. Types/targeted lint pass. No local runner remains.
