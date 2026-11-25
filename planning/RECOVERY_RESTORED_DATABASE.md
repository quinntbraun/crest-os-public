# Restored database comparison

`verifyRecoveryRestoredDatabase` is read-only verification after an operator has
separately authorized and applied the recovered dump to a new isolated target.
It does not apply SQL, create roles/logins, configure a provider or authorize
incident recovery. The canonical owner authentication, break-glass, fresh-target,
outbound-disable and old-authority fencing requirements remain unchanged.

The verifier requires the actual in-process result of authenticated coordinated
file recovery. A private WeakMap retains its original immutable metadata and
dump/metadata digests; a JSON file list or copied `filesVerified:true` object
cannot supply that capability. A new process must authenticate the candidate
again before comparison. No private identity key is retained in this capability.

The raw migration registry must match the selected point's exact SHA256 and the
known138 format. The transferred dedicated PostgreSQL client must pass the
existing complete-reader preflight, including its restricted login/membership,
no-write/no-definer privilege checks and exact applied migration version/names.
The verifier owns and closes that client, including preflight/cancellation
failures. Dump and metadata bytes/permissions are checked before and after the
comparison; independent checks are all awaited even if one fails.

One live read-only repeatable-read snapshot captures the destination's actual
catalog/row inventory, original-file metadata and financial comparison controls.
Captured table/column descriptors, owners and RLS flags, every table's row count and exact
row-multiset fingerprint, closed group roles/order, extensions and global counts
must equal the authenticated source metadata. Published and pending/staging
original metadata must agree. Every raw cent observation, journal entry and
trial-balance row and exact aggregate debit/credit must agree. A changed record
cannot pass merely because row counts and journal totals still match.

Source/destination database names, snapshot IDs/times and backend identities are
deliberately distinct observations. Old login memberships are references and
are not recreated or compared to newly issued restricted-reader credentials.
This does not silently restore obsolete runtime logins. Server versions are
recorded separately; the existing collector still requires PostgreSQL17 and
its declared fingerprint algorithm. No sequence transactional guarantee is added.

Matching these values proves the declared restoration comparisons, not every
financial/security/recovery rule. Full root/range/AR/AP/funds/custody/opening and
reconciliation controls, constraint/routine/grant and security acceptance, original storage application,
session invalidation, previous-worker fencing, account/key/file recovery and
owner-approved controlled reopen remain required. The verifier does not prove
that the supplied database is independently hosted; that is configured operator
acceptance. Results explicitly retain `destinationIsolationVerified:false`,
`securityAndIncidentAcceptance:false`,
`fullBusinessReconciliationVerified:false`, `runtimeActivated:false` and
`completeBackup:false`.

The synthetic fresh-process fixture extends the real coordinated file recovery:
the parent creates a separately owned PostgreSQL cluster and passes only its
destination URL, not source credentials. The child refuses an existing Crest role
or non-system table, creates only validated closed NOLOGIN groups, applies the
authenticated dump using the existing test-only pg_restore helper with
--exit-on-error/--single-transaction, then creates a new read-only limited login.
The production verifier checks that actual restored database. Wrong registry
bytes are refused, and a one-ten-thousandth numeric change in only a disposable
restored fixture table must fail without changing its count. Source rows are
never mutated. Existing metadata/financial corruption and lease/crypto cases
remain in the mandatory recovery suite. This is not an actual provider or
off-laptop drill, automatic production restore or financial-reopening approval.

Native acceptance on641c9b4 passes40 cases with tracked source unchanged and
owned cleanup awaited in `.local/recovery-restored-database138/result.json`.
The fresh process applies the actual coordinated vault dump to the separately
owned empty cluster, creates a new restricted reader and passes the production
comparison for every captured table/role/extension, original inventory and exact
financial control. Adding whitespace to the registry refuses before capture;
changing one restored numeric value by0.0001 refuses despite an unchanged row
count. Source data is preserved. The previous lease/crypto/metadata/corruption
cases remain passing. Two focused refusal/cancellation unit cases, types and
targeted lint also pass. This is broader than file recovery, but still not
actual-provider/off-laptop/full-business-control or controlled-reopen acceptance.

The trusted caller must establish the dedicated direct/session-capable,
verified-TLS production connection and any actual provider permissions before
transferring its client. This helper cannot prove how an already connected client
was provisioned and grants it no new authority. Synthetic helpers retain their
strict loopback/owned-database guard and have no production escape flag.
