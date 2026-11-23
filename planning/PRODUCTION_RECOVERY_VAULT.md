# Independent recovery vault implementation

This implements the already selected Backblaze B2/age layer in
EXPORTS_AND_BACKUPS sections4–5. It does not provision an account, authorize
spending, expose a web endpoint, make a complete recovery point, or enable real
business use. The scheduler, consistent database/object capture, independently
recoverable app/config/key kit, complete marker, monitoring and restore command
remain required. The existing synthetic recovery drill stays test-only.
Private attempt reservations and business lease/snapshot coordination are
implemented separately in PRODUCTION_RECOVERY_ORCHESTRATION.md. Neither
component establishes a complete recovery point.

`src/tooling/recovery-vault.ts` is isolated recovery tooling. Its production
factory accepts explicit region/bucket/application-key settings, derives only
the B2 HTTPS endpoint, uses one SDK attempt, and exposes no delete, bucket
configuration, retention shortening or bypass operation. The deployment must
verify account separation, bucket/key restrictions and denied deletion using
the actual provider; application source cannot prove an external key's powers.

The caller reserves and durably records a new point/artifact UUID key before
dispatch. Only an already age-formatted encrypted file is accepted. The header
check is syntactic; the standard age encryptor and an independent decrypt/restore
drill must establish encryption and key recoverability. Files are streamed from
one open handle, bounded to1GiB per encrypted artifact and a five-minute operation.
The database dump must be split or explicitly revised if this capacity is
insufficient; overflow fails rather than truncating. Plaintext/key material is
not accepted by the transport or written by it.

The upload requests COMPLIANCE retention with the caller's explicit7–500-day
date. That range is a transport guard, not the recovery-point retention policy:
the future orchestrator must select the existing7/35/400-day schedule and keep
every referenced original protected through its point's expiry. Source size and
timestamps are checked around hashing/upload; uploaded content is then streamed
back and SHA256/length checked. ETag is never treated as a content hash.

The returned immutable artifact receipt binds key, provider version ID, byte
length, SHA256 and minimum retention date. Retention is read for that exact
version and must be COMPLIANCE through at least the requested future date. Both
verification reads pin the version; an unversioned or `null` result fails.
Backblaze's documented upload headers do not establish conditional create-only
support, so this adapter does not pretend that Object Lock prevents a later
version at the same key. A recovery manifest must retain the exact version
receipt and never recover by latest key. It is deliberately not substituted for
the older unversioned/create-only object-recovery port.

After submission, every missing acknowledgement, failed retention check or
content mismatch is an uncertain write. No automatic retry or complete marker
is emitted; retain the reserved key for separate reconciliation. Failed versions
may remain locked. The orchestration must never silently reuse an uncertain
artifact key or discard its history. SDK exceptions are replaced with fixed
errors so endpoint, local path and credential details do not escape.

Recovery retrieval creates an exclusive0600 file in the caller's private owned
directory, streams the exact pinned version, and verifies retention, length and
SHA256 before returning it to the age restore tool. An existing destination is
never replaced. Failed partial ciphertext is removed only if this call created
it. Host ACLs and directory protection still require configured acceptance.

Fifteen focused local cases use actual AWS SDK HTTP/streaming against a
disposable server: version-pinned positive upload/readback; refusal of missing
version, governance lock, short retention, corruption, wrong content type,
changed version, missing length and lost acknowledgement; pre-I/O refusal of
plaintext, aborted calls and foreign/unversioned receipts; fixed endpoint
configuration, recovered ciphertext equality, refusal to overwrite existing
files and removal of a damaged partial recovery. Types and targeted lint pass. These fixtures use synthetic
age-shaped bytes and simulated lock responses, not actual age decryption or B2
conformance. Live vault/credential/retention/deletion and independent restore
acceptance remain open.

Primary provider references checked2026-11-22:
- [B2 Put Object headers and returned version](https://www.backblaze.com/apidocs/s3-put-object)
- [Version-specific retention lookup](https://www.backblaze.com/apidocs/s3-get-object-retention)
- [Application-key capabilities](https://www.backblaze.com/docs/cloud-storage-s3-compatible-app-keys)
