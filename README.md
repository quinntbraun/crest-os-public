# Crest OS

Current development: dated customer–vehicle association backend and atomic ownership transfers. Migration 36 retains the exact SQL bytes that passed native and encrypted-restore preflight; full current-source release acceptance remains pending. See [the active checkpoint](planning/WORKING_STATE.md) and [association implementation](planning/PHASE_4_VEHICLE_ASSOCIATIONS.md). Synthetic development only; real-data use remains gated.

Crest Detailing's internal business operating system.

**Status (2026-10-24): Public-source foundation; private owner-only application and business data. Security/recovery foundations and the first synthetic customer backend are underway. Read [the continuation checkpoint](planning/WORKING_STATE.md) and [current implementation plan](planning/PRE_IMPLEMENTATION.md), then verify live Git/PR/CI evidence. No usable CRM screens, financial functionality, hosted provider provisioning, real data, spending or production activation.**

The [customer directory core](planning/PHASE_4_CUSTOMER_DIRECTORY.md), [private HTTP boundary](planning/PHASE_4_CUSTOMER_HTTP.md) and [customer editor](planning/PHASE_4_CUSTOMER_EDITOR.md) add save/search/history, optimistic conflicts, archive/reopen and explicit interrupted-save review. Customer forms at `/customers` require configured authenticated customer access; the default executable remains closed. Drafts stay in memory; only opaque pending references use per-tab storage. A lost draft with an absent receipt remains blocked for review, not a replacement save. Exact-source native browser/build/container proof and real-use recovery/portability gates remain. ADR41/ROADMAP1.6 permit synthetic construction overlap while retaining every applicable release gate.

The [private object storage boundary](planning/PHASE_3_PRIVATE_OBJECTS.md) adds scoped staging PUTs, bounded checksummed intake and conditional immutable original candidates. Format validation, typed attachment publication and authorized reads remain unfinished.

The [isolated image validator](planning/PHASE_3_IMAGE_VALIDATION.md) adds strict JPEG/PNG checks and private previews. The [PDF validator](planning/PHASE_3_PDF_VALIDATION.md) adds encrypted/active-content rejection and offline page rendering. The [HEIC worker](planning/PHASE_3_HEIC_VALIDATION.md) adds patched native full-image decoding and private previews; check its feature PR's exact-source proof before calling it verified. Actual phone tests, attachment publication and production sandbox dispatch remain gated.

The [validated private intake](planning/PHASE_3_VALIDATED_INTAKE.md) connects the staging snapshot, isolated decoder and independently verified original/preview candidates. Its explicit local operator/CI dispatcher enforces the existing sandbox profile; production hosting, durable typed publication and authorized file reads remain unfinished. Check its PR for exact-source native evidence.

The owner-requested [V1 Google Calendar capability](planning/GOOGLE_CALENDAR_V1.md) is now in the versioned specification (P20/BR21/ADR35). Research and acceptance requirements are documented; no Calendar runtime or live connection is implemented.

The current [exact-target cleanup executor slice](planning/PHASE_2_PROVIDER_CLEANUP_EXECUTOR.md) adds a separately isolated, source-checked transactional maintenance operation under ADR36; it provisions no service login, scheduler or production access.

The [bounded maintenance adapter](planning/PHASE_2_PROVIDER_CLEANUP_DISPATCH.md) processes only explicit original request IDs with separate execution/history profiles, receipt validation and stop-on-unknown reports. It adds no scheduler, production credential or default runtime activation.

The [historical reconciliation review](planning/PHASE_2_PROVIDER_RECONCILIATION_REVIEW.md) joins bounded login-start/target/finish/request/outcome facts while keeping unknown, conflicting and recorded states distinct. It adds no cleanup or application-access authority.

The [private runtime review adapter](planning/PHASE_2_PROVIDER_RECONCILIATION_RUNTIME.md) validates one bounded read-only inventory page and closes its owned transport within the maintenance lifetime. It enables no automatic cleanup, endpoint or scheduler.

The [portable attempt-evidence verifier](planning/PHASE_2_PORTABLE_ATTEMPT_EVIDENCE.md) checks original JSON bytes, hashes and included source links offline, with explicit missing-record reporting. It establishes internal consistency only; complete exports and recoverable backups remain gated.

The [provider-evidence snapshot readers](planning/PHASE_2_PROVIDER_EVIDENCE_SNAPSHOT.md) expose scoped counts and bounded original-evidence pages in a read-only repeatable-read transaction. They enable no export job, cleanup action or production access.

The [private provider-evidence collector](planning/PHASE_2_PROVIDER_EVIDENCE_COLLECTOR.md) reads all six retained ledgers through one owned snapshot, validates counts and original hashes, and returns only a bounded complete collection. It enables no export job, file publication, provider action or production access.

The [offline collection verifier](planning/PHASE_2_PROVIDER_EVIDENCE_VERIFICATION.md) checks six-ledger schemas, nested inventory findings and original source links, preserving missing facts and original bytes. Its assurance is internal consistency; complete export custody and restore checks remain gated.

The [provider-reference snapshot readers](planning/PHASE_2_PROVIDER_REFERENCE_SNAPSHOT.md) add legacy session mappings, original session events and cleanup-reference projections under one scoped read-only snapshot contract. Representations remain explicit; complete security export, private custody and restore remain gated.

The [combined provider evidence collector and verifier](planning/PHASE_2_PROVIDER_RECOVERY_COLLECTION.md) keep all nine groups in one bounded snapshot and check original registration/revocation links offline, preserving exact versions and historical unknowns. Complete security coverage, private custody and independent recovery remain gated.

The [security export coverage gate](planning/PHASE_2_SECURITY_EXPORT_COVERAGE.md) checks all23 Crest source tables/286 columns against the actual applied schema, with explicit credential exclusions. Nine existing evidence groups remain partial coverage; complete private export and independent restore remain gated.

The [business configuration snapshot readers](planning/PHASE_2_BUSINESS_CONFIGURATION_EXPORT.md) add isolated business-scoped extraction of all39 current root/membership/recovery columns under ADR37. Inactive/paused history is retained; actual owner-authorized full exports, identity/audit closure and encrypted recovery remain gated.

The [business history snapshot readers](planning/PHASE_2_BUSINESS_HISTORY_EXPORT.md) add scoped operation receipts and original audit evidence under ADR38, preserving exact JSON text and distinct source/wrapper hashes. Identity reference closure, complete authorized exports and recoverable private custody remain gated.

The [offline business-history verifier](planning/PHASE_2_BUSINESS_HISTORY_VERIFICATION.md) checks included receipt/audit links and exact original numeric/hash evidence, reporting required actor IDs as unresolved references. It grants no identity access and does not certify a complete export or backup.

The [business identity readers](planning/PHASE_2_BUSINESS_IDENTITY_EXPORT.md) add isolated actor/operator ancestry, capability metadata and original identity history with exact source-chain checks. Other businesses' scoped records remain excluded; complete authorized exports and independent recovery remain gated.




The [offline identity verifier](planning/PHASE_2_BUSINESS_IDENTITY_VERIFICATION.md) checks original actor/capability/identity history and included references independently. Current configuration bindings, complete exports and recovery remain explicit unfinished gates.

The [safe current session metadata reader](planning/PHASE_2_SESSION_METADATA_EXPORT.md) fills the existing session projection gap with explicit credential exclusions and a separate closed definer. Complete joined exports and independent recovery remain gated.

The [offline session verifier](planning/PHASE_2_SESSION_METADATA_VERIFICATION.md) checks safe current metadata against retained provider/session evidence with exact versions and timestamps. Matching claims establish internal consistency only; authorized consistent capture, full reference closure and recovery remain gated.

The [configuration and business evidence verifier](planning/PHASE_2_BUSINESS_CONFIGURATION_VERIFICATION.md) compares all39 current configuration fields with retained identity state and resolves included history actor references. The [usable-release milestones](planning/USABLE_RELEASE_MILESTONES.md) distinguish foundation checks, a useful synthetic CRM build and real-use acceptance.

The [synthetic database recovery drill](planning/PHASE_3_RECOVERY_DRILL.md) uses an encrypted real PostgreSQL archive and a fresh isolated cluster to verify database recovery and existing security fences. The [retained-object recovery extension](planning/PHASE_3_OBJECT_RECOVERY.md) binds exact private object archives to that snapshot and checks file restoration before SQL. Configured independent vault/configuration recovery and production incident activation remain unfinished; the feature PR records executed evidence.

The [vehicle directory backend](planning/PHASE_4_VEHICLE_DIRECTORY.md) adds label-only vehicle sources, optional raw VIN/year/plate, nonunique search hints, audit/archive/history, typed private methods and same-snapshot recovery coverage. Native acceptance, dated customer associations, vehicle forms and ownership transfer remain unfinished; default access stays closed.

## Local development

The [private vehicle HTTP boundary](planning/PHASE_4_VEHICLE_HTTP.md) adds scoped context/list/save/history/receipt routes and a stateless browser client over the genuine vehicle source. It requires its own explicit `vehicles:true` composition. Native HTTPS acceptance is pending; vehicle forms and dated ownership links remain unfinished.

The [customer-owned address backend](planning/PHASE_4_CUSTOMER_ADDRESSES.md) adds incomplete intake locations, same-business customer links, versioned archive/history and exact-decimal source exports. Native database/recovery tests pass for the backend source; private address HTTP/client methods are implemented with current-source Linux acceptance pending. Private mobile address forms and original-parent save recovery are implemented, with exact-source browser acceptance pending; no geocoder, fake vehicle/lead parent or default runtime activation is introduced. Vehicle/ownership work remains in [the resource plan](planning/PHASE_4_CUSTOMER_RESOURCES.md).

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

The [signed password-session target receipt](planning/PHASE_2_PROVIDER_LOGIN_TARGETS.md) slice adds schema21 and `npm run test:provider-targets-db`: immutable token-free references before profile/MFA I/O, exact targeted issuance and restricted registration history. These references do not complete cleanup authority or unknown-outcome handling.

The [local login finish fence](planning/PHASE_2_LOGIN_ATTEMPT_FENCES.md) adds schema22 and `npm run test:login-fences-db`: atomic scoped stop/revocation, immutable local finish history and serialized app issuance. Ordinary web must use the fenced issuer; earlier direct issuance commands are retired from web execution. A local finish does not certify remote cleanup or browser delivery.

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
