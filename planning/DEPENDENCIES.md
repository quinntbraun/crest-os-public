# Phase 1 dependency and tooling evidence

Checked 2026-10-20 using official package-registry metadata, release APIs and container registries. All direct npm dependencies use exact stable versions; the npm v3 lockfile records transitive versions and SHA-512 archive integrity. Lifecycle scripts are disabled by .npmrc, local install commands and Docker/CI. No forced or ignored peer resolution is used. `npm ci` is the reproducible install authority.

| Component | Exact selection | Compatibility / license evidence |
|---|---|---|
| Node / npm | 24.22.0 / 11.19.1 | Official Node release index identifies this as Krypton LTS, released 2026-10-14. npm is bundled in that release. `.node-version`, package engines and container agree. |
| Next / React / React DOM | 16.4.2 / 19.3.1 / 19.3.1 | Next requires Node >=20.9 and permits React 19; React DOM requires React ^19.3.1. MIT. |
| TypeScript | 6.0.3 | Next requires TS >=5.1; TypeScript ESLint 8.72.0 supports >=4.8.4 <6.1. The latest TS 7 is outside that peer range, so is not selected. Apache-2.0. |
| ESLint / JS rules | 10.13.0 / 10.0.1 | ESLint 10 is maintained, supports Node >=24, and matches JS rules' ^10 peer. MIT. |
| TypeScript ESLint / Hooks rules | 8.72.0 / 7.1.1 | Both explicitly support ESLint 10. MIT. |
| globals | 17.13.0 | Requires Node >=18; MIT. |
| Vitest | 5.0.5 | Requires Node ^22.12 or ^24 or >=26; compatible Vite is locked. MIT. |
| Playwright / axe adapter | 1.64.1 / 4.14.0 | Node >=20 / >=22.12; adapter accepts playwright-core >=1. Apache-2.0 / MPL-2.0. Matching browsers are installed by this Playwright version. |
| pg / pg types | 8.23.1 / 8.23.1 | pg supports Node >=16; test-only dependency in Phase 1. MIT. |
| Node / React / DOM types | 24.19.2 / 19.3.0 / 19.3.0 | Types match chosen runtime/UI major versions; DOM types require React types ^19.3.0. MIT. |
| PostgreSQL / pgTAP | Supabase postgres 17.11.0.006 / 1.3.3 | Exact image digest in release/toolchain.json; real engine/extension versions asserted by the harness. PostgreSQL License; extension version execution still needs CI evidence. |
| Supabase CLI | 2.121.0 | Official release binaries and SHA-256s pinned for Linux/Windows x64; MIT. CLI remains sole migration authority. No cloud login/link. |
| Gitleaks | 8.30.1 | Official release binaries and SHA-256s pinned for Linux/Windows x64; MIT. Scans working files and Git history with redaction. |
| k6 | 2.3.0, source commit in toolchain.json | AGPL-3.0, separate test process only; workload execution deferred to stages mandated by TESTING. No capacity claim. |

Sources: https://nodejs.org/dist/index.json ; https://nextjs.org/docs/app/getting-started/installation ; https://registry.npmjs.org/ (exact version metadata for each named package); https://eslint.org/version-support/ ; https://vitest.dev/guide/ ; https://playwright.dev/docs/intro ; https://github.com/supabase/cli/releases/tag/v2.121.0 ; https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1 ; https://github.com/theory/pgtap/releases/tag/v1.3.3 ; https://github.com/grafana/k6/releases/tag/v2.3.0 .

## Security and compatibility decision

The initial candidate used Next's eslint-config-next 16.4.2 and ESLint 9.39.5. Actual installation reported ESLint 9 EOL and five high audit findings all rooted in braces <=3.0.3 (GHSA-vfj7-8cjw-p6xm), pulled through Next's lint plugin. There is no published patched braces version as of this review. The preset's React/import/a11y plugins still restrict peers to ESLint 9, preventing a supported mutually compatible ESLint 10 install. Do not force peer dependencies, downgrade Next, ignore advisories or pay for EOL support.

Use maintained ESLint 10 with JS/TypeScript recommended and React Hooks rules. Browser axe tests cover the foundation's accessibility. Next-specific preset rules can be added in a later reviewed dependency update when the upstream dependency/security/peer issues are resolved. The resulting actual npm audit reports zero findings. CI repeats the live audit at low severity and fails on any finding; no ignored-advisory list exists. Sources: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm and https://eslint.org/version-support/ .

The managed Windows host's Application Control blocks the native SWC binary even outside the sandbox. The same-version official WASM package was tried, failed to load, and was removed. No compiler/package source or host policy was modified. Local production build and browser verification remain unproven until Linux CI runs. Webpack is the shared supported build path, avoiding a second bundler contract. This is an environment limitation, not an excuse to skip the build gate.

## License and artifact maintenance

Executed compatibility correction: the digest-pinned Supabase 17.11 image reports pgTAP 1.3.3, although upstream's latest release is 1.3.4. Pin the bundled 1.3.3 and assert it on every run. This avoids installing a second unmanaged extension toolchain merely to chase the latest patch. All RLS/context/grant checks remain required. Any future extension/image upgrade is a reviewed compatibility change.

See THIRD_PARTY_NOTICES.md for native libvips and MPL obligations. Lockfile license validation is a review control, not proof of complete redistribution compliance. OS/native component notices and matching source materials must accompany any future externally distributed release. No upstream source has been modified.

All GitHub Actions use full commit SHAs verified from official release refs: checkout v7.0.1, setup-node v7.1.0, upload-artifact v7.0.2. Source credentials are not persisted; the job has contents:read only. Node and test-DB container tags are paired with immutable registry digests. Refresh versions/digests through a small reviewed change with a new compatibility/audit/build/DB/browser record. Registry integrity protects bytes; it does not make dependency code trusted.

Report/PDF/image processing SDKs and R2/B2/mail integrations are not installed speculatively. Pin and test them in their owning roadmap slices, including real HEIC fixtures and all required recovery controls before real use.

## Phase 2 provider boundary, 2026-10-21

Real Auth integration adds development-only OTPAuth9.5.2 and exact @noble/hashes2.4.0 (MIT; hashes requires Node>=20.19.0, satisfied by24.22.0). Official registry metadata, SHA-512 integrity and installed upstream documentation were checked2026-10-21. These generate synthetic TOTP codes for the actual Auth server; no application crypto is replaced. Scripts-disabled installation reported zero vulnerabilities. The lockfile now contains269 packages; no existing version changes. See PHASE_2_REAL_AUTH.md for fixture isolation and remaining production gates.

The subsequent live-session reader moves already pinned pg8.23.1 from development to runtime dependencies without version changes; @types/pg remains development-only. Provider-schema tests also run the official MIT Auth v2.197.0 container as a separate disposable process. Official release/source and Docker Hub manifest digest were checked2026-10-21 and pinned in release/toolchain.json. Details and limits are in PHASE_2_PROVIDER_DATABASE.md; no hosted-provider or image-vulnerability certification is claimed.

The owning authentication slice adds exact production pins `@supabase/auth-js`2.118.0 (official SDK, Node>=22, MIT), `jose`6.2.13 (maintained JWT/JWKS verification, MIT, no dependencies), and `server-only`0.0.1 (Next/React client-import guard, MIT, no dependencies). Official npm registry version metadata and the actual installed package source were checked. Auth SDK adds only tslib2.8.1, already present in the lockfile; no unrelated package version changed. All267 locked packages retain SHA-512 registry integrity and reviewed licenses. Node24.22.0 satisfies the SDK engine. Install used exact pins, disabled lifecycle scripts and reported zero audit findings; CI repeats a live audit and the full build/test gates.

Sources: [official Auth SDK](https://github.com/supabase/auth-js), [JOSE](https://github.com/panva/jose), [Next server-only guidance](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning), and official registry metadata at registry.npmjs.org for each exact version. No custom password, JWT signature or encryption implementation is introduced. Browser session/encryption libraries remain a separate reviewed slice. SDK/source inspection and synthetic protocol tests do not certify a deployed provider or account recovery.
