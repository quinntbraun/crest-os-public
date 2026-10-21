# Foundation evidence

2026-10-20. The original private Phase 1 candidate passed full Linux CI: 33 tooling unit tests, nine real PostgreSQL/pgTAP assertions, four Chromium/WebKit and axe cases, lint, strict types, dependency/provenance/migration checks, secret scanning, production build and non-root read-only container smoke. The original records remain in the private archive; no private workflow logs/artifacts/history are copied to the public repository. Public verification must pass independently on the new candidate.

The application source, test files, pinned dependencies/lockfile, toolchain/container configuration and empty migration registry are transferred byte-for-byte. See PUBLICATION_EVIDENCE.md for public-run identities and actual results. Earlier private success does not prove later public changes pass.

Local Windows Application Control blocks the native Next compiler; the official WASM fallback also failed and was removed. Do not bypass host security policy. Use Linux CI for production build, real PostgreSQL, browser and container gates. Local lint, types, provenance, migration/dependency checks, tooling regressions and secret/privacy scans can be run independently.

No CRM, accounting engine, owner login, recovery implementation, provider configuration, deployment or real records exist in this foundation. All real-data/security/accounting/recovery gates remain open. Candidate artifacts are short-lived synthetic engineering evidence, not production backups.
