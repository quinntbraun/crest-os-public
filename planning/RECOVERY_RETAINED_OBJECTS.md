# Retained primary-store recovery capture

`createR2RecoveryPrimaryStore` supplies read/list-only recovery mechanics through
the existing fixed R2 HTTPS client configuration. The explicit SDK factory is for
local protocol fixtures. Neither exposes writes, deletion, decoding/rendering,
public URLs or retries. Production must supply separate restricted credentials,
the actual domain-to-bucket mapping and verified retention/no-delete policy.
Account permissions and independent failure boundaries are not inferred from
successful local SDK requests. Tools use the server-only Node condition, as does
the existing recovery test command.

The catalog lists the entire dedicated primary bucket, including originals,
previews and staging. It does not filter by Available state, current parent state
or database linkage. Unrecognized paths, duplicate or reordered entries, looping page
tokens, missing metadata and objects above the25MiB current object guard fail the
capture instead of being omitted. Catalogs are bounded to100000 objects, fetched
in1000-key pages. Oversized retained uploads need explicit capacity/remediation
work; this collector does not delete them or claim a successful backup.

Each read must use the exact descriptor issued by that reader. It sends If-Match
for the observed ETag and verifies the returned ETag, byte count and Last-Modified
before hashing the complete stream. ETags are conditional-read references, never
substitutes for SHA-256. A returned provider version is recorded when available;
unversioned R2 reads remain explicitly null. Cancellation destroys the response
stream. Temporary copied chunks are cleared on every exit.

`captureRecoveryRetainedArchive` requires every published object selected by the
database snapshot for that domain to exist in this catalog and match its exact
length/SHA-256. Other observed bytes are isolated quarantine evidence, including
staging and unpublished original/preview candidates. Quarantine here means
unpublished in the selected database snapshot, not a malware verdict: a legitimate
upload published after that snapshot is still not promoted into restored history.
These extra bytes have their own provider observation times. They are not falsely
dated to the PostgreSQL snapshot or described as validated attachments.

Each object, including an empty unvalidated candidate, is encrypted with standard
age directly to an exclusive private ciphertext file and dispatched through the
existing durable attempt/vault protocol. Published objects use the original
purpose; isolated raw bytes use the explicit quarantine purpose. Prior journal
bytes/hashes remain unchanged and readable. Unknown publication aborts without
retry and leaves the ciphertext for reconciliation. Transferred plaintext is
cleared; verified local ciphertext is removed only after acknowledgement.

A second complete listing must exactly match key/size/ETag/Last-Modified before
the bucket archive returns. A changing catalog fails the capture and leaves
already verified vault versions as incomplete candidates. Two matching listings
are an observation, not an atomic provider snapshot or proof of immutability.
There is no complete-point marker, heartbeat, database write or original deletion.
The private receipt retains all observed source hashes and locked vault versions,
published/quarantine counts, times, and explicit `primaryAtomicSnapshot:false`,
`quarantineRendered:false`, `completeBackup:false`.

Full point assembly must bind all three configured storage domains, the database
snapshot and financial controls, independent app/configuration/key kit, protected
encrypted manifest, retention and restore acceptance before marking success.
Restore keeps quarantined bytes isolated and never renders or silently publishes
them. Historical staging versions already overwritten before observation cannot
be invented; actual primary retention/immutability and provider behavior must be
accepted before real-data activation.

Development verification:8 SDK unit cases pass for pagination, conditional
reads, matching/different second listings, copied-descriptor refusal, unknown or
oversized keys, repeating tokens, reordered pages and response cancellation.
The native reader/lease run on
`26f54b0bdb072ca83e3dfcad0b8b94d0fd3e55d4` passes18 cases with unchanged
tracked source and awaited owned cleanup. In addition to the existing encrypted
database/published-original recovery cases, actual age and loopback primary/vault
SDK requests preserve and independently decrypt raw staging bytes and an empty
unpublished candidate. A changed second listing refuses the retained archive
after preserving already verified ciphertext versions. Local proof is
`.local/recovery-retained-archive138/result.json`. Windows uses the explicit
publisher seam; actual Linux journal composition, all-three-domain point assembly
and production bucket permissions/retention are not established by this run.
