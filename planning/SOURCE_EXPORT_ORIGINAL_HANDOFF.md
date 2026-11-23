# Original-file export handoff

Registered migration 136 adds original-file access for new current business
exports. Earlier 43/134/135 jobs retain their original download contracts and do
not gain this new authority. No financial posting rule changes.

Registered migration 137 corrects a failure exposed by reading a receipt and then
a supplier original on one connection. The earlier function used a polymorphic
record whose byte-size field changed from integer to bigint; PostgreSQL's cached
expression plan then rejected the second read with 42804. The replacement uses
explicit UUID/text/bigint/timestamp variables for every source. It preserves the
same forced tenant policies, named-column grants, function owner, index tuple and
audit protocol. Existing136 jobs retain their frozen membership and identity;
new137 jobs use the separately named v4 request. No previous migration is edited.
The regression reproduces the frozen136 failure before applying137 to that same
database and connection, then checks all three originals through private SDK
reads and committed audits. New137 source capture has its own current fixture.

## Immutable snapshot membership

The worker creates attachment_inventory.json from the same repeatable-read
capture as the exported records. Its immutable plan freezes every eligible
original descriptor and that inventory's SHA-256 in
crest.source-export-original-index.v1. The plan hash binds these to the job,
generation, lease, release and source schema. Only exact members are downloadable.
Reserved or subsequently published files cannot enter an existing export.

Publication timestamps are retained data, not proof of database snapshot
membership. The initial timestamp-cutoff proposal was superseded before adoption;
backdated or future clocks must not change membership. The held proposal SQL is
reference material; the registered migration is canonical.

## Private authority and delivery

The fixed metadata reader uses the existing business-source owner's named-column
privileges and forced business policies for receipt revision 2, published supplier
originals and condition-photo originals. Only the command owner can call that
internal helper. Photos use the dispatch object ID, matching their private store.
No browser request can choose a business, table, object key or filename. The existing /api/business/exports/original route remains the interrupted-request receipt lookup; file delivery uses a distinct address.

POST /api/business/exports/original-file accepts only job ID, generation ID, kind and
attachment ID. It requires trusted ingress, same-origin POST, session cookie,
CSRF proof and ordinary request admission. Server composition uses the existing
three private stores; the route is available only when all three stores and
source exports are configured. Missing composition remains closed.

Each read freshly verifies provider and owner/recovery context. SQL requires a
Ready, unexpired version-136/137 job and exact immutable index membership. The reader
verifies length and SHA-256, rechecks authority, then commits the existing
export.download_access operation and immutable export_accesses audit with the
exact inventory hash, descriptor and generation. It compares the returned scope
before releasing bytes. An unknown commit outcome releases none. There is no
automatic retry of this sensitive handoff.

The route reuses the protected one-use receipt binary transport without wrapping
or mutating its registered Response. Its safe wire filename is
receipt-<attachmentId>.<extension>; the combined downloader must use the frozen
inventory's portable attachments/<attachmentId>/<objectId>.<ext> destination.
Existing uploads did not retain original client filenames; none is claimed.
An explicit completion promise keeps the owned source buffer alive until the
Node writer finishes or fails. Cancellation, time bounds, a two-file concurrency
limit and buffer wiping bound delivery. Ordinary JSON limits remain unchanged.

## Browser delivery and local resume

The export workspace loads the attachment inventory through the existing verified
logical-file reader. Its browser parser checks canonical bytes, the manifest's
inventory SHA-256, business/profile, complete item shapes, portable destinations,
counts and fixed photo/supplier/receipt identities. Its descriptors match the
server's frozen original index. Pending reservations remain visible and excluded.

Available originals are grouped deterministically by attachment ID into ZIPs of
at most 25 originals and 31 MiB of original bytes, with a 32 MiB final archive
limit. Each download freshly checks the existing owner context, supplies only the
job/generation/kind/attachment reference, and verifies response identity, length,
media and SHA-256. Each ZIP retains the original portable paths plus an exact
original_batch.json bound to the export header and inventory hash. Originals and
archive buffers are wiped after preparation. Compression level zero keeps the
work bounded; image/PDF recompression is unnecessary.

The owner explicitly prepares a ZIP, then requests its save within one minute.
The archive save is a separate closed profile: it cannot relax existing CSV,
workbook or physical-part filename/size limits. Prepared URLs and inventory state
are cleared on lifecycle review, disposal or a changed principal.

Selecting saved ZIPs checks their entries and exact batch metadata locally,
then independently checks every original's size/hash. Unknown/duplicate entries,
wrong generations, changed bytes and duplicate selected ZIPs are refused.
Unrelated selected files are counted without reading their contents. ZIP entry
names and declared sizes are checked before decompression. Comparison restores
which batches match; the owner can explicitly download missing/invalid batches.
No automatic file writes, server uploads, durable browser progress claims or
backup-completeness claims are introduced. Keep the business record package and
attachment inventory alongside all ZIPs.

## Evidence and remaining work

An isolated registered-136 database fixture verifies a real Ready encrypted
export, frozen membership, command-produced audit receipt, exact audit/operation
records, refusal of later/pending files, caller corruption, helper permissions
and business scope. A separate registered-136 fixture verifies current export
creation/download/Stop and Calendar credential lifecycle with simulated provider
endpoints. Both verified stable source and disposable-fixture cleanup.

Focused route and authority checks cover exact delivery, retained buffer lifetime,
fresh authentication, CSRF/admission, all three fixed store kinds, corruption,
changed principals, index scope and unknown commits. These do not establish
production-host or real-device acceptance.

The focused browser-controller composition also checks actual ZIP creation,
explicit save, offline comparison/resume, retained pending counts and clearing
after review or a changed principal. It is not a real-device acceptance check.

Still required: populated native positive photo/supplier cases and integrated
production-equivalent HTTP/object-store/browser acceptance. Complete reference closure,
remaining operator metadata and independent database/object/key recovery are
separate release obligations. This does not make exports complete backups or
authorize production activation.

