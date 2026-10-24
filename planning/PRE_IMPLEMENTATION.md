# Current implementation plan

## Active change: isolated JPEG/PNG validation and private previews

Baseline PR61/protected mainaaa7053d5b60429af4d5889cd2e10dfb791b04fe is fully verified. Read WORKING_STATE.md, PHASE_3_PRIVATE_OBJECTS.md and PHASE_3_IMAGE_VALIDATION.md. Canonical ROADMAP/TESTING/SECURITY/DATABASE remain authoritative.

Deliver one coherent strict-container/full-pixel validator, unchanged original digest, oriented metadata-free bounded JPEG preview and same-release worker entry point. Admit untrusted bytes only under actual enforced kernel isolation: no network, read-only/non-root, no privileges/capabilities, seccomp and explicit cgroup-v2 memory/swap/CPU/PID bounds. The worker must fail closed outside that profile. Direct native decoder tests use only generated trusted fixtures. Production sandbox dispatch/transport is not implicitly configured; no hosting redesign, Docker daemon assumption, provider setup or spending is authorized.

Both direct native and actual restricted-container suites are mandatory in protected CI alongside all existing gates. Include malformed/trailing/CRC/decode failures, native warning rejection, private EXIF preservation/preview stripping, exact byte/pixel boundaries, isolation weakening, memory and watchdog cases. Run local available provenance/dependency/secret/lint/types/unit/native checks, then exact-source candidate and protected actual-main verification with logs/artifact bindings in the PR. Linux CI must establish Docker/PG/Auth/build/browser proof on this host.

No Available attachment, schema migration, canonical amendment, actual-provider/phone proof or production activation is part of this slice. PDF and HEIC stay unsupported by this validator until separately implemented and proven. Future typed attachment consumers must validate/bind worker source digest and current attempt/session/parent/lease/recovery epoch before publication.

## Next

Complete PDF/HEIC validation and the remaining finite Phase3 file/recovery contracts, then Phase4's first customer/vehicle workflow with common-format retrieval. Preserve V1 scope, relevant release gates and Calendar prerequisites. Bundle related runtime/schema/UI/exports/regressions into reviewable feature changes; prioritize usable workflows and actual recovery over speculative verifier refinements.
