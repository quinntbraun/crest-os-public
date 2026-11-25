# Independent backup failure signaling and age policy

These implement the Healthchecks start/failure transport and the already adopted
EXPORTS_AND_BACKUPS6 age/schedule rules. They do not provision a service, send a
live message, run a scheduler, read authoritative completed points or declare a
backup complete. The actual scheduler, complete-point store/publisher, escalation
delivery and physical owner/account recovery acceptance remain unfinished.

## Private monitor transport

createRecoveryMonitorAttempt accepts one canonical HTTPS hc-ping.com UUID URL
from isolated scheduler secret configuration, plus the public run UUID/start
instant. The ping URL is a credential. Keep it out of source control, ordinary
application configuration, argv, browser state, diagnostics and event bodies.
It is separate from the current application's31-reference recovery recipe;
external monitor/scheduler account and secret-reference custody must be included
in the complete infrastructure recovery setup before launch.

The adapter emits only POST /start or /fail with rid=runUUID. It accepts no slug,
auto-provisioning, alternate origin, arbitrary suffix/query, credential-bearing
authority, plaintext HTTP or redirect. Requests contain bounded run/time and a
closed failure category only; no customer/business record, provider error or
source pathname is forwarded. Redirects are refused and requests have ten-second
abort bounds. Only HTTP200 plus the exact bounded OK body is an acknowledgment.
HTTP200 for an unknown check or rate limit is not silently accepted.

Each instance attempts start at most once and failure at most once, serializes
dispatch, preserves unknown acknowledgments and never automatically retries.
A failed/uncertain start can still be followed by one independent failure signal;
a late start cannot reset an already failed attempt. A pre-capture failure can
signal failure without a preceding start. Per-process state is not a durable
cross-host dispatch/reconciliation journal; the scheduler must supply that.

All exposed errors are closed categories without the private URL or raw provider
text. Client serialization refuses. Safe views/receipts contain only run/time,
phase/acknowledgment and completeBackup:false. There is deliberately no success
method: an encrypted candidate or a live scheduler must never ping the root
success URL. A future success adapter must require the actual verified complete
marker and completed-run recording sequence, not a caller-supplied boolean.

Provider contract checked against the official
[Healthchecks Pinging API](https://healthchecks.io/docs/http_api/) on2026-11-23.
An OK acknowledgment is not proof of owner email delivery. Independently enroll
the existing check, configure its UTC six-hour schedule/deadline, verify mailbox
ownership and actual start/failure/missed-success delivery, and retain account/
MFA recovery material outside the app/database/hosting account. No account or
check was created and no real URL was contacted during implementation.

## Age and schedule policy

recoveryProtectionStatus is a pure policy function. Its last-snapshot input must
come from an authoritative verified-complete-point store; it does not authenticate
timestamps or accept staged-candidate completion claims. Age is measured from the
source snapshot, not a later finish time, alert acknowledgment or scheduler run.
The boundaries are warning>=8 hours, critical>=12 and BR17 breach>=24. Missing
baseline is unprotected/attention required, without inventing a measured24-hour
breach. Invalid/future snapshots or invalid clocks refuse review rather than
producing a healthy status. Only a newer actual complete snapshot can restore
current status. Existing integrity/security/availability checks still apply.

ordinaryFinancialWritesBlocked remains false at every backup-age level, including
breach, under the owner's documented2026-10-20 decision. The age evaluator grants
no financial authority and cannot bypass other command guards. Nothing here
rotates epochs, freezes legitimate financial work or repairs records.

nextRecoveryBackupSlot returns the next strict UTC00:20/06:20/12:20/18:20 slot,
preserving the documented schedule through day/year and local DST changes. It is
not a durable scheduler, catch-up/retry policy, retention selector or month-end
point promotion. Daily>=35-day, month-end>=400-day and originals dependency
retention requirements remain unchanged and must be implemented in that pipeline.

## Executed checks and remaining wiring

Type checking, targeted lint and27 focused cases across the two new test files
pass. These cover actual request formation through an injected fetch transport,
closed input/origin boundaries, lost acknowledgments, refusal of ignored200
responses, bounded body cancellation, duplicate/concurrent dispatch, abort,
exact8/12/24-hour transitions, missing/future baselines, continuing-write policy
and UTC/DST/year transitions. There is no external network or production data.

The independent monitor must still be connected to the real isolated producer,
durable schedule/journal/reconciliation, final locked complete marker and
backup_runs; the app needs a trusted status reader and persistent owner banner,
and8/12/24-hour escalation/daily reminders need durable noise suppression and
actual delivery tests. Failed candidates keep their existing false completion
flags. None of these component checks establishes launch or complete-backup
acceptance, off-laptop recovery or actual external monitoring.
