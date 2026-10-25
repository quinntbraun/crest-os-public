## Active slice: canonical lead status history and typed backend

Read PHASE_4_LEAD_LIFECYCLE.md. The exactly tested forward SQL is adopted as migration38 (SHA256026b02ca64ccd410161ab2ec187a6e3e8da0774f024b675142027f5463a1021a); all37 prior SQL/checksums remain unchanged. Canonical coverage is29tables/413columns,403required plus10credential exclusions. Ordinary recovery retains all29 tested cases; proposal-only helpers/workflow are removed. Fixed typed change/lookup/event readers and status-aware intake history are implemented; private status HTTP/client are implemented under acceptance; mobile status controls remain next. Full new-source standard acceptance is required before merge/readiness claims.

Protected intake forms main93c1687 passed separate actual-main run40197402161/attempt2 with all four trusted checks/logs/artifacts,3,306units/93files,851DB/Auth,22shell,94HTTPS leaves/108entries and build/container. Corrective CI PR79 remains separately under verification. Older sections below are historical checkpoints. No spending/signup, production activation or real records.

# Current implementation plan

## Active consumer: lead/source intake forms

Read PHASE_4_LEAD_EDITOR.md. Mobile lead/source forms, explicit genuine reference pickers, exact USD/UTC input, private controllers and separate opaque pending references are implemented locally. All3,306 units/93files, lint/types/server bundle pass; actual compiled HTTPS/axe fixture is written but unexecuted. Lead list/history use10/5 complete rows/events to fit the unchanged1MiB bound; sources retain25/20. Parent backend PR76 is merged asca2db5d; separate actual-main run40185215438 and private HTTP/client PR77 run40185267989 are in progress, with all851 DB/Auth groups passed. Preserve37 SQL/canonical/coverage/compatibility/lockfile bytes. Next: verify live parent and current-source native gates, then lead lifecycle/vehicle/address/conversion within approved scope. No activation or real records. Older sections are historical.

## Active consumer: private lead/source HTTP

Read PHASE_4_LEAD_HTTP.md. Fixed private intake/source routes, stateless typed browser clients, explicit leads opt-in and bounded128KiB intake transport are implemented locally;3,183 units/88files, lint/types/server bundle pass. Genuine HTTPS fixture is written but unexecuted. Parent PR76 source32d2595/run40183242375 has passed all three isolated DB/Auth jobs; full acceptance remains pending. Preserve37 SQL/canonical/coverage/compatibility/dependency bytes. Next: exact-source HTTPS/build acceptance and mobile forms, with lifecycle/conversion still unfinished. No activation or real records. Older sections are historical.

## Active slice: lead and source intake backend

Read PHASE_4_LEAD_INTAKE.md. Migration37 locally adopts the exact tested lead/source SQL from source1ab5111/run40181814381:17 native intake,26 encrypted-recovery and142 focused unit cases pass. Genuine source snapshots, New-only intake, fixed typed commands and reversible source CSV are implemented; state events/conversion/HTTP/forms are unfinished. Coverage is28tables/395columns (385required,10excluded). Preserve all37 published SQL on publication, canonical provenance and lockfile. Full new-source standard acceptance remains required; proposal proof is not release acceptance.

Ownership PR75 is protected-merged as mainf64c1f55e094a8f232320012eea680094d116063, matching candidatebeb215e's exact treee7fbb87 and ordered parents8f50aac/1fa9510. Candidate run40178836126 fully passes all four trusted checks/logs/artifacts,2,850 units,831DBAuth,22shell,68HTTPS leaves/78entries and restricted container. Separate actual-main run40180694421 remains under verification. Older sections below are historical, not current acceptance.

Next: complete the canonical lead backend's full acceptance, then state events/atomic conversion and private consumers. Keep complete export/independent recovery, durable lost-draft intent resolution, real devices, operational/financial/Calendar and real-use approvals gated. No spending/signup, production apply/deployment/activation or real records.


## Current consumer: vehicle customer links

Read PHASE_4_ASSOCIATION_EDITOR.md and PHASE_4_ASSOCIATION_HTTP.md. The ownership screen, typed private HTTP/client and pending-reference recovery are combined in PR75 to test the complete association workflow together. The local screen source passes 2,850 unit tests/78 files. First combined-source run40177269506 passed all eight new screen leaves, 22 shell and 831 DB/Auth, but the whole gate failed on the older vehicle fixture with an ambiguous status locator. Distinct accessible status names and exact locators correct that finding; fresh full current-source acceptance remains required. Every required current-source gate remains required before merge or readiness claims. Protected backend main is 8f50aacb53fb064721c49eeb7814570a3e21ba88, tree 92babba4b6e82ddb86cad782086ffa74cbd08313, retaining candidate c422d3d0/run 40174331962 with all four trusted checks/2,676 units/831 DBAuth/full logs/artifacts passed. Its separate actual-main run40176194007 is fully verified with all four trusted checks/full logs/artifacts. Vehicle editor actual-main run 40173749320 passed all gates. Preserve all 36 SQL, canonical provenance and dependency bytes. No spending, signup, production apply/deployment/activation or real records.

## Active consumer: private association HTTP and client

Read PHASE_4_ASSOCIATION_HTTP.md. Five explicitly configured private routes and reserved Node routing are implemented locally over PR74; ordinary request/admission/auth/recovery behavior is retained. All 2,795 unit tests/75 files, lint/types/server bundle pass. Genuine compiled HTTPS fixtures for Chromium/mobile WebKit are written and syntax-checked, but have not run. The stateless browser client now has 64 additional focused cases and a successful pinned browser-bundle build; its compiled HTTPS acceptance is written but pending. Publish the consumer stacked on PR74 to test early, then integrate the protected parent and require fresh main-based acceptance. Association forms and runtime activation remain unfinished. Preserve SQL1–36/canonical/dependency bytes. Older sections below describe parent/historical work; read live evidence before acceptance.

## Active work: dated customer–vehicle associations

Vehicle backend PR71, private HTTP PR72 and mobile editor PR73 are merged. Protected main is 7c2c0a83d2928c57dc4773b0c19c8eb95b16e41a (tree 856655e967fe58a15981832ef1713866f3e844e5). PR71's actual-main run 40169678422 and PR72's actual-main run 40172076361 passed. PR73 source 08ea716ce9f7e478ae3889ee0a89f7d8d8b646e3 passed all four trusted checks and full logs/artifacts in main-based candidate run 40172139505/attempt 1; the protected merge retains exactly that candidate tree and ordered parents c5f0890/08ea716. Separate PR73 actual-main acceptance remains pending. Older sections below retain historical evidence and do not establish current acceptance.

Read PHASE_4_VEHICLE_ASSOCIATIONS.md. The association backend implements dated owner/keeper links, independent explicit billing selection, immutable audited close, atomic transfer, retained receipts, private typed readers and reversible source CSV. Proposal run 40173321294/attempt 1 at source 849995bdf84be6db58047314f47e7ed8a663dd34 passed all 18 native association and 23 encrypted-restore cases. Exactly tested SQL SHA256 d1277347d6a2b6771290aa7fda2a1eab277cc7cd1bff742231e130fc074900b3 is promoted as canonical migration 36; temporary proposal CI is removed. Latest coverage is 26 tables and 354 columns (344 required and 10 credential exclusions). Full standard current-source feature PR acceptance remains pending. All published migration bytes, canonical provenance and the dependency lockfile remain immutable.

Next: complete current-source release acceptance, then implement association HTTP/mobile consumers. Complete authorized exports, durable unresolved-intent recovery, independent operational recovery, financial/Calendar workflows and real-use approval remain required. Synthetic only; no spending, signup, production grant/apply/deployment, activation or real records.

## Active screen: vehicle editor

Read PHASE_4_VEHICLE_EDITOR.md. This consumer follows PR72's private vehicle HTTP with `/vehicles`, nullable intake/year fields, genuine search/history/archive and exact original pending-save handling. Preserve private in-memory drafts and block lost-draft/absent-receipt replacements. Local checks are not exact-source Next/HTTPS/device acceptance; run the expanded actual fixture and retain every security/recovery/container gate. Vehicle associations, atomic ownership transfer and typed attachment publication remain next work. No SQL, canonical or dependency change.

## Current consumer: private vehicle HTTP

Read PHASE_4_VEHICLE_HTTP.md. Vehicle backend PR71 source45c4292 retains all35 published migrations; its exact native17-case vehicle and22-case encrypted recovery suites pass in run40168254083, while full candidate/build acceptance remains pending. Sourcefed3d09 had one invalid field in its permission test; the correction checks real label writes against both restricted callers. Do not edit SQL35 or treat earlier units as current-source acceptance. Address protected main isd9327e6; verify actual-main run40167780564 separately.

This branch adds private five-route HTTP and stateless vehicle browser methods with independent explicit opt-in, unchanged authorization/admission/recovery fences and actual HTTPS acceptance fixtures. No vehicle screen or ownership source is claimed. Next: finish native findings, vehicle mobile editor and genuine dated customer association/atomic transfer, then typed attachment workflows and existing usable-release gates. No paid service or real-data activation.

## Active change: genuine vehicle directory; address acceptance pending

PR66/protected main8dc8d16ef9868490197db412b88a46d6b8f9b3ff, tree7c5daeb05ae0063ec1d69be7c8ebc27d44ba604e, passed candidate40150463624 and actual-main40152710258. Exact-source proof and finalized artifact bindings are in PR66. Retained object/database snapshot restoration is verified on isolated fixtures; independent cloud/vault/configuration/key/image recovery remains gated.

Read WORKING_STATE.md and PHASE_4_CUSTOMER_DIRECTORY.md. ADR41/ROADMAP1.6 explicitly overlap synthetic Phases3/4 construction so genuine CRM parents support later typed attachment links. This is sequencing within approved V1 scope, with all acceptance/security/export/recovery/accounting/real-data gates retained. Keep the existing stack and all checks.

PR67 adds the real customer backend with migrations32-33, scoped history, atomic receipts and strict encrypted restore coverage. PR68 adds the explicitly configured private HTTP routes and stateless browser transport. Verify their actual heads/candidate/main checks before merging or treating them as release proof. Every published SQL and canonical provenance byte remains unchanged by this consumer.

PR69's customer editor passes its exact main-based candidate run40161873803, including genuine Chromium/WebKit/Auth/PostgreSQL flows; protected merge566a07632af265e618a62dd6d3aaac05d003ed16 retains the reviewed treee603c9bb3eac63e571cc3970eaf829ee1baaf924. Verify its actual-main run separately. Customer forms preserve only opaque pending references per tab; absent/lost-draft intent stays review-blocked without replacement and durable operator resolution remains a real-use gate.

Migration34 adds a genuine same-business customer-owned address source with closed owners/RLS, immutable parent, complete audit, version/ID/parent conflicts, original operation/epoch replay, typed server methods,26-column snapshot/CSV and actual encrypted same-snapshot recovery coverage. Read PHASE_4_CUSTOMER_ADDRESSES.md. The private HTTP/client consumer now follows the same explicit customer opt-in; address mobile forms and original-parent interrupted-save handling are implemented, with exact-source native acceptance required and default runtime closed. Latest source coverage is24tables/312columns. Native upgrade/denial/concurrency/recovery execution is required before verification; every33 prior SQL and all canonical bytes remain unchanged. Vehicle/association contracts remain initial work only.

Migration35 adds the genuine22-column vehicle source/private commands/snapshot/CSV and encrypted same-snapshot recovery fixture. Read PHASE_4_VEHICLE_DIRECTORY.md; source coverage is25tables/334columns. All34 published SQL and canonical/dependency bytes remain unchanged. Native execution is pending. Vehicle associations/ownership transfer and HTTP/forms are separate unfinished work.

## Next

Finish actual-main editor proof and execute the current address HTTP candidate's full native gates. Backend17-case address and21-case encrypted recovery tests pass at source18a1542; that does not certify newer HTTP code. Resolve current address screen/HTTP/native findings, then implement genuine vehicle/association commands with atomic historical ownership rules. Continue typed attachment publication/authorized reads, unresolved-intent operator recovery, whole exports and compatible independent vault/configuration/key/image/incident recovery before real-data approval. No speculative verifier refinement, paid setup or status-only PR.
