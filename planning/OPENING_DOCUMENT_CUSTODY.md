# Opening document custody

Opening source records currently retain `{reference,sha256}`; the file picker
only hashes local bytes. A selected file is not an uploaded or recoverable
original. ACCOUNTING12 requires retained supporting evidence without importing
historic transactions into the live ledger.

Implementation decision: add a nonposting opening-document intent and immutable
publication record. Keep existing opening reference/hash pairs and their saved
history unchanged. A document is not a supplier bill, expense, receipt of money
or journal entry. Do not manufacture an ordinary supplier draft to obtain its
attachment storage. The same document reference/hash can support opening bank,
AR, funds, supplier or other evidence; attachment custody alone verifies none of
their financial assertions.

Reuse the existing supplier-document storage and isolated JPEG/PNG/HEIC/PDF
validation boundary. The web application only reserves/authorizes bounded
uploads and reads; the isolated document worker publishes verified candidates.
Publication must match the intent's exact reference, SHA-256, media type, byte
size, business, recovery epoch and original actor. Bytes cannot replace an earlier
publication or silently change a saved opening reference. A fresh original read
must reauthorize after object I/O, as existing receipt/supplier reads do.

The two new retained tables require a migration, RLS, operation/audit closure,
immutable histories and source export/recovery coverage before registration.
Sharing the supplier-document bucket requires exclusive attachment IDs across
ordinary supplier intents and opening intents, including concurrent reservations;
neither source may alias another's storage keys. No new provider account or
posting privilege is required. Staging candidates remain unverified until the
existing isolated decoder and immutable-object checks finish.

Construction uses fictional records and loopback storage only. Production routes,
opening approval and complete-backup claims stay held until the complete storage,
authenticated UI, download/export/recovery and current-release checks execute.
Manual references remain supported as explicit outside-file evidence; they must
never be displayed as a file stored by Crest OS.

Implemented held20270218180000 adds the two immutable tables, private reservation/
read/write/publication functions, operation replay/conflict checks and deferred
audit/result/payload closure. Scoped shared-bucket ID locks/triggers on both
opening and ordinary supplier intents prevent aliasing. No new login or posting
function is created. Only the precise explicit audit-ID INSERT and three SELECT
columns needed for closure extend the existing closed owner's column grants;
the row policies remain business/actor/command scoped.

The new workflow adapts the existing validated receipt byte pipeline, checking
the opening fingerprint before publication and reusing private verified reads.
An internal self-parent receipt binding does not create an expense or supplier
bill. The browser-safe reserve contract rejects arbitrary keys/candidates and
unsupported types/sizes. The authenticated directory and separate-worker
dispatcher are implemented, explicitly test-only. Each call freshly verifies the
owner/provider/session, pins the business and uses the restricted transaction
adapter; worker dispatch requires a separate login on the same database.

Native1/1 passes on6c0adac (`.local/opening-document-custody-accepted`), source
stable/owned cleanup: actual PostgreSQL roles/RLS/commands/audit, real generated PNG
validation, immutable object candidate publication/read, same-ID replay and changed
payload conflict, foreign-business/web/wrong-worker refusal, fingerprint mismatch,
cross-domain key-ID collision, retained-history refusal and explicit orphan-audit
rejection. Supplier bill, payable, financial-event and journal counts remain
unchanged. Object storage is an explicit in-memory seam and validation runs inline;
this is not actual provider, isolated-worker transport, genuine MFA or recovery
proof. The first run identified the missing explicit audit-ID permission, fixed
narrowly; two subsequent fixture assertions were corrected to use the existing
55000 retained-history code and schema-qualified deferred trigger name. Earlier
failure logs remain retained.

14 focused metadata/adapter-construction checks pass, with types and affected
lint. The new directory's genuine Auth/HTTP/worker execution still needs a fresh
integration check. Root remains registered141: the held document tables are not
yet registered, routed, shown in the file picker, or integrated into scoped
exports/original inventories and full recovery. Those steps must precede142
adoption and any production activation. Existing141 image/build proofs predate
this held implementation and are not relabelled as exact-current-source proofs.

Protected test-only reserve/upload/verify/status/original/preview HTTP routes are
now connected to the Node server. They enforce the existing trusted origin,
session cookie, CSRF, admission, exact JSON fields and bounded file stream. The
upload capability stays on the server and its destination must match the pinned
staging origin. Only one-use verified binary responses use the large-file writer;
ordinary metadata keeps its small limit. Direct ordinary supplier-original reads
now enter that same binary reservation path, fixing an omitted original variant.
Unconfigured/encoded opening-document routes return private unavailable responses
and cannot fall through to Next. Production configuration refuses the held runtime.

The private finance context advertises an opening-document upload header only
when the test runtime and opening worksheet are configured. The browser context
parses this optional capability; this does not yet make the picker upload files.

Genuine MFA/HTTP/SQL/SDK acceptance1/1 passed on078bb14, source stable/owned cleanup
(`.local/opening-document-http-auth`). It uploads a generated PNG larger than16KiB,
publishes through the separate worker adapter and retrieves exact private bytes.
Same-operation replay, changed-payload conflict, missing CSRF, arbitrary business/
object-key input, Range, fingerprint mismatch, corrupt bytes and session revocation
are checked. Failed verification remains reserved; published count stays1 and
financial event/journal counts do not change. The decoder is an explicit inline
fixture seam, not the isolated worker transport or real provider acceptance.

Full current unit suite10074/491 files passed ond5977f2, source stable
(`.local/opening-http-unit-suite`), with current types and affected lint. Its new
default-route denials also cover encoded paths. Historical141 adoption exposed
older fixture assumptions: supplier140 now runs its own archived140 CLI, held AP
tests start from frozen140, recovery command fixtures use frozen140 registry/
compatibility and current supplier UI fixtures apply registered141 once rather
than replaying held SQL. The140 helper clones its frozen139 prefix and accepts
only the exact known141 registry. No historical checksum or acceptance guard was
relaxed. Calendar138/held AP source cases passed onf7c92f1; supplier140 passed on
e5b43d0 (`.local/registered140-frozen-regression`).

Public108 main45652741276 failed its Calendar138 inventory check; it was reading
the moving current coverage for a frozen138 database. Both reads now select the
independently frozen138 coverage, and that case passes locally. All21 prerequisite
jobs passed; the later missing screenshot artifact follows skipped build/browser
steps and does not certify the release. Commercial and expense108 passed. Fresh
current hosted release acceptance remains required.

The reference/hash lookup and private browser picker are now implemented. Pending
saves retain document/reserve/verify IDs in memory, including an uncertain reserve
response; retry checks status first. A paused write context still permits a read
without issuing another reserve. Reopening a saved bill locates its published
original by its unchanged reference/fingerprint, without requiring the selected
File to survive navigation. Downloads verify exact bytes before exposing a
temporary user-activated link; unmount/pagehide removes private Blob URLs.

Genuine MFA/rendered acceptance passes onbc3117c
(`.local/opening-document-picker-final-auth`): actual committed reserve followed
by interrupted response, same-ID retry, upload/publication, saved bill reload,
lookup and exact original download.390/1440 Axe/overflow and minimum220px field
checks pass; both screenshots were inspected. The Next/server build passes on
e21bd9e (`.local/opening-document-picker-final-build`); bc3117c is test-only after
that build. A preceding export-fixture preamble failed with
SOURCE_EXPORT_RUN_REVIEW_REQUIRED; later complete runs passed, but its root cause
has not been established. It remains recorded, not explained away as a picker bug.

Held recovery-read SQL grants only SELECT to the existing closed backup reader.
`collectOpeningDocumentOriginalInventory` streams bounded cursor pages in the
caller's transaction, rejects orphan/duplicate/substituted records and binds each
original/preview to its reserved reference/fingerprint. Published files retain
`crest.opening_document_originals` as their source; the shared supplier-document
bucket remains unchanged. Pending staging is explicitly unverified. The collector
does not read file bytes or claim a complete backup.

Literal coverage contains every column of both tables, with no exclusions, and
extends the proposed instance inventory196→198. Native custody/backup-reader and
exact database-column acceptance passes on457463b
(`.local/opening-document-source-inventory`), with unchanged financial counts and
owned cleanup.33 focused units, types and affected lint pass. Registered141 and
its original inventory remain unchanged; this is not yet a142 archive/restore.

The held owner dictionary/page v4 now adds the two opening-document sources to
the existing174-source v3 dictionary, yielding176. Exact projection grants and
forced business row policies reuse the existing export reader; the web role
cannot execute it. The old dictionary and page stay unchanged. Pagination uses
the same bounded repeatable-read, read-only transaction and snapshot token rules.

An explicit142 capture selects only page v4. CSV, Excel generation and neutral
SQL formatters accept its separate `crest.current-business-rows.v4` profile;
v3 binds only141. The attachment inventory represents these originals as the
existing physical supplier-document kind but retains
`crest.opening_document_intents` as its actual source. Its bill ID and revision
are null; document reference and candidate fingerprint remain exact. Global
attachment-ID/path collision checks apply across ordinary and opening records.
Older inventories do not gain opening records.

Native acceptance passes onf3c29f8 (`.local/opening-document-portable-source`):
all176 sources captured, exact opening-original CSV roundtrip, Excel generated,
neutral SQL executed in a separate empty database and candidate JSON recovered
unchanged. Published/pending attachment distinction, truthful source/null bill
references, pagination, snapshot mismatch/limit/unknown-table refusals, another
business's empty result, web-role refusal and original174-source dictionary are
checked. Existing custody/backup-reader tests pass with unchanged financial
counts and owned cleanup.43 affected units, types and affected lint pass.

The held142 export job writer v8, worker, collector and original reader are now
connected. Its private original helper v2 reads opening publications under the
existing business-source policy, preserves object ID/reference/fingerprint and
delegates ordinary sources to the unchanged original helper. The public reader
selects v2 only for142 jobs and still requires exact membership in the frozen
committed snapshot, a fresh authority check and a committed access audit before
handoff.141 and older jobs keep the original lookup path.

Client profile/logical-file/controller checks explicitly admit142 and continue
to refuse143. Opening source-table inventory entries are permitted only under142
and must have null bill ID/revision. No new physical storage kind or fabricated
bill is introduced. Production source composition still refuses unregistered142.

The five held SQL parts are assembled in a disposable candidate142 directory;
root141 remains byte-for-byte unchanged. The helper verifies the pinned root
registry, full ordered prefix identity and every prefix SQL hash. It does not
rewrite the independently serialized sandbox prefix registry.

Native acceptance1/1 passes on83cd283
(`.local/opening-document-ready-export-accepted`), source stable/owned cleanup:
actual141→candidate142 coordinator, request/replay versus old-version conflict,
176-source collection, encrypted export parts and Ready transition, exact frozen
original permit, audit COMMIT before delivery, exact original bytes and cleared
owned buffer. Pending/outside-snapshot, foreign business and tampered audit
requests refuse. Existing source-format/reader/custody/backup checks also run;
financial counts remain unchanged. Original bytes use a memory seam; encrypted
parts use the loopback SDK fixture, with controlled SQL auth and inline decoder.
This is not142 genuine MFA/HTTP/browser or actual-provider acceptance.

202 focused checks and a second227-case group (one overlap), types and affected
lint pass. Prior failed runs are retained:2187134's prefix-manifest formatting
assumption was replaced with full ordered identity and SQL-byte verification;
12c310e exposed a missed142 collector constructor guard, corrected on83cd283.
No registered migration or historical acceptance hash was changed.

Genuine142 Chromium acceptance passes onaffa1ef
(`.local/opening142-original-browser`), source stable/owned cleanup: real password
and TOTP, actual Next/HTTPS dispatch,210 physical encrypted parts, opening-intent
CSV including the retained reference/fingerprint, and a four-original ZIP whose
contents/hashes match and whose pending count remains1. Local comparison verifies
the ZIP. Each delivered file has a committed access audit bound to the frozen
generation/inventory. Pending requests, absent CSRF, injected business input,
corrupt opening bytes and revoked session refuse.390/1440 Axe/overflow checks
pass and both screenshots were inspected. WebKit142 is written but not executed
locally. Providers/storage are loopback fixtures; the decoder stays inline.

The actual Next/server build passes onaffa1ef
(`.local/opening142-browser-build`), compiled source release
debf24c1845bb0a2a19c3d359b35b0a81ed8421c, still registered schema141.142 is
explicitly nonposting and retains financial vocabulary109;143 remains unknown.
Production source activation still refuses142.133 Node/financial/production
checks pass after the test-only35287bc follow-up; types and affected lint pass.

Closed-reader142 catalogue observation passes on30260b9
(`.local/opening142-recovery-catalog/opening142-catalog-observation.json`), with
owned cleanup/source stability:198 application sources,226 database tables,
intent/original row counts2/1 and opening original+preview metadata with one
pending reservation. Observed candidate registry is
3d215728bdcf52da73eefe4f1c4a6a5bcb682cbd947b178939f1d7175add5279,
SQL package dd77400ae479eee8777c4d0a8dfdb3eb15f6d458c9e171e32822c4581e143a7f.
1337 routines hash5c5b782846e2810ccae4f6c4bef98b21fc0d8ad014be5b152f1862d47d9a0264;
15982 schema objects hash09788b835bc3ed37c3767f32e317551a623ecea31ebd769c90f30e9d9fbf00cb.
Part offsets and SHA values are in the local observation artifact. This is an
observation to pin, not a registered archive/restore profile or a restore drill.

The observed142 pins now select a separately branded198-source instance capture
and202-file formatter. Complete routine/schema/table/column/key checks precede
row capture; fixed foreign-key coverage includes the new retained operation and
audit references. Registered141 and earlier capture/format brands stay separate.
The main recovery original inventory now invokes the opening collector only for
the exact142 migration identity, retaining actual source-table identities and
pending staging without inventing published bytes. The shared recovery profile
recognizes only the exact142 registry, with `registered:false`;143 still refuses.

Native source/recovery acceptance1/1 passes ond59e76d
(`.local/opening142-source-recovery`), source stable/owned cleanup:198-source/
202-file export, actual separate neutral SQL reimport, older141 formatter denial,
actual age encryption and loopback SDK immutable-vault original/preview retrieval
and decryption. An encrypted226-table database restores into a separate cluster;
all row inventories,72 closed role definitions and strict normalized schema dump
hashes match. Wrong-key and corrupt-ciphertext refusal remain enforced. Restored
1337-routine/15982-object catalogues match the pinned source, and the restored
main original and pending-staging inventories equal their source values.20
focused checks, types and affected lint pass. Root remains registered141.

The restore rehearsal uses same-host synthetic clusters and loopback storage.
Windows original-vault publication uses the explicitly documented journal seam;
Linux CI uses the actual durable journal. Original-vault retrieval and database
restore are not the full coordinated recovery-point/configuration/release and
primary-object reinstallation flow. `completeBackup` remains false. No current
image or new application build is claimed for this source/tool follow-up.

CI now requires custody/source/recovery and genuine HTTP/picker cases; the142
original-download product loop includes Chromium/WebKit. Public boundary checks
pass on6fe2f9c; hosted acceptance of the newest source remains pending.

Coordinated142 full-point recovery now passes22/22 onad89d2a
(`.local/opening142-coordinated-recovery-complete`), source stable/owned cleanup.
The point contains database/metadata, eight published objects, two quarantined
objects, exact tracked source, a deliberately synthetic image and configuration
recipe. The fresh restore process verifies all table contents, original inventory,
canonical routine/schema/policy/trigger definitions, five financial events across
two posted businesses, account controls and application authority. Ten exact file
destinations restore; an uncertain additional write stays review-required.
Missing/corrupt originals and stores, mixed snapshots, changed image, lease loss,
changed financial source/receivable/contents/registry and reused destinations
remain refusals. No case was skipped or weakened.

Release142 requires blocked activation in both manifest and compatibility fields.
Counts derive from the actual fixture inventory, preserving earlier six-object
profiles. Failed full runs are retained: e922a5f19/22 found old pending/object
expectations; d36c2e320/22 found the last old destination count. Finalad89d2a
passes the entire matrix.24 focused recovery units, types and affected lint pass;
final fixture lint also passes after the last expected-count correction.

This is same-host/loopback acceptance with synthetic image bytes and Windows
publication/object-journal seams. Recovery of the configuration recipe does not
prove actual external material availability, and the actual packaged application
has not been loaded from that synthetic image. Production/off-host/provider/key/
physical-device and complete-backup acceptance remain separate.

Exact current141 migration registry, export coverage and compatibility bytes are
saved in `.local/opening142-registration-baseline` for the next source adoption.
Source142 is now registered without changing the rehearsed package/registry or
any prior migration SQL. Exact141 registry/coverage/compatibility files are
independently frozen. Registered capture/formatter/CLI use a separate142 brand;
the production business-export runtime requires the compiled142 registry and
complete migration identity. The document directory/HTTP runtime itself stays
test-only pending production worker/storage acceptance. Registration creates no
opening approval/posting authority.

Registered source/CLI/restore plus historical141 regressions3/3 pass on369b75b
(`.local/opening142-registered-acceptance`). Full10101 units/495 files, types,
affected lint and migration/canonical checks pass. The original nonprivileged
Windows suite's symlink EPERM and stale139 unknown142 expectation are retained;
the latter now explicitly recognizes142 and refuses143. All units pass with
Windows access sufficient to execute the unchanged symlink refusal case.

Actual Next/server build passes on369b75b, release
b9eb6518ff066eb2242aeb91dfc999fc31a0c217. Actual non-root image84a01109...
builds on3b715ef with that same compiled/file identity and closed startup.
Encrypted actual-image recovery/Docker load/identity4/4 pass, with forged,
tampered and cancelled-dispatch refusals. See OPENING_DOCUMENT142_ADOPTION.md
for full image/archive identifiers. Same-host disk-vault proof only; it is
separate from the22-case point's synthetic-image acceptance.

Next: strict current source publication/hosted release, production document
worker/storage composition and isolated validator/file-format acceptance,
remaining opening approval/posting/corrections and actual provider/off-host/
key/device/owner cutover. No real documents, production installation, provider
financial activation or spending occurred.
