# Opening customer funds: retained evidence and held storage

The normalization module retains pre-cutover money origins, historical reductions and their remaining customer obligations. A single historical origin may fund multiple items/customers. Original received amount minus retained applications/refunds/tip conversions/collection failures/reclassifications must equal the held items exactly. The proposed opening root is only that remaining amount; normalization creates neither a new cash receipt nor a journal.

Amounts use exact integer cents bounded by PostgreSQL bigint for each source amount. Receipt, obligation and known refund-ceiling evidence retain references and SHA256 digests. A digest alone does not prove authenticity. Unknown refund ceilings remain null; an evidenced zero remains distinct. No refund authority is granted. Root, namespaced external origin and item identities cannot repeat inside a schedule. Customer UUID shape is not proof of a same-business customer; durable database identity/tenant checks and global external-money uniqueness remain required.

This boundary uses the existing worksheet's local-midnight cutover: origins and reductions must be strictly earlier local dates. It does not infer ordering for boundary-day or intraday events. Full intraday cutover still requires its complete roster/order implementation. Empty schedules are retained evidence only; they never verify unknown opening controls as zero or establish completeness.

The verifier independently recomputes all derived fields and compares the complete document. Retained normalized values are copied and recursively frozen. Input limits bound roots/reductions/items and total document bytes.

24 focused cases pass, including split origins, remaining-only amounts, exact bigint limits, evidenced zero versus unknown refund limits, over/underallocation, duplicate identities, chronology and tampering. The normalization component alone is not persistent storage or authority. The held storage implementation below now retains it; approval, posting, financial activation, complete export/restore acceptance and runtime routes remain unfinished. Canonical138 and financial history remain unchanged.

## Held persistent source commands

Unregistered migration20270202180000 creates three forced-RLS, append-only tables: original receipt identities, customer obligation identities and per-worksheet schedule revisions. Stable origin IDs bind the original namespace/external ID; namespaced external IDs cannot acquire a second origin. Stable item IDs bind origin plus actual same-business customer. Wrong customer/origin identity cannot be silently reassigned; a changed item requires a distinct identity. These draft-source identities are not final global external-money registrations or funded financial roots.

Save resolves the latest worksheet and expected schedule revision under the existing fresh finance.post authority and exclusive finance-control fence. Database validation independently verifies dates, positive exact amounts, retained evidence, aggregate conservation and refund ceilings. The operation hash binds original inputs and recovery epoch; exact replay returns its original receipt after later revisions. Changed payloads conflict. Lookup and explicit absent-operation retirement preserve unknown-outcome handling. No journal, payment, bank movement, refund authorization or opening approval is created.

Every revision carries the original operation/actor, SHA256 of exact PostgreSQL evidence text, predecessor and deferred matching operation-result/audit delta. Newly inserted identity rows must belong to a saved schedule from their creating operation; orphan identities cannot commit. Update/delete/truncate are rejected, including privileged history edits. Failed saves roll back their identities, operation and schedule together. Empty source schedules never clear the parent worksheet's unknown customer-funds control.

Private export-role function opening_funds_source_snapshot requires a read-only repeatable-read transaction. It retrieves all columns of retained origin/item/revision rows, original receipts and exact evidence text, in explicit order, under tenant filtering. Capacity overruns refuse rather than truncate. Web/finance-preview roles have no direct source-table or snapshot access. This is an explicitly unregistered domain candidate, not a complete business export: the138 exporter/backup profiles have not been extended to cover these tables. The trusted export orchestration must retain its existing authorization/handoff fences. CSV packaging, neutral reconstruction and independent restore remain prerequisites for adoption/activation.

Native1/1 passes on e1b1edaa142638db89ab7140870e4b6fb4e7ee93 against actual disposable PostgreSQL138 plus the held migration, controlled provider/session authority (not genuine hosted MFA). Proof: .local/opening-funds-sources-export/result.json. It exercises two customer items per origin, normalization parity, unknown/evidenced ceilings, save/replay/lookup/revision/read/retirement, stale worksheet/schedule, wrong-business and recovery epoch, customer/origin rebinding, receipt aliases, conservation/refund limits, direct-table denial, retained-history guards, deferred orphan rejection, full private source history/hash parity and empty other-business export. Financial/period row counts and the138 registry remain unchanged. Source stayed unchanged through the run and owned test cleanup was awaited.

Original failures remain in .local/opening-funds-sources (SQL generation replacement-token corruption), -fixed (fixture sent a PostgreSQL array instead of JSON), and -json (fixture expected permission-denied rather than the existing retained-history error). Corrections preserved business/security guards. The narrower storage/retention check also passes on67603f4 in -retention. No original failed run is relabeled accepted.

Next: portable domain packaging/reconstruction and independent recovery, integrate saved funds into the held opening context and owner screen, then complete all remaining opening source classes, immutable approval and atomic posting/correction. No139 registration, deployment, provider activation, real data or spend is authorized by this candidate.

## Portable files and neutral reconstruction

Held migration20270204180000 adds a separate export snapshot v2; the existing v1 remains unchanged. It retains the original save and retirement operations plus their audit records through narrowly scoped existing export-role column grants/RLS. Operation/audit scalar values use PostgreSQL text, with UTC six-digit timestamps. Revision bigints become text inside PostgreSQL before JavaScript sees JSON numbers. Snapshot limits fail rather than omit records.

buildOpeningFundsSourceFiles verifies receipt/evidence-text hashes, normalization, contiguous worksheet-specific revisions, original operation-result/audit deltas, retirement decisions, tenant and retained origin/item/customer bindings. Each durable identity must occur in its creating saved operation. Supplied parent worksheet dates and customer identities must match; these caller-supplied verified parents are consistency inputs, not new authentication or proof of undisclosed source completeness.

Ten files include five all-text CSV tables, original source JSON, dictionary, formula-escape map, a neutral PostgreSQL reconstruction script and a SHA256 file manifest. CSV preserves null versus literal backslash-N, exact money/revision strings and quotes/backslashes. Formula-leading text is escaped with a reversible row/column map using the established decoder. The SQL creates a separate inspection schema in an empty database, with internal operation, origin/item, audit and predecessor foreign keys. Existing target schemas refuse. Business, actors, customer and worksheet parents remain explicitly external; no application roles/sessions/provider functions or posting behavior are restored. Both completeBusinessExport and completeBackup remain false.

Native1/1 passes on a25446af5f2e785c3358b4f3cf48d3c625b0a745 in .local/opening-funds-portable-bound/result.json, source stable and owned cleanup awaited. Actual PostgreSQL138 plus held proposals, controlled authority only. Exported CSV and independent neutral SQL reconstruction agree across all five tables, including every retained operation/audit field. Manifest hashes, formula-leading receipt identity with quotes/backslashes, existing-target refusal and missing audit/origin/parent or changed evidence refusals pass. Existing source/storage/context/financial-unchanged checks remain included. Original13977da failure (PL/pgSQL result variable collided with the selected operation result column) remains in .local/opening-funds-portable; variable renamed, no integrity guard weakened. Full typechecking and targeted lint pass.

This closes the new domain's local portable reconstruction component. Integration into the complete business export/download profile, encrypted application backup and independent active-application restore remains required before migration registration/real use. The public102a release is fixed while its exact-head workflows run; this newer source is unpublished.

## Encrypted separate-cluster application-schema rehearsal

Native1/1 passes on930a6b42fb6b15d06a7452f45b0a2ef6a54ab29f in .local/opening-funds-restore-flat/result.json, source stable and owned cleanup awaited. The fixture captures an exported read-only PostgreSQL snapshot, all application/provider fixture table inventories, schema, closed role definitions and creation order. A custom-format database dump is age-encrypted; wrong-key and tampered-ciphertext decryption refuse. The complete decrypted dump is checksum-compared before restore SQL executes.

A second disposable PostgreSQL cluster receives recreated closed roles and an empty destination database. Restored table inventories, exact normalized schema and role definitions match the source; only the existing verified policy-role presentation normalization and random pg_dump restriction nonce normalization are used. The retained138 migration registry is unchanged. Saved deposit receipts, original save/retirement/audit history and portable-file construction survive; ordinary web access remains denied and privileged history alteration still refuses. Actual function presence is checked. Both clusters/private synthetic keys are cleaned up. All data and provider/session authority are fictional; no application server or real traffic is exposed.

The original e3ead30/45d1238/286cd65 restore failures remain in .local/opening-funds-restore, -policy and -diagnostic. The specific difference was PostgreSQL reparsing the origins external-ID length BETWEEN predicate into a flattened AND during restore. The held source CHECK now spells the same lower/upper bounds directly, preserving1..200 and every other condition. Exact schema comparison passes without excluding constraints or regenerating the138 baseline. Full integrity/permission guards remain. Targeted lint passes; the final later commit only trims whitespace/documents acceptance.

This is a held-source rehearsal, not production recovery acceptance. The new tables/functions are still unregistered and the current138 backup/export catalog pins intentionally do not adopt them. Complete business export/download and encrypted backup profile integration, compatible configuration/originals, restored session/credential invalidation and controlled reopening, off-host/key-custody/owner acceptance remain required before actual use. No completeBackup or productionReopenAccepted flag is granted.

## Existing read-only backup capture integration

Held migration20270205180000 grants only SELECT on the three new source tables to the existing crest_backup_reader. It creates no login, membership, routine, sequence or write grant. A disposable genuine database login assumes that role without inheritance/superuser privileges. Existing verifyRecoveryBackupReader passes for the unchanged138 migration registry, rejects writes and denies execution of the deposit export command. With the existing advisory/schema lease and authentic read-only repeatable-read snapshot, captureRecoveryDatabaseInventory obtains all three tables with exact1/2/2 origin/item/revision row counts, forced RLS, expected owner and database-side sorted row fingerprints. Sensitive inventory contents are not printed.

Native1/1 passes ondf4d066f516fb0664f0ef81cb8ad278b4670cf29 in .local/opening-funds-backup-reader-bound/result.json, source stable and owned cleanup awaited. The same run repeats the portable reconstruction, opening context, guards and encrypted separate-cluster recovery including the new SELECT grants. The original5f4719d fixture return-shape failure remains in .local/opening-funds-backup-reader; accessing the existing lease result.value fixed the fixture without changing capture semantics.

This connects the held tables to existing private inventory mechanics. Current138 catalog/profile pins and the registered source exporter remain unchanged and do not claim compatibility with the held additions. Next: coherent candidate migration assembly/coverage/catalog/export/restore profile integration and registration acceptance, then the owner screen. Complete backup/real activation flags stay false.

## Coherent migration139 candidate

openingFunds139Candidate assembles all five held proposal parts into candidate version20270205183000_fictional_opening_funds_sources.sql, in dependency order, with explicit RESET ROLE boundaries and byte offsets/lengths/SHA256 for every original part. It pins the prior138 registry hash9d4864f71e8641a6972b4a5db4b1e47bf58f3917ebab34f27e1802226d72236a, preserves every earlier migration entry and writes the139 candidate only into the owned disposable source directory. The root migration registry and historical baseline files remain unchanged. The shared coverage declaration adds exactly the three new source tables with all columns required and none excluded.

Native1/1 passes on180f251909d10591f43e5bb3520da61ccb5e0553 in .local/opening-funds-candidate139/result.json, source stable and owned cleanup awaited. The root test title identifies the139 coordinator-upgrade scope; the wrapper's older138-plus-held scope boilerplate is historical and does not redefine the executed test. The actual coordinator upgrades populated138 to candidate139. Every pre-existing table inventory is unchanged except the expected migration-ledger addition. Complete column-coverage validation passes against actual catalog columns. New saves/replays and context binding work, preserving unknown opening status and false posting authority.

A real restricted backup login validates the139 candidate registry and obtains routine/schema catalog observations plus whole-database inventory through the existing leased snapshot. The new three tables are present. Encrypted separate-cluster recovery matches the candidate schema, roles and rows, retains139 migration history and reconstructs the saved source export after restoration. This extends the previously proven unregistered-slices rehearsal to a coordinated versioned upgrade.

This is not root registration/adoption, hosted genuine-MFA acceptance, a complete portable business export or production backup/reopen approval. Next: reviewed exact139 catalog pins and complete business export/backup/restore profile integration, current-versus-frozen138 compatibility, then migration registration/runtime/owner-screen integration. Full P27 source classes, approval and atomic posting/correction remain required.

## Full-instance candidate export with exact catalog pins

Source profile opening-funds139-source-profile.ts retains the observed candidate registry1925b449bd75ebe9dd3a9a01b55f7eb0f33f993a88dfca5b96b55b4fbc0f7a7a and migrationdc1f24a26ff12e0b599f779faf5d9c733c9f297b327fff40ca8031c9acfe9136. Candidate routine count1283/hash ef066f0a38815c2c6fce0d1d7ab8deb889c873015178ce8538782f1307f28edb and schema object count15610/hash5fa17ef8a646bc878c3ed97d8d914c9243fe1a3c09107956033283a4646a64d0 come from the actual restricted snapshot observed onc16817d, with successful coordinator/restore proof .local/opening-funds139-catalog/result.json. Original138 baselines are unchanged.

The named candidate producer retains existing restricted-reader preflight and source/snapshot lease controls, admits exactly139 migrations with the expected final version/name, compares actual routine/schema fingerprints, requires the exact192-table inventory, checks all required/excluded columns and primary keys, and reads every included value as PostgreSQL text. Declared foreign-key capture now uses the selected fixed reviewed inventory; candidate roots/items/revisions and their parent references undergo the same snapshot orphan checks. Callers cannot supply arbitrary source lists. The existing138 producer remains separate and refuses a139 candidate.

The named candidate formatter produces196 files:192 source CSVs and dictionary, escape map, neutral SQL and manifest. Manifest source version139, candidate profile, unregistered status and migration hash remain explicit. Credential exclusions and incomplete logical/external-reference/completePortableExport/completeBackup flags remain. The existing138 formatter refuses candidate captures rather than relabeling them as138. File scope is the private instance operator, not a browser download or proof of all physical original files.

Native1/1 passes ona3af373669a74258eeeaaa0c30731bfea52402cc in .local/opening-funds139-instance-export/result.json, source stable/owned cleanup. Before upgrade, actual138 capture/format still returns189 sources/version138. After populated coordinator upgrade, the restricted candidate producer/formatter returns192 sources/196 files, includes positive data in all3 new tables and verifies their declared references. Every column of every candidate source reconstructs exactly into an independent neutral SQL database. Changing a real function COST forces catalog-stage refusal; no retry or relaxed fingerprint accepts it. The same case retains full139 column coverage, saved-source behavior and encrypted separate-cluster exact schema/roles/rows recovery. Types and targeted lint pass.

Remaining integration: encrypted capture/restore candidate-profile acceptance and frozen138/current139 compatibility, registered source/download profile and authenticated server/client contracts, formal139 registration/release, then owner screen. This does not make the production vault/catalog, session invalidation/reopening, complete backups or real business activation complete.

## Version-bound recovery components

Recovery compatibility now uses an explicit138-or-candidate139 profile rather than a numeric range. Existing138 component parsing remains compatible; canonical post-restore checks still require its original exact registry/routine/schema baseline. Candidate139 requires registry1925b449... and the separately retained139 fingerprints. Unknown versions or139 registries refuse. The data-only catalog can be imported by recovery tools without importing the application runtime.

Configuration recipes, archive/retained-object headers, recovery-run composition, release-distribution validation, offline run preparation and restored database/finance/account-control comparison carry the exact selected source version. Version139 release compatibility and build identity must agree and remain blocked for production. Database comparison no longer labels a139 result138. Original-file inventory accepts139 only with the exact candidate final migration version/name. Root command/adoption and actual release compatibility remain138; no candidate login, deployment, automatic success/protection marker or production activation is introduced.

Twenty-one focused profile/configuration/run/refusal cases pass, including seven new cases for exact139 binding, unknown-version/hash refusal, configuration reconstruction without external-material approval and consistent blocked release identity. Full types, targeted lint and a plain Node data-only import pass. Initial new test failures were fixture API assumptions (forOperator versus existing forRecoveryTools, and a candidate-parser return wrapper); fixtures were corrected without weakening the production checks.

Native1/1 passes on43c82bc55bc866f822b8fb06bb8275bcfcd66922 in .local/opening-funds139-recovery-profile/result.json, source stable/owned cleanup. Actual candidate139 original-file inventory and financial controls now execute through the restricted snapshot, matching the selected canonical139 routine/schema profile. The fixture has no attached originals or posted events: zero pending/empty originals and balanced fictional ledger are verified; this does not prove populated original-store transport or full financial reconciliation. Existing populated138-to139/source export/reconstruction and encrypted separate-cluster schema/role/row recovery remain included. The later commit extracts identical catalog constants into a data-only module and passes the focused checks; no SQL/catalog/baseline change.

The full production capture command, actual139 release/source/image artifacts and complete coordinated vault/object/configuration restore still need integrated acceptance before139 registration/installation. Existing138 baseline hashes and all security/incident/reopen/full-backup gates are retained. No claim that these component changes alone complete backups.

## Coordinated139 run with populated originals and financial events

The existing registered138 backup-reader rehearsal now also runs a candidate139 family, retaining every original138 case. Candidate139 upgrades the same populated original/financial fixture through the coordinator, adds a saved opening-deposit schedule and checks the192-source export. The candidate source package is a separately committed temporary Git repository containing the exact139 registry/migration and blocked139 compatibility; source archive/build identity match those real committed bytes. It is not mislabeled as the root138 commit. Image bytes remain explicitly synthetic, never a compiled Crest image, loaded application or production release claim.

The coordinated run now binds configuration to the actual point schema version, encrypts and retains the database, metadata, six published originals, two quarantined objects, source/image fixture archives and configuration references, then restores in a fresh process/database. Existing source/financial/account-control verification, object destination reservations, uncertainty handling, no extra vault writes during restore, wrong-source/missing/corrupt material and changed-image/lost-lease refusals remain. CompleteBackup, physical independence, actual image identity, security/reopen and full business reconciliation flags remain unapproved. Windows uses the documented publication/journal seam; Linux durability is not inferred from this run.

Native22/22 pass onc528a6cbb581595bfc5c774c70e185680a1ca013 in .local/opening-funds139-coordinated-bound/result.json, unchanged source/owned cleanup and zero skipped cases, about132seconds. This is the focused candidate139 family, not a rerun/acceptance transfer for the separate registered138 family. Types/targeted lint pass. A subsequent edit only corrects the139 export subtest label.

Original failures are retained: .local/opening-funds139-coordinated-run stopped3 run cases during temporary Git indexing on Windows long paths; -longpaths advanced packaging but correctly rejected a configuration fixture still labeled138 before any artifact write. The temporary repository alone now enables core.longpaths, and the recipe uses the point's actual version. No global Git setting, compatibility guard or expected artifact count was relaxed. A launch attempt with a mistyped checkout directory was rejected by automatic review; the correct absolute checkout, clean source and wrapper hash were verified before the authorized disposable run proceeded. No rejected action was executed.

Next: actual139 application/image artifact acceptance, release/runtime/schema registration and owner-screen integration, plus retained recovery security/incident/off-host/key-custody/provider/complete-catalog gates and all remaining opening/posting/launch scope. The root installation and schema registry remain138.

## Actual candidate image and private-screen actions

The actual139 application image now builds from separately committed candidate source,
with compiled build identity matching the image's identity file and139 registry.
Native build checkpoint d05dd042826b1a400313f2368fbf427037fb1cf7,
`.local/opening-funds139-image/result.json`: non-root identity probe and closed-default
health/auth/business startup pass. Image ID
`sha256:13444d320d74cb36c66639ac40f538f3c4697dfe75e0ebf23c918f77da2985c0`;
archive237089792bytes/SHA828bf148220ea6e5318ba51b9ecfb26645de2168829b8cc15a112143e93cf5bf.
The retained source archive/build identity are recorded alongside it.

Four native image-identity cases pass at e54d40a7788c851051e2a9507bf46e841c2dc258,
`.local/opening-funds139-image-recovery/result.json` and `test.log`: age-encrypted
archive recovery/load and compiled/file identity, foreign capability/build refusal,
altered archive refusal/exact repair, and cancellation before container creation.
The original image/source artifacts remain available; temporary probes/keys cleaned.
Same host/disk vault fixture does not establish independent-host/provider/retention
acceptance. The wrapper's inherited scope prose refers to an older database runner;
the four actual TAP cases are the image-only execution evidence. No139 installation,
root registration, production reopening or complete-backup claim.

`opening-funds-contract.ts` now owns browser-safe source normalization; the original
server module reexports its API and retains independent deep verification. The new
schedule contract validates saved evidence, derived totals/unknown refund ceilings,
business/worksheet/operation identity, exact bigint revision strings and uncertainty
states. Saving raw input copies it after validation; no evidence or balances persist
in browser storage through this contract.

The existing finance HTTP dispatcher now has explicit default-off `openingFunds`
capability (requires openingWorksheet), four private read/save/lookup/retire routes
and a context capability header. These reuse the existing fresh session, origin,
CSRF, rate admission, session edit binding and restricted financial transactions.
Save acknowledgments require exact expected normalized evidence, worksheet, actor,
operation and next revision before transaction acknowledgment. Malformed database
responses remain an uncertain outcome, not an invitation to submit another save.
Lookup/retirement use current review epoch while preserving original operation epoch.
The existing128KiB HTTP ceiling and source/storage validation limits remain distinct;
oversized requests refuse before execution. No global parser limit was raised.
Matching client methods use fresh proof/no-store requests, receipt validation and
no automatic retries. Runtime feature configuration and owner UI remain unconnected;
there is no production enablement or new financial posting behavior.

85 focused unit cases pass across7 files, including browser bundling without Node
shims, source/receipt integrity, HTTP/client boundaries and adjacent financial flows.
HTTP authority/DB seams here are mocked: genuine-session candidate139 integration
and screen/device acceptance remain required before enabling these actions.

## Connected owner screen and genuine-session execution

The saved opening worksheet now shows the customer-deposit disclosure only when
the authenticated context advertises openingFunds. Existing production feature
registration remains closed. The screen loads the current saved schedule, reopens
validated raw inputs preserving origin/item identities, reviews original receipt
and historical reductions, supports multiple customer allocations and distinguishes
unknown refundability from documented zero. Retained origin references are locked
when editing; updates create revisions. Only opaque operation/epoch references are
stored per tab. Drafts and evidence clear on hide/page transitions/disclosure close.
Unknown saves require original-operation lookup and explicit audited retirement
before another attempt; there are no automatic retries. Saved JSON downloads
recheck current authenticated access and saved revision identity.

The disposable genuine-provider fixture alone upgrades the actual registered
prefix to the exact139 candidate before enabling this capability. Its scoped
loopback HTTPS request helper holds the test session in a closure, returns no
credential and changes no trust store or global TLS policy. The production runtime
feature register, installed schema and real-data activation remain unchanged.

First native run7855725 found the new stale-revision SQLSTATE marker was not yet
included in the restricted database boundary, so the actual safe rollback became
an uncertain503. Exact opening-funds SQLSTATE/message pairs now cross only after
an acknowledged command rollback; unexpected private/audit failures stay generic.
The existing confirmed-rollback regression cases pass unchanged. Original failed
proof `.local/opening-funds139-ui-auth` remains. Corrected034031e reaches all HTTP
assertions but cannot find the screen in an old production Next client bundle;
`.local/opening-funds139-ui-auth-rollback` remains too. The fixture intentionally
serves a production client build, so the actual current Next+server application was
rebuilt, not the screen assertion or timeout weakened.

Actual build and native genuine-MFA/HTTP/Chrome1/1 pass on
53bc550871330ea16aae9a95e461ec554f5c1484, source stable/owned cleanup:
`.local/opening-funds139-ui-build/result.json` and
`.local/opening-funds139-ui-auth-built/{result.json,test.log}`. The test exercises
real customer creation, worksheet/bank evidence,10000-cent remaining deposits
from15000 received minus5000 historical application, save/replay/stale409/conflict,
read/original lookup/absent retirement, documented-zero revision2 and phone edit
revision3 restoring unknown refundability. Original receipt reference stays locked.
Financial event/journal/period counts do not change; logout/revocation denies read.
390/1440 viewports have no horizontal overflow and no serious/critical scoped Axe
findings. Retained screenshots `deposits-390.png`/`deposits-1440.png`; phone image
visually inspected. This is Chrome viewport evidence, not physical iPhone/WebKit
acceptance,139 installation, full source approval/posting or complete backups.
88 focused unit/native-import cases, types and targeted lint also pass.

## Version-bound operator command delivery

Release review found that the139 instance formatter's manifest still listed the
138 schema fingerprint while its capture already verified the correct139 schema.
It now writes the selected139 fingerprint. The native regression compares the
complete canonicalDefinition: registry hash, routine count/hash and schema count/hash.
The previous138 formatter path and baseline bytes remain unchanged.

`readRecoveryCaptureRegistry` recognizes only the exact reviewed138 and139 raw
registry hashes, returns the fixed migration list and rejects count/name/version/
checksum/byte drift. Capture command configuration/attempt headers now use this
selected version and require matching application release identity. This removes
the138-only command assumption without accepting a numeric schema range, changing
the installed registry or granting database upgrade/reopen authority. Full-instance
operator request version2 can select the139 capture/formatter; the legacy request
cannot quietly export an incomplete139 dataset.139 delivery reports192 sources,
196 files and explicit candidate/unregistered/incomplete flags.

Native1/1 PASS at95ed927f13849499b5616a15c0dfbc93ac7fcafa,
`.local/opening-funds139-command-bridge-longpaths/result.json`, about55seconds,
stable source and awaited owned cleanup. It executes the real operator command
from a separately committed139 source package against its actual restricted reader
login, writes/reads all196 delivery files, compares manifest fingerprints and
refuses the legacy request. Existing populated138 upgrade, every-column neutral
reconstruction, exact catalog/drift checks and encrypted separate-cluster recovery
also pass in the same root case.17 focused registry/profile/inventory units, full
types and targeted lint pass. Actual Linux capture-command dispatch, provider
authority/retention, off-host/keys/reopening and full backup acceptance remain open.

Original6870c1d proof `.local/opening-funds139-command-bridge` is retained: the
longer Windows fixture path made Git init fail before the repo-local longpaths
setting could be applied. Initialization now passes core.longpaths=true on that
one Git invocation, then keeps the existing repo-local setting. No global Git
configuration, source fingerprint or refusal assertion was relaxed.
