# Offline coordinated file recovery

`recovery-run-restore.ts` consumes the exact candidate receipt/expected identity,
read-only vault and offline age identity. It creates one new private workspace
below a protected parent. It neither connects to the source database nor reads
the original backup process's state. The candidate format is explicitly current138;
unknown schemas and prior shapes are refused rather than relabeled.

The reader authenticates the encrypted top index, then the data, application,
configuration and database-metadata indexes. It checks business/point/release/
registry/configuration-directory identity, database snapshot, applied retention,
profile versions, false completion flags, file counts and matching journal
summary totals. The current seven-day data/400-day original minimums remain
required. Every referenced artifact belongs to this point, has a unique key,
exact version/hash/size and sufficient retention. Repeated or foreign references
are refused, not silently substituted.

Published-file closure compares every retained bucket entry with the snapshot's
complete original/preview inventory, including historical/voided sources.
All three domains must be present. Missing, duplicate, differently hashed or
unexpectedly published objects fail. Unpublished/staging bytes stay quarantine;
their raw files are never rendered or applied. Release descriptors must preserve
the exact build manifest and contiguous source/image byte identities. The private
configuration recipe uses its existing closed reader and expected directory.

Only after index/closure checks pass does recovery retrieve the database dump,
published originals/previews, quarantined bytes and both application archives.
Existing authenticated readers check exact ciphertext/plaintext digests, age
authentication, lengths and release-part layout. Output names are newly generated
private filenames; storage keys and supplied paths are never destination paths.
The private `recovered-files.json` maps the verified files to source observations.
Files and marker are fsynced. A failure removes only this call's newly created
workspace, preserving earlier completed preparations. Cleanup failure returns a
fixed safe cleanup-stage error rather than raw private paths/provider errors.

`recovery-json.ts` is a separate bounded metadata grammar. HTTP/evidence parsing
limits are unchanged. It rejects duplicate decoded names, unsafe/rounded numeric
tokens, null characters, invalid Unicode and trailing material, and freezes all
parsed containers without prototype mutation. Bounds are8MiB,32 levels,100000
array members,10000 object keys and1000000 nodes; each index also has its own
smaller byte cap. Monetary values remain exact strings. Overflow fails instead
of truncating. These limits match bounded recovery preparation, not unlimited
production capacity.

Success means `filesVerified:true`, not a reopened system. Database application,
role/grant and migration validation, independent table/financial reconciliation,
session invalidation/old-worker fencing, actual external file/secret resolution,
image load, provider-specific auth restoration and controlled reopening remain
separate required steps. The reader preserves original private metadata for
those checks; matching summary totals do not validate every financial or role
rule. Outputs explicitly retain `databaseApplied:false`,
`configurationResolved:false`, `applicationLoaded:false`,
`fullBusinessReconciliationVerified:false` and `completeBackup:false`.

The synthetic native fixture invokes recovery in a fresh Node process with only
its candidate, explicit loopback vault access, key path and private destination.
It removes source PostgreSQL variables from that environment. The child uses
production recovery functions and retrieves every component through real SDK/age
operations. The parent verifies exact file bytes and no vault writes. Wrong
top plaintext digest and a separately encrypted index that mixes snapshot identity
must leave no new recovery workspace; the mixed snapshot fails before subordinate
retrieval. A fresh process on the same machine is not an off-laptop disaster
boundary or actual owner/provider/image acceptance; image bytes remain an
explicitly synthetic fixture.

Native acceptance ona2fa098 passes40 cases with unchanged tracked source and
awaited owned cleanup in `.local/recovery-run-restore138/result.json`. The fresh
process recovers16 verified files, including the real coordinated database dump,
all six published originals/previews, two quarantined objects, both release
archives and five metadata components. All source observations match their exact
bytes; the child makes no vault writes and has no source PostgreSQL environment.
A wrong top digest and a newly encrypted mixed-snapshot index both remove only
their failed workspaces. The latter makes just the top retention/content reads
and refuses before subordinate retrieval. Five focused unit cases, types and
targeted lint pass. No SQL application, real cloud/off-laptop owner/key/file/image
acceptance or complete recovery point is claimed.
