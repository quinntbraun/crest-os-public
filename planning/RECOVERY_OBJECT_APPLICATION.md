# Applying authenticated recovered originals

`applyRecoveryObjects` applies the actual authenticated recovery result to four
distinct empty destinations: expense receipts, supplier documents, condition
photos and quarantine. Copied JSON cannot supply the recovery capability. All
local files must match their authenticated sizes and SHA256 before any upload.

The production R2 adapter uses the existing fixed HTTPS client. Destination
bindings include account and bucket, independently of their assigned role.
Operators must supply newly provisioned private destinations and separately
verify credential restrictions and isolation from the old runtime. This code
does not provision resources or establish that operational acceptance.

Each write is conditional on the key not existing, with no automatic retry.
The restored bytes retain the original published key and MIME type. A readback
must match length, MIME and SHA256; final listings must match exactly the keys,
sizes and ETags observed during restoration. Listings are not atomic snapshots.
Concurrent writes can cause failure and require operator review.

Unpublished and staging bytes go only to the separate quarantine destination,
under point/domain prefixes, as application/octet-stream. Zero-byte objects are
allowed only there. Nothing in this process renders quarantine files or makes
them available to the application.

The Linux journal requires an existing private owner-only spool. Each operation
creates an exclusive directory. A private immutable reservation is flushed,
including its containing directory, before the object request. Verified and
uncertain acknowledgements are separate immutable files with timestamps. The
same directory is never resumed, overwritten or automatically reclaimed.
Failure after dispatch retains uncertain objects and blocks further writes;
there is no deletion, overwrite or automatic replay. Journal files support
operator investigation, not cryptographic authorship or crash reconciliation.

The final object marker means only that this component completed its declared
comparisons. Full database security and financial acceptance, recovered external
keys/settings, old-worker and session fencing, final backup completion and
controlled application activation remain separate requirements. Every result
retains completeBackup:false and runtimeActivated:false.

The integration fixture performs authenticated fresh-process database recovery,
then restores eight retained objects through the real S3 SDK to isolated loopback
destinations. It checks exact bytes and pre-upload reservations, refuses reused
nonempty destinations, and retains an uncertain object after a deliberately lost
acknowledgement. Linux uses the production journal. Windows uses an explicitly
labelled file-flush fixture seam and does not prove directory or power-loss
durability. Neither fixture certifies an actual cloud provider or off-laptop
deployment.

Native acceptance on1ccf10a passes40 cases with tracked source unchanged and
owned cleanup awaited in `.local/recovery-object-apply138/result.json`.
The coordinated-run case includes the fresh-process SQL restoration and exact
database comparison, eight restored objects (six published and two quarantined),
nonempty-destination refusal and one retained uncertain write with no replay.
Seven focused adapter tests pass, including conditional collision preservation,
corrupt readback and extra final-inventory objects. Type checking and targeted
lint pass. The native execution was on Windows with the explicitly declared
object journal seam; actual Linux journal/provider acceptance remains required.
