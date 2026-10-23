# Public canonical maintenance

Version: 1.2 | 2026-10-23 | Calendar amendment and ADR36 technical maintenance decision

PUBLICATION.md records the explicitly authorized fresh public baseline, privacy changes, version register and retained private provenance. The original private manifest is unchanged and is never represented as verifying these redacted bytes.

The public CANONICAL_MANIFEST.json is immutable once committed in the public baseline. CANONICAL_MAINTENANCE.json identifies that exact Git commit. scripts/verify-canonical.mjs checks the manifest byte-for-byte against that commit, checks all baseline document SHA-256 hashes/lengths from Git, and verifies current documents against baseline or explicit versioned amendments. The initial public baseline had no later amendments; the first explicit amendment is recorded below. Future amendments must identify original hashes/lengths plus changed version/hash/length and a reason in this file; never overwrite baseline provenance or silently regenerate its manifest.

No technical requirement or activation gate is relaxed. Source/test/lockfile/container identity comparison and public verification are in planning/PUBLICATION_EVIDENCE.md. Production activation remains blocked.

## 2026-10-22 - Owner-requested V1 Google Calendar capability

Reason/authority: the owner explicitly requested Google Calendar connection capability in V1, extensive investigation and the same rigorous tests/reliability as the rest of Crest. Previously PRODUCT made this optional, ARCHITECTURE excluded it and ROADMAP excluded automatic calendar sync; those exact conflicts are now resolved by P20/BR21/ADR35. Owner connection remains opt-in; outbound-only dedicated-calendar view, internal source of truth, least scope/minimal disclosure, free-first operation and all existing integrity/security/accounting/recovery gates remain. Research and planned GC01-GC18: planning/GOOGLE_CALENDAR_V1.md. This amendment implements no feature or production setting and spends nothing.

Changed versions: PRODUCT1.5, BUSINESS_RULES1.4, ARCHITECTURE1.6, ARCHITECTURE_DECISIONS1.6, DATABASE1.5, SECURITY1.5, EXPORTS_AND_BACKUPS1.5, ROADMAP1.5, TESTING1.5, CANONICAL_ADOPTION_REPORT1.4 and ARCHITECTURE_REVIEW1.5. PUBLICATION1.1 is the twelfth explicit amendment and carries the current register. ACCOUNTING1.5 and CREST_CONTEXT1.0 remain byte-identical, as do all16 SQL and the baseline manifest. CANONICAL_MAINTENANCE.json records each original manifest hash/length and explicit new version/hash/length/reason; none of the original provenance is regenerated. Verification checks baseline and amended bytes separately.

## 2026-10-23 - Explicit exact-target provider reduction decision

Reason/authority: owner continuation of the existing security/recovery work; ARCHITECTURE requires an ADR for a changed transaction/trust boundary. ADR36 explicitly selects the narrow, pinned, source-checked transactional provider adapter. It adds no business scope, provider/runtime switch, financial change, hosted grant, spending or production activation. Keep all Calendar and original accounting/security/recovery contracts. Ordinary app/worker/recovery/inventory callers receive no provider-write grant; actual operator permission/support and all production gates remain.

ARCHITECTURE_DECISIONS.md: prior amended SHA256 e194836811ef49e17401b7b4acc8a36ee8a248a01ca92ead272406968360b761, 19895 bytes; now version 1.7, SHA256 94d7905f5f9cb1cf58a6ffcf7b83afc09a3b94a7e7ae3990c3c9b98c960e8b27, 24898 bytes. Earlier amended bytes remain in PR37/main f399bdf8e5fb2b12e316b560eff7cf76195c999b.

PUBLICATION.md: prior amended SHA256 a04bf5e796ecd06e268c4c2e4eb260ae853a53a7521b5fcd67bbd129ef599343, 5793 bytes; now version 1.2, SHA256 ac1cca21ed30f9db54c13daa35dc60f3fd9acae437b55984338d3c677101e5d0, 5847 bytes. Earlier amended bytes remain in PR37/main f399bdf8e5fb2b12e316b560eff7cf76195c999b.

Original baseline manifest and every original hash/length stay immutable. The existing current amendment entries for these two documents advance to the new explicitly recorded versions while preserving their original baseline identities; ten other amended documents and all23 prior SQL remain byte-identical. Maintenance JSON keeps12 distinct amended documents, not a count of chronological change events.
