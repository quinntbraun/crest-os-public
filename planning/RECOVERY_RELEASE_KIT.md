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
