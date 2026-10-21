# Foundation engineering review

2026-10-20. The implementing assistant reviewed the original foundation's shell/health headers, container boundary, exact dependencies/license/integrity, least-permission CI, canonical provenance, migration registry, real PostgreSQL harness/RLS/grants/rollback and browser accessibility tests. This is self-review, not independent certification or owner approval.

The review reproduced a P2 defect: mandatory flat pgTAP output could falsely pass zero tests, skipped assertions or duplicate assertion numbers. The corrected actual runner uses src/tooling/tap.ts to require one positive plan, sequential matching assertions and no skip/TODO/fail/bailout/unknown output. Fifteen parser regression cases brought tooling tests to 33. The real nine PostgreSQL assertions remained intact. This correction and its tests are preserved in the public transfer.

The owner subsequently authorized a fresh public-source repository with private application/data access. docs/PUBLICATION.md explicitly supersedes the earlier private-source instruction. Main protection must be enforced and the actual public head must pass full CI; no bypass exception is approved. Foundation review does not authorize Phase 2, production deployment or real-data use.

Before Phase 2's first schema change, implement the controlled migration apply coordinator and concurrency/failure/checksum tests in RELEASE_DISCIPLINE.md. No generic migration push or schema activation is authorized by publication.
