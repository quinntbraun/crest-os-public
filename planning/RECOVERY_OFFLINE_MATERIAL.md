# Independent owner configuration material

The [operator command and runbook](RECOVERY_OWNER_KIT_COMMAND.md) now expose
capture and private reconstruction without custom caller code. The owner-only
capture command requires only the trusted age executable; it has no dependency
on database tools or provider credentials.

The configuration recipe names opaque references; it cannot reconstruct an
unavailable private key file or credential by itself. The owner-only offline
material capture now pairs every exact recipe reference with its original
secret value or certificate-file bytes. This implements the independent owner
reference directory in RECOVERY_CONFIGURATION, not a new runtime secret store.

Capture takes an explicitly supplied production profile and exact recipe. It
uses the real profile parser and original secret hashes before reading files.
Files must be regular, bounded to1MiB each and protected by owner-only Linux
permissions. Final-component symlinks are refused; file identity/size/times are
checked through the owned descriptor. Combined material is capped at4MiB and
its closed JSON envelope at8MiB. Unknown reference sets and missing files fail.

The complete material envelope is encrypted with the existing pinned standard
age implementation. No plaintext kit file is created during capture. Only the
private ciphertext path, size/hash descriptor and nonsensitive identity/count
observations are returned. It receives no vault credentials and is not part of
the scheduled backup service. Never commit a raw profile, decrypted envelope,
owner key, provider recovery code or actual kit descriptor to source control.

The owner must retain the encrypted kit and descriptor independently of the
app/hosting account and maintain two recoverable age private-key copies in
distinct secure locations. The age private key is deliberately absent from
this envelope: encrypting its only copy with itself is not recovery. Provider
recovery codes, mailbox/MFA and vault-administrator access remain separate
owner emergency-kit requirements. Neither code nor a matching hash can prove
the owner's physical custody or independent account access.

After standard age decryption on the recovery host, the reader requires the
retained plaintext size/hash, exact recipe hash, directory/business/release/
schema binding and complete ordered references. It rejects duplicate JSON,
noncanonical file encodings, missing/extra/reordered material and wrong secret
hashes. The resulting private in-process capability cannot be supplied by a
copied JSON result. It does not claim authenticity from a self-supplied hash;
the trusted age decryption and retained descriptor remain caller duties.

Materialization creates a new exclusive private configuration directory under
an existing protected parent. Files use reference UUIDs and exclusive0600
creation; the profile points to those relocated exact bytes. Files and Linux
directory entries are flushed; partial owned output is removed on failure.
Existing output is never overwritten. Windows file flushes are not a claim
about Linux directory or power-loss durability.

This prepares the original configuration for offline review only. It does not
start the app, connect providers, authenticate the owner, validate certificate
expiry/trust, rotate credentials, invalidate sessions or fence old workers.
Recovered credentials must go through the separate incident and controlled
reopen procedure before the application can use them. All results retain
applicationStarted:false and completeBackup:false; external copies and account
recovery remain explicitly unverified.

Native acceptance on7bfe0e0 passes41 cases with unchanged tracked source and
owned cleanup awaited in `.local/recovery-offline-material138/result.json`.
The new case encrypts all31 configured synthetic references with real age,
checks ciphertext and authenticated plaintext hashes, decrypts independently,
materializes every private file/profile, and proves a later source-file mutation
does not change captured bytes. It performs no vault requests. The prior40
database/lease/release/artifact/object cases remain passing. Five focused unit
cases, types and targeted lint pass. A follow-up confines the missing-file unit
fixture to its own empty temporary directory; its five cases, types and targeted
lint pass again without changing the production implementation.

This execution uses synthetic certificate bytes and Windows file permissions;
it proves transport and reconstruction, not certificate trust, Linux directory
durability, actual owner custody, account access or production acceptance.
