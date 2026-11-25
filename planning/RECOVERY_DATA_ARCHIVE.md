# Business data archive assembly

`recovery-data-archive.ts` joins the restricted database bundle and all three
dedicated primary stores under one business backup lease. A live read-only
repeatable-read snapshot supplies the dump, role/table inventory, attachment
inventory and exact financial comparison controls. The snapshot closes after
capture; the business lease remains held through publication and indexing.

All database and metadata artifacts are encrypted before journal reservation,
versioned vault publication, retention readback and ciphertext readback. Each
store is then inventoried and archived, including staging/unpublished bytes as
quarantine. Every database-published original and preview must be present and
match its recorded size/hash. Missing stores or originals refuse success.
Two matching bucket listings are observations, not an atomic storage snapshot.

An encrypted `crest.private-business-data-archive.v1` index binds the point,
database snapshot, encrypted database/metadata receipts, financial summary and
three bucket archives. Only acknowledged local ciphertext is removed. Failure
does not publish this component index, retry uncertain writes, erase retained
candidates, write a completed backup record or send a success heartbeat.

Retention preserves the minimum seven-day data and 400-day original policies.
The caller's requested deadline must be at least seven days after point start;
actual data retention is at least eight days after assembly preflight, and
original/quarantine retention is at least 401 days. The extra day accommodates
the bounded one-hour lease and vault validation at dispatch. Longer requested
retention is preserved. Exact applied deadlines are retained in the index;
the vault's existing maximum and COMPLIANCE validation remain in force.

This is a business-data component, not a complete recovery point. Its index and
returned evidence explicitly retain `completeBackup:false`,
`primaryAtomicSnapshot:false` and `fullBusinessReconciliationVerified:false`.
Accepted application/image, private configuration and offline key custody,
complete-point marker, scheduling/alerts and independent full restoration are
still required. No production credentials, roles, resources or data are created.

The existing registered138 native reader fixture exercises the assembly with
real pg_dump/age and three loopback SDK buckets, decrypts all components, checks
snapshot/financial identity and retention deadlines, and rejects missing-store
and missing-original attempts. Windows uses the explicit publication seam;
Linux uses the durable attempt journal. Local fixture success does not prove
actual cloud-provider acceptance or off-laptop recovery.

Native acceptance on871d318 passes22 cases with unchanged tracked source and
awaited disposable-resource cleanup in
`.local/recovery-data-archive138/result.json`. The combined component contains
six published objects, two quarantined objects, encrypted database/metadata and
an encrypted index, each with verified version/retention receipts. All three
stores and components decrypt and agree on their snapshot and exact25000-cent
journal controls. Missing-store failure performs no storage request;
missing-original failure retains the two verified database/metadata candidates
and emits no component index. The existing independent database restore and
deliberately corrupted restored-journal refusal also remain passing.
