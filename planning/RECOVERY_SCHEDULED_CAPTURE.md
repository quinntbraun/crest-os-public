# Durable UTC-slot capture dispatch

The scheduled-capture dispatcher connects the adopted00:20/06:20/12:20/18:20 UTC
calendar to the explicit-run capture command. It remains staging-only:
candidate_review_required/completeBackup:false, exit2 for a staged candidate,
exit1 for a closed failure. There is no successful-backup exit, final marker,
completed catalog, backup_runs write, healthy heartbeat or enabled host timer.

latestRecoveryBackupSlot selects the inclusive most recent canonical slot.
A catch-up activation after downtime attempts only that current slot, not every
missed interval. Its slot is scheduling metadata; actual PostgreSQL snapshot time
continues to determine backup age. Clock rollback/invalid clock cannot create a
healthy point. Next-slot and age policy semantics are unchanged, including the
owner's decision not to freeze ordinary financial work solely for backup age.

## Claim and dispatch

The Linux/Node24.22 dispatcher reads the same exact owner-only private profile
as the capture command and validates its private state directory. It opens one
slot-specific claim file exclusively with no-follow/0600 permissions. Only after
winning that exclusive creation does it generate a run UUID; it flushes both
claim and containing directory before dispatch. The command receives this exact
persisted UUID and the private profile path. Profile bytes are rechecked before
dispatch; changed configuration refuses after preserving its claim.

Existing claim files are never parsed as permission to retry. Completed, failed,
interrupted and torn claims all refuse before another command/provider call.
Concurrent processes on the same configured host/spool can dispatch only one
capture for a slot. No claim or failed history is removed automatically. An
operator must reconcile uncertainty; deleting a claim is not a retry procedure.
The separate manual capture command still requires an explicit reviewed new ID.

A later six-hour slot may create a distinct scheduled capture. It does not
overwrite or retry the old point, reuse an uncertain object key or pretend that
missed intervals were protected. Cross-host serialization still belongs to the
existing database lease; the claim spool is a single-host facility and is not
advertised as distributed authority. Keep that persistent spool through host
restarts/release changes and include its recovery needs in host operations.

The dispatcher owns only its claim/terminal files. The capture command owns
database, SDK and artifact-journal cleanup. Terminal records contain slot, point,
times, bounded stage and truthful candidate/failed state, never private profile
values. A mismatched or success-labeled child receipt refuses. Pre-dispatch
failures that cannot reach the capture monitor still depend on the independent
missing-success/deadline alert and unfinished scheduler alert integration; no
claim file is evidence of a complete snapshot.

## Host activation remains gated

The adopted architecture requires an isolated pinned recovery-tool image. A host
Node invocation or a timer template alone would not establish that requirement.
Next build/rehearse the actual recovery image with pinned runtime/tools and then
provide host-unit templates for the owner's selected host. No service, account,
user, container daemon, timer or cloud resource is created or enabled here.
For a systemd host, UTC OnCalendar and persistent catch-up behavior follow the
official [timer contract](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html)
and [calendar syntax](https://www.freedesktop.org/software/systemd/man/latest/systemd.time.html);
actual host version/unit/calendar validation remains required before activation.

Capture arguments are an absolute private profile path only; the dispatcher
chooses the UUID after durable exclusive claim. Production capture additionally
now requires the repository's exact Node24.22 runtime, matching the pinned tool
image contract. Credential/profile, executable, TLS and provider restrictions
remain those documented in RECOVERY_CAPTURE_COMMAND.md.

Thirty-six pure profile/age/calendar cases, types and targeted lint pass. Eight
new actual Linux-filesystem cases exercise durable-before-dispatch, duplicate and
failed-slot refusal, torn claims, new-slot identity, concurrent processes,
pre-cancellation and bad receipts through a controlled command port. Their native
execution, together with the original six controlled Linux command cases, passes
14/14 on ac55c1d. Source bytes unchanged and owned container cleanup awaited:
.local/recovery-scheduled-capture/result.json. This does not substitute for actual producer/provider/TLS, independent
host recovery or complete-point acceptance. All previous gates stay mandatory.
