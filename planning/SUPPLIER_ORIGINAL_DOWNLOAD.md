# Supplier original download

Supplier originals previously exposed only a verified preview through HTTP.
The original file is now available through the same private read authority,
POST/CSRF/session admission and two-active-file bound. No caller-selected storage
key, SQL permission or schema change is introduced. The existing reader freshly
checks the original reservation before and after storage access and verifies its
bytes. The handler returns that same one-use binary response without changing
its protected headers or bypassing the existing binary transport.

The supplier workspace offers Prepare original file, followed by Save original
file. Preparation bounds the stream to25MiB and verifies exact declared size,
media type, filename identity and SHA-256 before creating a private Blob URL.
Expected snapshot size/hash/type can additionally be supplied by a future batch
export caller. A one-minute expiry, hidden-page/pagehide reset and unmount cleanup
revoke prepared URLs. Mutable owned buffers are wiped after use. Requesting a save
does not claim durable local storage. The generated supplier-original UUID name
does not pretend to recover the client upload filename, which remains an explicit
source-schema gap.

This closes direct supplier-original access. It does not complete the combined
export batch downloader or its original-file handoff audit, receipt/photo batch
retrieval, original filename retention, full original verification/reconstruction,
independent backup, real-account deployment or physical iPhone acceptance.

31 focused cases across private-byte validation, supplier HTTP and existing
production composition pass. They include corruption, invalid headers/scopes,
stalled-stream cancellation, stale proof, CSRF/read denial and admission bounds.
Types and targeted lint pass before the final layout-only wrapper. The original
supplier browser journey now checks refusal of a corrupted original digest and
exact saved bytes. Both complete original Chromium and WebKit journeys pass
2/2 on efc9e66, with frozen tracked source, unchanged Next/server identity and
owned fixture cleanup. The exact file saved by each browser matches the uploaded
PNG byte for byte; corrupted digest preparation offers no save. All original
payable/settlement/export/privacy assertions remain. Full Next/server build81399
passes with compiled135 identity1fc66585389236d04cc8ea8a42cad12c100989a3.
Evidence is .local/supplier-original-download-native/result.json and test.log.
These are synthetic signed-in browser/PNG worker cases; actual Linux PDF-worker
hosting, production provider access and physical iPhone acceptance remain open.
