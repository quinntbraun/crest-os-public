# Continuation checkpoint

Read AGENTS.md, README.md, this checkpoint and PRE_IMPLEMENTATION.md. Canonical documents are authoritative. Verify live Git/PR/CI before dependent work; never reset unexpected changes. Historical detail is preserved in Git and PR metadata.

## Verified baseline

- Public repository: https://github.com/quinntbraun/crest-os-public
- PR65/protected main393206cce63e83fcf0c1951b15f31c6951d1bc96; treee22b47fde40992a52dfce6c206793c5f4f8d4589. Candidate40145236144 and actual-main40146988314 passed all four trusted checks, including Foundation checks/app15368 enforced for everyone. Exact logs/artifact bindings are in PR65.
- Native totals:1989 unit/49 files,748 DB/Auth including109 genuine Auth and16 recovery,9 pgTAP,21 private-storage entries,38 native-image entries,34 native-PDF entries,47 image-sandbox entries,32 PDF-sandbox entries,18 HEIC and23 HEIC-sandbox entries,10 validated-intake entries,16 shell and18 HTTPS leaves. Storage/isolated intake mechanics are implemented; Available publication, actual R2 configuration/conformance and complete object recovery remain unfinished.
- CI uses isolated foundation/provider/authentication groups and a fail-closed aggregate. Local Docker is unavailable and Windows native-build execution is blocked; actual PG/Auth/build/browser/container proof comes from Linux CI. Sharp native generated-fixture decoding works locally.
- App0.1.0/schema31/report0/command1. Default application authentication/business runtime and production activation remain closed. No usable CRM/finance/Calendar yet.

## Current feature slice

feature/object-recovery-drill extends the encrypted DB drill with snapshot-bound retained originals/previews/quarantine, private age archives and independently verified isolated file restoration before SQL. See PHASE_3_OBJECT_RECOVERY.md. Missing originals fail recovery; unknown writes retain candidates without automatic retry. Actual age/private disk tests do not prove configured independent cloud/vault recovery. Record candidate and actual-main evidence in the feature PR before calling this slice verified.

No schema, canonical bytes, Available publication or file HTTP route changes. Production sandbox hosting/orchestration and actual R2/phone/full recovery remain gated. No Docker socket in the web/decoder or assumption that Render cron supports nested Docker.

## Next usable milestones

Continue Phase3 isolated photo/PDF validation, typed attachment publication with leases/recovery fences and fresh-session authorized reads, file inventory/basic manifest, compatible configuration/key/image recovery, independent vault/heartbeat and incident authority. Then Phase4 customer/vehicle/address/ownership workflows with per-domain exportability under USABLE_RELEASE_MILESTONES.md. A database-only drill or storage byte test is not a complete backup or real-data approval. Retain all applicable safety/release gates; avoid speculative verifier refinements.

## Constraints and reporting

Use synthetic data only. No paid service, purchase, owner signup, provisioning, production grant/apply/deployment/activation or real records. sources/ and the private archive remain read-only. Preserve published SQL and canonical amendment/original provenance bytes.

Every final report states shipped functionality, checks/limits, next concrete milestone, rough V1 coding percent separate from actual-use readiness, low-confidence remaining active hours excluding waits, spend/necessary owner action and context health. Test/PR counts are not product completion. Latest estimate roughly38%,60-100 active hours to a first synthetic CRM build and150-300 to a limited pilot; uncertain judgments, not measured schedules. Repository/live evidence is sufficient; no invented chat-length threshold. Calendar P20/BR21/ADR35 is required V1 capability with optional later owner activation. PC transfer remains deferred.
