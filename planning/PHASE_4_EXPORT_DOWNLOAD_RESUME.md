# Complete download inventory and selected-file comparison

2026-10-27. Construction after source c1c5b971/run40489244389, independently accepted for1,253 native cases; its full release is a separate publication prerequisite. No export product page, runtime route or canonical43 adoption is activated.

## Inventory before comparison

The pure inventory builder consumes the existing bounded catalogue pages. It pins all12 original header fields, exact business/job/generation and the next ordinal. Before changing state, it checks global part/name uniqueness, contiguous ordinals, ascending non-manifest names, manifest-last name/type/checksum, exact final file count and total bytes. Intermediate pages must leave enough bytes for all remaining nonempty files. A rejected page leaves the last valid position intact. The existing1,024-file and byte limits remain. Only a completed inventory produces a comparison snapshot; neither the builder nor that snapshot performs requests or grants authority.

An already completed inventory may compare local files after export expiry. This is historical byte comparison only: the live download client and server still require unexpired current generation, fresh authentication and current recovery authority. Expired or regenerated exports cannot silently mix with old files.

## Read-only comparison

The verifier copies a fixed inventory and selected File metadata/stream handles before asynchronous work. It checks exact names, byte counts and actual WebCrypto SHA-256 sequentially with one bounded owned plaintext buffer. It classifies missing, duplicate, wrong-length, wrong-checksum and unreadable parts. Unrelated filenames/content are neither returned nor read; only their count is reported. Duplicate expected names are ambiguous and neither copy is read. Every scan starts from the newly supplied selection, without cached success. Remaining part IDs preserve catalogue order, allowing a later explicit whole-file request for only the missing or invalid parts.

Cancellation, disposal and a60-second comparison deadline abort the operation without returning a partial completed report. Only one comparison per verifier runs at a time. Owned buffers are cleared and readers cancelled/released on all outcomes; browser/crypto internals or caller copies cannot be promised overwritten. A crypto failure aborts the comparison rather than classifying a file as corrupt. No directory is changed, no file is deleted or overwritten, no network/storage call occurs and no retry starts automatically.

A File can be created in memory. Therefore `selected_file_bytes_only` means exactly that; matching selected bytes prove neither durable OS persistence, server authenticity, directory completeness nor a recoverable backup. A future UI must obtain the user's selected files and preserve this wording. A matching report additionally requires no unrelated selected files. Both completePortableExport and completeBackup remain false. This slice creates no Blob/link save, file picker, remembered local path or UI.

## Verification and remaining gates

Executed locally: all5,830 unit cases/173 files, including28 new inventory and26 selected-file cases, type checking, focused lint, native syntax and direct pinned Node imports. Tests include actual SHA-256, corrupt/truncated/oversized streams, duplicate/extraneous/missing files, cancellation during read/hash, cleanup, malformed/getter/sparse input, offline expired inventory, immutable scope, rescans and fixed limits.

One new genuine Auth integration case is written and requires execution:135 Auth/1,254 total expected, with696 foundation/253 proposed export cases and423 provider unchanged. It uses actual Auth/SQL/private SDK/JWE/socket delivery, compares two actual downloaded files, removes then corrupts one, explicitly re-downloads only the damaged part and compares again. It requires exactly3 download GETs and3 durable access operations/audits/activity increments; local comparisons cause none. Those Files are constructed in Node memory, not OS persistence or compiled-browser/HTTPS proof. Existing tests and gates remain mandatory.

SQL/registered42/seven proposal hashes/server/custody/crypto/dependencies/canonical rules/global caps remain unchanged. Next: current-source native/full acceptance; controller and save controls with user-file selection and lifecycle cancellation; canonical43 adoption and trusted composition; compiled HTTPS/mobile/lifecycle coverage. No owner action, spend, production apply/deploy, real records or activation.
