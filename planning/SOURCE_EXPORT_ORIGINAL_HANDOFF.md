# Original-file export handoff

Registered migration 136 adds original-file access for new current business
exports. Earlier 43/134/135 jobs retain their original download contracts and do
not gain this new authority. No financial posting rule changes.

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
No browser request can choose a business, table, object key or filename.

POST /api/business/exports/original accepts only job ID, generation ID, kind and
attachment ID. It requires trusted ingress, same-origin POST, session cookie,
CSRF proof and ordinary request admission. Server composition uses the existing
three private stores; the route is available only when all three stores and
source exports are configured. Missing composition remains closed.

Each read freshly verifies provider and owner/recovery context. SQL requires a
Ready, unexpired version-136 job and exact immutable index membership. The reader
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

Still required: populated native positive photo/supplier cases; integrated
production-equivalent HTTP/object-store acceptance; combined resumable browser
delivery and offline original-file verification. Complete reference closure,
remaining operator metadata and independent database/object/key recovery are
separate release obligations. This does not make exports complete backups or
authorize production activation.
