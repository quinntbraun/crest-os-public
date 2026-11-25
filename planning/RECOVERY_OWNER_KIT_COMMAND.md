# Owner recovery-kit command

Run from the exact reviewed source and locked dependencies using Node24.22:

```
npm run recovery:owner-kit -- capture /private/capture-request.json
npm run recovery:owner-kit -- materialize /private/rebuild-request.json
```

Use the direct `node --conditions=react-server scripts/recovery-owner-kit.mjs`
equivalent when machine-readable stdout is required; npm also prints its script
header. Only paths appear in argv. Each direct command emits one metadata JSON
result on success or the fixed review-required code on failure. It never prints
credential values, decrypted kit contents, raw provider errors or a stack trace.
No environment variable can bypass its validation or turn it into app startup.

## Prepare the encrypted kit

On the private Linux operator host, prepare an owner-only0700 directory. Its
request, recipe, profile and credential/certificate files must be0600 and owned
by the operator. The operator must protect parent directories and use trusted
source/tool installations. The command rejects final-component symlinks,
publicly readable input, file growth/replacement and malformed or unknown fields.
It does not change permissions on someone else's files to make them pass.

The capture request has exactly these fields:

```
{
  "schemaVersion": 1,
  "expected": {
    "businessId": "<actual business UUID>",
    "appReleaseId": "<actual 40-character release identity>",
    "migrationRegistrySha256": "<actual registry SHA256>",
    "sourceSchemaVersion": 138,
    "referenceDirectoryId": "<actual owner reference-directory UUID>"
  },
  "recipeFile": "/private/exact-recipe.json",
  "profileFile": "/private/original-production-profile.json",
  "workspace": "/private/encrypted-output",
  "recipient": "<owner public age recipient>",
  "tools": {
    "age": "/trusted/bin/age"
  }
}
```

Replace all bracketed values with the exact reviewed identities; placeholders
are rejected. The owner-only launcher validates the trusted executable path;
only age is needed for this command. Install the checksum-pinned tool using
the existing recovery-tool procedure, not an arbitrary downloaded executable.
The live profile must reconstruct exactly from the supplied recipe, including
the original secret hashes. Missing private file material aborts capture.

Retain the returned ciphertext `.age` file and descriptor outside the app/host
account, alongside the exact recipe. The descriptor includes the plaintext and
ciphertext size/hash and reference-directory/recipe identity; keep it private.
The capture workspace receives no plaintext kit file. This command deliberately
does not publish to the scheduler vault, email anyone or claim physical custody.

## Rebuild on the recovery host

Obtain the independent encrypted kit, descriptor, exact recipe and a separately
held age identity. Compare the encrypted file size/SHA256 with the descriptor.
Using the installed standard age tool and an owner-only destination, decrypt
without directing plaintext to a terminal or a log. For example on Linux:

```
umask 077
age --decrypt --identity /offline/owner-age-identity.txt --output /private/material.json /offline/owner-material.age
```

The rebuild request has exactly `schemaVersion:1`, `expected` (the same complete
binding shown above), `recipeFile`, `materialFile`, `plaintext` and `parent`.
`plaintext` is exactly `{ "byteSize": <descriptor plaintext byte count>,
"sha256": "<descriptor plaintext SHA256>" }`. All paths must be absolute.
`parent` must already be a protected private directory on the recovery host.
The reader checks exact bytes/reference identities before creating output.

Materialization creates a fresh private `configuration-<UUID>` directory with
relocated original files and `production-profile.json`. It never overwrites an
existing configuration. Its result names the profile path and explicitly says
the application has not started. Retain that private output only as required
for incident review; remove the owned decrypted input through the recovery
host's private-material handling procedure after it is no longer needed.

This is original-material preparation, not approval to reuse old credentials.
Before any controlled reopen, validate certificate trust/expiry and matching,
rotate or revoke credentials as required, fence old workers/connections,
invalidate sessions and establish incident authority. Two secure offline-key
copies, provider/MFA/account recovery and an actual independent-host drill are
still required. The command neither checks these physical facts nor marks a
backup complete. See RECOVERY_OFFLINE_MATERIAL for the underlying limits.

## Executed acceptance

Four actual CLI cases pass on681e435 in the digest-pinned Linux Node image,
with no network and read-only source. The full capture case uses the official
checksum-pinned age1.3.2 binaries in an owner-only executable ephemeral tools
mount. It creates the encrypted31-reference kit, decrypts using a separately
held test identity, and rebuilds the private profile and every original file.
The other cases verify metadata-only output, invalid request/digest refusal,
public request/recipe refusal and final-component symlink refusal. Source stays
unchanged. Proof: `.local/recovery-owner-kit-full-linux138-exec/result.json`.

The first full Linux attempt could not execute the tool from Docker's default
non-executable temporary mount. The otherwise identical source passes after
enabling execution only for `/tools`; data remains on the non-executable `/tmp`
mount, with no network, dropped capabilities and a read-only root filesystem.
Both attempt logs are retained; the failed attempt is not counted as acceptance.
The earlier materialize-only Linux cases also pass on30f651d; Windows runs its
two applicable CLI cases and explicitly skips Linux-only permissions/capture.
Types, targeted lint and locked dependency verification pass. No actual owner
keys, certificates, accounts, deployment or real-data activation were used.
