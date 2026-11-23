# Private instance-operator source export

The reviewed SECURITY_EXPORT_COVERAGE138 inventory has189 application sources.
Existing business, identity, session and provider components account for179.
The remaining ten are login attempts/contexts/limit state, session CSRF/admission
metadata, Calendar credential-key configuration, OAuth attempts/client, request
budget and worker bindings. Role capabilities already belong to the identity
component and are not duplicated here. A coverage regression checks the exact
set difference and every required/excluded column against the reviewed manifest.

## Scope and authority

These sources have instance/global or runtime-security boundaries. They are not
assigned invented business ownership and are not appended to a customer's or
business owner's browser download. captureOperatorSources138 is isolated private
operator tooling over the existing dedicated backup-reader connection. It uses
the existing strict role/grant/migration preflight, business coordination lease
and one read-only repeatable-read snapshot. The lease business ID coordinates
capture; it does not filter or claim ownership of these instance-wide records.
The function owns and closes that dedicated connection. No SQL grant, schema
migration, web route or broader browser permission is introduced.

Calendar SQL excludes ephemeral OAuth attempts from product exports and requires
their invalidation on restore. This operator-only projection is inspection and
portability evidence, not a product export or instructions to recreate active
sessions, consent attempts or worker authority. Original approved credential
exclusions remain: no tokens, credential/network hashes, OAuth state/proof/envelope,
encryption key identifiers or actual worker principals are selected. Singleton
state and noncredential references remain explicit rather than disappearing.

## Representation

Only the ten literal sources and approved required columns can be selected.
Each table's actual columns must equal its reviewed required/excluded union;
unknown columns refuse the entire capture rather than being silently omitted.
Required scalar types must be known PostgreSQL built-ins, and every primary-key
column must be in the projection. Row order follows the actual primary key.
Cursor reads and all source values use the same snapshot, with UTC/ISO output,
exact PostgreSQL scalar text and original timestamp microseconds. Values are
never passed through JavaScript numeric/date conversion. Limits are100000 total
rows and64MiB raw values; excess refuses without partial results.

The private capture capability produces ten RFC4180 CSVs, an exact type/key/
exclusion dictionary, spreadsheet escape map and SHA256/size manifest. The shared
independent CSV decoder must reproduce every row before a file set is returned.
Null/empty, literal backslashes and formula-like values remain distinguishable;
CSV display protection never changes the reconstructed source value. Copies of
the evidence object cannot authorize formatting. Total file bytes are bounded
at64MiB and the existing per-CSV decoder bound is32MiB.

The unkeyed manifest establishes file consistency, not authenticity or complete
reference closure. Instance records may refer to sessions/actors outside one
business's package. They therefore remain a separate operator component until
an instance-wide reference-closure/delivery contract is verified. This does not
turn one business's179-table package into an189-table whole-instance export.
completePortableExport, referenceClosureVerified and completeBackup stay false.
No credential table or field becomes a recovery import recipe.

## Verification and remaining work

The exact reviewed ten-source coverage test, types and targeted lint pass. The
first unit invocation needed the repository's existing server-only module mock;
no runtime guard was removed. The initial manually listed projection duplicated
role capabilities; comparison with all179 existing sources corrected it to the
actual missing worker-binding source before native execution.

The mandatory138 backup-reader fixture now seeds all ten sources with positive
synthetic rows, including two businesses' OAuth/session references. It compares
every projected cell with independent real PostgreSQL text, exact CSV decoding,
microseconds/nulls/formula/Unicode/backslashes, credential exclusion, copied
capability refusal, privileged wrong-role refusal and unknown-column refusal
followed by exact repair. Original independent encrypted restore, financial,
original-file, schema and role assertions remain. That native run passes22/22
onf17e5c48 with unchanged tracked source and awaited owned cleanup,
.local/operator-source-native138/result.json and test.log. Windows uses its
explicit journal/publication seam; the Linux capture-controller hookup is not
exercised by that Windows run.

## Operator command and private delivery

Run Node24 with --conditions=react-server, scripts/operator-source-export.mjs
and one absolute private request-file path. No credentials appear in argv or
normal output. The request has exactly schemaVersion:1, leaseBusinessId,
databaseUrl, rootCertificateFile and outputParent. Keep it owner-only and outside
source control. Use the existing dedicated backup login with only SET membership
in crest_backup_reader, not the web login, database administrator or a new grant.
Its direct/session-capable connection must support the existing snapshot/lease.

Production requires Linux, an owner-only request/CA file and output parent, and
verified TLS with the explicitly supplied CA. URL query/fragment options cannot
override that connection policy. The command reads the exact checksum-pinned138
registry from the checkout, preflights the existing role and closes the dedicated
connection. Explicit CREST_ENV=test permits only the existing loopback synthetic
database contract, including a Windows file-flush seam; it cannot select a remote
or production database. The test seam does not accept production Linux custody.

The command creates a fresh owner-only output folder, writes each fixed file
exclusively, flushes and reads back exact bytes, and writes the manifest last.
Linux also flushes containing directories. Partial output cleanup is restricted
to the freshly created folder under the validated parent; existing folders are
not replaced. Only a final metadata receipt is printed; errors are one closed
category without credentials or source paths. The input profile is infrastructure
recovery material whose custody remains an owner setup requirement.

The actual-subprocess delivery fixture passes on23b0c03 with source unchanged
and owned cleanup, .local/operator-command-native138/result.json and test.log. It
uses a real restricted login and all ten positive sources, compares delivered
CSVs/dictionaries/escape map against independent capture, checks manifest hash,
argument/connection-option refusal and no credential output. This is one native
root case with its retained assertions, not a new22-case recovery run. Windows
uses only the explicitly test/loopback file-flush path; fresh Linux execution
and actual production TLS/account custody remain separate acceptance. CI requires it after
the original recovery suite and controller cases. No prior case is removed.

Instance-wide reference closure, neutral reimport of this operator component,
required reports, original-file custody, actual host/account recovery and full
launch acceptance remain unfinished. No operational activation, source-owner
rule, real records or spending is included.
