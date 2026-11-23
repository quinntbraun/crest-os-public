# Recovery retention calendar

planRecoveryRetention implements the adopted EXPORTS_AND_BACKUPS6 calendar policy
over an authoritative inventory of complete points. It does not establish that
inventory's authenticity, publish points, modify provider locks or authorize
deletion. Inputs must come from the future verified complete-point catalog, never
staged candidates or a browser request. No completed catalog exists yet.

The planner keeps35 daily designations, the documented safety margin above the
required30, and all closed month-end boundaries whose400-day protection interval
is still live. This can include14 month ends, rather than assuming12 or13 is
always sufficient. Additional points need seven days from their source snapshot.
Existing longer protection is never shortened. Lock requirements conservatively
run from the calendar boundary, rather than the earlier selected snapshot.

Daily selection is the last successful completion within that local day. A day
without success is explicitly missing; repeating an old point is not a new daily
backup. Month-end selection is the last successful completion at or before that
local month end, including an older point when the month has no successes. A
run started before the boundary but completed after it cannot qualify. Equal
completion instants use later snapshot and then point UUID as deterministic
tie-breakers. This implements selection only; a stale point cannot satisfy RPO
merely because it is selected for monthly retention.

The caller supplies the business's explicit IANA timezone. Local boundaries are
found using that zone's actual calendar transitions; UTC dates and fixed offsets
cannot stand in for business dates. DST23/25-hour days, fractional offsets,
leap/year changes and midnight gaps are handled. An entirely skipped local date
refuses review rather than silently choosing a different date. Timestamps are
strict canonical millisecond UTC instants with bounded supported years2001-9997;
future/inverted point instants, duplicate IDs and invalid zones refuse.

Each point reports required protection, any longer existing lock, insufficient
or expired locks and its designations. Missing boundary counts remain explicit.
An expired existing lock is not proof the bytes still exist. Before using this
plan operationally, the complete-point catalog and vault must independently
authenticate every retained version, extend retention or make newly locked
copies, and verify all dependencies through the required expiry. Existing copies
must not be discarded or old points declared repaired based on a plan alone.
Original-file garbage collection stays unauthorized: all retained manifests'
dependencies must first be established and protected. The planner emits no
delete list and no backup-success claim.

Thirteen focused cases pass, along with types and targeted lint. They cover
Chicago's UTC-next-day month end, after-boundary completion refusal, DST/leap/year
boundaries, missing daily selection, older month fallback/expired lock, longer
existing locks, seven-day extra points,14 live month ends, fractional offsets,
midnight gaps, malformed inventory and all false operation/acceptance flags.
The first local assertion expected13 live month ends; calendar arithmetic shows
the September2025 boundary remains protected until November5,2026. Only that
fixture expectation was corrected; the400-day policy was unchanged. Source
fingerprints and executed check results are retained in .local/recovery-retention.

Scheduler/catalog integration, actual provider lock changes, complete-point
publication, backup_runs, notification delivery and independent recovery remain
unfinished. This module alone does not make backup retention operational.
