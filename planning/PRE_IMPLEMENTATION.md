# Current implementation plan

## Active change: isolated HEIC original validation and private previews

Baseline PR63/protected main74a201a61ddd5659ee2e8ce944a7b94eed1a510f is fully verified. Read WORKING_STATE.md, PHASE_3_PRIVATE_OBJECTS.md, PHASE_3_IMAGE_VALIDATION.md, PHASE_3_PDF_VALIDATION.md and PHASE_3_HEIC_VALIDATION.md. Canonical ROADMAP/TESTING/SECURITY/DATABASE remain authoritative.

Deliver source-pinned patched libheif/libde265 full-image decoding, unchanged original digest, strict warning/format/size rejection and one bounded metadata-free JPEG preview. Retain dynamic LGPL libraries, exact corresponding sources, notices and rebuild instructions in the release. Test the fixed1 GiB HEIC profile with no network/read-only/non-root/CPU/PID/swap/privilege controls, bounded private intermediate/IPC and hard deadlines. Existing512 MiB image/PDF profiles stay intact. Production dispatch/hosting/provisioning/spending are not authorized.

Both direct native and actual restricted-container HEIC suites are mandatory alongside all previous gates. Include8/10-bit, ICC/alpha/geometry/grids, corrupt pixels/containers, excessive dimensions, exact25 MiB/60MP boundary, memory/isolation weakening and watchdog cases. Run local available checks, then exact-source candidate and actual-main verification with logs/artifacts in the PR. Linux CI establishes native HEIC/Docker/PG/Auth/build/browser proof on this host; no positive local native HEIC claim is inferred.

No Available attachment, schema migration, canonical amendment, actual-provider/phone proof or production activation is included. Generated HEIC does not prove actual iPhone camera/gallery compatibility; that remains a mandatory pre-pilot gate. Consumers must bind worker source digest to current attempt/session/typed parent/lease/recovery epoch before publication.

## Next

Complete finite Phase3 typed file/publication/authorized-read/inventory/recovery contracts, then Phase4's first customer/vehicle workflow with common-format retrieval. Preserve V1 scope, release gates and Calendar prerequisites. Bundle related runtime/schema/UI/exports/regressions into reviewable feature changes; prioritize usable workflows and recovery over speculative verifier refinements.
