# Crest OS

Crest Detailing's internal business operating system.

**Status (2026-10-20): Public-source foundation; private owner-only application and business data. Phase 1 tooling is implemented; publication/check/protection evidence is in planning/PUBLICATION_EVIDENCE.md. No CRM/financial functionality, provider provisioning, real data or production activation.**

## Local development

Run every repository command from this `crest-os-public` checkout, not the parent ChatGPT project mirror or original private archive. Use Node **24.22.0** and its bundled npm **11.19.1**. No paid account or provider credentials are needed.

```sh
npm ci --ignore-scripts
npm run check
npm run dev
```

Open http://127.0.0.1:3000. This is a setup shell with process liveness at `/api/health`, not an authenticated business application. `check` runs provenance, migration/dependency checks, lint, strict types, tooling regressions and the production build. Use `npm run audit:dependencies` for the live registry security gate.

Phase 2 starts with the [controlled migration prerequisite](planning/PHASE_2_MIGRATIONS.md). With the disposable PostgreSQL service and pinned tools available, `npm run test:migrations` creates its own synthetic databases and tests actual CLI applies, receipts, failures and concurrency. `npm run migrations:apply:test -- --bootstrap-empty` is restricted to explicitly configured disposable targets and a clean checkout; it cannot apply to staging/production. The next [database boundary slice](planning/PHASE_2_DATABASE_BOUNDARY.md) adds restricted roles and closed schemas, verified with `npm run test:security-db`. The [closed identity foundation](planning/PHASE_2_IDENTITY.md) adds durable identities, memberships, permission metadata, recovery roots and identity history; `npm run test:identity-db` exercises actual constraints and concurrency. The [private session foundation](planning/PHASE_2_SESSIONS.md), tested by `npm run test:sessions-db`, adds fixed lifetime/revocation guards and local eligibility tests. The [provider boundary](planning/PHASE_2_PROVIDER.md) uses the official Auth SDK and JOSE with signed synthetic HTTP fixtures in `npm test`; it requires a trusted live-session adapter and never grants application access. Live-provider wiring, browser login/cookies and positive business-data access remain downstream.

```sh
node scripts/install-tools.mjs
npx --no-install playwright install chromium webkit
npm run test:e2e
```

Tool installation downloads checksum-pinned Gitleaks and Supabase CLI to ignored `.local/tools` on Windows/Linux x64. No CLI sign-in or project link is required. Windows needs PowerShell 7 (`pwsh`) to extract archives. Playwright tests desktop Chromium and 360px WebKit plus axe; they do not replace real-phone acceptance tests. On Linux, use Playwright's `install --with-deps chromium webkit` when OS libraries are missing. Webpack is the common build path. This managed Windows host blocks Next's native compiler through Application Control; its official WASM fallback also failed to load. Local build/browser success is not claimed. Use the Linux CI/container path to validate these gates; no host security policy is disabled.

## Disposable PostgreSQL and container checks

With Docker available, start only the isolated synthetic test database:

```sh
docker compose up --detach --wait test-db
```

Set `CREST_ENV=test` and `CREST_TEST_DATABASE_URL=postgresql://supabase_admin:crest_local_test_only@127.0.0.1:54322/crest_test` in the current shell, then run `npm run test:db`. This public test credential is never suitable for a hosted service. The harness rejects non-loopback hosts, databases other than `crest_test`, and URL options. It runs real PostgreSQL/pgTAP under restricted roles and rolls back all test DDL/data. It tests the harness boundary, not Phase 2 application RLS/authentication. `docker compose down` destroys the disposable tmpfs database. The schema1 boundary and schema2 identity migrations are exercised in separately owned disposable databases; runtime data access remains closed.

```sh
docker build --tag crest-os:local .
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges --publish 127.0.0.1:3000:3000 crest-os:local
```

The digest-pinned, non-root image exposes only the setup shell. No deployment or registry publishing is configured. Windows local verification and Linux CI results/limitations are recorded in [Phase 1 evidence](planning/PHASE_1_EVIDENCE.md). Follow [migration/release discipline](planning/RELEASE_DISCIPLINE.md), [dependency evidence](planning/DEPENDENCIES.md), and [third-party notices](THIRD_PARTY_NOTICES.md).

## Start here

1. [Preparation status and next steps](planning/PRE_IMPLEMENTATION.md)
2. [Owner decisions and evidence](planning/OWNER_INPUTS.md)
3. [First development phase checklist](planning/PHASE_1_CHECKLIST.md)
4. [Canonical adoption report and current version register](docs/CANONICAL_ADOPTION_REPORT.md)
5. [Implementation roadmap](docs/ROADMAP.md)

## Canonical specification

| Document | Purpose |
|---|---|
| [PRODUCT](docs/PRODUCT.md) | Approved V1 scope and acceptance requirements |
| [BUSINESS_RULES](docs/BUSINESS_RULES.md) | Operational invariants |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Selected system and provider architecture |
| [DATABASE](docs/DATABASE.md) | Database contracts |
| [ACCOUNTING](docs/ACCOUNTING.md) | Financial semantics and audit requirements |
| [SECURITY](docs/SECURITY.md) | Identity, privacy and security controls |
| [TESTING](docs/TESTING.md) | Verification and release gates |
| [EXPORTS_AND_BACKUPS](docs/EXPORTS_AND_BACKUPS.md) | Portability, backup and recovery contracts |
| [ROADMAP](docs/ROADMAP.md) | Dependency-ordered phases |
| [ARCHITECTURE_DECISIONS](docs/ARCHITECTURE_DECISIONS.md) | Recorded decisions and unresolved gates |
| [ARCHITECTURE_REVIEW](docs/ARCHITECTURE_REVIEW.md) | Design challenges and corrections |
| [CREST_CONTEXT](docs/CREST_CONTEXT.md) | Boundary for historical context retained privately |
| [CANONICAL_ADOPTION_REPORT](docs/CANONICAL_ADOPTION_REPORT.md) | Adoption and readiness record |
| [CANONICAL_MANIFEST](docs/CANONICAL_MANIFEST.json) | Reviewed public baseline hashes and versions |

The original private repository and its imported canonical manifest are preserved unchanged. This repository has fresh public history and an explicitly reviewed public baseline; it contains no original private Git objects. [Publication/provenance](docs/PUBLICATION.md) records privacy edits, current document versions and authority. [Canonical maintenance](docs/CANONICAL_MAINTENANCE.md) explains verification of immutable public baseline bytes and later versioned amendments.

Current requested expenditure is $0; no paid upgrade, hosting purchase or production provisioning is authorized. Free repository hosting does not establish a free production operating plan. Planning files summarize execution and evidence, never waive unresolved security/accounting/recovery gates. Foundation checks are not evidence of production readiness.
