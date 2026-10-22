# Public canonical maintenance

Version: 1.1 | 2026-10-22 | First explicit post-baseline scope amendment

PUBLICATION.md records the explicitly authorized fresh public baseline, privacy changes, version register and retained private provenance. The original private manifest is unchanged and is never represented as verifying these redacted bytes.

The public CANONICAL_MANIFEST.json is immutable once committed in the public baseline. CANONICAL_MAINTENANCE.json identifies that exact Git commit. scripts/verify-canonical.mjs checks the manifest byte-for-byte against that commit, checks all baseline document SHA-256 hashes/lengths from Git, and verifies current documents against baseline or explicit versioned amendments. The initial public baseline had no later amendments; the first explicit amendment is recorded below. Future amendments must identify original hashes/lengths plus changed version/hash/length and a reason in this file; never overwrite baseline provenance or silently regenerate its manifest.

No technical requirement or activation gate is relaxed. Source/test/lockfile/container identity comparison and public verification are in planning/PUBLICATION_EVIDENCE.md. Production activation remains blocked.

## 2026-10-22 - Owner-requested V1 Google Calendar capability

Reason/authority: the owner explicitly requested Google Calendar connection capability in V1, extensive investigation and the same rigorous tests/reliability as the rest of Crest. Previously PRODUCT made this optional, ARCHITECTURE excluded it and ROADMAP excluded automatic calendar sync; those exact conflicts are now resolved by P20/BR21/ADR35. Owner connection remains opt-in; outbound-only dedicated-calendar view, internal source of truth, least scope/minimal disclosure, free-first operation and all existing integrity/security/accounting/recovery gates remain. Research and planned GC01-GC18: planning/GOOGLE_CALENDAR_V1.md. This amendment implements no feature or production setting and spends nothing.

Changed versions: PRODUCT1.5, BUSINESS_RULES1.4, ARCHITECTURE1.6, ARCHITECTURE_DECISIONS1.6, DATABASE1.5, SECURITY1.5, EXPORTS_AND_BACKUPS1.5, ROADMAP1.5, TESTING1.5, CANONICAL_ADOPTION_REPORT1.4 and ARCHITECTURE_REVIEW1.5. PUBLICATION1.1 is the twelfth explicit amendment and carries the current register. ACCOUNTING1.5 and CREST_CONTEXT1.0 remain byte-identical, as do all16 SQL and the baseline manifest. CANONICAL_MAINTENANCE.json records each original manifest hash/length and explicit new version/hash/length/reason; none of the original provenance is regenerated. Verification checks baseline and amended bytes separately.
