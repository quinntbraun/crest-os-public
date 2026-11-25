# Exact release artifacts for independent recovery

The release pipeline now saves both the tested container image and a source tar
archive of the exact checked-out commit before writing build-manifest.json.
Manifest format2 records their filenames, byte counts and SHA-256 values, the
tested container image ID, computed application build identity, source commit,
lockfile/migration/toolchain hashes and compatibility. distributionDigest binds
the container archive rather than remaining null. CI fails if either archive or
the tested image identity is absent. Local partial metadata may still contain
null archives and remains explicitly production-blocked. Historical format1
metadata is not silently relabeled as format2 or a complete recovery kit.

The image is saved by immutable image ID rather than a mutable tag. The release
writer records source identity before hashing, verifies the source tar's Git
commit header and refuses a changed checkout before writing the manifest.

The source tar includes tracked source, documentation, migrations, package lock,
fonts/templates/assets and build instructions without depending on GitHub at
restore time. The image archive preserves runtime dependencies independently of
the container registry. Hashes describe exact bytes, not cryptographic proof of
CI authorship. Trusted release provenance and the actual container/decoder
acceptance remain required. No fake image or synthetic file is published as the
application image.

`createPinnedRecoveryReleaseFileEncryption` encrypts these release files through
the protected age executable with bounded streams and backpressure. It opens a
regular source file without following symlinks on Linux, binds the opened inode,
and checks the expected count/SHA plus unchanged source metadata. It writes only
an exclusive private ciphertext file; no additional plaintext archive is created.
Existing local Crest images measure1.25–1.91GB, so an entire image cannot be
assumed to fit one1GiB vault artifact. Release file hashing accepts up to8GiB;
`hashRecoveryReleaseParts` plans256MiB parts with exact offsets, part hashes and
a whole-file hash. The encryptor accepts those bounded ranges without creating
plaintext part files, checks each expected part hash and retains the whole-file
identity. Each encrypted part remains below1GiB, reserving64KiB of overhead.
At most128 parts are permitted. Reassembly must verify every offset/count/hash
and the complete image checksum before load. Larger artifacts fail and require
explicit capacity work rather than silent truncation. This does not
widen the25MiB attachment limit or tenant export limits. Missing files, changes,
encryption failure, cancellation or wrong digests remove unfinished ciphertext.

Full recovery point assembly must copy and verify both encrypted release archives
in the independent version-pinned vault along with the release manifest, required
private configuration, secret references, provisioning instructions and offline
key/account recovery procedure. The private age key stays off the backup host.
This release-artifact preparation does not yet establish full kit custody,
production provisioning, decryption-key recovery or a complete backup.

Local proof: the actual tracked source tar (over25MiB) is age-encrypted,
independently decrypted/hash checked and its Git commit header verified. Four
native cases on01c5b6f also check wrong-digest cleanup, wrong-size/nonfile refusal
before encryption, and six bounded8MiB-range parts reassembled to the exact
whole-file checksum without plaintext part files. They pass with unchanged
tracked source and awaited cleanup in
`.local/customer-route93-and-release-parts138/result.json` (6/6 including the
two sample browser cases). This does not prove an8GiB capacity run or a current
application container build/load.

The actual release writer on87e247f produced format2 local partial metadata for
its44,810,240-byte source archive, bound to the current registry and computed
build identity. A missing CI image archive was refused without overwriting that
manifest. `.local/recovery-release-kit-metadata/result.json` records the exact
source identity and null image fields. These retained87 artifacts are not a
newer compiled image, full kit or production acceptance. Earlier metadata was
preserved separately; source/header identities are never relabeled.

## Versioned archive assembly and recovery

`captureRecoveryReleaseArchive` binds the selected source/image file and immutable
release metadata to the attempt header, checks the entire file against the
expected release checksum, then encrypts and publishes every planned range
through the existing attempt/vault protocol. Its private archive descriptor
records ordered offsets, plaintext counts/hashes and exact retained ciphertext
versions. It captures input metadata before awaits, stops on any failed or
uncertain dispatch, and never emits a complete-backup claim.

The archive reader validates all fields and the complete contiguous part layout
before any retrieval. It bounds ciphertext overhead as well as plaintext size,
refuses missing/reordered/duplicate artifacts, and preserves release identity.
`createPinnedRecoveryReleaseArchiveRestore` runs on the separate Linux restore
host with its private identity file. Only that host decrypts. Version/retention
readback, ciphertext checksums, age authentication, every plaintext part hash,
exact offsets and the whole-file checksum must pass before the private result
is returned. Plaintext streams into a new exclusive private file; no original
file is overwritten. Failure removes the unfinished assembled file and owned
ciphertext candidates. Child processes, file writes and cancellation are awaited.

This step does not extract a tar, load/start a container, provision resources,
resume sessions, change a database or declare a full recovery point. Actual image
identity/load, configuration/key custody, business/database controls and independent
host acceptance remain mandatory. The private result explicitly records
`authenticated:true`, `applicationLoaded:false`, `completeBackup:false`.

Native acceptance on7027ea2 passes8 cases across release-file and release-archive
tests, with unchanged tracked source and awaited cleanup. The actual tracked Git
source tar is split, age-encrypted, uploaded through real loopback vault SDK
requests with version/retention readback, retrieved and recovered by the new
restore implementation. The authenticated assembled file matches its complete
byte count/SHA and Git commit header. Missing/reordered metadata makes no vault
request or destination file. A tampered part whose transport checksum was also
changed still fails age authentication and removes partial recovery; a wrong
whole-file hash likewise removes the otherwise authenticated assembled output.
Proof is `.local/recovery-release-archive138/result.json`. Windows uses the
explicit publication seam; actual Linux journal composition for this new archive
workflow, real provider permissions/retention, current container load and full
kit/configuration/offline-key acceptance remain open.

## Paired distribution custody

`recovery-release-distribution.ts` consumes the current complete format2 build
manifest and both archive paths. Its closed reader requires clean source,
nonnull image/source descriptors and immutable image ID, exact build identity,
current138 registry identity, known compatibility/toolchain versions and the
matching distribution digest. Candidate `productionActivation:blocked` is
preserved; backing up a candidate never activates it. Historical formats are not
silently converted. The build manifest and accepted release provenance must be
obtained from the trusted release process; hashes alone do not prove authorship.

Both files are checked before the first dispatch. The existing range producer
then rechecks each file and every range during encryption/publication. An
encrypted `crest.private-release-distribution.v1` index includes the exact build
manifest and both version-pinned archive descriptors. No unencrypted metadata
index or plaintext part files are created. Uncertain writes retain the existing
journal/vault refusal behavior, and only acknowledged ciphertext is removed.

This closes paired release-distribution custody, not private configuration,
secret-reference availability, offline-key recovery, container load or complete
point publication. Explicit false flags remain on its private result. The focused
fixture uses the real Git source archive and a clearly synthetic image fixture;
it tests paired encryption, receipts, index binding and authenticated retrieval,
not acceptance of an actual application image. Missing/changed image and
incomplete/dirty/foreign manifests must refuse before any vault dispatch.

Native acceptance on3ab8b71 passes11 cases in
`.local/recovery-release-distribution138/result.json`, with tracked source fixed
and owned cleanup awaited. It retains the previous8 release-file/archive cases
and adds three distribution cases: pre-dispatch invalid/foreign manifest refusal,
paired encrypted custody and independently recovered synthetic image bytes, and
pre-dispatch missing/changed-image refusal. No actual application image load,
configured provider, configuration/key custody or complete backup is claimed.
