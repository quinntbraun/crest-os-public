# Backup protection escalation and durable delivery attempts

recovery-alert-policy implements the adopted8/12/24-hour warning/critical/breach
thresholds, unresolved daily reminders and a single recovery notice when a newer
verified complete snapshot makes protection current again. No first complete
point means unprotected; it does not fabricate a24-hour breach. Ordinary
financial writes remain allowed, including during a breach, per the owner's
existing decision. Alert acknowledgment never changes backup protection.

The policy consumes an authoritative complete-point timestamp and retained
notification attempts. It does not authenticate the source timestamp or turn
capture candidates into complete points. Missing/regressed catalog observations
after a known point, future/reordered/duplicate history and altered notification
identities refuse. A newer but already stale point does not emit recovery or
restart an unresolved incident. Later deterioration after actual recovery opens
a new incident, preserving prior history. Returned metadata is immutable.

For noise suppression, a check that resumes after an outage emits the currently
applicable severity rather than sending an obsolete warning/critical/breach
burst. A later higher severity is a distinct notification in the same incident.
Unresolved reminders become due24 hours after the most recent attempt. Reserved,
acknowledged and unknown attempts all suppress automatic repeats at the same
severity; acknowledgment is transport evidence, not proof the owner read mail.
These implementation choices preserve the adopted daily/noise-suppression rule.

createRecoveryAlertDispatcher connects the policy to a private Linux filesystem
journal, an injected authoritative catalog reader and a delivery transport. It
holds an exclusive local lock before reading the journal/catalog, durably writes
an immutable numbered reservation before handing off the notice, then records
the exact matching acknowledgment or unknown outcome in another immutable file.
Both files and their directory are flushed. No private address, endpoint,
credential, customer/financial data or raw transport error is written.

Existing reservations without delivery receipts never authorize resending.
Concurrent dispatchers cannot both win. A stopped process's lock remains for
operator review; no guessed lock expiry or automatic lock deletion. Torn files,
unexpected names, missing sequences, mismatched outcomes and nonprivate files
refuse; the journal is not silently repaired or pruned. The owner-only directory
has a4096-notice/8192-file bound; capacity failure is explicit. Place this in a
dedicated private directory, separate from capture/artifact journals.

This journal coordinates one host filesystem, not distributed mail delivery or
database authority. A lost acknowledgment stays unknown and the independent
deadline monitor must cover dispatcher/catalog/delivery outages. Source clocks
must be trustworthy. Notice IDs bind their incident/type/time/snapshot metadata;
they are deduplication identifiers, not signatures or physical recovery proof.

Thirty-eight combined focused policy/calendar cases, full types and targeted
lint pass. Eleven actual private Linux filesystem cases are written for durable
handoff, repetition suppression, unknown delivery, escalation/reminder/recovery,
missing receipts, torn files, concurrency, cancellation, permissions, wrong
acknowledgments, catalog/clock regression and stopped-process locks. All11 pass
on f8f5c14 with unchanged tracked source and owned cleanup awaited, in pinned
network-disabled Linux: .local/recovery-alert-dispatch/result.json. Catalog and
delivery ports are controlled fixtures; this does not prove actual catalog/mail
provider operation or owner receipt. The mandatory CI database group retains all previous
recovery checks and adds this file.

Production complete-point catalog authority, mail/owner destination transport,
independent monitor account setup, dashboard/backup_runs integration and actual
delivery/restore drills remain unfinished. No new command or host timer invokes
this uncomposed dispatcher. There is no live mail, service activation, final
complete marker, healthy heartbeat or complete-backup claim from this change.
