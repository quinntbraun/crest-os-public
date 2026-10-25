# Current implementation plan

## Active change: validated private file intake

PR64/protected main2abdca1bc3458381339f80e05ecae9c3f3863958, tree6d579616653552374c608b3dff45e690aef64452, is fully verified in candidate40140192052 and actual-main40141770335. Read WORKING_STATE.md and PHASE_3_VALIDATED_INTAKE.md; canonical ROADMAP/TESTING/SECURITY/DATABASE remain authoritative.

Connect one bounded staging snapshot through the actual isolated JPEG/PNG/HEIC/PDF decoder to independently checksummed immutable original and private preview candidates. Use an explicit local operator/CI transport for the reviewed image ID and already specified sandbox limits; no production host, web Docker authority, grant, credentials or activation. Retain unknown create/write/cleanup outcomes and reserved candidate/dispatch identity for reconciliation. Never mark Available or infer deletion/retry safety.

Test real SDK preview limits/faults, binding/protocol/cancellation/cleanup/partial-write unit regressions and native SDK+restricted-release-container intake across all four formats, plus reused staging, quarantine, final corruption, lost original response and running-worker cancellation. Keep all existing gates. Local Windows native/Docker constraints remain; candidate and actual-main Linux evidence belongs in the PR. Preserve canonical/SQL bytes and no dependency/schema changes.

## Next

Complete finite Phase3 durable typed attachment publication/fresh-authorized reads, file inventory/basic manifest and compatible independent recovery, then Phase4's customer/vehicle/address/ownership workflow and common-format retrieval. Real typed parent FKs are mandatory; do not invent a generic cabinet. Bundle coherent workflow changes; preserve all real-data, phone/provider, accounting and V1 Calendar gates. No speculative verifier refinement or paid setup.
