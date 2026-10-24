# Current implementation plan

## Active change: private object storage mechanics

Baseline PR60/protected main156c9f680b907bf072e5f3f78e6a7861aba2cf67 is fully verified; do not repeat its fixed recovery-clock investigation. Read WORKING_STATE.md, PHASE_3_RECOVERY_DRILL.md and PHASE_3_PRIVATE_OBJECTS.md for evidence and limits. Canonical ROADMAP/TESTING/SECURITY/DATABASE remain authoritative.

Deliver one coherent storage adapter using the existing R2/S3 architecture and exact-pinned official AWS SDK. Scope: private random staging PUTs, declared type/ten-minute signature, independent bounded byte intake, immutable original candidate creation, final byte/hash checks, sealed buffers, timeout/cancellation and fail-closed uncertain writes. No delete, automatic write retry, reusable read URL or attachment Available transition. The future worker must durably reserve candidate identity, validate content in isolation, and separately authorize/fence publication. Do not invent dangling polymorphic attachment parents before typed domains exist.

Mandatory native SDK/loopback HTTP fault tests join the protected aggregate without removing any existing gate. Execute available local lint/types/unit/provenance/dependency/secret checks, then full exact-source candidate and protected actual-main verification with logs and artifact bindings recorded in the PR. Native build/PG/Auth/browser/container checks require Linux CI on this host. Cloud R2 conformance, real phone fixtures, decoder safety, typed routes/DB leases and full object/configuration recovery remain unfinished; synthetic tests cannot satisfy them.

No application schema/canonical change or production activation is part of this slice. Only exact new SDK declarations and their integrity-pinned lock entries change dependency provenance. No actual provider setup, deployment, spending, real data or production grants.

## Next

Complete the remaining finite Phase3 file/recovery contracts, then Phase4's first customer/vehicle workflow with common-format data retrieval. Preserve the original V1 scope, relevant release gates and Calendar prerequisites. Bundle related runtime/schema/UI/exports/regressions into reviewable feature changes; prioritize actual usable workflows and recovery over speculative verifier refinements.
