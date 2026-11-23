# Current original-file inventory

The current source package now includes attachment_inventory.json and a private
README. They describe the original and preview metadata for all retained expense
receipt reservations/revisions, supplier original intents/publications and custody
photo attempts/originals in the same business source capture. Available and
reserved entries remain distinct. Voided/corrected expense receipts and verified
unlinked photos are retained; pending records never receive invented hashes or
paths. The metadata is bound to the business snapshot and included in the current
package's verified file descriptors.

This is a source inventory, not object-read authority or evidence of downloaded
bytes. originalBytesIncluded, completePortableExport and completeBackup remain
false. Every available record still needs separately authorized and audited byte
retrieval, length/hash verification and the batch/resumable downloader required
by EXPORTS_AND_BACKUPS. Separate original-file ZIP delivery is implemented and
locally checked through138; see SOURCE_EXPORT_ORIGINAL_HANDOFF.md. The combined
complete source/recovery package and actual-provider acceptance remain unfinished.

Portable originals use attachments/<attachment-id>/<object-id>.<extension>.
Photo object identity is its dispatch ID, rather than its photo ID, matching the
actual photo store. Receipt and supplier object IDs are their reservation IDs.
Previews have separate paths and hashes. Path/ID collisions fail explicitly;
they cannot silently overwrite a different attachment. The inventory contains
no storage URL or credential and does not allow a caller-selected object key.
Existing source rows retain their own metadata and full relationships.

The formatter reuses the receipt reservation/candidate/record and custody photo
validators. Receipt history must start at1 and advance to2 without changing its
reservation. Receipt expense revisions and supplier draft revisions must exist;
supplier original hashes, size, media, object key and document reference must
match the reservation/draft/candidate. Orphan or duplicated originals are refused.
Precise revision strings remain text.

An additional launch gap is now explicit: the existing upload source schemas do
not retain original client filenames. The inventory records null with
not_retained_by_source, rather than inventing a filename or claiming that
canonical filename retention is complete. Adding safely retained names for future
uploads needs an append-only migration and consistent reservation/upload/audit
wiring; older names cannot be recovered from these records.

Security scope review: SECURITY_EXPORT_COVERAGE labels do not authorize reads.
Unscoped login attempts/contexts and instance configuration still need a private
operator recovery/export contract. No new browser read privilege or business
ownership rule is introduced here, and the remaining10 sources are not declared
resolved. Full database/role/object/key backup and independent off-laptop restore,
required reports, actual host/account setup and phone acceptance remain open.

18 focused cases across attachment inventory and existing workbook formatting
pass, with current types and targeted lint. The registered135 upgrade fixture now
also creates a retained receipt through the original commands and checks its
inventory metadata in the combined179-table package. Native source1623841 passes
that upgrade with exact receipt ID, hash, portable path, counts and false
byte-delivery flag. All prior provider/reimport/old-job assertions remain. The
complete original current135 export/worker/audited-download/selected-workbook/
Stop/fresh-job case also passes on1623841 with both inventory files included.
Both runs retain frozen source and complete owned cleanup. Full Next/server
build95490 passes; compiled135 identity is6084237af4eca73db460cdcbc89154a622bf3388.
Evidence is .local/provider-source-native/result.json and
.local/current-export135/result.json. Decoder and actual object custody remain
separate proofs. No real account or production acceptance is claimed.
