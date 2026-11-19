# Design-audit coverage — November 19, 2026

This inventory reconciles all 70 original groups: 14 shared findings, 36 destinations and 20 deeper workflows. It preserves every original group and its full requirement text in [DESIGN_AUDIT_COVERAGE.json](DESIGN_AUDIT_COVERAGE.json). The original audit SHA-256 and current assessment source are recorded there.

## Counted progress

| Local implementation review | Groups |
|---|---:|
| Main change locally addressed | 39 |
| Partial implementation or required review | 29 |
| Open audit work | 2 |
| Review required before choosing changes | 0 |
| Total | 70 |

39/70, or 55.7%, is the share whose main local change is addressed by this conservative group-count method. It is **not** a claim that 55.7% of all work hours are spent, that the other groups are untouched, or that any particular release is accepted. 29 groups have partial work; 2 groups remain open or require dedicated baseline review. Do not publish a blended percentage by assigning invented half-credit to partial groups.

The audit is **not finished**. Each row has remaining implementation or verification. Full current-source/state, delivered-build and physical iPhone acceptance is not established. The earlier roughly 80% figure is a low-confidence V1 coding estimate and is not the audit percentage. This inventory does not reduce the broader goal: complete this audit and then all unfinished approved V1 functionality, including P16/P17, native files, recoverable backups, preserved upgrades and owner/device readiness.

## How to read the rows

Locally addressed means the main proposed change exists in the inspected source and has retained scoped workflow evidence (or, for the already-appropriate missing page, retained baseline plus source inspection). It does not close every explicit state, zoom, release or device requirement. Partial means some implementation exists but a named change or required review is still missing. Open describes the audit refinement, not absence of the entire product feature. Review required means the audit itself needs a fresh configured baseline before implementation is chosen.

The JSON contains original requirements, source/notes links with SHA-256 fingerprints, current implementation, remaining work and verification scope for every row. A changed fingerprint makes this assessment stale and requires re-review. Automated coverage validation proves row/link integrity only.

## Item-by-item register

| ID | Audit group | Local state | Remaining work |
|---|---|---|
| S01 | One visual system, delivered consistently | Open | Deliver an accepted matching release, preserve the populated upgrade and compare installed states. |
| S02 | Desktop layouts need purpose, not more cards | Partial | Finish remaining prerequisite, supplier and configured-page compositions; review all wide layouts. |
| S03 | Phone record detail should replace the directory | Partial | Reconcile every selected-record workflow, especially remaining commercial/supplier states, and exact return position. |
| S04 | Make action priority predictable | Partial | Review commit/refresh/recovery priority in every configured task; one narrow success is not global coverage. |
| S05 | Reduce visual nesting | Partial | Finish accepted-document, supplier and remaining approval/completion nesting. |
| S06 | Treat every state as a designed screen | Partial | Complete the eight-state cross-workflow inventory and exact-source visual verification;72 baseline captures do not cover it. |
| S07 | Keep financial scope attached to the number | Main change addressed | Fresh full-head and delivered acceptance remain separate gates. |
| S08 | Make Crest recognizable through restraint | Partial | Resolve a legible approved small-size asset and confirm brand consistency on delivered documents/sign-in/navigation. |
| S09 | Replace Unicode navigation symbols | Main change addressed | Physical-device and installed verification remain separate. |
| S10 | Refine type, spacing and numeric rhythm | Partial | Complete all-view16px input, zoom, long-name and served-font checks; do not diagnose by a screenshot alone. |
| S11 | Motion should explain changes | Partial | Finish state-specific motion duration, stable geometry, focus and quiet save-response review. |
| S12 | Turn history into a readable evidence trail | Partial | Finish remaining agreement, proposal, approval and integration histories and their missing/stale variants. |
| S13 | Protect context through every transition | Partial | Verify planner date/view and all remaining contextual returns plus sign-out/private clearing on the exact release. |
| S14 | Phone finishing is physical-device work | Open | Complete the required physical iPhone, keyboard, safe-area, camera/download, zoom and reduced-motion acceptance. |
| R01 | Sign in (/sign-in) | Partial | Finish single-brand composition and wrong-code/expired/success/keyboard/zoom review with security clearing preserved. |
| R02 | Today (/) | Partial | Reconcile compact empty queues and wide agenda/attention composition for scheduled, active, overdue-only and partial reads. |
| R03 | Customer addresses (/addresses) | Main change addressed | Fresh release/device and broader state review remain; saved quote address snapshots must stay immutable. |
| R04 | Appointment proposals (/appointment-holds) | Partial | Reconcile empty-state hierarchy and configured unconfirmed/withdrawn/confirmed phone/desktop presentations. |
| R05 | Customer directory (/customers) | Main change addressed | Revalidate all profile sections, sign-out and navigation states at the final release. |
| R06 | Contact CSV review (/customers/import-review) | Partial | Investigate retained provider verification failures using safe actual error categories without retries or relaxed security/deadlines; complete remaining state/zoom/private/device/release review. Loaded faces and actual Chromium glyph fonts are verified on inspected CSV content. |
| R07 | Expenses (/expenses) | Partial | Finish every loaded/empty/loading/denied/uncertain/invalid-file variant and real format/device acceptance. |
| R08 | Business data exports (/export-files) | Partial | Finish export-center distinctions, selected request composition and equivalent capability/data states; never imply partial equals complete. |
| R09 | Lead sources (/lead-sources) | Main change addressed | Remaining source state/pagination and final release/device verification stay open. |
| R10 | Leads and follow-ups (/leads) | Main change addressed | Complete remaining state variants and final release; do not alter follow-up eligibility. |
| R11 | Quotes (/quotes) | Main change addressed | Complete additional many-line/long-value/state variants, retained access-failure investigation and final exact-source release/installed/physical-device acceptance. |
| R12 | Quote amendments (/quotes/amendments) | Partial | Reconcile complete retained/changed-item comparison hierarchy and configured modes; current hosted timeout remains unexplained. |
| R13 | Interrupted save review (/save-review) | Partial | Finish all no-reference/recorded/unresolved/access-lost identity, safe-return and phone compositions. |
| R14 | Schedule / saved job (/schedule) | Partial | Finish compact loaded-job/header/action reach and contextual returns for remaining actual states/linked workflows, wider stress/zoom/privacy and exact release/installed/physical-device acceptance. |
| R15 | Change appointment (/schedule/change) | Partial | Review compact phone comparison, timezone/reason/reservation effect and adjacent communication status across actual outcomes. |
| R16 | Trip mileage (/schedule/mileage) | Partial | Finish full job/trip/vehicle context, desktop aligned density and remaining empty/long-list/state review. |
| R17 | Service arrangements (/schedule/modes) | Main change addressed | Complete populated-existing-job/policy-dependent and remaining state variants plus fresh current-head release/installed/physical-device acceptance. |
| R18 | Book a visit (/schedule/new) | Partial | Reconcile the configured booking stages, persistent customer/work context and unavailable/loading slot presentations. |
| R19 | Standalone travel (/schedule/travel) | Main change addressed | Remaining long-page/state and delivered/device acceptance stay open; no inferred business classification. |
| R20 | Work status (/schedule/work) | Partial | Finish compact loaded job strip, single next-action hierarchy and keyboard/phone reach for every actual state. |
| R21 | Cancel started job (/schedule/work/cancel) | Partial | Complete eligible affected-scope/reason/final-confirmation visual review and prove retained work at all relevant states. |
| R22 | End job (/schedule/work/complete) | Main change addressed | Complete many-vehicle/long-value/context-specific and remaining state variants plus exact-head release/upgrade/installed/physical-device acceptance. |
| R23 | Interrupt trip (/schedule/work/interrupt) | Partial | Finish configured trip/job consequence hierarchy and en-route/arrived/uncertain visual acceptance. |
| R24 | Recorded work time (/schedule/work/time) | Main change addressed | Remaining history/pagination/state and final device/release acceptance stay open. |
| R25 | Services (/services) | Main change addressed | Final stress/denied/history/device verification remains; accepted quote/job prices must not change. |
| R26 | Business settings (/settings) | Main change addressed | Remaining child setup states and delivered/device acceptance stay open. |
| R27 | Accounting home (/settings/accounts) | Main change addressed | Complete remaining state/zoom/private-clearing variants; investigate retained tax/session failures and preserve exact-source release/installed/physical-device requirements. |
| R28 | Money channels (/settings/accounts/channels) | Main change addressed | Remaining channel/history/pagination/setup states and delivered/device checks remain. |
| R29 | Dated account mappings (/settings/accounts/mappings) | Main change addressed | Remaining state and final release/device verification remain; never silently fall back across gaps. |
| R30 | Expense category mappings (/settings/accounts/mappings/categories) | Main change addressed | Complete remaining loading/error/denied/stale/long-value variants and fresh exact-head release/installed/physical-device acceptance. |
| R31 | Category approvals (/settings/accounts/mappings/categories/manage) | Partial | Integrate retained approval history with proposed editing and finish staged phone selection/review acceptance. |
| R32 | Mapping approvals (/settings/accounts/mappings/manage) | Main change addressed | Remaining full state and final release/device verification stay open. |
| R33 | Tax profiles (/settings/accounts/tax) | Main change addressed | Remaining long/history/state and final release/device verification stay open; no unsupported jurisdiction directory is invented. |
| R34 | Calendar setup (/settings/google-calendar) | Main change addressed | Investigate original session/held-request failures; finish paused/recovery and remaining state/privacy variants plus full exact-source release/installed/physical-device acceptance. Actual selected changes and cookie-loss clearing/direct sign-in recovery now pass both engines. |
| R35 | Vehicle directory (/vehicles) | Main change addressed | Final profile/history/photo, sign-out and device/state verification remain; no stock evidence image. |
| R36 | Page not found (/audit-page-does-not-exist) | Main change addressed | Retained baseline plus source inspection is not a fresh final-release/device run. |
| D01 | Customer profile | Partial | Reconcile compact last/next-visit facts and action hierarchy consistently across all profile sections. |
| D02 | Schedule planner | Main change addressed | Complete additional empty/error/recovery/long-value/zoom/selected-change variants and fresh full release/installed/physical-device acceptance. Planning stays distinct from active execution; loaded-time cues do not infer availability or override approval. |
| D03 | Quote editor and preview | Main change addressed | Other long/many-line/retained/denied/stale/pending states and access-failure investigation remain; exact-head release, installed and physical-device acceptance are separate gates. |
| D04 | Sharing and acceptance | Partial | Finish compact accepted-agreement/event hierarchy with all retained content and honest delivery evidence. |
| D05 | Receipt viewer | Main change addressed | Original-file formats, full release and physical iPhone remain separate required acceptance. |
| D06 | Partial completion | Main change addressed | Finish additional stress, policy/context, access/stale/pending and device/release variants without treating local coverage as final sign-off. |
| D07 | Saved completion and follow-up | Main change addressed | Other outcome/message/delivery states and final release/device acceptance remain. |
| D08 | Work-time ledger | Main change addressed | Other large/stale/denied histories and final source/device acceptance remain. |
| D09 | Trial balance | Main change addressed | Complete specific text-zoom/final-source and delivered verification; implementation presence is not that sign-off. |
| D10 | Income statement | Main change addressed | Fresh full-head/all relevant state and delivered/device verification remain. |
| D11 | Receivables aging | Main change addressed | Finish long/truncated/empty/error/private-clearing/zoom variants and fresh full-release/installed/physical-device acceptance. |
| D12 | Customer funds | Main change addressed | Fresh full-head and long/truncated/delivery/device variants remain. |
| D13 | Issued invoice | Partial | A verified invoice-scoped outstanding header remains to implement/review; payment choices are date-scoped and are not a typed zero-balance result. The original total must not be used as a guessed balance. |
| D14 | Payment correction | Main change addressed | Other correction/history/stale states and fresh full-head acceptance remain; no invented cash or total balance. |
| D15 | Statement staging | Main change addressed | Other account-identity/long-value/state and installed/device acceptance remain; staging never means reconciliation. |
| D16 | Supplier bills | Main change addressed | Complete remaining state/long-value/native-original-format variants and fresh release/installed/physical-device acceptance. |
| D17 | Dated approval history | Main change addressed | Remaining large/gap/state and final release/device review remain. |
| D18 | Travel history | Main change addressed | Remaining long pagination/failure states and final source/device verification remain. |
| D19 | Calendar waiting state | Main change addressed | Complete paused/recovery and other missing state/privacy variants; investigate original session/held-request failures and preserve truthful simulation labels through final release/device acceptance. Selected-change refusal/focused reload and actual cookie-loss clearing/sign-in navigation pass. |
| D20 | Drop-off custody history | Main change addressed | Other custody editor/state, native original-format and physical-device/full release acceptance remain. |

## Next sequence

1. Investigate the retained CSV user-verification HTTP500 with safe actual error categories; complete remaining state review; actual Chromium glyph-font evidence is retained for inspected CSV content. Final-width seven-parent browser acceptance passes, but is not a cause/cure for earlier failures. Preserve the original failed historical54 CI schema comparison; focused25/25 and observed369/369 local passes do not prove a cause/cure or release acceptance. No login retry, deadline/freshness weakening or blind CI retry.
2. Finish remaining Calendar paused/recovery/privacy states and investigate original session/held-request failures; actual selected-change and cookie-loss recovery journeys pass in both engines; preserve actual reschedule refusal, bounded directory, pagination/return and quote reading modes.
3. Complete remaining report/state/stress variants; the wide receivables date/load width is verified in both complete configured invoice journeys; preserve completed four-report and planner/context-return evidence. Continue every remaining original page/workflow refinement.
4. Complete state/zoom/long-value/privacy verification and the unchanged full-release, upgrade, restore and physical-device gates. Reconcile every row before claiming audit completion.

The JSON embeds the original sequence/acceptance and review-gap text. The source register and per-domain notes remain evidence; neither this table nor green narrow checks replace required verification.
