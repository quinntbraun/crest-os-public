# Provider login reconciliation review

2026-10-23. Baseline PR40/main f6d2baaf4aaca744efd4d0d7d18ab3a555d26fc8, tree0d0602e652f1b2ac8ca0bdf40677999cd06f6bb9, passed complete trusted main CI39921714965/job120308258661:844 unit/35 files,497 DB/Auth including109 genuine Auth,9 pgTAP,16 shell browser and18 HTTPS leaf scenarios. Build/container/security/provenance passed. The existing separate inventory role can read each safe ledger; this slice composes those same historical facts without adding authority or source privileges.

## Read boundary

Schema25 adds only provider_reconciliation_review(expectedActor,configuredIssuer,afterAttempt,pageSize). Only crest_inventory can execute; crest_inventory_owner owns the fixed STABLE definer with pg_catalog/pg_temp search path, forced RLS behavior and UTC formatting. No new role, membership, login, table, table/column grant, source writer or provider operation. Migration preflight rejects role/membership/configuration/default-ACL/CREATE/write drift and changed prerequisite-reader ownership/configuration/PUBLIC access. Existing24 SQL and original canonical provenance remain immutable. This is composition within ADR36 and the existing historical inventory boundary, not a new cleanup or authorization decision; no canonical amendment is required.

Validate actor UUID, exact issuer length1..500 and page size1..100, require READ COMMITTED. Materialize one bounded page from the existing provider_login_attempt_inventory before joining indexed target, two distinct local-finish phases, selected request and outcome. Actor/issuer scope anchors every row. Match original epoch/subject/reserved app, target/provider identity and request/finish/target/outcome hash links; conflicting source ancestry suppresses linked derived details and reports binding_conflict_review. Existing registration source assessment remains its own distinct fact. No token, credential digest, cipher, password, contact, key ID, provider secret or raw source payload is projected. Disabled actors/old epochs retain original historical references without restoring eligibility.

A version1 JSON observation includes original attempt identity/hash, registration fact, optional target/registrationFinish/stop/request/outcome ID/hash references and a reviewState. Keep both local finish phases and their original hashes; late target evidence never rewrites the original stop. observedAt is the SQL statement start timestamp in UTC, not provider sampling, external completion time or a durable observation receipt. All stages come from one statement snapshot. The result is a changing read view, not a retained/signed snapshot or full restore-integrity verifier. References/hashes support subsequent authorized retrieval of original ledger bytes; they do not replace those bytes, grant customer export access or establish a complete security export/backup.

| reviewState | Historical fact at this statement |
|---|---|
| binding_conflict_review | Registration ancestry or linked identity/source hashes conflict; hide derived linked details |
| target_unconfirmed_review | No confirmed signed target, including a stopped start whose target remains unknown |
| finish_unconfirmed_review | Target exists; neither local finish phase is recorded |
| registration_closed_recorded | Local registration closure recorded, without a recorded stop |
| stopped_without_request_review | Local stop and target recorded, without a selected cleanup request |
| cleanup_outcome_unconfirmed_review | Original request selected; no committed outcome is visible |
| cleanup_outcome_recorded | Original request has a matching retained removal or observed-absence outcome |

No label is cleanup permission, fresh session eligibility, proof of current provider absence, all external I/O ending, safe closure or global orphan freedom. A recorded outcome remains historical after provider reappearance; removal and observed absence stay distinct. Any future explicit dispatch still supplies original request IDs through schema24's fresh revalidation. No automatic selection/retry/expiry, assumed rollback, broad-user logout, new identity or timeout closure.

## Visibility and remaining gaps

Uncommitted target/outcome evidence is invisible to another reader; commit exposes it and rollback leaves the prior uncertainty. Reads do not hold a producer/cleanup lease or stop external work. Pagination is exclusive UUID keyset, not a transaction spanning pages or a complete scan: later source commits and new starts behind a cursor require fresh review. Empty pages never resolve unknown attempts or prove no sessions. Legacy/headerless provider/app sessions receive no invented headers or deletion; use the existing provider inventory and future authorized security export/operator review alongside this view. Unknown exchange outcomes, source-less sessions, external-drain/lease policy, shared maintenance capacity, retention, complete export/restore and hosted operator support remain gates.

This schema slice added no runtime adapter. The later [bounded runtime slice](PHASE_2_PROVIDER_RECONCILIATION_RUNTIME.md) adds a private fixed read-only factory; no CLI, scheduler, endpoint, service credential, production role/grant, migration apply/deployment or real records. Default runtime stays closed. Free/open-source PostgreSQL and existing test tools suffice; no signup or paid service.

Primary PostgreSQL17 references: [STABLE snapshot behavior](https://www.postgresql.org/docs/17/xfunc-volatility.html) and [statement timestamps](https://www.postgresql.org/docs/17/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT). These define the database read semantics; they do not establish provider completion.

## Verification

24 new actual PostgreSQL cases cover24/23 upgrades and exact source/table-privilege preservation; unknown starts/stops, provider expiry, late targets, registered unfinished/closed/both finishes, pending requests, removed versus absent outcomes, later provider reappearance, disabled/old-epoch history, actor/issuer isolation, bounded pagination, read-only UTC restoration, typed/isolation denial, fixed definer/grants, uncommitted target rollback and cleanup commit visibility, registration ancestry conflict, deliberately inconsistent restored outcome hash with derived detail suppression, prerequisite drift/pending refusal, and headerless legacy provider/app non-adoption. No sleep-based race proof. Two existing genuine Auth cases additionally check pending/outcome review after failed final verification and review while a real MFA result is held; another device stays valid. Existing109 real Auth cases remain required.

Local lint/types,844 unit/35 files, verifiers/security checks must pass; planned full Linux521 DB/Auth including109 actual Auth,9 pgTAP,16 shell and18 HTTPS leaf scenarios (20 Node entries), build/container/security/provenance require exact-head candidate and protected merged-main passes. Plans are not passes. No local DB/native-build pass is claimed: Docker is unavailable and AppControl blocks native compilation. Do not bypass host policy. CI review artifacts expire after three days and are not independent backups; implementing-assistant review is not independent security/accounting certification.

App0.1.0/schema0..25/report0/command1; enabled authentication minimum22 remains. Next: separately bounded runtime review/recoverable security evidence, broader unknown/in-flight/legacy handling and shared maintenance/retention policy, then Phase3 files/recovery before CRM/catalog and authoritative scheduling/opt-in Google Calendar. No production readiness follows from this historical view.
