# Current implementation plan

## Active change: isolated PDF receipt validation and raster previews

Baseline PR62/protected main79e420340c7013d088fb616d053a278aa1cba06e is fully verified. Read WORKING_STATE.md, PHASE_3_PRIVATE_OBJECTS.md, PHASE_3_IMAGE_VALIDATION.md and PHASE_3_PDF_VALIDATION.md. Canonical ROADMAP/TESTING/SECURITY/DATABASE remain authoritative.

Deliver checksum-pinned qpdf/PDFium inspection/rendering, unchanged original digest, encrypted/active/uninspectable rejection, all-page rendering and one selected bounded metadata-free JPEG preview. Retain source/artifact identities and upstream notices in the release. Reuse actual enforced kernel admission with private bounded IPC, temporary cleanup and child/process/external deadlines. Direct tests use generated trusted fixtures. Production sandbox transport/dispatch is not configured; no hosting redesign, Docker daemon assumption, provider setup or spending is authorized.

Both direct native and actual restricted-container PDF suites are mandatory alongside all previous gates. Include encrypted/action/malformed PDFs, compressed/unreferenced objects, filled forms, later-page failures, exact page/byte/raster bounds, isolation weakening and watchdog cases. Run local available provenance/dependency/secret/lint/types/unit/native checks, then exact-source candidate and protected actual-main verification with logs/artifact bindings in the PR. Linux CI establishes Docker/PG/Auth/build/browser proof on this host.

No Available attachment, schema migration, canonical amendment, actual-provider/phone proof or production activation is part of this slice. HEIC stays unsupported until separately proven. Typed attachment consumers must bind worker source digest and current attempt/session/parent/lease/recovery epoch before publication.

## Next

Complete HEIC validation and the remaining finite Phase3 typed file/recovery contracts, then Phase4's first customer/vehicle workflow with common-format retrieval. Preserve V1 scope, release gates and Calendar prerequisites. Bundle related runtime/schema/UI/exports/regressions into reviewable feature changes; prioritize usable workflows and recovery over speculative verifier refinements.
