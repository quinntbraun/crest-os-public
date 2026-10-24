# Continuation checkpoint

Read AGENTS.md, README.md, this checkpoint and PRE_IMPLEMENTATION.md. Canonical documents are authoritative. Verify live Git/PR/CI before dependent work; never reset unexpected changes. Historical checkpoint detail is preserved in Git through PR58.

## Verified baseline

- Public repository: https://github.com/quinntbraun/crest-os-public
- PR58/protected main98461af19ecb0c871e425b97bcc801a83c0e5026; tree8be27f48b3e5ecfeb96dfcc342151f64140e0805.
- Candidate40116891393 and actual-main40117826989:1915 unit/45 files,732 DB/Auth including109 genuine Auth,9 pgTAP,16 shell and18 HTTPS leaves. Four trusted GitHub Actions checks passed; required Foundation checks app15368 is enforced for everyone. Full bindings/log evidence are in PR58.
- CI uses isolated foundation/provider/authentication groups and a fail-closed required aggregate. Every existing check remains. Candidate+main measured19m40s versus26m25s for PR57; one comparison, no throughput guarantee.
- App0.1.0/schema31/report0/command1. Default application authentication/business runtime and production activation remain closed. No usable CRM/finance/Calendar yet.

## Current work

feature/synthetic-recovery-drill starts from that main. PHASE_3_RECOVERY_DRILL.md defines a bounded, synthetic-only actual pg_dump/age/isolated pg_restore drill. Fifteen new native cases are planned: whole-database snapshot/rows/schema/grants, unknown-schema exact values/sequence, emergency-key recovery in a fresh process, failed/corrupt input, nonempty target denial, restored RLS/constraints, incident fixture/session invalidation/stale command rejection and original-source preservation. Expected totals:1915 unit/45 files,747 DB/Auth including109 genuine Auth,9 pgTAP,16 shell/18 HTTPS leaves. Counts are expectations until exact-source CI succeeds.

No SQL/schema/canonical/lockfile/runtime grant or production recovery adapter is added. Official age1.3.2 artifacts are checksum-pinned in toolchain metadata; Windows/Linux installation is separate from ordinary app dependencies. Native PG/Docker/build/browser verification runs in Linux CI; do not claim it from local Windows syntax/unit checks.

## Next usable milestones

Finish and verify this actual synthetic database recovery proof, then implement private files and the remaining basic recovery/vault/heartbeat/authority boundaries. CRM customer/vehicle/address/ownership workflows follow under USABLE_RELEASE_MILESTONES.md. Complete exports, neutral reimport, independent compatible recovery and all relevant release gates remain required before their claims/real use. A database-only drill is explicitly not a complete backup or production recovery approval.

Use coherent feature-sized PRs with meaningful native regressions; no speculative foundation verifier refinements. Keep these notes concise; Git/PR history retains prior proof.

## Constraints and reporting

Use synthetic data only. No paid service, purchase, owner signup, provisioning, production grant/apply/deployment/activation or real records. sources/ and the private archive remain read-only. Preserve all published SQL and canonical amendment/original provenance bytes.

Every final report states shipped functionality, executed checks/limits, next concrete milestone, rough V1 coding percent separate from actual-use readiness, low-confidence remaining active hours (waiting excluded), spend/necessary owner action and context health. Test/PR counts are not product completion. Latest rough estimate was about30%,60-100 active hours to a synthetic CRM build and150-300 to limited pilot; these are uncertain judgments, not measured schedules. Repository/live evidence is sufficient; no invented chat-length threshold. Calendar P20/BR21/ADR35 remains required V1 capability with optional later owner activation. PC transfer remains deferred.
