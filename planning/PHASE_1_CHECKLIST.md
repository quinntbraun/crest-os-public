# Phase 1 checklist

Public publication update, 2026-10-20: main protection is now configured and verified through active ruleset25515303 plus the source-bound classic rule. Full public run39519874910 passed. The earlier checklist below records original foundation execution; its protection items are superseded by this notice and PUBLICATION_EVIDENCE.md. The final evidence-only head must pass its own required check before the owner-authorized public transfer is merged. Phase 2, production deployment and real data remain outside this publication authorization.

Based on ROADMAP Phase 1, ARCHITECTURE and TESTING. **Owner-authorized; foundation implemented and full Linux CI run passed on the review branch.** See PHASE_1_EVIDENCE.md for exact tested commits and the latest-head requirement. Main protection/review remain unresolved; no merge or Phase 2 start is implied. An implemented tool is not a passed production gate.

## Entry criteria

- [x] Explicit owner authorization to start coding is recorded.
- [x] Canonical cross-reference follow-ups in PRE_IMPLEMENTATION are reviewed and corrections explicitly documented with new versions/verification metadata.
- [ ] Enforced main protection is configured and verified, or the owner records a specific interim exception with its risks; do not silently waive the architecture requirement.
- [x] Read relevant canonical contracts and preserve all unresolved production gates. Current human instructions permit branch/PR work while protection remains unresolved; this is not a merge exception.

## First coherent implementation change

- [x] Create minimal Next.js App Router / React / strict TypeScript foundation on standard Node, following the selected modular monolith.
- [x] Select supported mutually compatible exact versions, record compatibility/license/security evidence, pin lockfile and container digest.
- [x] Establish synthetic local/CI separation and example configuration; ignore local secrets/generated files. Provider staging/production are not provisioned.
- [x] Set up a portable Docker build, a minimal application shell and explicit local setup documentation; full Linux build/container smoke passed.
- [x] Configure lint, typecheck, production build, test harness and dependency/secret checks; final results in evidence record.
- [x] Establish GitHub Actions using least permissions, pinned action revisions and synthetic data. No production credentials or automatic release.
- [x] Document candidate release metadata, schema compatibility and ordered SQL migration registry/checksum/lock discipline. No feature/domain migrations; apply coordinator is a prerequisite to Phase 2 schema work.
- [x] Set up real PostgreSQL/pgTAP path with RLS/grants intact and Vitest/Playwright/axe harness. k6 pinned for later measured stages; no downstream test passes claimed.
- [x] Record actual commands, results, environment and limitations. Full Linux checks passed; Windows compiler limitation remains documented.
- [ ] Require the actual `Foundation checks` result in enforced repository protection; protection is still unverified and no exception is approved.
- [ ] Review the small change before adding Phase 2 dependencies.
- [x] Complete engineering self-review and correct the mandatory database result-parser finding; see PHASE_1_REVIEW.md. Owner acceptance and the protection decision remain open.

## Exit criteria

A fresh checkout can reproducibly install pinned dependencies, perform the configured checks and produce the container/build artifact without secrets. Required checks for the slice pass. Migration/release discipline is documented. No business features, real customer data, production accounts or financial activation are included.

These implementation/CI criteria were demonstrated in run 39505346554; see evidence for exact source/integration commits, test counts, image identity and short-lived artifact. Keep the latest PR head green. Owner review and main protection remain separate open merge gates.

## Subsequent slices

Phase 2 introduces identity/session/membership, roles/RLS, audit/operation registry and transactional recovery fencing. Phase 3 introduces private validated files, independent backups/recovery kit and a basic export manifest, with a synthetic restore. Do not begin CRM before those prerequisites. Later phases follow ROADMAP; financial posting templates remain governed by ACCOUNTING.
