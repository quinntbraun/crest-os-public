# Large encrypted release-part correction

Public100a/main45174621023 passes all21 prerequisite jobs and Foundation through
step40 application build/smoke. Step41 fails0/4 in the shared setup with
RECOVERY_RELEASE_ARCHIVE_REVIEW_REQUIRED before image identity probing. Later
document-worker jobs are skipped, so whole release/worker acceptance is absent.
Both ancillary workflows45174620855/45174620712 pass. All three are terminal;
keep the original source and logs, do not rerun unchanged and call it repaired.

An independent native reproduction on0e2b112 creates a sparse256MiB+17-byte
fictional release, uses the default256MiB parts and real standard age1.3.2.
It fails the same archive boundary; tracked bytes remain unchanged and cleanup
is awaited: .local/recovery-release-large-before/result.json. The previous flat
64KiB ciphertext overhead allowance cannot accommodate all authentication tags
on a256MiB part plus its header. The standard format uses64KiB payload chunks
and16-byte AEAD tags: [age payload specification](https://c2sp.org/age#payload).

recoveryAgeCiphertextLimit retains the existing64KiB header/nonce allowance and
adds16 bytes per payload chunk, capped at the original absolute1GiB ciphertext
limit. Producer byte/file encryption and archive metadata validation share that
bound. No hash, exact-byte, authentication, source-stability or retention check
is removed; default part size,128-part/8GiB archive limits and historical format
identity remain unchanged. Parts too close to1GiB still refuse if actual
ciphertext exceeds the hard cap; this change grants no unlimited allowance.

The unchanged native reproduction passes1/1 on2de7a60, asserting first-part
ciphertext actually exceeds the old allowance, two ordered parts, standard age
authentication/decryption and whole restored byte/hash equality. Source stable,
owned cleanup awaited: .local/recovery-release-large-fixed/result.json. Nine
focused boundary/cap/invalid-size unit cases, full types and targeted lint pass.
The mandatory new recovery-image CI step includes the original large-file case.
Fresh exact-source hosted application-archive/identity and later worker checks
remain required; the reproduction is evidence of a real defect and correction,
not independent proof that this was the only cause of the hosted setup failure.
