# Private configuration recovery recipe

This implements the configuration export and secret-reference requirement in
EXPORTS_AND_BACKUPS sections4–5. It adds no production authority, provider,
credential store or activation flag. The live profile parser remains canonical.

Operator preparation runs separately from the backup scheduler. It accepts the
operator's current profile through the existing closed production parser, binds
business/release/schema/registry identity, and requires one opaque UUID reference
for every configured credential and certificate-file slot. References include
retained authentication/export keys and optional finance, export, receipt, photo,
supplier and Calendar configuration. Unknown profile fields and missing, extra,
duplicate or misclassified references refuse preparation.

The `crest.private-configuration-recipe.v1` envelope retains nonsecret settings
and a template whose credential/file slots contain reference markers. Secret
values are omitted and checked for accidental repetition elsewhere in the
template. Secret-reference SHA256 values bind the exact original material; they
are sensitive private comparison metadata, not public fingerprints or proof of
authorship. File references deliberately do not claim file-content availability
or compare a relocated destination path to the old host path.

An independent owner recovery directory, identified by UUID, must retain the
immutable reference-to-material mapping and actual file contents. These UUIDs
are references, not a new secret-manager service, proof of storage or permission
to replace an old key with a current one. Owner custody, two distinct recoverable
copies of age identities, account recovery and actual TLS/file availability
remain configured acceptance requirements. Keep old decryption material for all
retained points. Never place this directory or raw profiles in source control.

The scheduler receives only the prepared recipe. A bounded duplicate-rejecting
reader checks the closed envelope, exact expected binding and every known marker.
Before resolving anything, the actual production parser validates nonsecret
structure using temporary distinct dummy values. No dummy connection is opened.
`createPinnedRecoveryConfigurationArchive` encrypts the recipe with the public
age recipient and uses the existing journal/version-pinned vault protocol under
the `configuration` purpose. It never receives the private age identity, runtime
passwords or key values. Only acknowledged ciphertext is removed.

Offline reconstruction requires an explicit owner resolver for that exact
directory/reference identity. Missing material, wrong original secret hashes,
invalid reconstructed profiles, cancellation or foreign binding refuse a usable
result. Certificate-file references resolve to deliberately prepared local paths;
their content, TLS matching, permissions and availability still require the
existing actual file/startup and recovery acceptance. Reconstruction does not
write files, connect providers, run a process, start the app, resume sessions or
rotate credentials. It returns private configuration for reviewed recovery only.
The complete incident procedure must invalidate restored auth sessions and fence
old workers before any controlled reopen.

All recipe/archive results retain `externalMaterialAvailabilityVerified:false`,
`applicationStarted:false` and `completeBackup:false`. This is a component for
the final recovery point, not proof that an owner's actual emergency kit exists
or that a full restore is ready. Prior incomplete formats are not relabeled.

Focused unit checks cover the entire current profile (31 required references in
the full synthetic fixture), exact reconstruction, missing/duplicate/foreign
references, duplicate JSON, unknown template fields, retained keys, a different
valid-looking key, cancellation, minimal/managed ingress and pre-encryption
binding refusal. The existing native release-archive file additionally exercises
real age/vault custody, independent recipe decryption and offline reconstruction.

Native acceptance on9ddc10f passes12 cases with tracked source unchanged and
owned cleanup awaited in `.local/recovery-configuration138/result.json`. This
includes the prior11 release-file/distribution cases and the new full synthetic
configuration encryption/retrieval/decryption/reconstruction case. Every original
credential value is absent from the decrypted recipe, while all reference slots
reconstruct the exact original profile through the explicit offline resolver.
Missing offline material refuses recovery. Seven focused unit cases, types and
targeted lint also pass. The first unit expectation miscounted31 references as32
and the fixture Map needed an explicit string key type; those test corrections
do not relax any slot requirement or credential-integrity check. These results
do not establish actual owner key/file custody, provider access or full recovery.
