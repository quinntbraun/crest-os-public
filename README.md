# Crest OS

Crest Detailing's internal business operating system.

**Status (2026-10-22): Public-source foundation; private owner-only application and business data. Phase 2 security implementation is underway. Read [the continuation checkpoint](planning/WORKING_STATE.md) and [current implementation plan](planning/PRE_IMPLEMENTATION.md), then verify live Git/PR/CI evidence. No CRM/financial functionality, hosted provider provisioning, real data, spending or production activation.**

The owner-requested [V1 Google Calendar capability](planning/GOOGLE_CALENDAR_V1.md) is now in the versioned specification (P20/BR21/ADR35). Research and acceptance requirements are documented; no Calendar runtime or live connection is implemented.

## Local development

Run every repository command from this `crest-os-public` checkout, not the parent ChatGPT project mirror or original private archive. Use Node **24.22.0** and its bundled npm **11.19.1**. No paid account or provider credentials are needed.

```sh
npm ci --ignore-scripts
npm run check
npm run dev
```

Open http://127.0.0.1:3000. This is a setup shell with process liveness at `/api/health`, not an authenticated business application. `check` runs provenance, migration/dependency checks, lint, strict types, tooling regressions and the production build. Use `npm run audit:dependencies` for the live registry security gate.

Phase 2 starts with the [controlled migration prerequisite](planning/PHASE_2_MIGRATIONS.md). With the disposable PostgreSQL service and pinned tools available, `npm run test:migrations` creates its own synthetic databases and tests actual CLI applies, receipts, failures and concurrency. `npm run migrations:apply:test -- --bootstrap-empty` is restricted to explicitly configured disposable targets and a clean checkout; it cannot apply to staging/production. The next [database boundary slice](planning/PHASE_2_DATABASE_BOUNDARY.md) adds restricted roles and closed schemas, verified with `npm run test:security-db`. The [closed identity foundation](planning/PHASE_2_IDENTITY.md) adds durable identities, memberships, permission metadata, recovery roots and identity history; `npm run test:identity-db` exercises actual constraints and concurrency. The [private session foundation](planning/PHASE_2_SESSIONS.md), tested by `npm run test:sessions-db`, adds fixed lifetime/revocation guards and local eligibility tests. The [provider boundary](planning/PHASE_2_PROVIDER.md) uses the official Auth SDK and JOSE with signed synthetic HTTP fixtures in `npm test`; it requires a trusted live-session adapter and never grants application access. The [live provider reader](planning/PHASE_2_PROVIDER_DATABASE.md), [real Auth integration](planning/PHASE_2_REAL_AUTH.md), [token encryption](planning/PHASE_2_TOKEN_ENCRYPTION.md) and [local revocation command](planning/PHASE_2_SESSION_REVOCATION.md) extend that foundation; their exact merge/check status belongs in Git and the linked PR evidence. The [issuance/retrieval lifecycle](planning/PHASE_2_SESSION_ISSUANCE.md) connects those prerequisites on the server. The [locked refresh lifecycle](planning/PHASE_2_SESSION_REFRESH.md) serializes provider rotation with local state and revocation. The [request-admission prerequisites](planning/PHASE_2_REQUEST_ADMISSION.md) add durable login limits and Origin/CSRF primitives, tested with `npm run test:login-admission-db` and unit tests. The [browser-state/server orchestration slice](planning/PHASE_2_BROWSER_SESSION_STATE.md) persists one-use login/CSRF state and joins guarded MFA issuance, atomic local replacement and local-first logout. The [HTTP boundary adapters](planning/PHASE_2_BROWSER_HTTP.md) add bounded JSON/cookie parsing and explicit private responses; no authentication route is enabled. The [durable session admission slice](planning/PHASE_2_SESSION_ADMISSION.md) limits ordinary/session-proof work and independently bounded logout across processes and devices. The [document policy slice](planning/PHASE_2_DOCUMENT_POLICY.md) enforces fresh script/style nonces and private page responses with production browser/container checks. The [authentication HTTP dispatcher](planning/PHASE_2_AUTHENTICATION_HTTP.md) adds socket-derived ingress evidence and guarded dispatch/cleanup, tested over loopback HTTP with actual Auth. The [Node hosting adapter](planning/PHASE_2_NODE_HOSTING.md) runs a supported Next custom server with explicit Docker packaging and failed-delivery cleanup. The default executable keeps authentication closed. The [device sign-in slice](planning/PHASE_2_SIGN_IN.md) adds explicit trusted runtime composition and mobile sign-in/session/logout UI with real disposable Auth/PG HTTPS browser acceptance (`npm run test:sign-in-browser`, after build/browser installation on Linux). Default sign-in honestly reports setup unavailable. The [tenant context read boundary](planning/PHASE_2_TENANT_READ.md) adds a narrow schema11 identity.read routine with fresh real SDK/local verification and locked membership/root checks (`npm run test:tenant-read-db`). It exposes no business HTTP route or reusable authority. The [mutation recovery fence](planning/PHASE_2_MUTATION_FENCE.md) adds schema12's exact expected-epoch/writes-enabled guard and bounded trusted transaction scope (`npm run test:mutation-fence-db`). It enables no domain writes or recovery activation. The [retained operation/audit storage](planning/PHASE_2_OPERATION_STORAGE.md) adds closed schema13 tables with deferred completion checks, immutable history and portable hash evidence (`npm run test:operation-storage-db`). No runtime access is granted. The [operation lookup/integrity slice](planning/PHASE_2_OPERATION_LOOKUP.md) adds schema14's authenticated historical receipt reader and a stable restricted role for PostgreSQL17 deferred checks (`npm run test:operation-lookup-db`). It enables no business writer. The [first typed business-name command](planning/PHASE_2_BUSINESS_NAME_COMMAND.md) adds schema15's fixed atomic rename/replay under current authorization and recovery/version guards (`npm run test:business-name-db`). It exposes no business HTTP route. The [business settings context prerequisite](planning/PHASE_2_BUSINESS_SETTINGS_CONTEXT.md) adds schema16's guarded point-in-time name/version and ready-epoch or paused/null read for explicitly reviewed new edits (`npm run test:business-settings-db`), without rebasing pending commands or enabling writes. The [protected business HTTP boundary](planning/PHASE_2_BUSINESS_HTTP.md) composes settings/rename/operation through explicit trusted business configuration, Origin/CSRF, durable shared admission and private responses. The [settings review UI](planning/PHASE_2_SETTINGS_UI.md) adds /settings with per-tab pending-name retention, explicit status review and identical manual retry without credential persistence or epoch rebasing. Default runtime business access stays closed; durable orphan reconciliation, full exports/backups/restore and verified hosted ingress remain downstream.

```sh
node scripts/install-tools.mjs
npx --no-install playwright install chromium webkit
npm run test:e2e
```

Tool installation downloads checksum-pinned Gitleaks and Supabase CLI to ignored `.local/tools` on Windows/Linux x64. No CLI sign-in or project link is required. Windows needs PowerShell 7 (`pwsh`) to extract archives. Playwright tests desktop Chromium and 360px WebKit plus axe; they do not replace real-phone acceptance tests. On Linux, use Playwright's `install --with-deps chromium webkit` when OS libraries are missing. Webpack is the common build path. This managed Windows host blocks Next's native compiler through Application Control; its official WASM fallback also failed to load. Local build/browser success is not claimed. Use the Linux CI/container path to validate these gates; no host security policy is disabled.

The [live provider-session reader](planning/PHASE_2_PROVIDER_DATABASE.md) adds a narrow boolean database helper and bounded server adapter. `npm run test:provider-db` also requires Docker on Linux to apply the digest-pinned official Auth binary's embedded migrations in disposable databases. Browser and business-data access remain closed pending real Auth HTTP integration and browser-session work.

The [real Auth integration](planning/PHASE_2_REAL_AUTH.md), `npm run test:real-auth`, runs the pinned Auth HTTP service with synthetic users, actual password/TOTP/refresh/logout and the restricted database reader. It additionally requires Docker on Linux. No browser login or business-data route is enabled.

The [token-free provider cleanup reference slice](planning/PHASE_2_PROVIDER_CLEANUP_REFERENCES.md) adds schema17 and the npm run test:provider-cleanup-db suite: local revocation retains exact immutable reconciliation evidence while erasing credentials. It does not execute provider cleanup or complete orphan reconciliation.

The [provider-session inventory](planning/PHASE_2_PROVIDER_INVENTORY.md) adds schema18 and `npm run test:provider-inventory-db`: a separately scoped maintenance reader compares bounded provider pages with same-actor registrations/revocation references. Observations grant no cleanup authority; ordinary application requests cannot execute it.

The [retained inventory evidence](planning/PHASE_2_PROVIDER_RECONCILIATION_EVIDENCE.md) adds schema19 and `npm run test:provider-evidence-db`: immutable classified observations, exact scan-request replay and scoped historical lookup with independently verifiable JSON bytes. Scan receipts grant no cleanup authority or current-session eligibility.

The [durable provider login starts and tracked registration](planning/PHASE_2_PROVIDER_LOGIN_ATTEMPTS.md) slice adds schema20 and `npm run test:provider-attempts-db`: an immutable token-free start before provider I/O, pinned security epoch and exact registration history. Unknown attempts remain unresolved; legacy callers and remote cleanup remain explicit gaps.

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
