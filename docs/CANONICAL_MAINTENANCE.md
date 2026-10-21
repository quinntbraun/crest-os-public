# Public canonical maintenance

Version: 1.0 | 2026-10-20 | Public-baseline transition

PUBLICATION.md records the explicitly authorized fresh public baseline, privacy changes, version register and retained private provenance. The original private manifest is unchanged and is never represented as verifying these redacted bytes.

The public CANONICAL_MANIFEST.json is immutable once committed in the public baseline. CANONICAL_MAINTENANCE.json identifies that exact Git commit. scripts/verify-canonical.mjs checks the manifest byte-for-byte against that commit, checks all baseline document SHA-256 hashes/lengths from Git, and verifies current documents against baseline or explicit versioned amendments. New baseline has no later amendments. Future amendments must identify original hashes/lengths plus changed version/hash/length and a reason in this file; never overwrite baseline provenance or silently regenerate its manifest.

No technical requirement or activation gate is relaxed. Source/test/lockfile/container identity comparison and public verification are in planning/PUBLICATION_EVIDENCE.md. Production activation remains blocked.
