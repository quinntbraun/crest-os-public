# Coordinated recovery candidate

`recovery-run.ts` composes the database/three-store archive, paired release
distribution and secret-reference configuration archive under one owned business
backup lease. The database producer's optional trusted `afterData` continuation
runs after verified data publication but before the lease closes. Existing
standalone data callers keep their behavior; no SQL, migration, role or grant is
changed. The continuation cannot introduce a second database snapshot.

Release manifest, recipe and business/release/schema/registry bindings are
checked before capture. Inputs are frozen before the first await. The database
snapshot still closes after its dump/inventories/controls finish; the business
lease remains held through file, application, configuration and final candidate
index publication. All later dispatches check that same lease before and after
the existing journal/vault publication. A lost lease stops further dispatch.

The encrypted `crest.private-recovery-run-candidate.v1` index links exact
version-pinned component receipts, database snapshot, release identity, private
configuration directory identity and applied retention. Data/application/settings
and this index use the data deadline; originals/quarantine retain their longer
deadline. Only acknowledged local ciphertext is removed. A later failure leaves
verified earlier candidates and any uncertain write for explicit reconciliation;
it does not replay, delete them or turn them into a complete point.

The candidate is deliberately distinct from a final complete marker. It records
five outstanding acceptance requirements: actual external configuration files
and secrets, offline age-key custody, actual provider scope/retention, complete
business reconciliation, and an independent full restore. It emits no completed
`backup_runs` record, success heartbeat or production activation. Its private
result and all linked components retain `completeBackup:false`. This is the
coordinated input to those remaining steps, not permission to bypass them.

The existing native reader fixture exercises all components with the actual
restricted database login, pg_dump/age and three loopback SDK stores. Application
source is the real tracked Git archive; image bytes are explicitly synthetic and
never loaded or described as a tested application image. During application
publication a competing same-business lease must fail; after completion or
failure a fresh owner can acquire it. Changed-image failure after verified data
must emit no combined index. Actual disposable backend termination after a
stored application part must prevent further output and preserve uncertainty.
Windows uses the explicit publisher seam; Linux selects the durable journal.
Actual cloud, Linux combined composition, offline owner custody and full restore
still require their own acceptance.

Native acceptance on493fe88 passes25 cases with source unchanged and owned
cleanup awaited in `.local/recovery-run138/result.json`. Three new run cases
join the previous22: all components and exact cross-index bindings publish
while a competing application-stage lease is refused; a changed image after
data capture leaves11 verified data candidates without a combined index; actual
disposable backend termination after a stored application part leaves12 candidates,
preserves write uncertainty and returns no combined result. A fresh lease can be
acquired after each outcome. These are isolated SDK/Windows-seam results, not
actual provider or complete-backup acceptance.
