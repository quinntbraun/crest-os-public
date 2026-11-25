# Isolated backup capture controller

createRecoveryCaptureController connects the existing coordinated capture to
private durable run records and independent start/failure monitoring. It is a
Linux recovery-tool composition, not a web endpoint, production scheduler or
complete-point publisher. It introduces no database migration or financial rule.

The isolated caller supplies an already connected dedicated backup client, its
existing fresh artifact-attempt journal, primary/vault ports, an owner-only record
directory and a matching fresh monitor instance. The controller checks the run,
business/release/registry identity and empty journal before dispatch. It creates
an exclusive run directory, writes started.json, flushes the file and directory,
then attempts the external start signal. An unknown monitor acknowledgment does
not prevent capture: backup work remains independent of monitor availability.

The existing capture retains its single business lease and snapshot/component
verification. The controller checks the returned candidate's point and manifest
against the same verified artifact reservation and unchanged journal header. It
persists a private candidate_review_required terminal record, including the exact
manifest/version/hash reference. Raw input, credentials, monitor URL, database
address and exception messages never enter these records or external signals.
Every output remains completeBackup:false.

Failures after durable start produce a failed terminal record when possible.
Partial/uncertain file writes are retained for review and never overwritten. An
existing run directory refuses before another capture; no automatic replay or
new point ID is inferred from a process restart. Reconciliation of interrupted
runs remains required. Hashes/fsync establish neither independent custody nor
protection from a privileged host removing records.

The controller owns and closes the dedicated capture connection. The caller
continues to own the artifact journal and SDK clients and must close them. A
connection-cleanup failure cannot return a normal result. After capture/cleanup,
failure signaling uses a separate bounded shutdown signal so cancellation does
not suppress that attempt. A staged candidate sends recovery_review failure,
never success. A separate private monitor.json preserves start/failure
acknowledgments; unknown delivery is not retried. This is safe staging behavior,
not an operational healthy backup schedule. Before pilot, the accepted final
complete-point path must replace review-required signaling at the actual success
boundary, followed by backup_runs and success heartbeat in the adopted order.

Ten controlled-port cases pass in a pinned network-disabled Node24 Linux
container with real owner-only files, file/directory fsync, unchanged source and
awaited owned-container cleanup. They cover candidate review, duplicate refusal,
capture failure, uncertain start/failure acknowledgments, incorrect manifest
purpose, cancellation, non-private parent refusal and connection cleanup. No live
HTTP account, provider or database was used in those ten cases. Evidence:
.local/recovery-capture-controller/result.json and test.log. Types and targeted
lint pass independently.

The existing real database/age/SDK coordinated run fixture now uses this
controller on Linux, retaining its original financial/object/restore assertions
and checking actual recorded manifest identity and start/failure signals through
a controlled HTTP port. Its fresh Linux combined acceptance is pending. Windows
retains its explicit existing file-flush/publication seams and does not claim
Linux controller acceptance. CI runs the ten controller cases after the original
mandatory encrypted recovery suite; no prior case is removed or made optional.

Still unfinished: authoritative verified-complete inventory for the retention
planner and age reader, final locked complete marker, actual scheduler and
backup_runs, provider retention application, email/missed-heartbeat delivery,
full financial/global/incident acceptance and independent owner/host recovery.
These local review records must never be supplied to the complete-point planner
as successful backups. Existing candidate profiles and acceptance requirements
remain unchanged.
