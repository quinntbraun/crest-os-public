# Isolated capture command and private host configuration

scripts/recovery-capture.mjs connects the pinned coordinated producer, dedicated
TLS backup reader, three R2 read/list adapters, versioned encrypted vault,
durable artifact/capture journals and independent start/failure monitor. It runs
only on Linux, not in the web service or worker. It never creates a completed
backup marker, backup_runs success, healthy heartbeat or app activation.

Use Node24 with --conditions=react-server and exactly two arguments: an absolute
private profile-file path and an explicit run UUID. Credentials never enter argv.
The caller supplies that UUID; the command does not generate a new identity on
restart. Before any tools/client/provider dispatch it durably reserves the run in
the private state directory. Existing identity files refuse before another
dispatch, including after a failed preflight or uncertain upload. Manual review
and a deliberately new identity are required for a fresh attempt. No scheduler,
timer or automatic retry is installed or enabled here.

## Private configuration boundary

The exact profile fields are schemaVersion1, businessId, referenceDirectoryId,
databaseUrl, rootCertificateFile, recipient, retentionDays, stateDirectory,
workspaceDirectory, recipeFile, distribution, tools, sources, vault and
monitorPingUrl. Nested objects have fixed keys too; unknown flags and private
decryption-key fields refuse. The profile is JSON in an owner-only regular file,
outside source control. All configured local paths are absolute. State/workspace
directories must already exist, be owner-only and belong to the process user.
The shared bounded file reader refuses symlinks, oversized/changed files and
nonprivate inputs, zeroes temporary buffers and rechecks the opened inode.

The database URL has no query or fragment options. The command supplies explicit
verified TLS/CA and SET role=crest_backup_reader; the existing preflight still
rejects administrators, web identities, excessive privileges or wrong migrations.
Source and image paths bind to the strict format2 release manifest; the registry
must have its existing exact138 checksum. The secret-free recipe must match that
release, business, registry and reference-directory binding. Only public age
recipient material enters capture. Actual offline secret/file/key custody is
still separate acceptance.

tools selects only absolute pgDump/age paths; the real pinned producer verifies
the existing executable/toolchain contract. sources is exactly expense_receipt,
supplier_document and condition_photo, each with explicit accountId, bucket and
read-only access credentials. Physical account/bucket pairs must be distinct;
the fixed R2 constructors supply their HTTPS endpoints. These are backup-reader
credentials, not web write credentials. Actual provider scope tests remain
required; a private profile alone cannot establish cloud permission restrictions.

The chosen independent vault uses explicit region/endpoint/bucket/credentials,
one SDK attempt and bounded requests. Its endpoint must be the canonical HTTPS
Backblaze regional origin matching the selected region, with no userinfo, port,
query or alternate path. This follows the provider's [S3-compatible endpoint
contract](https://www.backblaze.com/apidocs/introduction-to-the-s3-compatible-api).
The existing vault producer requires versioned byte readback and [COMPLIANCE
retention observations](https://www.backblaze.com/apidocs/s3-get-object-retention).
No bucket settings are modified by this command. Separate account ownership,
Object Lock configuration, restricted key authority, billing/capacity and actual
independent-provider acceptance still require owner setup; none was provisioned.
SDK credentials are explicit, with no ambient AWS profile fallback or raw SDK
diagnostics. The web release process receives none of these credentials.

monitorPingUrl is only the existing private Healthchecks UUID endpoint, never a
slug/autoprovision URL. The profile accepts explicit retention tiers7/35/400 days;
the producer retains its existing safety floors for data/originals. This command
does not decide daily/month-end designation or apply the authoritative retention
calendar. Complete catalog/retention integration is still unfinished.

## Execution and truthful status

Pinned-tool and file preflight precede artifact creation. The actual database
connection is opened inside the durable capture controller so connection failure
gets a local terminal record and independent bounded failure signal. Client,
artifact-journal and all SDK handles are closed on success/failure. Uncertain
uploads remain reserved/reviewable; their keys are never automatically retried.
Failed preflight after reservation is also recorded and signaled when monitor
configuration is available. A bounded70-minute outer signal supplements existing
capture/SDK limits. Source/image bytes, encryption, object inventory and business
lease behavior remain the existing producer's responsibility and checks.

A fulfilled stage prints only run identity, candidate_review_required and
completeBackup:false, and exits2. A failure prints one closed error code and
exits1; private local records retain a bounded failure stage/monitor phase.
Neither exit is backup success. There is no exit0 or success heartbeat. Existing
prior complete points are never replaced. This staging command must not be
advertised as an operational healthy backup schedule before final complete-point
publication, backup_runs ordering, retention and independent recovery acceptance.

Fourteen configuration cases, types and targeted lint pass. New Linux command
composition cases use real private files/fsync/artifact journal/controller with
controlled PG, producer, object and HTTP ports; they are not actual encryption,
TLS or provider acceptance. They exercise private staging, duplicate refusal,
connection failure, lost acknowledgment, tool failure and nonprivate/argument
refusal. Six such command cases pass on23f2379 in pinned network-disabled Linux,
actual owner-only files/directory fsync, source unchanged and owned cleanup:
.local/recovery-capture-command/result.json and test.log. These controlled ports
do not establish real pinned-tool execution, PostgreSQL TLS or provider scope.
Those existing producer/restore checks remain separately required.

The shared-file-reader regression also passes on23f2379 with unchanged source
and owned cleanup, .local/shared-private-reader-native138/result.json and test.log.
It retains actual restricted PostgreSQL/command ten-source and full189-source
capture,193-file delivery/neutral reimport, exact cells/references/hash metadata,
orphan/schema refusals and repairs. This is one native root case with assertions
and the Windows test-only loopback/file-flush seam, not production Linux/TLS
acceptance or a full recovery rerun. CI adds command cases without removing any
original producer, restore, financial or release gate.
