# Public source publication and provenance

Version: 1.0 | 2026-10-20 | Explicit public-baseline transition

## Authority and scope

The owner explicitly authorized a public repository after reviewing the distinction between public code and private application/data access. Public source is compatible with an owner-only application. Publishing financial records, credentials or private evidence does not improve product quality; those remain private. No authentication, authorization, accounting, audit, export or recovery requirement is relaxed.

This public repository becomes the canonical development source and technical-rule repository after its publication checks and main protection pass. The existing private repository is preserved unchanged as the original historical/provenance archive. It is not a parallel development branch. Its original imported manifest, commits and reviewed Phase 1 candidate remain recoverable there. Do not push or fetch private history into this public repository.

This decision supersedes earlier instructions to keep all source private. It authorizes this repository/publication/protection work only, not paid services, production deployment, real data or downstream feature implementation. Current requested expenditure is $0. The earlier $30 ceiling is not permission to spend; the selected paid production-hosting estimates remain historical planning until a compliant operating plan is reviewed. A free production plan is not established by free repository hosting. Never weaken product requirements to force a price target.

## Privacy amendment

Keep the complete historical context, owner alert address, actual payment-channel/banking/tax background, customer counts and historical financial/pricing examples in private storage. The public context file explains that boundary. Generalize owner references and activation facts in specifications, preserving technical mechanisms and every requirement/acceptance ID. Accounting section 25 retains the evidence gates without reporting private owner answers. Synthetic accounting examples are test fixtures, not actual business activity.

All application source, unit/DB/browser tests, dependency lockfile, container settings, migration registry and pinned tool versions are transferred without alteration. Tooling changes are limited to public-baseline provenance, publication guards and public CI handling. No feature or quality gate is removed.

## Provenance transition

Fresh history intentionally excludes all original private objects, PR discussions, CI logs and artifacts. This is a new explicitly named public baseline, not a claim that the original manifest covers redacted bytes. The original private manifest is never rewritten. A private comparison record retains exact source/public hashes and edits for review. The public manifest lists the reviewed public bytes; the public baseline commit is fixed in CANONICAL_MAINTENANCE.json and the verifier. The verifier checks the immutable manifest and baseline blobs from Git plus separately versioned later amendments, just as before. Future canonical changes require explicit reasons, versions and amended hashes; never regenerate baseline hashes to hide drift.

Current public versions: ACCOUNTING1.5, ARCHITECTURE1.5, ARCHITECTURE_DECISIONS1.5, PRODUCT1.4, BUSINESS_RULES1.3, DATABASE1.4, SECURITY1.4, TESTING1.4, EXPORTS_AND_BACKUPS1.4, ROADMAP1.4, ARCHITECTURE_REVIEW1.4, CANONICAL_ADOPTION_REPORT1.3, CREST_CONTEXT1.0. Older version references in historical adoption/review prose describe their original package. Technical accounting semantics are retained; historical ACCOUNTING1.4 references mean those same adopted contracts, now published with privacy-only amendments as1.5.

## Public workflow

Require pull requests, the actual Foundation checks result, an up-to-date branch, resolved conversations and no administrator bypass. Block force pushes and branch deletion. Formal approval count remains zero for a single owner who cannot approve their own PR; owner review remains an explicit process. No external contributor or app is granted production credentials. CI runs on standard hosted Linux runners with contents:read and synthetic loopback PostgreSQL only. Never use pull_request_target or execute untrusted PR code with secrets. No production deployment is configured. Candidate artifacts contain synthetic source/build evidence only; maintain short retention and free storage limits. No paid runner or overage is authorized.

Public visibility does not grant application access. Before any real-data use, implement and test provisioned owner identity, TOTP, server authorization, restricted database roles/RLS, private object storage, recovery and complete export controls. Security controls and private credentials remain necessary even when source is public.

## Verification status

Publication requires reviewing every transferred file/diff, checking code/test identity against the private candidate, scanning files and fresh Git history for secrets/private contacts and unsafe data artifacts, rerunning local available checks, passing the complete Linux CI on the public candidate, and verifying enforced main protection. These are release criteria, not passes implied by this document. Record actual results in planning/PUBLICATION_EVIDENCE.md.

No product license grant is introduced: package.json remains private:true and UNLICENSED. Public visibility is not approval to change ownership or publish a package. No production-readiness, independent security review or accounting certification is claimed.
