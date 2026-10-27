# V1 delivery inventory and working estimates

2026-10-27. This replaces the earlier unmeasured percentage/hour guesses with a source-based inventory. It is an engineering judgment, not a time-tracking report or a release certificate. Requirements remain PRODUCT P01-P20 and ROADMAP1.6, including Google Calendar. No scope is dropped.

## What exists and what remains

| Group | Executed implementation found | Remaining work | Share of V1 coding effort used for estimate |
|---|---|---|---:|
| Access and foundations | Pinned tooling,43 registered migrations, owner/provider/MFA/session/recovery/RLS/audit/operation code; genuine native and browser evidence for earlier exact sources | Configured durable sample startup, owner provisioning/consent, accepted current integrated release, deployed smoke and real-use gates | 12% |
| CRM and intake | Customer/address/vehicle/source/ownership, lead reports/locations/status, conversion, per-source history and exports; shared working preview and follow-up picker | Full follow-up dashboard including explicitly scheduled lost leads, duplicate-review prompts, integrated commercial history and durable deployment | 12% |
| Files and recovery foundation | Private object staging, image/PDF/HEIC validation, encrypted custody and source-export components | Typed business attachment publication/read paths, ordinary app generation/recovery composition, independent complete restore and real-device checks | 10% |
| Catalog and quotes | Shared exact pricing, service definition/version domain and unsaved service/quote editor implemented; canonical commercial contracts | Catalog schema passed29 native cases; trusted save/read commands written with native acceptance pending, plus source export/independent recovery and adoption; category/condition records; persisted quotes, rendering, send/accept/revision/amendment workflows and end-to-end acceptance | 12% |
| Scheduling and field work | Canonical contracts and generic foundations | Appointments/conflicts, job travel/timers/completion, custody/dropoff/return, photos, native outreach/maintenance and outbound Google Calendar | 18% |
| Finance and books | Adopted accounting specifications and source/audit foundations | Actual ledger/posting domains; invoices/payments/tips/excess/refunds, expenses/vendors/mileage/funding, openings/transfers/reconciliation/locks and financial acceptance | 22% |
| Reports/import/portability | Extensive source export/CSV and encrypted delivery construction for implemented sources | Finished generation flow, complete cross-domain CSV/XLSX/PDF/report totals, migration/dedup/opening staging and portable reimport | 8% |
| Product/release hardening | Responsive shared CRM screens, browser and release harnesses | Full device/accessibility/capacity/recovery/lifecycle coverage, pilot and cutover runbooks for the completed product | 6% |

Evidence inspected: src/app has CRM, sign-in/settings/save-review and export screens; src contains customer/security/files/server/tooling/client modules, with a new stateless commercial pricing domain/worksheet, but no persisted catalog/quote/job/ledger/billing application domain located in this checkout. The migration verifier reports43 registered migrations. Generic tasks and export workers are not counted as implemented scheduling, finance or job features. Specifications/research are not counted as executed domain code.

2026-10-27 commercial update: PHASE_5_QUOTE_WORKSHEET.md records35 pricing tests,27HTTP checks and an interactive unsaved worksheet. This begins commercial implementation; stored catalog and actual approved offers remain unimplemented. The broad estimate below remains25-35%; no automatic percentage is added for one preliminary slice.

2026-10-27 service update: PHASE_5_SERVICE_EDITOR.md adds40 service domain cases (75 with pricing),28HTTP checks and browser-verified definition/edit/archive/reopen/copy behavior. Quote copies retain the earlier customer scope and owner amount, without internal guidance. These are reusable domain/UI components, not a completed persistent catalog. The estimate remains25-35%; real-data readiness and the broad remaining-hour ranges below are unchanged.

2026-10-27 storage construction: PHASE_5_CATALOG_STORAGE.md adds a closed, unregistered two-table schema and29 PostgreSQL cases awaiting native execution, with no trusted save/read command or catalog export/restore yet. Full local units6058/186 pass. This is partial commercial construction, not a completed persistent catalog, and does not change the25-35% estimate or real-use/hour assessments.

## Fresh rough estimates

Full approved V1 coding is approximately **25-35% complete**, with low-to-moderate confidence. Weighting is judgmental: access is roughly70-90%, CRM85-95%, file/recovery foundations35-55%, reports/import10-25%, release hardening5-15%, and the commercial/operational/financial groups mostly0-5% in executable delivery. These weights describe remaining engineering work, not file counts or test counts. The rounded total is intentionally broad.

The visible sample can be launched and tested now. A **durable CRM-only synthetic test installation** is roughly **15-30 further active engineering hours once its local runtime prerequisites work**. It is a narrower testing milestone, not a reduced V1 definition or permission to use real records. Windows setup/reboots, owner consent, CI waiting and feedback delays are excluded.

For the **full approved V1**, a provisional remaining range is **200-350 active engineering hours**, including implementation and relevant verification. Confidence is low because financial and operational vertical slices have not been implemented here yet. This is not a calendar-date or continuous-agent promise. Re-estimate after the first catalog-to-quote slice and after genuine durable sample startup; investigate overruns rather than repeatedly adding invisible infrastructure.

Real Crest operational/financial readiness remains **not ready**. Code completion, sample usability and production acceptance are separate. Prior high test counts establish specific foundation behavior, not completion of missing workflows. Progress percentages should change when meaningful weighted deliverables advance, not automatically with each continuation or test.

## Exact-source status

The current owner-preview work remains local on feature/owner-review-workspace, based on checkpoint54731c51 before this commercial slice. Live read-only GitHub inspection confirmed PR91 still open at07470b65 and run40528663344 completed/success. PR92 remains a draft at14de626f and run40532054037 completed/failure. The previously diagnosed default-ACL proposal failure remains unresolved and unregistered; it must be fixed before admission adoption. No run was retried/cancelled and no PR state changed.

The accepted public parent proof and current local work are separate. This inventory does not promote local review tests to full current-source release acceptance.

## Free durable-test path

See FREE_LOCAL_TEST_SETUP.md. Read-only checks found no Docker, Podman or PostgreSQL executables; wsl --status says WSL is not installed. Pinned Supabase CLI2.121.0 runs when its process-local home is inside the writable workspace and telemetry is off. Its presence is not a database.

Official Supabase documentation supports native local services only on Linux and Apple-silicon macOS, not Windows. Docker/WSL is the supported free local direction for this computer. Plain portable PostgreSQL exists, but cannot replace the application's genuine Auth/RLS/provider setup and pinned integration requirements. No software was installed and no host security setting was bypassed. A full free production operating plan, including independent backups, remains unproven.

## Follow-up picker delivered with this inventory

Working review09 adds the shared native date/time picker, explicit UTC/device-zone selection and optional precise UTC entry. Zone selection changes presentation only. Unedited source seconds/microseconds stay exact. New minute choices are matched against actual nearby zone offsets; DST gaps fail closed and folds require an explicit occurrence. No business timezone is silently inferred or rewritten. P02 still needs the complete due/overdue dashboard.

Executed:93 focused lead/date-input units in3files, including18 new picker cases;26 real HTTP preview cases; types/focused lint and43-migration verification. Browser review chose the later Indianapolis fall-back occurrence, saved/reopened, preserved06:30:01.123456Z through an unrelated notes edit, refused a spring-forward gap, restored the unchanged saved value and checked360px layout. Native keyboard commits were used for the browser calendar field; both input/change handlers are supported. The existing native release fixture now covers calendar input and expands precise entry, but was not executed locally. No whole-suite/current native release pass is claimed.

Next implement the catalog/quote vertical slice and, when Windows runtime setup is available, the durable synthetic CRM launcher. Keep the preview current without expanding a parallel mock product. Spend remains$0; production activation, real data and paid services remain unapproved.
