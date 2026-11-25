# Authenticated application image recovery

The recovery tools now preserve the actual authenticated image-file capability
through coordinated preparation. `preparedRecoveryApplication` accepts only the
original prepared result, not a copied JSON object. The retained raw format2
build manifest and image capability can be passed to the separate image verifier.
The database, object and application preparation steps still declare no complete
backup, independent-host acceptance or runtime activation.

`createRecoveryImageIdentityVerifier` requires the actual successful encrypted
archive restore capability. It checks its release tuple, byte count and SHA256
against the strict build manifest, then rehashes the private non-symlink archive
before and after inspection. A caller-supplied path or copied capability cannot
authorize inspection. Import remains a separate standard Docker load step.

The verifier inspects only the manifest's immutable image ID, with pull disabled,
network disabled, a read-only filesystem, node user, all capabilities dropped,
no-new-privileges, bounded memory/processes, and no mounts, environment profile,
ports or healthcheck. The fixed command compares the application's published
getServerBuildIdentity export with its embedded build-identity.json and then
compares that identity with the authenticated manifest. It starts no application
listener, database connection, migration, document worker or business task.
Output and execution time are bounded; cleanup removes only the generated probe
container and checks it is absent. The verifier never removes images.

## Executed evidence and limits

The actual locally built schema138 image comes from source f5203c1d, with
appReleaseId1140220cedb297290b54cff33596ca9ddca40bc4 and image ID
sha256:e713856ab0335f76c3048957d0f1d1a9b1b94a60ad050476aeaa84ad7b906dcd.
Its standard Docker archive is237082112 bytes. Docker Desktop's image ID here
is an OCI index digest, not the config-blob filename; no equality is assumed.
The build, standard age encryption/decryption, byte recovery, removal of only
the new unused candidate image, import and compiled/file identity observations
are retained under .local/recovery-candidate-image. This is a same-host fixture
exercise and does not establish independent custody or production acceptance.

The first manual probe incorrectly called a non-exported migration helper after
the build-identity comparison. That failure remains preserved. The corrected
probe uses only the actual public export; no application export was added to
accommodate the test. The successful resumed identity evidence is separate.

Four integration cases on29fab496 pass actual encrypted image recovery/import
and compiled identity, copied/foreign binding refusal, changed archive refusal
with exact repair, and pre-dispatch cancellation. A later combined run on2086dea8
passes25 cases from recovery-backup-reader.test.mjs and
recovery-image-identity.test.mjs, including original coordinated application
capability retention and copied-result refusal. Tracked source is unchanged and
owned cleanup awaited. The combined wrapper's inherited scope paragraph is
inaccurate: it mentions44 cases and a synthetic image. Its separate acceptance
record corrects the scope without altering the original result or log. The older
44-case financial/schema runs are separate evidence, not repeated by this run.

CI now requires the four actual-image cases after building the release manifest,
using that build's real image archive. Exact four pass/zero fail/zero skipped
counts are mandatory. Public98b predates this addition; its successful Linux
database recovery step is not application-image acceptance. New exact-source
hosted acceptance remains required.

These components do not publish a final complete point, run the backup schedule,
prove owner key/account recovery, restore on an independent host, fence old
sessions/workers, complete global financial reconciliation or reopen Crest.
