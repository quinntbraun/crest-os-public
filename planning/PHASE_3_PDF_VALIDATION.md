# Isolated PDF receipt validation and raster previews

2026-10-24. Implements existing SECURITY5/DATABASE6/ARCHITECTURE16 and TESTING F6/P09. No canonical, schema, business-rule or activation change. No paid SDK/provider account is required.

## Tool and implementation decision

Use checksum-pinned qpdf12.4.2 for normalized inspection and exact-pinned @hyzyla/pdfium3.0.0 for offline rendering. The wrapper vendors PDFium build8046d; builder commit f2bed3c8bd49569a6b5c2a0df3a1ae0def3d8871 targets chromium/8046 with V8/XFA disabled by default for WASM. release/toolchain.json pins inspector archives and the actual WASM SHA-256. Explicit local WASM bytes avoid CDN/browser fetches. These are source-configuration/artifact identities, not a reproducible-build attestation or security certification.

qpdf's Apache-2.0 distribution/notices remain intact; the wrapper retains its MIT LICENSE.md. release/third-party retains PDFium's BSD/Apache license plus32 distinct additional license texts from chromium/8046, DEPS-pinned sources and Emscripten6.0.0. The collection includes optional components and does not claim every component is linked. Notices travel with the release image. Updates require reviewing pins, compatibility, notices and native/sandbox regressions together.

## Validation contract

Seal an unchanged original of1 byte through25 MiB with PDF header and exact EOF closure. Quarantine encrypted PDFs even with an empty user password. Suppress qpdf recovery; check/JSON errors or warnings fail closed. JSON v2 must describe1-100 pages and a bounded consistent object graph. Inspect normalized names throughout compressed and unreferenced objects. Reject JavaScript, automatic/open/additional actions, embedded/associated files, launch/remote/submission actions, XFA/rich media, external stream files and missing references. Literal strings containing action-like text are not executable names. This supported subset conservatively rejects even benign OpenAction.

Render every page before a positive verdict and require matching parser/renderer page counts. Return one selected page (default1, explicit integer through actual count) as metadata-free JPEG quality85 against white, targeting144 dpi within2048 pixels per side and8 MiB. Preserve filled static AcroForm appearances. Record validator version, unchanged original SHA-256/size/type/page count and independent preview hash/size/dimensions/page number. Never repair, decrypt or replace original evidence with raster bytes. Subsequent preview-page requests require the same validation/authorization contract; no route is exposed here.

This does not prove every possible PDF semantic error absent. qpdf checks referenced content streams; unused arbitrary stream data is not automatically interpreted as page content. Denied action/attachment names are nevertheless rejected even when unreferenced. Regression fixtures cover malformed later-page compression, cross references, EOF, encrypted/active content and boundaries. Unsupported/uninspectable bytes cannot become Available.

## Worker and isolation

One same-release server/pdf-worker.mjs invocation accepts original stdin plus selected-page argument and returns one private JSON verdict. It accepts no filename, URL, credentials, DB handle or parent authorization. Before native imports, reuse the image worker's Linux/non-root/read-only/capability/NoNewPrivs/seccomp/network/cgroup-v2 admission check. Direct module fixtures are trusted synthetic bytes, not a sandbox.

CI constructs the actual release container: network none, read-only/non-root, cap-drop ALL, no-new-privileges, default seccomp,512 MiB memory/no swap, one CPU,32 PIDs,128 MiB V8 heap and32 MiB noexec/nosuid/nodev /tmp tmpfs. No host workspace/credentials/socket is mounted. The original uses a unique restricted temporary directory and is removed after processing. qpdf child execution has10-second/8 MiB output bounds; the worker has a30-second watchdog. Synchronous WASM cannot be preempted by a JS timer: the external caller must enforce hard termination. CI bounds attached execution to45 seconds/12 MiB stdout, records each exact owned ID before starting, and removes it on every outcome. Private stderr must be discarded, never copied into application logs/verdicts.

Production sandbox construction, transport, credential stripping, external hard deadline and dispatch remain deployment gates. A Render cron process is not assumed to construct Docker isolation. A verdict is not publication authority: later transactions must bind source digest/candidate/attempt to current session, typed parent, lease and recovery epoch. No Available transition, upload/read URL, provider setup or real-data use is enabled.

## Acceptance and continuation

Mandatory test:pdf-validation and test:pdf-sandbox use real qpdf/PDFium with generated static/compressed/form fixtures, encrypted/empty-password PDFs, escaped/compressed/unreferenced JS, attachments/actions/XFA, later-page corruption, bad cross references/EOF,100/101 pages, exact25 MiB/oversize, selected last-page color, visible form text, metadata removal, large vectors, original hashes, caller mutation, temporary cleanup, bounded inspection, actual kernel limits, weakened admission and stalled stdin. All previous release gates remain. Windows native tests run locally; Docker/PG/Auth/Next/browser proof requires exact-source Linux CI. Record candidate and actual-main evidence in the PR before calling this shipped.

Next: HEIC/actual synthetic phone proof; typed attachment/attempt/lease/recovery publication; fresh-session parent-authorized streaming reads including Range; object inventory/basic manifest and encrypted file/configuration/key recovery. Then the first customer/vehicle workflow. Avoid speculative file-manager/provider-verifier work ahead of usable milestones.

Primary references reviewed2026-10-24: [qpdf12.4.2](https://github.com/qpdf/qpdf/releases/tag/v12.4.2), [qpdf JSON](https://qpdf.readthedocs.io/en/stable/json.html), [wrapper source](https://github.com/hyzyla/pdfium/tree/c60c75d08051454f0deadf093ffdb948aa179888), [build configuration](https://github.com/paulocoutinhox/pdfium-lib/tree/f2bed3c8bd49569a6b5c2a0df3a1ae0def3d8871), [PDFium source](https://pdfium.googlesource.com/pdfium/+/refs/heads/chromium/8046/).
