# Phase 5: closed catalog storage construction

2026-10-27. Unregistered schema construction under BR03, PRODUCT P04/P05 and DATABASE service tables. This is a small storage foundation after PHASE_5_SERVICE_EDITOR.md. It is not a completed catalog save connection, adopted migration or production release.

## Scope and decisions

planning/proposals/service-catalog-storage.sql defines two tenant-scoped sources: mutable services (13 columns) and retained service_versions (16 columns). Stable service code/UUID, optimistic directory revision, active flag and typed current-content pointer are separate from immutable scope sequence, name, inclusions/exclusions, internal guidance, exact starting cents and duration seconds.

The first root/content pair publishes atomically using a deferred same-business/service foreign key. Later content must append exactly the next sequence and become current through a matching directory revision. Archive/reopen changes the active state without manufacturing a scope version. Unchanged revisions, same-content replacements, rollback to earlier scope and cross-service/tenant attachments fail. Updates/deletes of retained content and directory deletion/truncation are refused. There are no seeded service descriptions or prices.

Both tables use schema ownership and forced RLS. No runtime role receives table access, no save/read RPC exists and no new capability is granted. A closed NOLOGIN/NOINHERIT integrity owner can inspect only the sources and matching catalog operations/audits required by the two deferred trigger checks. Functions have fixed pg_catalog/pg_temp search paths; default and explicit PUBLIC execute are closed.

Each actual directory change needs its exact before/after audit image and revision. Appended content needs its immutable image plus the matching directory publication, operation and actor. A forged future audit cannot make an orphan append valid. Multiple genuine publications in one transaction can retain all intermediate images; deferred checks do not require every historical version to remain the final current pointer. Actual command payload hashing/receipts/foreground activity and fresh owner/provider authorization are the next layer, not supplied by the admin test fixtures.

This candidate has no migration ordinal. Registered43 and its historical bytes remain unchanged. The separate export-admission construction formerly described as proposed44 is still unregistered; do not reuse its number, accidentally adopt it or treat this schema as authorized real-data storage. Adoption must add current source/export/restore coverage and preserve the existing accepted registered release.

## Related refusal correction

The failed public PR92 source14de626f/run40532054037 remains failed. Its default-function-ACL refusal inspected only explicit pg_default_acl rows. GRANT PUBLIC can restore the built-in default and remove that row. The new source corrects only that preflight to inspect coalesce(explicit ACL, acldefault), and strengthens the existing regression with an assertion that the explicit global row is absent. The original seven function-body pins, request/receipt/mutation behavior,43 registry entries and every acceptance case remain. The unregistered proposal checksum now identifies the corrected source; Git retains the old failed bytes. No acceptance is retroactively granted.

The catalog candidate uses the same effective-default rule and tests unsafe source-owner/public-function settings before installing anything. This is a guard correction needed for fresh CI, not an export feature expansion or a manual rerun.

## Verification status

The existing full local unit suite passes6058 cases across186 files, including41 service and35 pricing cases. The new service regression refuses trailing line terminators in IDs, codes, stored cents, duration and revision strings. JavaScript end anchors can match before a final line terminator; explicit canonical-string checks prevent those values from surviving unchanged into storage. The shared module also uses an explicit .ts dependency so the genuine Node database fixture can import it directly.

29 actual-PostgreSQL cases are written in tests/integration/service-catalog-storage.test.mjs and are mandatory in the existing database-foundation CI group through npm run test:catalog-storage-proposal. They use a disposable registered43 database and official provider DDL; synthetic administrator fixture writes exercise the schema only. They cover preflight rollback, implicit PUBLIC defaults, RLS/grants, exact audits, old scope retention, multiple publications, missing audit rollback, wrong command type, code uniqueness, exact/nullable bigint data, invalid fields, history deletion/update, stale content, orphan publication and cross-tenant linkage.

These29 database cases have NOT been executed locally: this Windows computer still lacks the supported WSL/Docker runtime. JavaScript syntax/type/lint and ordinary unit checks do not substitute for PostgreSQL execution. Native counts are prospective only: prior1551 plus29 would be1580, if all suites execute and pass. The separate existing admission regression also needs a fresh exact-source result. CI source/run evidence must be recorded separately.

Fresh cloud run40592213936 for public8bb455a9/local11724957 executed all29 catalog cases:28 passed and the optional-absence case failed. The original upper-range CHECK combined a NULL comparison with a false lower-present condition, rejecting an entirely omitted range. The correction explicitly allows a NULL upper amount while retaining nonnegative/ordered-range checks whenever an upper amount is supplied. The existing regression now also exercises lower-only and explicit-zero guidance; it is not removed, relaxed or skipped. The failed run and original SQL remain retained by Git/checkpoint evidence. A new source/run is required; no catalog-native acceptance is claimed from28/29.

The current browser preview remains available and all current services/quotes remain unsaved page memory. No storage activation, database application outside disposable tests, new provider, dependency, host installation, real data or spending is authorized here.

## Next step

First inspect actual native CI for this candidate and correct any failure without skipping checks. Then construct the scoped trusted save/lookup/directory/history interfaces using existing session/recovery/operation fences, retaining original-operation semantics. Review the capability mapping explicitly instead of silently expanding the fixed capability catalog. Add source CSVs, complete inventory and independent restore acceptance before registration or a persistent owner-facing save button. Connect the existing editor only after these gates; then persist quote revisions and enforce immutable approval/send/acceptance.

V1 remains roughly25-35% coded, with low-confidence15-30 active hours to durable synthetic CRM after runtime prerequisites and200-350 remaining for full V1. Real Crest use remains gated. Cost$0.
